# Run worktrees, checkpoints and protected paths

- Status: Accepted
- Date: 2026-11-27

## Context

Stage 1 ran the agent on a new branch inside the human's own checkout (ADR 0025). Stage 2 requires that the agent only acts inside an isolated worktree, that repository hooks never run, that consequential writes need approval, and that the main checkout is never modified.

## Decision

**Worktree per run.** `createWorkspace` refuses a dirty base (tracked or untracked changes) with `TUIG_E_DIRTY`, then runs `git worktree add -b tuig/run-<id>` at `.tuig/temp/worktrees/<id>`. That directory is inside the main checkout but must be gitignored (`tuig init` already ignores `.tuig/temp/`); creation refuses otherwise, refuses symlinked path components and an existing run branch, and re-checks that the main checkout's status is unchanged. Run records stay in the main checkout's `.tuig/runs/<id>`, outside the agent's path root, so the agent cannot read or alter its own record. Status checks use `--no-optional-locks` so the harness never rewrites the main index.

**Safe Git everywhere.** One helper (`src/engine/git.ts`) runs every harness Git command with `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, and also exports the same settings as `GIT_CONFIG_COUNT/KEY/VALUE` environment variables. Tool subprocesses inherit those variables, so a trusted check or tool that calls Git itself cannot trigger hooks either. A test fails if any other compiled module spawns `git` directly.

**Checkpoints.** Before each model request the harness snapshots the worktree into a tree object through a private temporary index (`GIT_INDEX_FILE`), commits it with a fixed `tuig` identity and creates `refs/tuig/checkpoints/<id>/<turn>`, refusing to overwrite an existing ref. The agent's index and branch are untouched. A `checkpoint` event records turn, ref, commit and tree. `diff.patch` is the diff from the base commit to a fresh snapshot, so untracked new files are included (Stage 1 missed them).

**Cleanup.** `tuig runs cleanup <id>` commits any uncommitted final state onto `tuig/run-<id>` and removes the worktree. The branch and checkpoint refs stay. Nothing is pushed.

**Protected paths.** `.git`, `.tuig`, `.agents`, `AGENTS.md`, `CLAUDE.md`, CI configuration (`.github/`, `.gitlab-ci.yml`, `.circleci/`, `.buildkite/`, Azure, Bitbucket, Travis, Jenkins) and command-defining configuration (`package.json`, Makefiles, `justfile`, `Taskfile.yml`, `pyproject.toml`, `setup.cfg`, `tox.ini`, `noxfile.py`, `.pre-commit-config.yaml`, `.gitattributes`, `.gitmodules`, `.envrc`, `.husky/`, `.vscode/`, `.devcontainer/`) are writable only with approval. Both the requested and the resolved path are classified. Credential locations and hidden tests stay refused for reads and writes regardless of approval; `.git`, `.tuig` and `.agents` stay unreadable. The 2.2 policy engine will make this list configurable.

**Approval path.** A protected write calls the approver with a harness-built request (tool, path, rule, cwd, diff stat; never model prose). The controller records `approval_requested`, moves `RUNNING → AWAITING_APPROVAL`, records `approval_decided` and returns to `RUNNING` through a new `deny` or the existing `approve` event. Without an approver (non-interactive), the write is denied immediately and recorded as `policy_denied`. Step 2.3 adds the terminal prompt as an approver.

**Agent Git tool.** A sixth tool, `git`, accepts only `status`, `diff`, `log`, `show`, `add` and `commit`. Each subcommand has an explicit flag allow-list (for example no `--output`, `--ext-diff`, `--amend`, `-F`, `--template`, `--pathspec-from-file`, `--format` or `-c`); the harness appends `--no-ext-diff --no-textconv` (and `--no-verify` for commit), disables signing, and runs Git with a throwaway `HOME`, no system config and no pager. Arguments that name credential or hidden-test paths are refused. Push, force, reset, rebase, filter-branch and clean are not offered.

**Replay compatibility.** Replay now reproduces checkpoint, approval and `policy_denied` events from the record and sends each request's *recorded* tool definitions, so records made before the `git` tool existed (including frozen B0) still verify. A test replays all 15 B0 records.

## Consequences

Runs need a clean, committed `.gitignore` that ignores `.tuig/temp/`. The agent cannot create new files with `edit` yet, as before. Approval-gated writes in non-interactive runs fail closed. Worktrees accumulate until `tuig runs cleanup`; they are needed for review and for resume in Step 2.6. Process-group cleanup, minimal environments and the OS sandbox remain for Steps 2.4 and 2.5, so allow-listed `run` commands can still write anywhere the user can.
