# Step 2.1: Workspace manager

- **Stage:** 2 — Controlled execution
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 2 → Step 2.1
- **Depends on:** Stage 1 checkpoint
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `workspace.ts`:
  - create a worktree per run on `tuig/run-<id>` from a clean base (refuse if the base has uncommitted changes, with a `fix` message);
  - pass `-c core.hooksPath=/dev/null` on every git invocation;
  - make a checkpoint commit to a shadow ref (`refs/tuig/checkpoints/<run-id>/<n>`) before each turn;
  - produce `diff.patch`;
  - offer cleanup that leaves the branch in place.
- [ ] Protected paths, writable only with approval: `.git/`, `.tuig/`, `.agents/`, `AGENTS.md`, CI config, and any config that defines commands.
- [ ] Git subcommands the agent may run without asking: `status`, `diff`, `log`, `show`, `add`, `commit`. Push, force, reset --hard, rebase, filter-branch and clean are not offered.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] A planted `.git/hooks/pre-commit` that writes a marker file never runs.
- [ ] Writes to protected paths trigger the approval path.
- [ ] The human's main checkout is never modified by a run.

## Verification log

| Date | Command / test | Result (summary) |
|---|---|---|
| | | |

## Decision records created

- (none yet) <!-- e.g. docs/decisions/0011-json-schema-validator.md -->

## Notes and deviations from the guide

- (none yet)

## Open questions for the human

- (none yet) <!-- also copy each one into PROGRESS.md → Open questions -->
