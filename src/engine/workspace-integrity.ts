import { realpathSync } from 'node:fs';
import { gitOutput } from './git.js';
import type { Workspace } from './workspace.js';
import { ProtectionError } from './protected-tests.js';

export type WorkspaceIdentity = { gitDir: string; commonDir: string };
export function workspaceIdentity(workspace: Workspace): WorkspaceIdentity {
  return {
    gitDir: realpathSync(gitOutput(['rev-parse', '--absolute-git-dir'], workspace.path)),
    commonDir: realpathSync(
      gitOutput(['rev-parse', '--path-format=absolute', '--git-common-dir'], workspace.path),
    ),
  };
}
export function verifyWorkspace(workspace: Workspace, expected: WorkspaceIdentity): void {
  try {
    const actual = workspaceIdentity(workspace);
    if (
      actual.gitDir !== expected.gitDir ||
      actual.commonDir !== expected.commonDir ||
      gitOutput(['symbolic-ref', '--quiet', 'HEAD'], workspace.path) !==
        'refs/heads/' + workspace.branch
    )
      throw new Error('identity');
  } catch {
    throw new ProtectionError(
      'TUIG_E_WORKSPACE',
      'Run workspace Git identity or branch changed.',
      'Restore the original run worktree Git metadata and branch, then retry with a new run.',
    );
  }
}
