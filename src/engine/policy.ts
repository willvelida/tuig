import { isAbsolute, relative, resolve, sep } from 'node:path';
import { protectedRule } from '../runner/tools/paths.js';

/**
 * Permission modes, from least to most autonomous. Each mode allows a superset
 * of the one before it. There is deliberately no bypass-everything mode.
 */
export const MODES = ['plan', 'ask', 'auto-edit', 'auto'] as const;
export type Mode = (typeof MODES)[number];
export type Decision = 'allow' | 'ask' | 'deny';

export type Category =
  | 'control'
  | 'read'
  | 'edit'
  | 'git-write'
  | 'trusted-command'
  | 'allowed-command'
  | 'unknown-command'
  | 'opaque-command'
  | 'protected-write'
  | 'network'
  | 'package-install'
  | 'delete-outside'
  | 'write-outside'
  | 'injection'
  | 'credential-path'
  | 'denied-command';

/** A tool call reduced to the facts policy decides on. */
export type PolicyCall = {
  tool: string;
  /** Normalized program name, e.g. "rg" for /usr/bin/rg or "pip" for python -m pip. */
  command?: string;
  argv?: string[];
  subcommand?: string;
  /** Options as written, with any "=value" removed. */
  flags: string[];
  /** Arguments resolved to absolute paths. */
  paths: string[];
  hosts: string[];
  /** Protected-path rule for edits. */
  protected?: string | null;
  /** True for the agent git tool's add/commit. */
  write?: boolean;
};

/** A repository policy rule. For allow, flags are the permitted flags; otherwise any listed flag triggers. */
export type PolicyRule = {
  decision: Decision;
  command: string;
  flags?: string[];
  subcommands?: string[];
};

export type PolicyContext = {
  mode: Mode;
  /** Workspace root that path arguments must stay inside. */
  root: string;
  /** Exact argv entries from trusted configuration (checks and allowedCommands). */
  trusted?: string[][];
  rules?: PolicyRule[];
  /** False when no human can answer; ask then becomes deny. */
  interactive: boolean;
};

export type Verdict = { decision: Decision; category: Category; rule: string; reason: string };

type Match = { decision: Decision; category: Category; rule: string; reason: string };

/** Flags that turn otherwise harmless commands into arbitrary execution or writes. */
const INJECTION_FLAGS: Readonly<Record<string, readonly string[]>> = {
  find: [
    '-exec',
    '-execdir',
    '-ok',
    '-okdir',
    '-delete',
    '-fprint',
    '-fprint0',
    '-fprintf',
    '-fls',
  ],
  rg: ['--pre', '--pre-glob', '-z', '--search-zip'],
  tar: [
    '--to-command',
    '--use-compress-program',
    '-I',
    '--checkpoint-action',
    '--rsh-command',
    '--info-script',
    '--new-volume-script',
    '-F',
  ],
  rsync: ['-e', '--rsh', '--rsync-path'],
  ssh: ['-o', '-F'],
  scp: ['-o', '-S', '-F'],
  zip: ['-TT', '--unzip-command'],
  npm: ['--script-shell'],
};
/** Git global options are never accepted from the agent; -c alone can set core.sshCommand. */
const GIT_SAFE_GLOBAL = new Set(['--no-pager', '--version', '--help']);
const GIT_INJECTION_FLAGS = new Set([
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--ext-diff',
  '--output',
]);
const GIT_NETWORK = new Set(['clone', 'fetch', 'pull', 'push', 'ls-remote', 'submodule']);
/** Git operations that rewrite or discard history or work; denied outright. */
const GIT_DESTRUCTIVE: Readonly<Record<string, readonly string[] | true>> = {
  push: [
    '-f',
    '--force',
    '--force-with-lease',
    '--force-if-includes',
    '--mirror',
    '--delete',
    '-d',
    '--prune',
  ],
  reset: ['--hard', '--keep', '--merge'],
  clean: true,
  rebase: true,
  'filter-branch': true,
  'filter-repo': true,
  reflog: true,
  'update-ref': true,
  worktree: true,
  gc: true,
  prune: true,
  config: true,
};

