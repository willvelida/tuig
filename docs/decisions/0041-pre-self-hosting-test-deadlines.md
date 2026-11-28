# Bound test concurrency and separate lint semantics from process deadlines

- Status: Accepted
- Date: 2026-11-28

## Context

The full WSL suite runs test files concurrently, defaulting to the host's
available parallelism (12 on this machine). Many files spawn additional Node,
Git and sandbox processes. Stage 3 semantic lint tests supplied artificial
500 ms or two-second process deadlines, including process startup, although
they test diagnostic identity and byte rollback rather than execution timing.
The same original tests pass in isolation and intermittently report lint_failed
under full-suite load. The original dbbca3e full suite reproduced this in
`edit guard: warnings` (1314.9 ms total, expected ok, actual lint_failed).
The same run also hit a pre-existing 400 ms cancellation setup race in a main
subprocess test; that protected test is unchanged.

## Decision

Give semantic lint cases the ordinary ten-second check budget. Keep the
explicit pre-edit and post-edit timeout cases at 500 ms and preserve every
assertion. Bound npm test to four concurrent test files so CPU/process startup
contention scales predictably instead of following machine CPU count. This is
a test infrastructure bound, not a change to production execution deadlines,
retry, skipped test or relaxed expectation. All files still run.

## Verification

Run the original commit in a disposable WSL clone, then require every new
hardening regression to fail there. Run all final checks on Windows and five
consecutive full WSL suites with sandbox and real gitleaks required, followed
by the safety and mutation scripts. Keep results in the Step 3.4b progress log.
