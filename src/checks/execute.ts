import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
} from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { resolveTarget } from '../runner/tools/paths.js';
import { runProcess, type ProcessOptions } from '../runner/tools/run.js';
import type { Check } from './config.js';
import { diagnostic, MAX_REPORT_BYTES, parseDiagnostics, type Diagnostic } from './parsers.js';

export type CheckResult = {
  name: string;
  kind: Check['kind'];
  passed: boolean;
  status: 'ok' | 'nonzero_exit' | 'timeout' | 'cancelled' | 'invalid_report';
  exitCode: number | null;
  diagnostics: Diagnostic[];
};
export type ChecksResult = { verdict: 'ok' | 'degraded' | 'error'; checks: CheckResult[] };
function reportFile(root: string, path: string): string {
  // Resolve both parent and file with the same credential/workspace boundary as agent reads.
  const parent = resolveTarget(root, dirname(path), 'read').file;
  const candidate = join(parent, basename(path));
  try {
    if (!lstatSync(candidate).isFile())
      throw new Error('Report must be a regular file, not a symlink.');
    return resolveTarget(root, path, 'read').file;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
    throw error;
  }
}
function readReport(root: string, path: string): string {
  const file = reportFile(root, path);
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES)
      throw new Error('Report exceeds 1 MiB or is not a regular file.');
    // Read at most cap + 1 bytes, even if a file grows after fstat.
    const bytes = Buffer.alloc(MAX_REPORT_BYTES + 1);
    // A bounded read avoids allocating from an untrusted file's advertised size.
    const length = readSyncBounded(fd, bytes);
    if (length > MAX_REPORT_BYTES) throw new Error('Report exceeds 1 MiB.');
    return bytes.subarray(0, length).toString('utf8');
  } finally {
    closeSync(fd);
  }
}
function readSyncBounded(fd: number, bytes: Buffer): number {
  let length = 0;
  while (length < bytes.length) {
    const count = readSync(fd, bytes, length, bytes.length - length, null);
    if (!count) break;
    length += count;
  }
  return length;
}
export async function executeCheck(
  root: string,
  check: Check,
  options: ProcessOptions = {},
  onOutput?: (output: string) => void,
): Promise<CheckResult> {
  const base = { name: check.name, kind: check.kind };
  try {
    if (check.reportPath) {
      const file = reportFile(root, check.reportPath);
      try {
        unlinkSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const result = await runProcess(root, check.argv, '.', check.timeoutSec * 1000, {
      ...options,
      pythonCacheIsolation: true,
    });
    onOutput?.(result.output);
    let diagnostics: Diagnostic[];
    try {
      diagnostics = parseDiagnostics(
        check.parser,
        check.name,
        check.reportPath ? readReport(root, check.reportPath) : result.stdout,
      );
    } catch {
      return {
        ...base,
        passed: false,
        status: result.status === 'ok' ? 'invalid_report' : result.status,
        exitCode: result.exitCode,
        diagnostics: [
          diagnostic(
            check.name,
            (result.status === 'ok'
              ? ''
              : 'Check ' + result.status + ' (exit ' + result.exitCode + '); ') +
              'Missing, oversized, or invalid ' +
              check.parser +
              ' report.',
          ),
        ],
      };
    }
    const passed = result.status === 'ok' && !diagnostics.some((d) => d.severity === 'error');
    if (!passed && !diagnostics.length)
      diagnostics.push(
        diagnostic(check.name, 'Check ' + result.status + ' (exit ' + result.exitCode + ').'),
      );
    return { ...base, passed, status: result.status, exitCode: result.exitCode, diagnostics };
  } catch {
    return {
      ...base,
      passed: false,
      status: 'invalid_report',
      exitCode: null,
      diagnostics: [diagnostic(check.name, 'Check report path is unavailable or unsafe.')],
    };
  }
}
export async function executeChecks(
  root: string,
  checks: Check[],
  options: ProcessOptions = {},
  before?: (check: Check) => void,
): Promise<ChecksResult> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    before?.(check);
    results.push(await executeCheck(root, check, options));
    if (options.signal?.aborted) break;
  }
  return {
    verdict: results.some((c) => !c.passed && c.kind === 'gate')
      ? 'error'
      : results.some((c) => !c.passed)
        ? 'degraded'
        : 'ok',
    checks: results,
  };
}
