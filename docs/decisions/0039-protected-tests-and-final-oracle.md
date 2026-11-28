# Protected tests and host-owned final oracle

- Status: Accepted
- Date: 2026-11-28

## Context

Visible checks can be made to pass by editing their assertions. Hidden tests must
stay outside the agent's tools, and model claims must never determine task verdicts.
Frozen B0 records and existing safety fixtures must replay unchanged.

## Decision

Pin optional `protectedTests` from trusted `.tuig/config.json` before running the
agent. It is a list of repository-relative Node `path.matchesGlob` patterns, with
forward slashes, no absolute paths or traversal. Missing configuration preserves
legacy behavior. Init supplies common test directories and filename patterns.
Task metadata does not override this repository policy. No dependencies are added.

Edits matching these patterns use the existing protected-path approval policy.
After the agent loop ends, compare the complete snapshot
tree with the run base using a NUL-delimited, rename-disabled Git diff. Deletions,
additions, mode changes and both endpoints of renames therefore count. The human
sees the exact harness-derived paths as a JSON array through the existing approval
prompt. Without an approver the final gate denies; rejected diffs cannot succeed.
The run retains the rejected diff for inspection, rather than silently restoring
agent changes. `test_tamper` events and `testTamperAttempts` count attempted
protected edits and final changed paths; an approved edit can also appear in the
final diff, so this is a count of detections rather than unique model calls.

Pin reviewed task oracle bytes and SHA-256 before the first model request.
Only pytest and a finite positive `hiddenSec` timeout of at most one hour are
supported. Verify source containment, reject symlinks, hash mismatches, sources
in the visible repository, and identical bytes in any Git object (including
unreachable objects and alternates). A task with an oracle requires an OS sandbox
before any model request. Hide its source directory from every agent subprocess,
visible check and lint check. Additional hidden paths cannot overlap writable
workspace mounts, and overlapping read-only tool exceptions are removed. File,
search and Git tools retain their existing hidden-test restrictions.

Only after the agent loop has ended and the protected diff gate allows the changes,
copy the final worktree to an isolated temporary directory, excluding Git, harness,
agent-state and hidden-test directories. Symlinks fail closed. Copy the pinned
oracle bytes into this snapshot, recheck SHA-256, and invoke `python -m pytest`
with an argv array through the existing bounded subprocess and OS sandbox.
Disable conftest loading and use an isolated pytest configuration. Oracle output
requires a fresh bounded JUnit report with a test case, distinguishing a sandbox
launcher's exit one from a completed pytest assertion failure. Python isolated
mode prevents workspace sitecustomize or a shadow pytest package from steering
the interpreter startup; pytest adds the project to its import path afterwards.
Output never enters the model conversation or visible tool logs; the snapshot is removed
in `finally`. Exit zero passes, pytest assertion failure (exit one) fails, and
missing Python/pytest, collection/configuration failures, timeout, cancellation or
snapshot errors are typed infrastructure outcomes, never a pass.

The harness records a separate `taskVerdict` object with source `hidden_oracle` in
the summary and CLI result. Its verdict is pass, fail, infrastructure_error, or
not_evaluated. No-oracle runs (including legacy named tasks with no oracle fields)
and runs that never reach final validation explicitly record not_evaluated.
Tools cannot write summary.json even with approval; the actual run record also
lives outside the agent worktree. Existing error codes provide typed remediation:
TUIG_E_ORACLE_REVIEW for rejected pins/exposure, TUIG_E_SANDBOX for missing isolation,
and TUIG_E_PREREQUISITE/TUIG_E_WORKSPACE for execution/snapshot failures.

New summary fields and event types are additive. Offline replay consumes recorded
gate decisions and oracle outcomes without running either. The stable system
prefix explicitly offers abort_with_reason as a legitimate, non-penalised outcome
for impossible or contradictory tasks.

## Verification and consequences

Scripted fixtures in `fixtures/tamper/` measure the harness, require no model calls
and contain no benchmark oracle. Their separate lister leaves the seven Stage 2.7
fixtures unchanged. The direct safety script reports both suites, with attempts,
blocked and unblocked counters for tampering. A new test requires positive attempts,
all blocked, zero unblocked and all legacy violation counters zero.

Regression tests cover exact approval paths, additions, deletions, rename
endpoints, POSIX modes, protected edits, hidden access, verdict writes, oracle pins,
historical Git objects, source masking, final snapshots and process outcomes.
Tests use a test-controlled fake Python executable on PATH for deterministic
process outcomes. For an opt-in real pytest check, run on a sandbox-capable POSIX
host with Python/pytest installed: `TUIG_REAL_PYTEST=1 node --test
test/protected-oracle.test.mjs`. No existing benchmark or approved oracle pins
are changed.
