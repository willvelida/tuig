import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
const denied =
  /^(?:\.env(?:\..*)?|\.git|\.tuig|\.aws|\.ssh|\.azure|\.gnupg|\.config|\.agents|tests-hidden|credentials(?:\..*)?)$/i;
export function workspacePath(root: string, path: string, edit = false): string {
  if (
    isAbsolute(path) ||
    path.includes('\0') ||
    path.split(/[\\/]/).some((part) => part === '..' || denied.test(part))
  )
    throw new Error('Workspace or credential path denied.');
  const base = realpathSync(root),
    candidate = realpathSync(resolve(base, path));
  const rel = relative(base, candidate);
  if (
    rel === '..' ||
    rel.startsWith('..' + sep) ||
    isAbsolute(rel) ||
    rel.split(/[\\/]/).some((part) => denied.test(part))
  )
    throw new Error('Resolved path escapes workspace or reaches a protected path.');
  if (
    edit &&
    rel.split(/[\\/]/).some((part) => ['AGENTS.md', 'CLAUDE.md', '.github'].includes(part))
  )
    throw new Error('Protected edit path denied.');
  return candidate;
}