const DENIED_COMMANDS = new Set([
  'sudo',
  'su',
  'doas',
  'pkexec',
  'dd',
  'mkfs',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
]);
const NETWORK_COMMANDS = new Set([
  'curl',
  'wget',
  'ssh',
  'scp',
  'sftp',
  'nc',
  'ncat',
  'netcat',
  'telnet',
  'ftp',
  'http',
  'https',
  'aria2c',
  'ping',
  'dig',
  'nslookup',
]);
/** Package managers and the subcommands that install or fetch packages. */
const INSTALLERS: Readonly<Record<string, readonly string[] | true>> = {
  npm: ['install', 'i', 'ci', 'add', 'update', 'up', 'upgrade', 'link', 'exec', 'x'],
  pnpm: ['install', 'i', 'add', 'update', 'up', 'dlx', 'exec'],
  yarn: ['install', 'add', 'upgrade', 'up', 'dlx'],
  bun: ['install', 'i', 'add', 'update', 'x'],
  npx: true,
  pnpx: true,
  bunx: true,
  uvx: true,
  pipx: true,
  pip: ['install', 'download'],
  pip3: ['install', 'download'],
  uv: ['add', 'sync', 'pip', 'tool', 'run'],
  poetry: ['add', 'install', 'update'],
  apt: ['install'],
  'apt-get': ['install'],
  dnf: ['install'],
  yum: ['install'],
  apk: ['add'],
  brew: ['install', 'upgrade'],
  port: ['install'],
  cargo: ['install', 'add'],
  gem: ['install'],
  go: ['install', 'get'],
  bundle: ['install', 'add'],
  composer: ['install', 'require', 'update'],
  conda: ['install', 'create'],
  mamba: ['install', 'create'],
};
/** Programs whose effect cannot be classified from argv: shells, wrappers and debuggers. */
const OPAQUE = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'fish',
  'ksh',
  'csh',
  'tcsh',
  'env',
  'xargs',
  'nohup',
  'timeout',
  'nice',
  'ionice',
  'stdbuf',
  'time',
  'watch',
  'eval',
  'exec',
  'command',
  'script',
  'strace',
  'ltrace',
  'gdb',
  'flock',
  'setsid',
  'unshare',
  'chroot',
  'nsenter',
  'at',
  'batch',
  'crontab',
  'systemd-run',
  'docker',
  'podman',
  'kubectl',
  'awk',
  'gawk',
  'sed',
]);
/** Interpreters become opaque when given inline code. */
const INLINE_CODE: Readonly<Record<string, readonly string[]>> = {
  python: ['-c'],
  python3: ['-c'],
  node: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  perl: ['-e', '-E'],
  ruby: ['-e'],
  php: ['-r'],
  lua: ['-e'],
};
const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'shred']);
const WRITERS = new Set([
  'mv',
  'cp',
  'ln',
  'touch',
  'truncate',
  'tee',
  'chmod',
  'chown',
  'mkdir',
  'install',
]);
/** Read-only commands and their permitted flags. Paths must stay inside the workspace. */
const READ_ONLY: Readonly<Record<string, readonly string[]>> = {
  ls: ['-l', '-a', '-la', '-al', '-1', '-R', '-h', '-lh'],
  cat: ['-n'],
  head: ['-n'],
  tail: ['-n'],
  wc: ['-l', '-w', '-c'],
  pwd: [],
  find: [
    '-name',
    '-iname',
    '-type',
    '-path',
    '-maxdepth',
    '-mindepth',
    '-print',
    '-newer',
    '-size',
  ],
  rg: [
    '-n',
    '--line-number',
    '-i',
    '--ignore-case',
    '-l',
    '--files-with-matches',
    '-w',
    '-F',
    '--fixed-strings',
    '-g',
    '--glob',
    '-t',
    '--type',
    '-c',
    '--count',
  ],
  grep: ['-n', '-i', '-r', '-R', '-l', '-w', '-F', '-E', '-c', '-v'],
};
/** Credential and oracle names: never passed to any command, in any mode. */
const SECRET =
  /^(?:\.env(?:\..*)?|\.aws|\.ssh|\.azure|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.docker|\.kube|\.config|tests-hidden|credentials(?:\..*)?|id_[a-z0-9]+)$/i;
const CREDENTIAL =
  /^(?:\.env(?:\..*)?|\.aws|\.ssh|\.azure|\.gnupg|\.config|\.git|\.tuig|\.agents|tests-hidden|credentials(?:\..*)?)$/i;

function programName(path: string): string {
  return (path.split(/[\\/]/).at(-1) ?? path).replace(/\.exe$/i, '');
}

