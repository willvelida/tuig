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
import { snapshotTree, type Workspace } from './workspace.js';

export const SECRET_GATE_FIX =
  'Install gitleaks on PATH and verify it can scan with detect --no-git; then retry the run. Never put credentials in the result files.';
export type SecretGateResult = {
  status: 'disabled' | 'not_evaluated' | 'pass' | 'fail' | 'infrastructure_error';
  enabled: boolean;
  code?: 'TUIG_E_PREREQUISITE';
  findings: { rule: string; file: string; line: number; marker: string }[];
};

const MAX_BYTES = 1024 * 1024;
const MAX_SNAPSHOT = 64 * MAX_BYTES;

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

/** Scan the resulting blobs in exactly the base-to-result changed file set. */
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
  try {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-secrets-')));
    reports = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-secret-report-')));
    const tree = snapshotTree(workspace);
    const changed = runGit(
      ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMT', workspace.base, tree],
      workspace.path,
      { maxBuffer: MAX_BYTES },
    );
    if (changed.error || changed.status !== 0) return failure;
    const files = new Map<string, string>();
    let total = 0;
    for (const path of changed.stdout.split('\0').filter(Boolean)) {
      const blob = runGit(['show', tree + ':' + path], workspace.path, {
        maxBuffer: MAX_SNAPSHOT,
      });
      if (blob.error || blob.status !== 0) return failure;
      total += Buffer.byteLength(blob.stdout);
      if (total > MAX_SNAPSHOT) return failure;
      // Opaque names prevent repository .gitleaks.toml, .gitleaksignore and
      // default filename allowlists from changing the trusted scanner policy.
      const name = randomUUID() + '.txt';
      files.set(name, path);
      // 8.16 has no ignore-allow-comments flag. Preserve positions while
      // neutralizing its agent-controlled inline suppression marker.
      writeFileSync(
        join(directory, name),
        blob.stdout.replaceAll('gitleaks:allow', '              '),
        {
          mode: 0o600,
          flag: 'wx',
        },
      );
    }
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
  } catch {
    return failure;
  } finally {
    if (reports) rmSync(reports, { recursive: true, force: true });
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}
