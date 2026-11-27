# Step 1.6: Model adapter

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.6
- **Depends on:** Step 1.5
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `adapter/types.ts`: the interface plus normalised `Usage`.
- [ ] `openai-compat.ts`: chat completions with tool calls. Base URL, model and `apiKeyEnv` (the *name* of an env var) come from config. A per-model price table in config is used for cost.
- [ ] `replay.ts`: replays `model_response` events from a recorded run, keyed by step index. Unrecorded steps fail loudly.
- [ ] Egress check: if the base URL host is not `localhost`/`127.0.0.1`/`::1` and not in `models.allowedEndpoints`, refuse with `TUIG_E_EGRESS_DENIED` and a `fix`.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Unit tests run against a local mock HTTP server, so tests make no real network calls.
- [ ] A non-allow-listed hosted URL is refused.
- [ ] Keys never appear in records.
- [ ] Replaying a recorded run reproduces the same model responses.

## Stop conditions (from the guide)

Before the first call to any hosted endpoint, confirm with the human which endpoint and model are approved, and that only fixture repos will be used.

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
