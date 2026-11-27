import { existsSync } from 'node:fs';
import type { SandboxSpec } from './index.js';

/**
 * Bubblewrap invocation: the system read-only, the user's home and other
 * personal mounts hidden, only the worktree and the tool's temporary home
 * writable, and every namespace (network, PID, IPC, UTS) unshared.
 */
export function bwrapArgv(bwrap: string, spec: SandboxSpec, argv: string[]): string[] {
  const args = [
    bwrap,
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
  ];
  // Hide personal data: the real home and mounted drives (WSL exposes Windows under /mnt).
  for (const hidden of spec.hidden) if (existsSync(hidden)) args.push('--tmpfs', hidden);
  // Re-expose what tools need, after hiding, so these mounts sit on top.
  for (const path of spec.readOnly) if (existsSync(path)) args.push('--ro-bind', path, path);
  for (const path of spec.writable) args.push('--bind', path, path);
  args.push('--chdir', spec.cwd, '--', ...argv);
  return args;
}
