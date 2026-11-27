# Step 1.3: Self-teaching docs and `tuig doctor`

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.3
- **Depends on:** Step 1.2
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `tuig agents-start-here`: a compiled-in orientation for agents covering what tuig is, the verbs, the envelope and the safety rules.
- [ ] `tuig docs get <topic>`.
- [ ] `tuig doctor`: checks Node/Bun version, `git` and `rg` availability, the sandbox tool (`sandbox-exec` or `bwrap`), whether the repo is initialised and trusted, and config validity.
- [ ] Docs are bundled at build time, so they always match the binary.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] `tuig doctor` returns `unconfigured` with `next_action: "tuig init"` in an empty git repo.
- [ ] It returns `ok` after init and trust.
- [ ] Missing `bwrap`/`sandbox-exec` gives `degraded` with a `fix`.
- [ ] Docs work offline.

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
