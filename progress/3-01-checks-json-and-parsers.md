# Step 3.1: `checks.json` and parsers

- **Stage:** 3 — Deterministic feedback
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 3 → Step 3.1
- **Depends on:** Stage 2 checkpoint
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] The `checks.json` schema: `{name, argv, kind: gate|repair, parser: exit-code|junit|eslint-json|ruff-json, timeoutSec, paths?}`.
- [ ] Parsers that output one `Diagnostic` schema `{tool, file, line, col, rule, severity, message}`.
- [ ] `tuig checks [--json]` runs them in order and returns the envelope with verdict `ok` (all pass), `degraded` (repair-kind failures only) or `error` (a gate failed).
- [ ] The `run_checks` tool lets the agent run the visible checks.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Parser tests pass on recorded real outputs of pytest `--junitxml`, `ruff check --output-format json`, `eslint -f json` and `tsc`. tsc output is parsed as text: its JSON output was not verified, so check it.
- [ ] The same `tuig checks` runs identically locally and in CI.

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
