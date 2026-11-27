import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAFE_GIT_ENV } from '../../engine/git.js';
import { workspacePath } from './paths.js';
import { sandboxArgv, sandboxSpec, type Sandbox } from '../../sandbox/index.js';

export type ProcessResult = {
  output: string;
  stdout: string;
  status: 'ok' | 'nonzero_exit' | 'timeout' | 'cancelled';
  exitCode: number | null;
};

export type ProcessOptions = {
  /** Aborting kills the whole process group. */
  signal?: AbortSignal;
  /** Names of extra parent variables explicitly allowed by trusted configuration. */
  passEnv?: string[];
  /** Time between SIGTERM and SIGKILL for the group. */
  graceMs?: number;
  /** OS sandbox confining the command to the worktree and its temporary home. */
  sandbox?: Sandbox;
};

const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * The environment a tool sees: never the parent's. PATH and locale pass
 * through, HOME and TMPDIR point to a fresh temporary directory, Git hooks
 * stay disabled, and only explicitly configured names are added.
 */
export function minimalEnv(home: string, passEnv: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...SAFE_GIT_ENV, HOME: home, TMPDIR: join(home, 'tmp') };
  const names = [
    'PATH',
    'LANG',
    'LC_ALL',
    ...(process.platform === 'win32' ? ['SystemRoot', 'WINDIR', 'PATHEXT'] : []),
  ];
  for (const name of [...names, ...passEnv])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  if (process.platform === 'win32') env.TEMP = env.TMP = env.TMPDIR;
  return env;
}

/**
 * Run argv in its own process group. On timeout or cancellation the whole
 * group receives SIGTERM, then SIGKILL after a grace period; when the leader
 * exits, anything it left behind in the group is reaped the same way.
 * Callers decide whether argv may run (policy for agent calls, trusted config for checks).
 */
export async function runProcess(
  root: string,
  argv: string[],
  cwd: string,
  timeoutMs: number,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const dir = workspacePath(root, cwd);
  const home = mkdtempSync(join(tmpdir(), 'tuig-home-'));
  mkdirSync(join(home, 'tmp'));
  const graceMs = options.graceMs ?? 2000;
  try {
    return await new Promise<ProcessResult>((settle) => {
      const chunks: Buffer[] = [];
      const stdout: Buffer[] = [];
      let size = 0,
        reason: 'timeout' | 'cancelled' | null = null,
        overflow = false,
        exitCode: number | null = null,
        spawnError: Error | null = null,
        settled = false;
      const command = options.sandbox
        ? sandboxArgv(
            options.sandbox,
            sandboxSpec({ cwd: dir, writable: [workspacePath(root, '.'), home] }),
            argv,
          )
        : argv;
      const child = spawn(command[0]!, command.slice(1), {
        cwd: dir,
        env: minimalEnv(home, options.passEnv),
        detached: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const signalGroup = (signal: NodeJS.Signals): void => {
        if (child.pid === undefined) return;
        try {
          // A negative pid addresses the whole process group the child leads.
          process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
        } catch {
          // ESRCH: the group is already gone.
        }
      };
      let killTimer: NodeJS.Timeout | undefined;
      let drainTimer: NodeJS.Timeout | undefined;
      const terminate = (): void => {
        signalGroup('SIGTERM');
        killTimer ??= setTimeout(() => signalGroup('SIGKILL'), graceMs);
        // A descendant that left the group (setsid) can hold the pipes open forever;
        // stop waiting for them one grace period after SIGKILL.
        drainTimer ??= setTimeout(
          () => {
            child.stdout.destroy();
            child.stderr.destroy();
            finish();
          },
          graceMs * 2 + 250,
        );
      };
      const timer = setTimeout(() => {
        reason ??= 'timeout';
        terminate();
      }, timeoutMs);
      const onAbort = (): void => {
        reason ??= 'cancelled';
        terminate();
      };
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
      const collect = (data: Buffer, isStdout = false): void => {
        size += data.length;
        if (size > MAX_OUTPUT) {
          if (!overflow) terminate();
          overflow = true;
          return;
        }
        chunks.push(data);
        if (isStdout) stdout.push(data);
      };
      child.stdout.on('data', (data: Buffer) => collect(data, true));
      child.stderr.on('data', collect);
      // Background children keep the pipes open after the leader exits; reap them.
      child.on('exit', (code) => {
        exitCode = code;
        terminate();
      });
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (drainTimer) clearTimeout(drainTimer);
        signalGroup('SIGKILL');
        options.signal?.removeEventListener('abort', onAbort);
        let output = Buffer.concat(chunks).toString('utf8');
        if (overflow)
          output += '\nProcess output exceeded ' + MAX_OUTPUT + ' bytes and was stopped.';
        if (spawnError) output += '\nProcess failed: ' + spawnError.message;
        if (reason)
          output +=
            '\nProcess ' +
            (reason === 'timeout' ? 'timed out' : 'was cancelled') +
            '; its process group was terminated.';
        settle({
          output,
          stdout: Buffer.concat(stdout).toString('utf8'),
          status: reason ?? (exitCode === 0 && !overflow && !spawnError ? 'ok' : 'nonzero_exit'),
          exitCode,
        });
      };
      child.on('error', (error) => {
        spawnError = error;
        finish();
      });
      child.on('close', finish);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
