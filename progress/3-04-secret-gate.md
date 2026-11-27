# Step 3.4: Secret gate

- **Stage:** 3 — Deterministic feedback
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 3 → Step 3.4
- **Depends on:** Step 3.3
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] A gitleaks (MIT) check over the run diff as a blocking gate.
- [ ] It is an external tool. If it's missing, `tuig doctor` reports `degraded`; never download it automatically.
- [ ] Verify gitleaks' current version and licence and record them in a decision file.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] a planted fake secret in an agent edit is caught before the run can succeed.

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
