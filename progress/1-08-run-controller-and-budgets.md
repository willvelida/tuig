# Step 1.8: Run controller and budgets

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.8
- **Depends on:** Step 1.7
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `states.ts`: the enum and terminal states from §2.
- [ ] A pure `transition()` with an exhaustive test table.
- [ ] `controller.ts`: the loop.
- [ ] `budgets.ts`, with defaults from decision 6: requests 100, cost $10, wall 60 min, format errors 3, repair 3/6.
- [ ] Request and tool-call budgets are checked **before** acting; tokens and cost after each response.
- [ ] SIGINT sets a cancellation flag that is checked at step boundaries, ending in `CANCELLED`.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Each terminal state is reachable in tests using the replay adapter.
- [ ] Budget exhaustion produces the right `BUDGET_EXCEEDED(kind)`.
- [ ] Ctrl-C produces `CANCELLED` and a valid record.

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
