import { spawnSync } from 'node:child_process';
import { workspacePath } from './paths.js';
export function search(root: string, path: string, pattern: string): string {
  const cwd = workspacePath(root, path);
  const args = ['--line-number', '--no-heading', '--color', 'never', '--hidden', '--max-count', '100'];
  for (const glob of ['.git', '.tuig', '.env*', '.aws', '.ssh', '.azure', '.config', '.agents', 'tests-hidden', 'credentials*']) args.push('--glob', '!' + glob);
  args.push('--', pattern, '.');
  const result = spawnSync('rg', args, { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error('Search failed; verify ripgrep is installed and the pattern is valid.');
  return result.stdout;
}
