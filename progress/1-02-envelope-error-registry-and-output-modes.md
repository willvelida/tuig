# Step 1.2: Envelope, error registry and output modes

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.2
- **Depends on:** Step 1.1
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `envelope.ts`: a typed builder, status→exit-code mapping, and enforcement that non-ok results carry `next_action`.
- [ ] `errors.ts`: the error registry, with codes like `TUIG_E_UNCONFIGURED`, `TUIG_E_UNTRUSTED`, `TUIG_E_POLICY_DENIED`.
- [ ] `output.ts`: TTY detection and the `TUIG_OUTPUT` override.
- [ ] A script that generates `docs/reference/error-codes.md` from the registry.
- [ ] The JSON Schema for the envelope.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Every command's output validates against `schemas/envelope.schema.json` in tests.
- [ ] Exit codes match the mapping.
- [ ] A test fails if a non-ok envelope lacks `next_action`.
- [ ] The generated error doc is up to date (CI checks this).

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
