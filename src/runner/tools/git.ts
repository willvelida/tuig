import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from '../../engine/git.js';

/**
 * Git subcommands the agent may run without asking. Push, force, reset --hard,
 * rebase, filter-branch and clean are deliberately not offered.
 */
export const GIT_SUBCOMMANDS = ['status', 'diff', 'log', 'show', 'add', 'commit'] as const;
export type GitSubcommand = (typeof GIT_SUBCOMMANDS)[number];

/** Permitted flags per subcommand; true means the flag consumes the next argument. */
const FLAGS: Readonly<Record<GitSubcommand, Readonly<Record<string, boolean>>>> = {
  status: { '--short': false, '-s': false, '--porcelain': false, '--branch': false, '-b': false },
  diff: {
    '--stat': false,
    '--cached': false,
    '--staged': false,
    '--name-only': false,
    '--name-status': false,
    '--numstat': false,
    '--shortstat': false,
  },
  log: {
    '--oneline': false,
    '--stat': false,
    '--name-only': false,
    '--name-status': false,
    '-n': true,
  },
  show: { '--stat': false, '--name-only': false, '--name-status': false, '--oneline': false },
  add: { '-A': false, '--all': false, '-u': false, '--update': false },
  commit: { '-m': true, '--message': true, '-a': false, '--all': false },
};

/** Options the harness appends so repository configuration cannot run programs. */
const FORCED: Readonly<Record<GitSubcommand, readonly string[]>> = {
  status: [],
  diff: ['--no-color', '--no-ext-diff', '--no-textconv'],
  log: ['--no-color', '--no-ext-diff', '--no-textconv'],
  show: ['--no-color', '--no-ext-diff', '--no-textconv'],
  add: [],
  commit: ['--no-verify'],
};

/** Same credential and oracle names the file tools refuse. */
const CREDENTIAL =
  /^(?:\.env(?:\..*)?|\.aws|\.ssh|\.azure|\.gnupg|\.config|tests-hidden|credentials(?:\..*)?)$/i;

export type GitToolResult = { output: string; status: 'ok' | 'nonzero_exit' | 'timeout' };

/** Validate agent-supplied arguments; throws a policy error naming the first offender. */
export function gitArgv(subcommand: GitSubcommand, args: string[]): string[] {
  const allowed = FLAGS[subcommand];
  const argv: string[] = [];
  let paths = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!paths && arg === '--') {
      paths = true;
      argv.push(arg);
      continue;
    }
    if (!paths && arg.startsWith('-')) {
      const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (!Object.hasOwn(allowed, flag))
        throw new Error(
          'Git flag ' + JSON.stringify(flag) + ' is not permitted for ' + subcommand + '.',
        );
      argv.push(arg);
      if (allowed[flag] && !arg.includes('=')) {
        const value = args[++i];
        if (value === undefined) throw new Error('Git flag ' + flag + ' requires a value.');
        if (flag === '-n' && !/^\d{1,4}$/.test(value)) throw new Error('git log -n needs a count.');
        argv.push(value);
      }
      continue;
    }
    if (arg.split(/[\\/:]/).some((part) => CREDENTIAL.test(part)))
      throw new Error('Git argument reaches a credential path.');
    argv.push(arg);
  }
  return argv;
}

/** Run an allow-listed Git subcommand inside the worktree with a minimal environment. */
export function gitTool(root: string, subcommand: GitSubcommand, args: string[]): GitToolResult {
  const argv = gitArgv(subcommand, args);
  // A throwaway HOME keeps user aliases, credential helpers and global hooks out.
  const home = mkdtempSync(join(tmpdir(), 'tuig-git-home-'));
  try {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      LANG: process.env.LANG ?? 'C.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      GIT_AUTHOR_NAME: 'tuig agent',
      GIT_AUTHOR_EMAIL: 'agent@tuig.invalid',
      GIT_COMMITTER_NAME: 'tuig agent',
      GIT_COMMITTER_EMAIL: 'agent@tuig.invalid',
    };
    const result = runGit(
      [
        '-c',
        'commit.gpgSign=false',
        '-c',
        'log.showSignature=false',
        subcommand,
        ...FORCED[subcommand],
        ...argv,
      ],
      root,
      { env, timeoutMs: 10000 },
    );
    const timeout = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    const output =
      result.stdout +
      result.stderr +
      (result.error ? '\nProcess failed: ' + result.error.message : '');
    return { output, status: timeout ? 'timeout' : result.status === 0 ? 'ok' : 'nonzero_exit' };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
