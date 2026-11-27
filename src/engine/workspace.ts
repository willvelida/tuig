import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { codedError } from '../cli/errors.js';
import { HARNESS_IDENTITY, gitOutput, runGit } from './git.js';

/** One isolated Git worktree for one run. The main checkout is never modified. */
export type Workspace = {
  id: string;
  /** Canonical root of the human's main checkout. */
  root: string;
  /** Worktree directory the agent works in. */
  path: string;
  branch: string;
  /** Commit the run started from. */
  base: string;
};

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export function worktreeDirectory(root: string, id: string): string {
  return join(root, '.tuig', 'temp', 'worktrees', id);
}

export function checkpointRef(id: string, turn: number): string {
  return 'refs/tuig/checkpoints/' + id + '/' + turn;
}

function refuseSymlinks(root: string, path: string): void {
  let current = root;
  for (const part of relative(root, path).split(/[\\/]/)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw codedError('TUIG_E_WORKSPACE', 'Run workspace path contains a symlink.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/** Status of the main checkout, including untracked files, excluding ignored ones. */
export function mainStatus(root: string): string {
  // No optional locks: a plain status would refresh and rewrite the main index.
  return gitOutput(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], root);
}

/**
 * Create a worktree on tuig/run-<id> from the clean HEAD of the main checkout.
 * Refuses a dirty base so a run never starts from, or mixes with, unsaved work.
 */
export function createWorkspace(root: string, id: string): Workspace {
  if (!RUN_ID.test(id)) throw codedError('TUIG_E_WORKSPACE', 'Invalid run id.');
  const canonical = realpathSync(root);
  if (mainStatus(canonical)) throw codedError('TUIG_E_DIRTY');
  const base = gitOutput(['rev-parse', '--verify', 'HEAD^{commit}'], canonical);
  const branch = 'tuig/run-' + id;
  if (runGit(['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], canonical).status === 0)
    throw codedError('TUIG_E_WORKSPACE', 'Run branch already exists.');
  const path = worktreeDirectory(canonical, id);
  refuseSymlinks(canonical, path);
  // The worktree lives inside the main checkout, so it must be ignored there.
  if (runGit(['check-ignore', '--quiet', '--no-index', path], canonical).status !== 0)
    throw codedError('TUIG_E_WORKSPACE', '.tuig/temp/ is not ignored by Git.');
  mkdirSync(join(canonical, '.tuig', 'temp', 'worktrees'), { recursive: true, mode: 0o700 });
  gitOutput(['worktree', 'add', '--quiet', '-b', branch, path, base], canonical);
  if (mainStatus(canonical))
    throw codedError('TUIG_E_WORKSPACE', 'Creating the worktree changed the main checkout.');
  return { id, root: canonical, path: realpathSync(path), branch, base };
}

/** Reattach to an existing run workspace, verifying it is still the run's worktree. */
export function openWorkspace(root: string, id: string, base: string): Workspace {
  if (!RUN_ID.test(id)) throw codedError('TUIG_E_WORKSPACE', 'Invalid run id.');
  const canonical = realpathSync(root);
  const path = worktreeDirectory(canonical, id);
  refuseSymlinks(canonical, path);
  const branch = 'tuig/run-' + id;
  let current: string;
  try {
    current = gitOutput(['symbolic-ref', '--quiet', 'HEAD'], path);
  } catch {
    throw codedError('TUIG_E_WORKSPACE', 'Run worktree is missing.');
  }
  if (current !== 'refs/heads/' + branch)
    throw codedError('TUIG_E_WORKSPACE', 'Run worktree is not on its run branch.');
  return { id, root: canonical, path: realpathSync(path), branch, base };
}

/**
 * Tree object of the worktree's current files (tracked and untracked, honouring
 * .gitignore). Uses a private index so the agent's index and branch stay untouched.
 */
export function snapshotTree(workspace: Workspace): string {
  const directory = mkdtempSync(join(tmpdir(), 'tuig-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'index') };
    gitOutput(['read-tree', 'HEAD'], workspace.path, { env });
    gitOutput(['add', '--all', '--', '.'], workspace.path, { env });
    return gitOutput(['write-tree'], workspace.path, { env });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Record the worktree state before a turn on refs/tuig/checkpoints/<id>/<turn>. */
export function checkpoint(
  workspace: Workspace,
  turn: number,
): { ref: string; commit: string; tree: string } {
  if (!Number.isSafeInteger(turn) || turn < 0) throw new Error('Invalid checkpoint turn.');
  const tree = snapshotTree(workspace);
  const head = gitOutput(['rev-parse', '--verify', 'HEAD^{commit}'], workspace.path);
  const ref = checkpointRef(workspace.id, turn);
  const existing = runGit(['rev-parse', '--verify', '--quiet', ref + '^{commit}'], workspace.path);
  if (existing.status === 0) {
    // A resumed run re-enters the turn it was restored to; the same state reuses the ref.
    const commit = existing.stdout.trim();
    if (gitOutput(['rev-parse', commit + '^{tree}'], workspace.path) === tree)
      return { ref, commit, tree };
    throw codedError(
      'TUIG_E_WORKSPACE',
      'Checkpoint ' + ref + ' already exists with other content.',
    );
  }
  const commit = gitOutput(
    ['commit-tree', tree, '-p', head, '-m', 'tuig checkpoint ' + workspace.id + ' turn ' + turn],
    workspace.path,
    { env: { ...process.env, ...HARNESS_IDENTITY } },
  );
  // An empty old value means the ref must not already exist.
  gitOutput(['update-ref', ref, commit, ''], workspace.path);
  return { ref, commit, tree };
}

/** Binary patch from the run's base to the worktree's current files. */
export function diffPatch(workspace: Workspace): string {
  const tree = snapshotTree(workspace);
  const result = runGit(
    ['diff', '--binary', '--no-color', '--no-ext-diff', '--no-textconv', workspace.base, tree],
    workspace.path,
  );
  if (result.error || result.status !== 0) throw new Error('Cannot produce run diff.');
  return result.stdout;
}

/**
 * Remove the worktree but keep the branch: any uncommitted state is first
 * committed onto tuig/run-<id>, so nothing the run produced is lost.
 */
export function cleanupWorkspace(workspace: Workspace): { branch: string; commit: string } {
  const tree = snapshotTree(workspace);
  const head = gitOutput(['rev-parse', '--verify', 'HEAD^{commit}'], workspace.path);
  let commit = head;
  if (gitOutput(['rev-parse', head + '^{tree}'], workspace.path) !== tree) {
    commit = gitOutput(
      ['commit-tree', tree, '-p', head, '-m', 'tuig run ' + workspace.id + ' final state'],
      workspace.path,
      { env: { ...process.env, ...HARNESS_IDENTITY } },
    );
    gitOutput(['update-ref', 'refs/heads/' + workspace.branch, commit, head], workspace.path);
  }
  gitOutput(['worktree', 'remove', '--force', workspace.path], workspace.root);
  return { branch: workspace.branch, commit };
}

/** One-line summary of the worktree's changes since the base, for approval prompts. */
export function diffStat(workspace: Workspace): string {
  const tree = snapshotTree(workspace);
  return gitOutput(
    ['diff', '--shortstat', '--no-color', '--no-ext-diff', '--no-textconv', workspace.base, tree],
    workspace.path,
  );
}

/**
 * Put the worktree back to a checkpoint: the run branch and index return to
 * the commit the checkpoint was taken on, and the files to the checkpoint's
 * tree. Files added since are removed; ignored files are left alone.
 */
export function restoreCheckpoint(
  workspace: Workspace,
  ref: string,
): { commit: string; tree: string } {
  const commit = gitOutput(['rev-parse', '--verify', ref + '^{commit}'], workspace.path);
  const tree = gitOutput(['rev-parse', commit + '^{tree}'], workspace.path);
  const parent = gitOutput(['rev-parse', '--verify', commit + '^1'], workspace.path);
  const current = snapshotTree(workspace);
  const added = runGit(
    ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=A', tree, current],
    workspace.path,
  );
  if (added.error || added.status !== 0)
    throw new Error('Cannot compare worktree with checkpoint.');
  for (const path of added.stdout.split('\0').filter(Boolean))
    rmSync(join(workspace.path, path), { force: true });
  gitOutput(['update-ref', 'refs/heads/' + workspace.branch, parent], workspace.path);
  gitOutput(['read-tree', parent], workspace.path);
  const directory = mkdtempSync(join(tmpdir(), 'tuig-restore-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'index') };
    gitOutput(['read-tree', tree], workspace.path, { env });
    gitOutput(['checkout-index', '--all', '--force'], workspace.path, { env });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (snapshotTree(workspace) !== tree)
    throw codedError('TUIG_E_WORKSPACE', 'Restored worktree does not match ' + ref + '.');
  return { commit, tree };
}
