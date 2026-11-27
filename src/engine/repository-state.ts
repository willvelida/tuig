import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLI_NAME } from '../cli/name.js';

export function git(args: string[], cwd: string): string {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Cannot read Git repository state.');
  return result.stdout.trim();
}
export function repositoryIdentity(cwd: string): { path: string; rootCommits: string[] } {
  const path = realpathSync(git(['rev-parse', '--show-toplevel'], cwd));
  const rootCommits = git(['rev-list', '--max-parents=0', 'HEAD'], path).split(/\r?\n/).sort();
  return { path, rootCommits };
}
export function trustFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), CLI_NAME, 'trusted.json');
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isTrusted(identity: { path: string; rootCommits: string[] }, file: string): boolean {
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('User trust state is unreadable or invalid.');
  }
  if (!object(value) || value.schema_version !== 1 || !Array.isArray(value.repositories)
    || !value.repositories.every((r: unknown) => object(r) && typeof r.path === 'string' && typeof r.rootCommit === 'string')) {
    throw new Error('User trust state has an invalid format.');
  }
  const repositories = value.repositories;
  return identity.rootCommits.every(rootCommit => repositories.some((r: {path: string; rootCommit: string}) => r.path === identity.path && r.rootCommit === rootCommit));
}
export function validateConfig(value: unknown): string[] {
  if (!object(value)) return ['Configuration must be an object.'];
  const errors: string[] = [];
  if (value.schema_version !== 1) errors.push('schema_version must be 1.');
  if (!['ask', 'auto-edit', 'auto', 'plan'].includes(String(value.mode))) errors.push('mode must be plan, ask, auto-edit or auto.');
  const models = value.models;
  if (!object(models) || !Array.isArray(models.allowedEndpoints) || !models.allowedEndpoints.every((endpoint: unknown) => {
    if (typeof endpoint !== 'string') return false;
    try { const url = new URL(endpoint); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  })) errors.push('models.allowedEndpoints must be an array of HTTP(S) URLs without credentials.');
  return errors;
}
