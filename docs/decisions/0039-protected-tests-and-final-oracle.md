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
unreachable objects and alternates).
Tracked source paths are refused independently of blob hashes, and the object
scan also checks LF-normalized bytes so Git line-ending conversion cannot hide
exposure. A task with an oracle requires an OS sandbox before any model request.
Hide its source directory from every agent subprocess,
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
missing Python/pytest, missing/invalid reports, timeout, cancellation or
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

## Review hardening

The final protected-test gate augments the Git snapshot diff with `git ls-files
-z --others --ignored --exclude-standard`, bounded to 1 MiB and executed through
the existing hook-disabled Git runner. Every ignored file matching protectedTests
is gated, including dotfiles and dot directories. Glob matching removes Node's
special leading-dot exclusion using a same-length private sentinel in both paths
and literal dot-prefixed pattern components, preserving wildcard character counts.
The init defaults also cover conftest.py at every depth, pytest.ini, .pytest.ini,
pyproject.toml, tox.ini and setup.cfg.

When ignored protected files exist, changed applicable .gitignore files also
appear in the approval and tamper record. The harness pins the worktree's Git
info/exclude hash before any model turn and records .git/info/exclude if it changes
while hiding protected files. Ignored protected files are counted even if the
ignore rule predated the run. Operators should keep check-generated caches out
of protected directories or disable their creation: an ignored file under a
protected glob still needs approval.

Oracle snapshot copying and ignored-file gating share the same reserved-directory
filter: .git, .tuig, .agents and tests-hidden are never copied. Everything else
that the snapshot copies is included in the gate's view if it matches a protected
glob, whether tracked, untracked, ignored or dot-prefixed. Tracked changes retain
the existing base-to-snapshot diff checks, including rename endpoints and modes.

Hidden-oracle JUnit has stricter semantics than visible checks. It must contain at
least one passed testcase, with no skipped, xfail, xpass, failure or error evidence
in testcase elements, outcome attributes or suite counters. Declared suite test
counts must match their actual descendant testcase counts, and outcome counts
must be valid and within the testcase total. A valid empty or skipped report is
a task failure; missing, malformed or inconsistent reports remain infrastructure
errors. The bounded XML reader is exported for reuse; visible JUnit parsing
behavior is unchanged. Pytest also receives `-o xfail_strict=true`.

Each final validation creates a private random report directory outside the
copied snapshot and a UUID-named report file inside it. Only the final pytest
subprocess receives an additional writable sandbox mount for that directory;
agent tools have no corresponding argument or mount. The old predictable
tests-hidden/result.xml path is ignored. Both snapshot and report directory are
removed after final validation, and report reading remains bounded and refuses
symlinks. Suite/testcase count checks establish internal consistency, not an
independent measurement of collected tests; no in-process plugin or second
collection pass is added.

Residual limitations are explicit: pytest's non-strict XPASS from an explicit
strict=False marker in a human-reviewed, hash-pinned oracle is indistinguishable
from a passing testcase in JUnit, despite the strict default. Also, tested solution
code runs inside the pytest process and can discover the report argv or monkeypatch
pytest and forge evidence. The private random report path prevents predictable
snapshot-file forgery by an agent tool; it cannot authenticate evidence against
adversarial code in the same process. Stage 5 may revisit this execution boundary.
Findings concerning approval on ineligible runs and recorded-event replay remain
separate follow-ups and are not changed here.

## Final review corrections

An empty protectedTests list bypasses the gate's Git work entirely. Otherwise
ignored-file enumeration passes each validated pattern to Git as a `:(glob)`
pathspec, plus exclusions for the snapshot's reserved paths, before the existing
dot-aware post-filter. The 1 MiB bound therefore applies to filtered candidates,
not unrelated ignored dependency trees. A genuine filtered-list overflow fails
closed with TUIG_E_WORKSPACE, a specific message and next_action, a recorded
policy_denied infrastructure event, and the same diagnostic in the run summary
and CLI error envelope. Offline replay consumes that recorded final-gate event.

The supported protectedTests subset is repository-relative forward-slash literal
components, `*` within a component, and whole-component `**`. Brace expansion,
extglobs, character classes, `?`, embedded double-stars, empty/dot components,
absolute paths and traversal are refused. Unsupported patterns raise TUIG_E_CONFIG
with the offending pattern and instructions to expand it into separate supported
patterns. Restricting the new, unmerged configuration avoids Node/Git matching
differences silently omitting ignored protected files; `?` and character classes
also have differing Unicode byte/character behavior. All init patterns are tested
through both Git filtering and the post-filter, including dot paths and conftest
at arbitrary depths.

Python `__pycache__` and `.pytest_cache` directories, and files ending in `.pyc`,
are reserved regardless of Git ignore state. They are neither gated nor copied
into the oracle snapshot. No other ignored file type is exempted; ignored
conftest.py and tests still require approval. This supersedes the earlier cache
operator warning: ordinary visible pytest caches no longer cause false tamper
denials, and stale bytecode cannot enter final oracle execution. Environment
behavior is otherwise unchanged; exclusion is enforced even if a check writes
caches explicitly.

Oracle tests now validate the complete required argv and exercise final pinned
bytes mutated after load. Mutation probes independently remove -I, --noconftest,
xfail_strict and the final SHA-256 recheck and require regression assertions to
fail. A final hash mismatch preserves TUIG_E_ORACLE_REVIEW. Missing, malformed or
inconsistent reports use TUIG_E_PREREQUISITE; snapshot/filesystem failures use
TUIG_E_WORKSPACE. A valid adverse report with pytest exit 2 (collection/import
failure), as well as exits 0, 1 or 5, is a task failure. Missing/invalid evidence,
timeouts and launcher failures remain infrastructure outcomes. No resume baseline
attribution behavior is changed.

## Pre-self-hosting hardening

At run start, pin the ignored protected-file paths and SHA-256 content hashes,
with the same filtered 1 MiB listing limit and a 64 MiB aggregate content limit.
Hash through bounded reads and refuse symlinks and non-regular files. Final
validation gates additions, content changes and deletions relative to that
baseline; unchanged dependency-installed tests do not require approval. The
run_start event carries the baseline through resume chains; resume refuses a
missing or invalid baseline rather than attributing prior edits to the operator.
Changed ignore rules are included only when ignored protected content changes.

Every harness subprocess now receives PYTHONPYCACHEPREFIX in its fresh private
temporary home outside the workspace, and PYTHONDONTWRITEBYTECODE=1. These
harness-owned settings override passEnv and require no argv rewriting. This
covers standalone visible checks, run_checks, lint before/after edits and repair
validation through their shared process runner. A forged timestamp/size-valid
workspace pyc remains demonstrably usable by an ordinary Python invocation but
is never consulted by these checks. Reserved-cache exclusion alone protected the
oracle snapshot; it did not protect visible execution. Python isolated mode
ignores environment configuration, but already ignores PYTHONPATH and uses its
own startup semantics; trusted checks must not explicitly reset the interpreter's
cache prefix or load arbitrary bytecode as data. No environment mechanism can
constrain a trusted command that deliberately overrides it.
