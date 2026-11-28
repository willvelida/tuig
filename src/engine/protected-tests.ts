import { matchesGlob } from 'node:path';
import { randomUUID } from 'node:crypto';
import { codedError } from '../cli/errors.js';
import { runGit } from './git.js';
import { snapshotTree, type Workspace } from './workspace.js';
import { appendEvent, type RecordStore } from './record.js';
import type { Approver } from '../runner/approval.js';

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
  return [...value] as string[];
}

export function isProtectedTest(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path.replaceAll('\\', '/'), pattern));
}

/** No rename detection: both the deleted source and added destination are checked. */
export function changedTests(workspace: Workspace, patterns: string[]): string[] {
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
  return result.stdout
    .split('\0')
    .filter((p) => p && isProtectedTest(p, patterns))
    .sort();
}

export function approveTests(
  workspace: Workspace,
  patterns: string[],
  store: RecordStore,
  approver?: Approver,
): boolean {
  const paths = changedTests(workspace, patterns);
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
