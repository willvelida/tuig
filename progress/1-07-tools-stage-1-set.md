# Step 1.7: Tools (stage 1 set)

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.7
- **Depends on:** Step 1.6
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `read_file`: path must resolve inside the workspace; credential paths are denied.
- [ ] `search`: ripgrep with a fixed set of safe flags; `--pre` and similar are never passed through.
- [ ] `edit`: aider-style search/replace blocks. Fails clearly if the search text is missing or ambiguous.
- [ ] `run`: argv array plus cwd plus timeout. In stage 1 this is the single "bash-like" tool, with an allow-list of programs.
- [ ] `abort_with_reason`: ends the run as `ABORTED_BY_AGENT`.
- [ ] Shared requirements for every tool:
  - JSON Schema validation of arguments;
  - output capped (e.g. 8 KB head + 8 KB tail) with the full log written to `tool-logs/`;
  - output wrapped in untrusted delimiters, e.g. `<untrusted source="tool:run">…</untrusted>`.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Invalid arguments are rejected before execution.
- [ ] Path traversal (`../`, symlinks out of the workspace) is denied.
- [ ] Long outputs are truncated with a pointer to the full log.
- [ ] Every tool call produces exactly one `tool_call` event with a status.

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
