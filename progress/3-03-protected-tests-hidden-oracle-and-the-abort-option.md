# Step 3.3: Protected tests, hidden oracle and the abort option

- **Stage:** 3 — Deterministic feedback
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 3 → Step 3.3
- **Depends on:** Step 3.2
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] A gate that fails if the run's diff modifies any file matched by `protectedTests` globs, unless the human approves it.
- [ ] Hidden tests are copied in only at final validation, outside the agent's tool view.
- [ ] The task verdict is written by the harness from the hidden oracle; the agent cannot write it.
- [ ] Make sure the agent's prompt mentions `abort_with_reason` as a legitimate option when a task seems impossible.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] 100% of test-tamper attempts in fixtures are blocked and counted.

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
