# Step 1.5: Run record and redaction

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.5
- **Depends on:** Step 1.4
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `record.ts`: `appendEvent` (JSONL, fsync), `readRun` and `writeSummary`.
- [ ] Event JSON Schemas with `schema_version`.
- [ ] `redact.ts`: env-var values from a sensitive list, common token patterns and configured literals, applied **before** anything is written.
- [ ] Runs are stored at `.tuig/runs/<run-id>/{events.jsonl,summary.json,diff.patch,tool-logs/}`.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Each test event validates against its schema.
- [ ] A planted fake key (`sk-test-…`, an AWS-style key, a value of `OPENAI_API_KEY`) never appears in any file under `.tuig/runs/`.
- [ ] A crash mid-run leaves a readable, valid prefix of events.

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
