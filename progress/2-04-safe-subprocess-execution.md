# Step 2.4: Safe subprocess execution

- **Stage:** 2 — Controlled execution
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 2 → Step 2.4
- **Depends on:** Step 2.3
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] Spawn with `detached: true` so each tool gets its own process group.
- [ ] On timeout or cancel, kill the whole group (SIGTERM, then SIGKILL after a grace period).
- [ ] Pass a minimal environment allow-list (PATH, HOME pointing to a temp dir, LANG, plus explicitly configured vars) and never the full parent environment.
- [ ] Deny reads of `~/.ssh`, `~/.aws`, `~/.config/gh` and similar credential locations.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] A tool that spawns `sleep 1000` children leaves no orphans after a timeout.
- [ ] A secret in the parent env is not visible to `run env`.
- [ ] An agent cannot kill the harness's own process. Test this with a fixture that tries `pkill -f tuig`.

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