/** Turn a run argv into a policy call. Unwraps "python -m <module>". */
export function describeCommand(argv: string[], cwd: string): PolicyCall {
  let rest = argv.slice(1);
  let command = programName(argv[0] ?? '');
  if (/^python3?$/.test(command) && rest[0] === '-m' && rest[1]) {
    command = rest[1];
    rest = rest.slice(2);
  }
  const flags: string[] = [],
    paths: string[] = [],
    hosts: string[] = [];
  let subcommand: string | undefined;
  for (const arg of rest) {
    if (arg.startsWith('-') && arg !== '-') {
      flags.push(arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg);
      continue;
    }
    if (subcommand === undefined) subcommand = arg;
    const url = /^[a-z][a-z0-9+.-]*:\/\/([^/:@]+@)?([^/:?#]+)/i.exec(arg);
    if (url) hosts.push(url[2]!.toLowerCase());
    else if (/^[^/\s]+@[^/\s:]+:/.test(arg))
      hosts.push(arg.slice(arg.indexOf('@') + 1, arg.indexOf(':')));
    else paths.push(resolve(cwd, arg));
  }
  return { tool: 'run', command, argv, ...(subcommand ? { subcommand } : {}), flags, paths, hosts };
}

function outside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}

function exactlyTrusted(argv: string[] | undefined, trusted: string[][]): boolean {
  return !!argv && trusted.some((entry) => JSON.stringify(entry) === JSON.stringify(argv));
}

/** Facts about a command, independent of mode. */
function commandMatches(call: PolicyCall, context: PolicyContext): Match[] {
  const matches: Match[] = [];
  const command = call.command ?? '';
  const add = (decision: Decision, category: Category, rule: string, reason: string): void => {
    matches.push({ decision, category, rule, reason });
  };
  for (const path of call.paths) {
    const parts = (outside(context.root, path) ? path : relative(context.root, path)).split(
      /[\\/]/,
    );
    if (parts.some((part) => SECRET.test(part)))
      add(
        'deny',
        'credential-path',
        'builtin:credential-path',
        'argument reaches a credential or hidden-test path',
      );
  }
  if (DENIED_COMMANDS.has(command))
    add('deny', 'denied-command', 'builtin:denied-command', command + ' is never permitted');
  for (const flag of INJECTION_FLAGS[command] ?? [])
    if (call.flags.includes(flag))
      add(
        'deny',
        'injection',
        'builtin:injection:' + command + flag,
        command + ' ' + flag + ' can run programs or write files',
      );
  if (command === 'git') {
    const argv = (call.argv ?? []).slice(1);
    const first = argv.findIndex((arg) => !arg.startsWith('-'));
    const globals = first === -1 ? argv : argv.slice(0, first);
    for (const option of globals)
      if (!GIT_SAFE_GLOBAL.has(option.split('=')[0]!))
        add(
          'deny',
          'injection',
          'builtin:injection:git-global',
          'git global option ' + option.split('=')[0] + ' can reconfigure Git',
        );
    for (const flag of call.flags)
      if (GIT_INJECTION_FLAGS.has(flag))
        add(
          'deny',
          'injection',
          'builtin:injection:git' + flag,
          'git ' + flag + ' can run programs or write files',
        );
    const sub = first === -1 ? undefined : argv[first];
    const destructive = sub ? GIT_DESTRUCTIVE[sub] : undefined;
    if (
      destructive === true ||
      (destructive && call.flags.some((flag) => destructive.includes(flag))) ||
      (sub === 'push' && argv.some((arg) => arg.startsWith('+')))
    )
      add(
        'deny',
        'denied-command',
        'builtin:git-destructive:' + sub,
        'git ' + sub + ' can rewrite or discard history or work',
      );
    if (sub && GIT_NETWORK.has(sub))
      add('ask', 'network', 'builtin:network:git-' + sub, 'git ' + sub + ' contacts a remote');
  }
  if (NETWORK_COMMANDS.has(command))
    add('ask', 'network', 'builtin:network:' + command, command + ' accesses the network');
  if (
    command === 'rsync' &&
    call.hosts.length === 0 &&
    (call.argv ?? []).some((arg) => /^[^/]*:/.test(arg))
  )
    add('ask', 'network', 'builtin:network:rsync', 'rsync to a remote host');
  if (call.hosts.length)
    add('ask', 'network', 'builtin:network:host', 'arguments name hosts: ' + call.hosts.join(', '));
  const installer = INSTALLERS[command];
  if (installer === true || (installer && call.subcommand && installer.includes(call.subcommand)))
    add(
      'ask',
      'package-install',
      'builtin:package-install:' + command,
      command + (installer === true ? '' : ' ' + call.subcommand) + ' installs or fetches packages',
    );
  if (DELETERS.has(command) || WRITERS.has(command)) {
    for (const path of call.paths) {
      if (outside(context.root, path))
        add(
          'ask',
          DELETERS.has(command) ? 'delete-outside' : 'write-outside',
          'builtin:' + (DELETERS.has(command) ? 'delete' : 'write') + '-outside',
          command + ' targets ' + path + ' outside the worktree',
        );
      else {
        const rule = protectedRule(relative(context.root, path));
        if (rule)
          add(
            'ask',
            'protected-write',
            'protected-path:' + rule,
            command + ' changes a protected path',
          );
      }
    }
  }
  for (const rule of context.rules ?? []) {
    if (rule.command !== command) continue;
    if (rule.subcommands && !(call.subcommand && rule.subcommands.includes(call.subcommand)))
      continue;
    const name = 'config:' + rule.decision + ':' + rule.command;
    if (rule.decision === 'allow') {
      if (call.flags.every((flag) => (rule.flags ?? []).includes(flag)))
        add('allow', 'allowed-command', name, 'allow-listed command with permitted flags');
    } else if (!rule.flags || rule.flags.some((flag) => call.flags.includes(flag)))
      add(
        rule.decision,
        rule.decision === 'deny' ? 'denied-command' : 'unknown-command',
        name,
        'repository policy rule',
      );
  }
  return matches;
}

/** The mode's baseline decision for the primary kind of action. */
function baseline(category: Category, mode: Mode): Decision {
  if (category === 'control' || category === 'read') return 'allow';
  if (mode === 'plan') return 'deny';
  switch (category) {
    case 'edit':
    case 'git-write':
    case 'trusted-command':
      return 'allow';
    case 'allowed-command':
      return mode === 'ask' ? 'ask' : 'allow';
    case 'unknown-command':
      return mode === 'auto' ? 'allow' : 'ask';
    default:
      // Opaque commands and every always-ask category ask in every mode above plan.
      return 'ask';
  }
}

function primary(call: PolicyCall, context: PolicyContext, matches: Match[]): Category {
  if (call.tool === 'abort_with_reason') return 'control';
  if (call.tool === 'read_file' || call.tool === 'search') return 'read';
  if (call.tool === 'git') return call.write ? 'git-write' : 'read';
  if (call.tool === 'edit') return call.protected ? 'protected-write' : 'edit';
  const command = call.command ?? '';
  if (exactlyTrusted(call.argv, context.trusted ?? [])) return 'trusted-command';
  if (
    OPAQUE.has(command) ||
    (INLINE_CODE[command] ?? []).some(
      (flag) => call.flags.includes(flag) || call.subcommand === flag,
    )
  )
    return 'opaque-command';
  const readOnly = READ_ONLY[command];
  if (
    readOnly &&
    call.flags.every((flag) => readOnly.includes(flag)) &&
    call.paths.every(
      (path) =>
        !outside(context.root, path) &&
        !relative(context.root, path)
          .split(/[\\/]/)
          .some((part) => CREDENTIAL.test(part)),
    )
  )
    return 'read';
  if (matches.some((match) => match.decision === 'allow')) return 'allowed-command';
  return 'unknown-command';
}

/**
 * Decide a call. Every applicable rule contributes; deny beats ask and ask
 * beats allow. Without a human to answer, ask becomes deny.
 */
export function evaluate(call: PolicyCall, context: PolicyContext): Verdict {
  if (!MODES.includes(context.mode)) throw new Error('Unknown policy mode.');
  const matches = call.tool === 'run' ? commandMatches(call, context) : [];
  if (call.tool === 'edit' && call.protected)
    matches.push({
      decision: 'ask',
      category: 'protected-write',
      rule: 'protected-path:' + call.protected,
      reason: 'write to a protected path',
    });
  const category = primary(call, context, matches);
  const base = baseline(category, context.mode);
  matches.push({
    decision: base,
    category,
    rule: 'mode:' + context.mode + ':' + category,
    reason: context.mode + ' mode ' + base + 's ' + category,
  });
  const rank: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };
  // Highest severity wins; among equals, the first (most specific) rule is reported.
  const winner = matches.reduce((best, match) =>
    rank[match.decision] > rank[best.decision] ? match : best,
  );
  if (winner.decision === 'ask' && !context.interactive)
    return {
      ...winner,
      decision: 'deny',
      reason: winner.reason + '; approval required but the run is non-interactive',
    };
  return winner;
}

/** True when `to` is not more permissive than `from`; modes only move down the ladder mid-run. */
export function canLowerMode(from: Mode, to: Mode): boolean {
  return MODES.indexOf(to) <= MODES.indexOf(from);
}
