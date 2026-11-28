import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { codedError } from '../cli/errors.js';
import { gitOutput, runGit } from './git.js';
import { runProcess, type ProcessOptions } from '../runner/tools/run.js';
import { MAX_REPORT_BYTES } from '../checks/parsers.js';
import { oracleReportPassed } from './oracle-report.js';
import { oracleSnapshotPath } from './protected-tests.js';

export type Oracle = { bytes: Buffer; sha256: string; timeoutMs: number; sourceDirectory: string };
export type TaskVerdict = {
  verdict: 'pass' | 'fail' | 'not_evaluated' | 'infrastructure_error';
  source: 'hidden_oracle';
  code?: string;
};

/** Pin reviewed bytes before the first model request. No oracle data enters the record. */
export function loadOracle(
  root: string,
  taskDir: string,
  task: {
    oracle?: { framework?: unknown; hidden?: unknown; sha256?: { hidden?: unknown } };
    timeouts?: { hiddenSec?: unknown };
  },
): Oracle | undefined {
  if (!task.oracle) return undefined;
  const { hidden, framework, sha256 } = task.oracle;
  const timeout = task.timeouts?.hiddenSec;
  if (
    framework !== 'pytest' ||
    typeof hidden !== 'string' ||
    isAbsolute(hidden) ||
    hidden.includes('\\') ||
    hidden.includes('\0') ||
    hidden.split('/').includes('..') ||
    typeof sha256?.hidden !== 'string' ||
    !/^[a-f0-9]{64}$/.test(sha256.hidden) ||
    typeof timeout !== 'number' ||
    !Number.isFinite(timeout) ||
    timeout <= 0 ||
    timeout > 3600
  )
    throw codedError('TUIG_E_ORACLE_REVIEW');
  const file = resolve(taskDir, hidden);
  if (
    relative(realpathSync(taskDir), realpathSync(file)).startsWith('..') ||
    !lstatSync(file).isFile() ||
    lstatSync(file).isSymbolicLink()
  )
    throw codedError('TUIG_E_ORACLE_REVIEW');
  const bytes = readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256.hidden)
    throw codedError('TUIG_E_ORACLE_REVIEW');
  const rel = relative(root, realpathSync(file));
  const inRepository = !rel.startsWith('..' + sep) && !isAbsolute(rel);
  if (inRepository) {
    const tracked = runGit(['ls-files', '-z', '--', rel], root);
    if (tracked.error || tracked.status !== 0 || tracked.stdout.length)
      throw codedError('TUIG_E_ORACLE_REVIEW');
    if (!rel.split(sep).includes('.tuig')) throw codedError('TUIG_E_ORACLE_REVIEW');
  }
  // Even an ignored source is exposed if identical bytes exist anywhere in this object DB.
  const format = gitOutput(['rev-parse', '--show-object-format'], root);
  const variants = [bytes, Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))];
  const blobs = variants.map((content) =>
    createHash(format === 'sha256' ? 'sha256' : 'sha1')
      .update(Buffer.from('blob ' + content.length + '\0'))
      .update(content)
      .digest('hex'),
  );
  const probe = runGit(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'], root);
  if (
    probe.error ||
    probe.status !== 0 ||
    probe.stdout.split(/\r?\n/).some((object) => blobs.includes(object))
  )
    throw codedError('TUIG_E_ORACLE_REVIEW');
  return {
    bytes,
    sha256: sha256.hidden,
    timeoutMs: timeout * 1000,
    sourceDirectory: realpathSync(taskDir),
  };
}

/** Called only after control has ended: the adapter can never observe this directory. */
export async function finalOracle(
  worktree: string,
  oracle: Oracle,
  options: ProcessOptions,
): Promise<TaskVerdict> {
  if (!options.sandbox)
    return { verdict: 'infrastructure_error', source: 'hidden_oracle', code: 'TUIG_E_SANDBOX' };
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-oracle-')));
  const reports = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-oracle-report-')));
  const reportPath = join(reports, randomUUID() + '.xml');
  try {
    cpSync(worktree, directory, {
      recursive: true,
      filter(source) {
        if (!oracleSnapshotPath(relative(worktree, source))) return false;
        if (lstatSync(source).isSymbolicLink()) throw codedError('TUIG_E_WORKSPACE');
        return true;
      },
    });
    const hidden = join(directory, 'tests-hidden', 'test_oracle.py');
    if (existsSync(dirname(hidden))) throw codedError('TUIG_E_ORACLE_REVIEW');
    mkdirSync(dirname(hidden));
    writeFileSync(hidden, oracle.bytes, { flag: 'wx', mode: 0o600 });
    if (createHash('sha256').update(readFileSync(hidden)).digest('hex') !== oracle.sha256)
      throw codedError('TUIG_E_ORACLE_REVIEW');
    writeFileSync(join(directory, 'tests-hidden', 'pytest.ini'), '[pytest]\n');
    const result = await runProcess(
      directory,
      [
        'python',
        '-I',
        '-m',
        'pytest',
        '-p',
        'no:cacheprovider',
        '--noconftest',
        '-o',
        'pythonpath=.',
        '-o',
        'xfail_strict=true',
        '-c',
        'tests-hidden/pytest.ini',
        '--junitxml=' + reportPath,
        'tests-hidden/test_oracle.py',
      ],
      '.',
      oracle.timeoutMs,
      {
        ...options,
        additionalWritablePaths: [...(options.additionalWritablePaths ?? []), reports],
      },
    );
    // A sandbox launcher can itself exit 1 when Python is missing. A fresh,
    // bounded pytest report distinguishes completed tests from launch failure.
    if (
      !existsSync(reportPath) ||
      !lstatSync(reportPath).isFile() ||
      lstatSync(reportPath).isSymbolicLink()
    )
      return {
        verdict: 'infrastructure_error',
        source: 'hidden_oracle',
        code: 'TUIG_E_PREREQUISITE',
      };
    const fd = openSync(reportPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let report: string;
    try {
      const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const n = readSync(fd, buffer, size, buffer.length - size, null);
        if (!n) break;
        size += n;
      }
      if (size > MAX_REPORT_BYTES) throw codedError('TUIG_E_PREREQUISITE');
      report = buffer.subarray(0, size).toString('utf8');
    } finally {
      closeSync(fd);
    }
    let passed: boolean;
    try {
      passed = oracleReportPassed(report);
    } catch {
      throw codedError('TUIG_E_PREREQUISITE');
    }
    if (result.status === 'ok' && result.exitCode === 0 && passed)
      return { verdict: 'pass', source: 'hidden_oracle' };
    if (
      (result.status === 'nonzero_exit' &&
        (result.exitCode === 1 || ([2, 5].includes(result.exitCode ?? -1) && !passed))) ||
      (result.status === 'ok' && result.exitCode === 0)
    )
      return { verdict: 'fail', source: 'hidden_oracle' };
    return {
      verdict: 'infrastructure_error',
      source: 'hidden_oracle',
      code: 'TUIG_E_PREREQUISITE',
    };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return {
      verdict: 'infrastructure_error',
      source: 'hidden_oracle',
      code:
        code === 'TUIG_E_ORACLE_REVIEW' || code === 'TUIG_E_PREREQUISITE'
          ? code
          : 'TUIG_E_WORKSPACE',
    };
  } finally {
    rmSync(reports, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
}
