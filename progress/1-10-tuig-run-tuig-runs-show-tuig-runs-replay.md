# Step 1.10: `tuig run`, `tuig runs show`, `tuig runs replay`

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.10
- **Depends on:** Step 1.9
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `tuig run <task-id|--instruction "…">`. In stage 1 it may run in a plain branch; worktrees come in stage 2.
- [ ] `tuig runs show <id>`: a summary, the event timeline and the diff.
- [ ] `tuig runs replay <id> --adapter replay`.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] A run on a fixture task produces a branch, a diff, `events.jsonl` and `summary.json`.
- [ ] Replay reproduces the same event sequence, ignoring timestamps and durations.

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
