import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLI_NAME } from '../cli/name.js';
import { runGit } from './git.js';
import { MODES } from './policy.js';

export function git(args: string[], cwd: string): string {
  const result = runGit(args, cwd, { timeoutMs: 5000, maxBuffer: 1024 * 1024 });
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
export function isTrusted(
  identity: { path: string; rootCommits: string[] },
  file: string,
): boolean {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('User trust state is unreadable or invalid.');
  }
  if (
    !object(value) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.repositories) ||
    !value.repositories.every(
      (r: unknown) => object(r) && typeof r.path === 'string' && typeof r.rootCommit === 'string',
    )
  ) {
    throw new Error('User trust state has an invalid format.');
  }
  const repositories = value.repositories;
  return identity.rootCommits.every((rootCommit) =>
    repositories.some(
      (r: { path: string; rootCommit: string }) =>
        r.path === identity.path && r.rootCommit === rootCommit,
    ),
  );
}
export function validateConfig(value: unknown): string[] {
  if (!object(value)) return ['Configuration must be an object.'];
  const errors: string[] = [];
  if (value.schema_version !== 1) errors.push('schema_version must be 1.');
  // There is no bypass-everything mode: only the four ladder modes exist.
  if (!(MODES as readonly string[]).includes(String(value.mode)))
    errors.push('mode must be plan, ask, auto-edit or auto.');
  const policy = value.policy;
  if (policy !== undefined) {
    const flag = (item: unknown): boolean =>
      typeof item === 'string' && /^-{1,2}[^\s=]+$/.test(item);
    const rule = (item: unknown): boolean =>
      object(item) &&
      Object.keys(item).every((key) =>
        ['decision', 'command', 'flags', 'subcommands'].includes(key),
      ) &&
      ['allow', 'ask', 'deny'].includes(String(item.decision)) &&
      typeof item.command === 'string' &&
      /^[A-Za-z0-9._+-]+$/.test(item.command) &&
      (item.flags === undefined || (Array.isArray(item.flags) && item.flags.every(flag))) &&
      (item.subcommands === undefined ||
        (Array.isArray(item.subcommands) &&
          item.subcommands.every((sub: unknown) => typeof sub === 'string' && sub.length > 0)));
    if (
      !object(policy) ||
      (policy.rules !== undefined && !(Array.isArray(policy.rules) && policy.rules.every(rule)))
    )
      errors.push('policy.rules must be an array of {decision, command, flags?, subcommands?}.');
    if (
      object(policy) &&
      policy.passEnv !== undefined &&
      !(
        Array.isArray(policy.passEnv) &&
        policy.passEnv.every(
          (name: unknown) =>
            typeof name === 'string' &&
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
            !['HOME', 'TMPDIR', 'TEMP', 'TMP'].includes(name) &&
            !name.startsWith('GIT_'),
        )
      )
    )
      errors.push(
        'policy.passEnv must list environment variable names (not HOME, TMPDIR or GIT_*).',
      );
  }
  const models = value.models;
  if (
    !object(models) ||
    !Array.isArray(models.allowedEndpoints) ||
    !models.allowedEndpoints.every((endpoint: unknown) => {
      if (typeof endpoint !== 'string') return false;
      try {
        const url = new URL(endpoint);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      } catch {
        return false;
      }
    })
  )
    errors.push('models.allowedEndpoints must be an array of HTTP(S) URLs without credentials.');
  if (
    object(value.policy) &&
    Array.isArray(value.policy.passEnv) &&
    object(models) &&
    value.policy.passEnv.includes(models.apiKeyEnv)
  )
    errors.push('policy.passEnv must not include the model credential variable.');
  return errors;
}
