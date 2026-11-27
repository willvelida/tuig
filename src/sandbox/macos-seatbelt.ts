import type { SandboxSpec } from './index.js';

const quote = (path: string): string =>
  '"' + path.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';

/**
 * Seatbelt profile for sandbox-exec. Later rules take precedence: writes are
 * denied everywhere except the worktree, the tool's temporary home and a few
 * devices; reads of the user's home and other hidden locations are denied
 * except for the re-exposed paths; all network access and signals to
 * processes outside the sandbox are denied.
 */
export function seatbeltProfile(spec: SandboxSpec): string {
  const subpaths = (paths: string[]): string =>
    paths.map((path) => '(subpath ' + quote(path) + ')').join(' ');
  const writable = subpaths(spec.writable);
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny signal)',
    '(allow signal (target same-sandbox))',
    '(deny file-write*)',
    '(allow file-write* ' +
      writable +
      ' (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (regex #"^/dev/fd/"))',
  ];
  if (spec.hidden.length) {
    lines.push('(deny file-read* ' + subpaths(spec.hidden) + ')');
    lines.push('(allow file-read* ' + subpaths([...spec.readOnly, ...spec.writable]) + ')');
  }
  return lines.join('\n') + '\n';
}

export function seatbeltArgv(sandboxExec: string, spec: SandboxSpec, argv: string[]): string[] {
  return [sandboxExec, '-p', seatbeltProfile(spec), ...argv];
}
