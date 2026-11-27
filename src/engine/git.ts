import { spawnSync } from 'node:child_process';

/**
 * Configuration forced onto every Git invocation the harness makes. Hooks and
 * fsmonitor would otherwise run repository-controlled programs.
 */
export const SAFE_GIT_CONFIG: readonly string[] = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
];

/**
 * The same overrides as environment variables, for child processes (checks and
 * tools) that may invoke Git themselves.
 */
export const SAFE_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '/dev/null',
  GIT_CONFIG_KEY_1: 'core.fsmonitor',
  GIT_CONFIG_VALUE_1: 'false',
};

/** Identity for commits the harness itself creates (checkpoints, cleanup). */
export const HARNESS_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'tuig',
  GIT_AUTHOR_EMAIL: 'tuig@localhost.invalid',
  GIT_COMMITTER_NAME: 'tuig',
  GIT_COMMITTER_EMAIL: 'tuig@localhost.invalid',
};

export type GitResult = { status: number | null; stdout: string; stderr: string; error?: Error };

export type GitOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
};

/** Run Git with the safe configuration. Callers decide how to treat failure. */
export function runGit(args: string[], cwd: string, options: GitOptions = {}): GitResult {
  const result = spawnSync('git', [...SAFE_GIT_CONFIG, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...(options.env ?? process.env), ...SAFE_GIT_ENV },
    timeout: options.timeoutMs ?? 10000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Run Git and return trimmed stdout, throwing on any failure. */
export function gitOutput(args: string[], cwd: string, options: GitOptions = {}): string {
  const result = runGit(args, cwd, options);
  if (result.error || result.status !== 0) throw new Error('Git command failed: git ' + args[0]);
  return result.stdout.trim();
}
