import { readFileSync, statSync } from 'node:fs';
import { workspacePath } from './paths.js';
export function readFile(root: string, path: string): string {
  const file = workspacePath(root, path);
  if (statSync(file).size > 8 * 1024 * 1024) throw new Error('File exceeds 8 MiB read limit.');
  return readFileSync(file, 'utf8');
}
