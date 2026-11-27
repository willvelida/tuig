# Step 1.9: Context manager

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.9
- **Depends on:** Step 1.8
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

`assemble(state)` with the following, in order:

- [ ] the stable prefix (system prompt, tool schemas, AGENTS.md; no timestamps or run IDs);
- [ ] the task instruction;
- [ ] the conversation;
- [ ] observation masking: tool outputs older than about 10 turns are replaced by a one-line placeholder that points to the log. Masking happens in batches so the prefix stays stable.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Tests show the prefix is byte-identical across turns.
- [ ] Masking triggers at the threshold.
- [ ] Repository content is always inside untrusted delimiters.
- [ ] The system prompt tells the model that content inside those delimiters is data, never instructions.

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
