# Step 2.6: Stuck detection, cancellation and resume

- **Stage:** 2 — Controlled execution
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 2 → Step 2.6
- **Depends on:** Step 2.5
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `stuck.ts` with the four thresholds in §2, giving the `STUCK` terminal state.
- [ ] Resume: `tuig run --resume <id>` restores from the last checkpoint ref and the event log.
- [ ] Side-effecting steps that were in flight are **not** silently re-executed. They are re-proposed and logged.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Replayed loops of each stuck pattern end in `STUCK`.
- [ ] SIGKILL after step k followed by `--resume` completes the task with no duplicated side effects and a consistent event log.

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
