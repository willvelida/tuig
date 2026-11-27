import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Credential and oracle locations: never readable or writable, even with approval. */
const CREDENTIAL =
  /^(?:\.env(?:\..*)?|\.aws|\.ssh|\.azure|\.gnupg|\.config|tests-hidden|credentials(?:\..*)?)$/i;
/** Harness and Git state: not readable by the agent; writable only with approval. */
const STATE = /^(?:\.git|\.tuig|\.agents)$/i;

/**
 * Protected paths are writable only after approval. Each rule names a location
 * whose contents steer agents, CI, or commands that tools and checks execute.
 */
const PROTECTED_DIRECTORIES: Readonly<Record<string, string>> = {
  '.git': 'git-state',
  '.tuig': 'harness-config',
  '.agents': 'agent-skills',
  '.github': 'ci-config',
  '.gitlab': 'ci-config',
  '.circleci': 'ci-config',
  '.buildkite': 'ci-config',
  '.husky': 'command-config',
  '.vscode': 'command-config',
  '.devcontainer': 'command-config',
};
const PROTECTED_FILES: Readonly<Record<string, string>> = {
  'agents.md': 'agent-instructions',
  'claude.md': 'agent-instructions',
  '.gitlab-ci.yml': 'ci-config',
  '.travis.yml': 'ci-config',
  'azure-pipelines.yml': 'ci-config',
  'bitbucket-pipelines.yml': 'ci-config',
  jenkinsfile: 'ci-config',
  'package.json': 'command-config',
  makefile: 'command-config',
  gnumakefile: 'command-config',
  justfile: 'command-config',
  'taskfile.yml': 'command-config',
  'pyproject.toml': 'command-config',
  'setup.cfg': 'command-config',
  'tox.ini': 'command-config',
  'noxfile.py': 'command-config',
  '.pre-commit-config.yaml': 'command-config',
  '.gitattributes': 'command-config',
  '.gitmodules': 'command-config',
  '.envrc': 'command-config',
};

/** Rule name when a workspace-relative path is protected, otherwise null. */
export function protectedRule(rel: string): string | null {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  for (const part of parts.slice(0, -1)) {
    const rule = PROTECTED_DIRECTORIES[part.toLowerCase()];
    if (rule) return rule;
  }
  const last = (parts.at(-1) ?? '').toLowerCase();
  return PROTECTED_DIRECTORIES[last] ?? PROTECTED_FILES[last] ?? null;
}

export type WorkspaceTarget = { file: string; rel: string; rule: string | null };

/**
 * Resolve an agent-supplied path inside the workspace. Reads never reach
 * credentials or harness state. Writes never reach credentials; writes to
 * protected paths are returned with their rule so the caller can ask.
 */
export function resolveTarget(root: string, path: string, mode: 'read' | 'write'): WorkspaceTarget {
  const refused = (part: string): boolean =>
    CREDENTIAL.test(part) || (mode === 'read' && STATE.test(part));
  if (
    isAbsolute(path) ||
    path.includes('\0') ||
    path.split(/[\\/]/).some((part) => part === '..' || refused(part))
  )
    throw new Error('Workspace or credential path denied.');
  const base = realpathSync(root),
    candidate = realpathSync(resolve(base, path));
  const rel = relative(base, candidate);
  if (
    rel === '..' ||
    rel.startsWith('..' + sep) ||
    isAbsolute(rel) ||
    rel.split(/[\\/]/).some((part) => refused(part))
  )
    throw new Error('Resolved path escapes workspace or reaches a protected path.');
  // Classify both the requested and the resolved path; either being protected is enough.
  const rule = protectedRule(path) ?? protectedRule(rel);
  // Portable separators: requests and records read the same on every platform.
  return { file: candidate, rel: rel.split(sep).join('/'), rule };
}

/** Read-mode resolution for tools that only read or use a directory as cwd. */
export function workspacePath(root: string, path: string): string {
  return resolveTarget(root, path, 'read').file;
}
