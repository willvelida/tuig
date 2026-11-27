# Step 2.2: Policy engine and modes

- **Stage:** 2 — Controlled execution
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 2 → Step 2.2
- **Depends on:** Step 2.1
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `policy.ts` evaluates rules over a structured call `{tool, command, flags, paths, hosts}`.
- [ ] **Deny beats ask, and ask beats allow.** Unknown commands go to ask, or to deny when non-interactive.
- [ ] Allow-lists name the command **and** its permitted flags. For example, `find` without `-exec`/`-delete`, and `rg` without `--pre`.
- [ ] Modes form a one-way ladder:
  - `plan`: read-only;
  - `ask` (default): worktree edits automatic, non-allow-listed commands ask;
  - `auto-edit`: allow-listed commands run automatically;
  - `auto`: everything sandboxed; ask becomes deny when non-interactive.
- [ ] These always ask, in every mode: network access, package installs, writes to protected paths, deletion outside the worktree.
- [ ] There is no bypass-everything mode.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] a table-driven test suite covers each mode against each action category, including the flag-injection cases (`find -exec`, `rg --pre`, `git -c core.sshCommand=…`).

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
