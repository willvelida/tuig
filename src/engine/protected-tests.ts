import { dirname, matchesGlob, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { codedError } from '../cli/errors.js';
import { gitOutput, runGit } from './git.js';
import { snapshotTree, type Workspace } from './workspace.js';
import { appendEvent, type RecordStore } from './record.js';
import type { Approver } from '../runner/approval.js';

export class ProtectionError extends Error {
  readonly next_action: string;
  constructor(
    readonly code: 'TUIG_E_CONFIG' | 'TUIG_E_WORKSPACE',
    message: string,
    readonly fix: string,
  ) {
    super(message);
    this.name = 'ProtectionError';
    this.next_action = fix;
  }
}
const RESERVED = ['.git', '.tuig', '.agents', 'tests-hidden', '__pycache__', '.pytest_cache'];
function pythonCache(path: string): boolean {
  const parts = path.split(/[\\/]/);
  return (
    parts.some((p) => p === '__pycache__' || p === '.pytest_cache') ||
    (parts.at(-1) ?? '').endsWith('.pyc')
  );
}

export function protectedTests(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (p: unknown) =>
        typeof p !== 'string' ||
        !p.length ||
        p.includes('\\') ||
        p.includes('\0') ||
        p.startsWith('/') ||
        /^[A-Za-z]:/.test(p) ||
        p.split('/').includes('..'),
    )
  )
    throw codedError('TUIG_E_CONFIG');
  for (const pattern of value as string[]) {
    if (
      /[?{}\[\]()!]/.test(pattern) ||
      pattern
        .split('/')
        .some((part) => !part || part === '.' || (part.includes('**') && part !== '**'))
    )
      throw new ProtectionError(
        'TUIG_E_CONFIG',
        'Unsupported protectedTests pattern ' +
          JSON.stringify(pattern) +
          '. Use literals, * and whole ** path components.',
        'Expand ' +
          JSON.stringify(pattern) +
          ' into separate literal or * / ** patterns in protectedTests, then retry.',
      );
  }
  return [...value] as string[];
}

export function isProtectedTest(path: string, patterns: string[]): boolean {
  if (pythonCache(path)) return false;
  const normalized = path.replaceAll('\\', '/');
  // Node glob stars exclude leading dots. A same-length private sentinel removes
  // only that special treatment while preserving wildcard character counts.
  const dots = (value: string): string => value.replace(/(^|\/)\./g, '$1\uE000');
  return patterns.some(
    (pattern) => matchesGlob(normalized, pattern) || matchesGlob(dots(normalized), dots(pattern)),
  );
}

/** Reserved directories never copied into the oracle snapshot. */
export function oracleSnapshotPath(path: string): boolean {
  return !pythonCache(path) && !path.split(/[\\/]/).some((p) => RESERVED.includes(p));
}

export type ProtectionState = { exclude: string; excludeHash: string };
function excludeHash(file: string): string {
  if (!existsSync(file)) return 'missing';
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw codedError('TUIG_E_WORKSPACE');
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
export function protectionState(workspace: Workspace): ProtectionState {
  const exclude = gitOutput(
    ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
    workspace.path,
  );
  return { exclude, excludeHash: excludeHash(exclude) };
}

/** No rename detection: both the deleted source and added destination are checked. */
export function changedTests(
  workspace: Workspace,
  patterns: string[],
  baseline?: ProtectionState,
): string[] {
  if (!patterns.length) return [];
  const result = runGit(
    [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      '--no-ext-diff',
      '--no-textconv',
      workspace.base,
      snapshotTree(workspace),
    ],
    workspace.path,
  );
  if (result.error || result.status !== 0) throw codedError('TUIG_E_WORKSPACE');
  const ignored = runGit(
    [
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      ...patterns.map((pattern) => ':(glob)' + pattern),
      ...RESERVED.map((directory) => ':(exclude,glob)**/' + directory + '/**'),
      ':(exclude,glob)**/*.pyc',
    ],
    workspace.path,
    { maxBuffer: 1024 * 1024 },
  );
  if (ignored.error || ignored.status !== 0 || (ignored.stdout && !ignored.stdout.endsWith('\0'))) {
    const overflow = (ignored.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS';
    throw new ProtectionError(
      'TUIG_E_WORKSPACE',
      overflow
        ? 'The filtered protected test list exceeded its 1 MiB limit.'
        : 'The filtered protected test list could not be read completely.',
      overflow
        ? 'Narrow protectedTests or remove unwanted protected files, then retry.'
        : 'Check Git availability and expand protectedTests into supported glob patterns, then retry.',
    );
  }
  const changed = result.stdout.split('\0').filter(Boolean);
  const ignoredPaths = ignored.stdout.split('\0').filter((p) => p && oracleSnapshotPath(p));
  const protectedIgnored = ignoredPaths.filter((p) => isProtectedTest(p, patterns));
  const paths = new Set([
    ...changed.filter((p) => isProtectedTest(p, patterns)),
    ...protectedIgnored,
  ]);
  if (protectedIgnored.length) {
    for (const path of [...changed, ...ignoredPaths]) {
      if (
        path.split('/').at(-1) === '.gitignore' &&
        protectedIgnored.some((p) => {
          const rel = relative(dirname(path), p).replaceAll('\\', '/');
          return rel !== '..' && !rel.startsWith('../');
        })
      )
        paths.add(path);
    }
    if (baseline && excludeHash(baseline.exclude) !== baseline.excludeHash)
      paths.add('.git/info/exclude');
  }
  return [...paths].sort();
}

export function approveTests(
  workspace: Workspace,
  patterns: string[],
  store: RecordStore,
  approver?: Approver,
  baseline?: ProtectionState,
): boolean {
  let paths: string[];
  try {
    paths = changedTests(workspace, patterns, baseline);
  } catch (error) {
    if (error instanceof ProtectionError)
      appendEvent(store, 'policy_denied', {
        tool: 'protected_tests',
        rule: 'protected-tests-list',
        category: 'infrastructure',
        code: error.code,
        reason: error.message,
        next_action: error.fix,
      });
    throw error;
  }
  if (!paths.length) return true;
  const request = {
    id: randomUUID(),
    tool: 'protected_tests',
    cwd: workspace.path,
    rule: 'protected-tests',
    path: JSON.stringify(paths),
  };
  appendEvent(store, 'approval_requested', { request });
  const decision = approver?.(request) ?? 'deny';
  appendEvent(store, 'approval_decided', { id: request.id, decision });
  appendEvent(store, 'test_tamper', { paths, decision, source: 'final_diff', count: paths.length });
  return decision !== 'deny';
}
