import { dirname, matchesGlob, relative, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  openSync,
  closeSync,
  readSync,
  fstatSync,
  constants,
} from 'node:fs';
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

export type ProtectionState = {
  exclude: string;
  excludeHash: string;
  ignored: Record<string, string>;
};
/** Resume must retain the original ignored-file attribution, never rebaseline edits. */
export function restoreProtectionState(value: unknown): ProtectionState {
  if (!value || typeof value !== 'object')
    throw new ProtectionError(
      'TUIG_E_WORKSPACE',
      'Run-start protection baseline is missing.',
      'Start a new run with a complete protection baseline.',
    );
  const state = value as ProtectionState;
  if (
    typeof state.exclude !== 'string' ||
    typeof state.excludeHash !== 'string' ||
    !state.ignored ||
    typeof state.ignored !== 'object' ||
    Array.isArray(state.ignored) ||
    Object.entries(state.ignored).some(
      ([path, hash]) =>
        !path ||
        path.startsWith('/') ||
        path.includes('\\') ||
        path.split('/').includes('..') ||
        typeof hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new ProtectionError(
      'TUIG_E_WORKSPACE',
      'Run-start protection baseline is invalid.',
      'Start a new run with a complete protection baseline.',
    );
  return state;
}
function excludeHash(file: string): string {
  if (!existsSync(file)) return 'missing';
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw codedError('TUIG_E_WORKSPACE');
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function ignoredTests(workspace: Workspace, patterns: string[]): string[] {
  if (!patterns.length) return [];
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
      'Narrow protectedTests or remove unwanted protected files, then retry.',
    );
  }
  return ignored.stdout.split('\0').filter((p) => p && oracleSnapshotPath(p));
}
function ignoredHashes(workspace: Workspace, paths: string[]): Record<string, string> {
  const entries: [string, string][] = [];
  let total = 0;
  const buffer = Buffer.alloc(64 * 1024);
  for (const path of paths) {
    const file = join(workspace.path, path);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw codedError('TUIG_E_WORKSPACE');
    const fd = openSync(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      if (!fstatSync(fd).isFile()) throw codedError('TUIG_E_WORKSPACE');
      const hash = createHash('sha256');
      for (;;) {
        const count = readSync(fd, buffer, 0, buffer.length, null);
        if (!count) break;
        total += count;
        if (total > 64 * 1024 * 1024)
          throw new ProtectionError(
            'TUIG_E_WORKSPACE',
            'Protected baseline exceeds its 64 MiB content bound.',
            'Remove oversized protected files or narrow protectedTests, then retry.',
          );
        hash.update(buffer.subarray(0, count));
      }
      entries.push([path, hash.digest('hex')]);
    } finally {
      closeSync(fd);
    }
  }
  return Object.fromEntries(entries);
}
export function protectionState(workspace: Workspace, patterns: string[] = []): ProtectionState {
  const exclude = gitOutput(
    ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
    workspace.path,
  );
  return {
    exclude,
    excludeHash: excludeHash(exclude),
    ignored: ignoredHashes(
      workspace,
      ignoredTests(workspace, patterns).filter((p) => isProtectedTest(p, patterns)),
    ),
  };
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
  const changed = result.stdout.split('\0').filter(Boolean);
  const ignoredPaths = ignoredTests(workspace, patterns);
  const protectedIgnored = ignoredPaths.filter((p) => isProtectedTest(p, patterns));
  const current = ignoredHashes(workspace, protectedIgnored);
  const ignoredChanges = [
    ...Object.keys(current).filter((p) => current[p] !== baseline?.ignored?.[p]),
    ...Object.keys(baseline?.ignored ?? {}).filter((p) => !Object.hasOwn(current, p)),
  ];
  const paths = new Set([
    ...changed.filter((p) => isProtectedTest(p, patterns)),
    ...ignoredChanges,
  ]);
  if (ignoredChanges.length) {
    for (const path of [...changed, ...ignoredPaths]) {
      if (
        path.split('/').at(-1) === '.gitignore' &&
        ignoredChanges.some((p) => {
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
