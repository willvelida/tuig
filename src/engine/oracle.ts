import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
  // Even an ignored source is exposed if identical bytes exist anywhere in this object DB.
  const format = gitOutput(['rev-parse', '--show-object-format'], root);
  const blob = createHash(format === 'sha256' ? 'sha256' : 'sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0'))
    .update(bytes)
    .digest('hex');
  const probe = runGit(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'], root);
  if (probe.error || probe.status !== 0 || probe.stdout.split(/\r?\n/).includes(blob))
    throw codedError('TUIG_E_ORACLE_REVIEW');
  const rel = relative(root, realpathSync(file));
  if (!rel.startsWith('..' + sep) && !isAbsolute(rel) && !rel.split(sep).includes('.tuig'))
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
  try {
    cpSync(worktree, directory, {
      recursive: true,
      filter(source) {
        const parts = relative(worktree, source).split(sep);
        if (parts.some((p) => ['.git', '.tuig', '.agents', 'tests-hidden'].includes(p)))
          return false;
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
        '-c',
        'tests-hidden/pytest.ini',
        'tests-hidden/test_oracle.py',
      ],
      '.',
      oracle.timeoutMs,
      options,
    );
    if (result.status === 'ok' && result.exitCode === 0)
      return { verdict: 'pass', source: 'hidden_oracle' };
    if (result.status === 'nonzero_exit' && result.exitCode === 1)
      return { verdict: 'fail', source: 'hidden_oracle' };
    return {
      verdict: 'infrastructure_error',
      source: 'hidden_oracle',
      code: 'TUIG_E_PREREQUISITE',
    };
  } catch {
    return { verdict: 'infrastructure_error', source: 'hidden_oracle', code: 'TUIG_E_WORKSPACE' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
