# Step 2.5: OS sandbox

- **Stage:** 2 — Controlled execution
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 2 → Step 2.5
- **Depends on:** Step 2.4
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `sandbox/macos-seatbelt.ts`: generates a `sandbox-exec` profile that allows writes only in the worktree and temp dir, and denies network.
- [ ] `sandbox/linux-bwrap.ts`: a bubblewrap invocation with the worktree bound read-write, the system read-only, `--unshare-net` and a `--die-with-parent`-style cleanup.
- [ ] **Fail closed:** if the sandbox tool is missing, `run` refuses to execute in `auto`/`auto-edit` modes and `tuig doctor` reports `degraded`.
- [ ] You may evaluate `@anthropic-ai/sandbox-runtime` (Apache-2.0, pre-1.0). If you adopt it, record it in a decision file and keep it behind `sandbox/index.ts` so it can be replaced.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] Under the sandbox, writing outside the worktree fails.
- [ ] `curl https://example.com` fails.
- [ ] Reading `~/.ssh` fails.
- [ ] Tests run on both macOS and Linux CI runners. If one platform isn't available in CI, document the manual test.

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
