# Step 3.2: Lint on edit and the repair loop

- **Stage:** 3 — Deterministic feedback
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 3 → Step 3.2
- **Depends on:** Step 3.1
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] After each `edit`, run the fast lint for the edited file. If it introduces new syntax or lint errors, reject the edit and return the diagnostics (SWE-agent-style guardrail).
- [ ] In `VALIDATING`, failing repair-kind checks send structured diagnostics back to the agent, at most 3 attempts per check and 6 in total, then `FAILED_VALIDATION`.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] The repair loop always terminates within budget.
- [ ] Lint-rejected edits are recorded as such.

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
