import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runProcess, type ProcessOptions } from '../runner/tools/run.js';
import { runGit } from './git.js';
import { redactor, REDACTED } from './redact.js';
import type { Workspace } from './workspace.js';

export const SECRET_GATE_FIX =
  'Install gitleaks on PATH and verify it can scan with detect --no-git; then retry the run. Never put credentials in the result files.';
export type SecretGateResult = {
  status: 'disabled' | 'not_evaluated' | 'pass' | 'fail' | 'infrastructure_error' | 'cancelled';
  enabled: boolean;
  code?: 'TUIG_E_PREREQUISITE';
  reason?: 'preparation_limit' | 'preparation_timeout';
  message?: string;
  fix?: string;
  findings: { rule: string; file: string; line: number; marker: string }[];
};

const MAX_BYTES = 1024 * 1024;
const MAX_SNAPSHOT = 64 * MAX_BYTES;
const MAX_OBJECTS = 256;
const MAX_COMMITS = 128;
const PREPARATION_MS = 10000;

/** Host-owned bounded report. No raw tool output, match or secret leaves this module. */
function report(path: string): unknown {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('report');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error('report');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const n = readSync(fd, bytes, size, bytes.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size > MAX_BYTES) throw new Error('report');
    return JSON.parse(bytes.subarray(0, size).toString('utf8')) as unknown;
  } finally {
    closeSync(fd);
  }
}

