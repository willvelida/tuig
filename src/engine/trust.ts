import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isTrusted, repositoryIdentity, trustFile } from './repository-state.js';
export function trustRepository(
  cwd: string,
  file = trustFile(),
): { path: string; rootCommits: string[] } {
  const identity = repositoryIdentity(cwd);
  // Parsing via isTrusted also validates the entire existing state before writes.
  if (isTrusted(identity, file)) return identity;
  if (existsSync(file) && lstatSync(file).isSymbolicLink())
    throw new Error('Refusing symlink trust state.');
  const value: { schema_version: number; repositories: { path: string; rootCommit: string }[] } =
    existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as {
          schema_version: 1;
          repositories: { path: string; rootCommit: string }[];
        })
      : { schema_version: 1, repositories: [] };
  for (const rootCommit of identity.rootCommits) {
    if (!value.repositories.some((r) => r.path === identity.path && r.rootCommit === rootCommit))
      value.repositories.push({ path: identity.path, rootCommit });
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
  return identity;
}
