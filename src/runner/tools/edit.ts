import { readFileSync, writeFileSync } from 'node:fs';
import { workspacePath } from './paths.js';
export function edit(root: string, path: string, search: string, replace: string): string {
  const file = workspacePath(root, path, true),
    content = readFileSync(file, 'utf8');
  if (!search || !content.includes(search)) throw new Error('Search text is missing.');
  const offset = content.indexOf(search);
  if (content.indexOf(search, offset + 1) !== -1) throw new Error('Search text is ambiguous.');
  writeFileSync(file, content.slice(0, offset) + replace + content.slice(offset + search.length));
  return 'Replaced one exact block in ' + path;
}