/** Scan the delivered tree, every newly reachable commit's changed blobs and its message. */
export async function secretGate(
  workspace: Workspace,
  options: ProcessOptions = {},
  timeoutMs = 10000,
): Promise<SecretGateResult> {
  const failure: SecretGateResult = {
    enabled: true,
    status: 'infrastructure_error',
    code: 'TUIG_E_PREREQUISITE',
    findings: [],
  };
  let directory: string | undefined;
  let reports: string | undefined;
  const cancelled = (): SecretGateResult => ({ enabled: true, status: 'cancelled', findings: [] });
  const deadline = performance.now() + PREPARATION_MS;
  const check = (): void => {
    if (options.signal?.aborted) throw new Error('cancelled');
    if (performance.now() >= deadline) throw new Error('preparation_timeout');
  };
  const read = (args: string[], maxBuffer = MAX_BYTES, env?: NodeJS.ProcessEnv): string => {
    check();
    const result = runGit(args, workspace.path, {
      maxBuffer,
      timeoutMs: Math.max(1, Math.floor(deadline - performance.now())),
      ...(env ? { env } : {}),
    });
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ETIMEDOUT') throw new Error('preparation_timeout');
    if (code === 'ENOBUFS') throw new Error('preparation_limit');
    check();
    if (result.error || result.status !== 0) throw new Error('git');
    return result.stdout;
  };
  try {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-secrets-')));
    const sourceDirectory = directory;
    reports = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-secret-report-')));
    // Same private-index snapshot semantics as diff.patch, with the gate's
    // remaining preparation deadline applied to every Git subprocess.
    const env = { ...process.env, GIT_INDEX_FILE: join(reports, 'index') };
    read(['read-tree', 'HEAD'], MAX_BYTES, env);
    read(['add', '--all', '--', '.'], MAX_BYTES, env);
    const tree = read(['write-tree'], MAX_BYTES, env).trim();
    const blobs = new Map<string, string>();
    const files = new Map<string, string>();
    let total = 0;
    const addDiff = (args: string[]): void => {
      const fields = read(args).split('\0');
      if (fields.pop() !== '') throw new Error('git');
      if (fields.length % 2 || fields.length / 2 > MAX_OBJECTS)
        throw new Error('preparation_limit');
      for (let i = 0; i < fields.length; i += 2) {
        const match = /^:[0-7]{6} [0-7]{6} [a-f0-9]{40,64} ([a-f0-9]{40,64}) [ACMT]$/.exec(
          fields[i]!,
        );
        if (!match || !fields[i + 1]) throw new Error('git');
        if (!blobs.has(match[1]!)) blobs.set(match[1]!, fields[i + 1]!);
        if (blobs.size + files.size > MAX_OBJECTS) throw new Error('preparation_limit');
      }
    };
    const addText = (text: string, file: string): void => {
      check();
      total += Buffer.byteLength(text);
      if (total > MAX_SNAPSHOT || files.size >= MAX_OBJECTS) throw new Error('preparation_limit');
      // Opaque names prevent repository .gitleaks.toml, .gitleaksignore and
      // default filename allowlists from changing the trusted scanner policy.
      const name = randomUUID() + '.txt';
      files.set(name, file);
      // 8.16 has no ignore-allow-comments flag. Preserve positions while
      // neutralizing its agent-controlled inline suppression marker.
      writeFileSync(
        join(sourceDirectory, name),
        text.replaceAll('gitleaks:allow', '              '),
        {
          mode: 0o600,
          flag: 'wx',
        },
      );
    };
    addDiff([
      'diff',
      '--raw',
      '--no-ext-diff',
      '--no-textconv',
      '--no-abbrev',
      '-z',
      '--no-renames',
      '--diff-filter=ACMT',
      workspace.base,
      tree,
    ]);
    // Scan every parent edge of merges as well as ordinary commits; a net
    // diff or first-parent-only walk would miss committed then reverted keys.
    const commits = read([
      'rev-list',
      '--max-count=' + (MAX_COMMITS + 1),
      workspace.base + '..HEAD',
    ])
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    if (commits.length > MAX_COMMITS) throw new Error('preparation_limit');
    for (const commit of commits) {
      if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('git');
      addDiff([
        'diff-tree',
        '--root',
        '--no-ext-diff',
        '--no-textconv',
        '-r',
        '-m',
        '--no-commit-id',
        '--raw',
        '--no-abbrev',
        '-z',
        '--no-renames',
        '--diff-filter=ACMT',
        commit,
      ]);
      addText(
        read(
          ['-c', 'log.showSignature=false', 'show', '-s', '--format=%B', commit],
          MAX_SNAPSHOT - total + 1,
        ),
        'commit/' + commit + '/message',
      );
    }
    for (const [oid, file] of blobs)
      addText(read(['cat-file', 'blob', oid], MAX_SNAPSHOT - total + 1), file);
    check();
    const output = join(reports, randomUUID() + '.json');
    const result = await runProcess(
      directory,
      [
        'gitleaks',
        'detect',
        '--no-git',
        '--source',
        directory,
        '--redact',
        '--report-format',
        'json',
        '--report-path',
        output,
        '--exit-code',
        '42',
        '--no-banner',
      ],
      '.',
      timeoutMs,
      {
        ...(options.sandbox ? { sandbox: options.sandbox } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
        additionalWritablePaths: [reports],
      },
    );
    if (result.status === 'cancelled' || options.signal?.aborted) return cancelled();
    if (!(
      (result.status === 'ok' && result.exitCode === 0) ||
      (result.status === 'nonzero_exit' && result.exitCode === 42)
    ))
      return failure;
    const value = report(output);
    if (!Array.isArray(value) || value.length > 1000) return failure;
    const clean = redactor();
    const findings: SecretGateResult['findings'] = [];
    for (const item of value as unknown[]) {
      if (!item || typeof item !== 'object') return failure;
      const data = item as Record<string, unknown>;
      if (
        typeof data.RuleID !== 'string' ||
        !/^[a-z0-9-]{1,100}$/.test(data.RuleID) ||
        typeof data.File !== 'string' ||
        !Number.isSafeInteger(data.StartLine) ||
        Number(data.StartLine) < 1
      )
        return failure;
      const file = files.get(basename(data.File));
      if (file === undefined) return failure;
      findings.push({
        rule: clean(data.RuleID),
        file: clean(file),
        line: Number(data.StartLine),
        marker: REDACTED,
      });
    }
    if ((result.exitCode === 0) !== (findings.length === 0)) return failure;
    return { enabled: true, status: findings.length ? 'fail' : 'pass', findings };
  } catch (error) {
    if (options.signal?.aborted) return cancelled();
    if (
      error instanceof Error &&
      ['preparation_limit', 'preparation_timeout'].includes(error.message)
    )
      return {
        ...failure,
        reason: error.message as 'preparation_limit' | 'preparation_timeout',
        message:
          error.message === 'preparation_limit'
            ? 'Secret gate preparation exceeded its size or count limit.'
            : 'Secret gate preparation exceeded its ten-second deadline.',
        fix: 'Reduce the run to at most 256 changed paths per diff, 256 distinct blobs plus commit messages, 128 commits and 64 MiB of scan content; split large work into smaller runs and retry.',
      };
    return failure;
  } finally {
    if (reports) rmSync(reports, { recursive: true, force: true });
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}
