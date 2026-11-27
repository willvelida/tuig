import { spawnSync } from 'node:child_process';
import { SAFE_GIT_ENV } from '../../engine/git.js';
import { workspacePath } from './paths.js';
export type ProcessResult = {
  output: string;
  status: 'ok' | 'nonzero_exit' | 'timeout';
  exitCode: number | null;
};
export function runProcess(
  root: string,
  argv: string[],
  cwd: string,
  timeoutMs: number,
  allowed: string[][],
): ProcessResult {
  if (!allowed.some((command) => JSON.stringify(command) === JSON.stringify(argv)))
    throw new Error('Command argv is not allow-listed.');
  const dir = workspacePath(root, cwd);
  // Nested Git calls inherit the hook and fsmonitor overrides.
  const env: NodeJS.ProcessEnv = { ...SAFE_GIT_ENV };
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP'])
    if (process.env[name]) env[name] = process.env[name];
  const result = spawnSync(argv[0]!, argv.slice(1), {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    killSignal: 'SIGKILL',
  });
  const timeout = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  const output =
    (result.stdout ?? '') +
    (result.stderr ?? '') +
    (result.error ? '\nProcess failed: ' + result.error.message : '');
  return {
    output,
    status: timeout ? 'timeout' : result.status === 0 ? 'ok' : 'nonzero_exit',
    exitCode: result.status,
  };
}
