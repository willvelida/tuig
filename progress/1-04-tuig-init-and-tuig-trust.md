# Step 1.4: `tuig init` and `tuig trust`

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.4
- **Depends on:** Step 1.3
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `tuig init`: idempotent scaffolding from `templates/init/v1/`. It writes `.tuig/config.json` and `.tuig/checks.json`, adds a `.gitignore` entry for `.tuig/runs/` and `.tuig/temp/`, and records each file's template version and sha256 in `.tuig/template.lock.json`.
- [ ] It only proposes the marked AGENTS.md section; the section is written only with `--write-agents-md` or after an interactive yes.
- [ ] `tuig template diff` shows upstream template changes and applies nothing.
- [ ] `tuig trust`: marks this repo trusted in **user-level** state (e.g. `~/.config/tuig/trusted.json`, keyed by absolute path plus the repo's root commit), never in the repo itself.
- [ ] Until a repo is trusted, no repo-local checks, config-defined commands or skills are loaded or run.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Running `tuig init` twice changes nothing the second time.
- [ ] Hand-edited files are never overwritten.
- [ ] An untrusted repo's `checks.json` is never executed (there's a test for this).
- [ ] Non-interactive mode requires the `TUIG_TRUST_CI=1` env flag.

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
