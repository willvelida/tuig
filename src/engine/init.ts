import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git } from './repository-state.js';
import { TEMPLATES } from './templates.js';
export const templateVersion = 1;
function safe(root: string, relative: string): string {
  const parts = relative.split('/');
  let file = root;
  for (const part of parts) {
    file = join(file, part);
    try { if (lstatSync(file).isSymbolicLink()) throw new Error('Refusing symlink in scaffolding path.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return file;
}
const hash = (content: string): string => createHash('sha256').update(content).digest('hex');
export function templateDiff(cwd: string): { path: string; current: string | null; upstream: string; changed: boolean }[] {
  const root = realpathSync(git(['rev-parse','--show-toplevel'],cwd));
  return Object.entries(TEMPLATES).map(([path, upstream]) => {
    const file = safe(root,path);
    const current = existsSync(file) ? readFileSync(file,'utf8') : null;
    return { path, current, upstream, changed: path === 'AGENTS.md' ? !current?.includes(upstream.trim()) : current !== upstream };
  });
}
export function initialize(cwd: string, writeAgents = false): { created: string[]; preserved: string[]; proposal: string; conflicts: string[] } {
  const root = realpathSync(git(['rev-parse','--show-toplevel'],cwd));
  // Validate every path before making changes, including generated bookkeeping.
  for (const path of [...Object.keys(TEMPLATES),'.gitignore','.tuig/template.lock.json']) safe(root,path);
  const lockPath = safe(root,'.tuig/template.lock.json');
  let files: Record<string,{ templateVersion: number; sha256: string }> = {};
  let original = '';
  if (existsSync(lockPath)) {
    original = readFileSync(lockPath,'utf8');
    const lock = JSON.parse(original) as { schema_version: number; files: typeof files };
    if (lock.schema_version !== 1 || !lock.files || typeof lock.files !== 'object' || Array.isArray(lock.files)) throw new Error('Invalid template lock; repair it before init.');
    files = lock.files;
  }
  const created: string[] = [], preserved: string[] = [], conflicts: string[] = [];
  for (const [relative, content] of Object.entries(TEMPLATES)) {
    if (relative === 'AGENTS.md' && !writeAgents) continue;
    const file = safe(root,relative);
    if (existsSync(file)) {
      const current = readFileSync(file,'utf8');
      if (relative === 'AGENTS.md' && !current.includes('<!-- tuig:start -->')) {
        writeFileSync(file,current + (current.endsWith('\n') ? '\n' : '\n\n') + content);
        files[relative] = {templateVersion,sha256:hash(readFileSync(file,'utf8'))};
      } else {
        preserved.push(relative);
        if (relative === 'AGENTS.md' ? !current.includes(content.trim()) : current !== content) conflicts.push(relative);
      }
    } else {
      mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,content,{flag:'wx'});
      created.push(relative); files[relative] = {templateVersion,sha256:hash(content)};
    }
  }
  const ignore = safe(root,'.gitignore');
  let current = existsSync(ignore) ? readFileSync(ignore,'utf8') : '';
  const lines = current.split(/\r?\n/);
  const missing = ['.tuig/runs/','.tuig/temp/'].filter(line=>!lines.includes(line) && !lines.includes('/'+line));
  if (missing.length) {
    if (current && !current.endsWith('\n')) current+='\n';
    writeFileSync(ignore,current + missing.join('\n')+'\n');
  }
  const lock = JSON.stringify({schema_version:1,files},null,2)+'\n';
  mkdirSync(dirname(lockPath),{recursive:true});
  if (original !== lock) writeFileSync(lockPath,lock);
  return {created,preserved,conflicts,proposal:TEMPLATES['AGENTS.md'] ?? ''};
}
