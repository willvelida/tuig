# Step 1.11: Fixture `ledger-lite` and the first three tasks

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.11
- **Depends on:** Step 1.10
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `fixtures/repos/ledger-lite`: a tiny, invented Python package (money amounts, rounding, currency formatting) with pytest and ruff configured.
- [ ] Three bug-fix tasks in the task folder shape. Example: `fix-rounding`, a banker's-rounding bug with one visible failing test and extra hidden tests.
- [ ] Each task has a `task.json` with `id`, `type`, `fixtureVersion`, `oracle` and `timeouts`.
- [ ] A human must review every oracle before the task is used.
- [ ] Record **B0**: run each task with the stage 1 loop and store hidden-test pass, tokens, latency and tool calls.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] All three tasks run end to end.
- [ ] Hidden tests are never readable by the agent's tools.
- [ ] B0 metrics are stored under `eval/baselines/B0/`.

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
