# Step 2.3: Approval prompt

- **Stage:** 2 — Controlled execution
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 2 → Step 2.3
- **Depends on:** Step 2.2
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] A terminal prompt that shows the raw argv, cwd, the matching rule and the diff stat.
- [ ] Choices: allow once, allow for this run, or deny.
- [ ] "Allow for this run" never persists beyond the run.
- [ ] Writes `approval_requested` and `approval_decided` events.
- [ ] Non-interactive runs: ask becomes deny with `policy_denied`.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Approvals and denials are recorded.
- [ ] The prompt never shows model-generated prose as the description of the action.

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
