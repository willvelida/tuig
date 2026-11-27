import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { bwrapArgv } from './linux-bwrap.js';
import { seatbeltArgv } from './macos-seatbelt.js';

/**
 * The OS sandbox boundary. Callers only see this module, so the Linux and
 * macOS implementations can be replaced without touching the tools.
 */
export type SandboxKind = 'bwrap' | 'seatbelt';
export type Sandbox = { kind: SandboxKind; executable: string };

/** What a sandboxed command may touch. All paths are canonical and absolute. */
export type SandboxSpec = {
  cwd: string;
  /** Read-write: the worktree and the tool's temporary home. */
  writable: string[];
  /** Hidden (Linux) or unreadable (macOS): the real home and personal mounts. */
  hidden: string[];
  /** Read-only exceptions inside hidden locations, such as tool installs. */
  readOnly: string[];
};

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function which(name: string, path = process.env.PATH ?? ''): string | null {
  for (const directory of path.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const CREDENTIAL_CHILDREN = [
  '.ssh',
  '.aws',
  '.config',
  '.gnupg',
  '.netrc',
  '.docker',
  '.kube',
  '.azure',
];

function inside(parent: string, path: string): boolean {
  return path === parent || path.startsWith(parent.endsWith('/') ? parent : parent + '/');
}

/**
 * Locations to hide and the exceptions tools need. The real home is hidden so
 * ~/.ssh, ~/.aws and ~/.config cannot be read; WSL's Windows drives under /mnt
 * and removable media are hidden for the same reason.
 */
export function sandboxSpec(options: {
  cwd: string;
  writable: string[];
  realHome?: string;
  extraReadOnly?: string[];
}): SandboxSpec {
  const home = canonical(options.realHome ?? homedir());
  const hidden = [
    home,
    ...(process.platform === 'linux' ? ['/mnt', '/media', '/root'] : ['/Volumes']),
  ]
    .map(canonical)
    .filter((path, index, all) => path !== '/' && all.indexOf(path) === index);
  const writable = options.writable.map(canonical);
  // Tool installs (PATH directories, the Node runtime) that live under hidden roots stay readable.
  const tools = [
    ...(process.env.PATH ?? '').split(delimiter).filter((entry) => isAbsolute(entry)),
    dirname(process.execPath),
    ...(options.extraReadOnly ?? []),
  ]
    .map((entry) => canonical(dirname(entry)))
    .filter((entry) => hidden.some((root) => inside(root, entry) && entry !== root))
    .filter((entry) => !writable.some((path) => inside(path, entry)))
    // Never re-expose a home-like directory, e.g. a PATH entry of ~/bin whose parent is ~.
    .filter((entry) => !CREDENTIAL_CHILDREN.some((child) => existsSync(join(entry, child))))
    .filter((entry, index, all) => all.indexOf(entry) === index);
  return { cwd: canonical(options.cwd), writable, hidden, readOnly: tools };
}

export function sandboxArgv(sandbox: Sandbox, spec: SandboxSpec, argv: string[]): string[] {
  return sandbox.kind === 'bwrap'
    ? bwrapArgv(sandbox.executable, spec, argv)
    : seatbeltArgv(sandbox.executable, spec, argv);
}

let cached: { key: string; value: Sandbox | null } | undefined;

/**
 * Find a sandbox that actually works here: present and able to run a probe
 * with network and filesystem restrictions. Missing or broken means null, so
 * callers fail closed.
 */
export function detectSandbox(
  platform: NodeJS.Platform = process.platform,
  path = process.env.PATH ?? '',
): Sandbox | null {
  const key = platform + '\0' + path;
  if (cached?.key === key) return cached.value;
  let value: Sandbox | null = null;
  const executable =
    platform === 'linux'
      ? which('bwrap', path)
      : platform === 'darwin'
        ? existsSync('/usr/bin/sandbox-exec')
          ? '/usr/bin/sandbox-exec'
          : null
        : null;
  if (executable) {
    const sandbox: Sandbox = { kind: platform === 'linux' ? 'bwrap' : 'seatbelt', executable };
    const scratch = canonical(mkdtempSync(join(tmpdir(), 'tuig-sandbox-probe-')));
    try {
      const argv = sandboxArgv(sandbox, sandboxSpec({ cwd: scratch, writable: [scratch] }), [
        '/bin/sh',
        '-c',
        'echo ok > probe',
      ]);
      const result = spawnSync(argv[0]!, argv.slice(1), {
        cwd: scratch,
        encoding: 'utf8',
        timeout: 10000,
      });
      if (result.status === 0 && existsSync(join(scratch, 'probe'))) value = sandbox;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  cached = { key, value };
  return value;
}
