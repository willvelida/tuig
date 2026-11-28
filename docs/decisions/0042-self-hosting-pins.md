# Pinned self-hosting executable and explicit binary under test

- Status: Accepted
- Date: 2026-11-28

## Context

The code being edited must not supply its own policing harness. Step 3.5a
prepares configuration and regression tests; only the owner installs a tagged
pin and launches the later demo. No dependency or adapter change is needed.

## Decision

Optional selfHost contains pinnedVersion (a local Git tag name) and pinnedSha256.
Resolve $XDG_DATA_HOME/tuig/pinned/<version>/tuig, falling back to
~/.local/share/tuig/pinned/<version>/tuig. Canonicalize the path, refuse paths
inside the repository, verify the SHA-256, then probe --build-identity with argv,
a five-second deadline and 16 KiB output bound. Hash regular files incrementally
with a 256 MiB cap and refuse observed changes during the read, rather than
allocating from a candidate's advertised size. Refuse missing pins, placeholders,
unknown/dirty identities, absent local tags, or commit/tree values inconsistent
with that tag. These conditions return TUIG_E_SELFHOST_UNPINNED with remediation.
The tag may equal HEAD: a demo can start immediately after pinning.

build:binary obtains hook-disabled Git commit/tree and dirty status, and embeds
them using Bun's define option in the build-identity module. Source builds expose
an unknown dirty placeholder. No real generated identity is committed. The
invoking executable must itself hash to the pin for run and checks; Node source
invocations fail closed. Doctor always completes its other diagnostics, then
reports TUIG_E_SELFHOST_UNPINNED for a dev invocation as well as an invalid pin;
the overall status is error with the full per-check list and pinning remediation.
Read-only docs, orientation and runs show remain available from development code.
Hash approval is the primary control: a malicious executable can lie about
its identity, and a human can deliberately approve a malicious hash/tag. The
embedded identity detects accidental development builds, not hostile compilation.

protectedPaths uses the existing validated protectedTests glob grammar and edit
approval/final snapshot gate, including subprocess changes. Configure all guide
section 4 paths in tuig's own config. Hidden tests and harness verdicts retain
their unconditional refusal. A self-hosted summary records the pinned version,
hash and sorted unique protectedPathsTouched, including denied edit attempts
recorded by test_tamper. Offline replay copies this host-owned evidence without
executing the binary. Setup failures carry an empty touched list.
Final-diff attribution also runs independently of approval events: an earlier
secret-gate failure or adapter error must not hide protected subprocess/check
writes from the summary. Persist attempted-path pin evidence before this bounded
audit so an infrastructure error cannot erase the selfHost block. The existing
redactor still governs summary paths, with the same format limitations as the
existing diff artifact; this is not a new secret-detection mechanism.

checks --binary-under-test statically validates a regular executable and records
its bounded SHA-256 (refreshed after checks can rebuild it). No candidate probe
executes in the host environment. Trusted argv entries exactly equal to {binary-under-test} are replaced with
its absolute path; they default to bin/tuig for the repository's ordinary build
then safety-check sequence. This does not change the invoking harness. The safety
fixture script passes that binary as the executable for its real CLI runs rather
than substituting source under test. Invalid candidates produce a typed error and
next_action. No shell interpolation or environment-based executable selection is
added. In run worktrees the default resolves against the worktree after creation;
the preceding trusted build check creates it before the safety suite.

## Review round 1 corrections

Candidate selection is static only: resolve a regular executable, check execution
permission and hash through the bounded reader, then record path/SHA in the
checks result. Never run its version probe with host environment/credentials.
Candidate execution belongs to the confined safety check. Candidate build mode
skips Git and embeds unknown/dirty/candidate identity, explicitly rejected by
doctor; normal builds continue to require real Git identity. Main .git remains
hidden from worktree check sandboxes.

Shards use fresh worktree-local TMPDIR/TEMP/TMP. Linux visible checks also use a
private /var/tmp through the existing tmpfs mechanism, selected in non-protected
runner code. Host /var/tmp remains inaccessible for writes. Exact external PATH
directories there may be re-exposed read-only for nested fixture tools. The
trusted shard --sandboxed mode clears inherited Git/Python overrides only for
fixture test processes so plain-tool controls work; actual harness subprocesses
reapply minimalEnv protection. An untyped fixture package boundary isolates tools
from the surrounding ESM package scope, preserving Node syntax detection and
CommonJS extensionless tools. No sandbox/main test is weakened. Exactly two
confined-only named exclusions are reviewed in self-host-test-policy.mjs, pinned
by count/digest and an explicit guard test: the real-HEAD license guard (main .git
must remain hidden), and the nested mount parent-temp escape control (the outer
writable mount cannot become a fresh host boundary without changing protected
sandbox code). Both files still load and all new/other names run; neither is a
whole-file omission. Both cases run in full CI/outside acceptance, and each shard
prints the policy. Working nested sandbox/gitleaks are required, never silently
skipped. The simulation script performs real workspace/setup/baseline/check
execution with step timings and no agent/model.

Acceptance scripts/package/lock/ESLint/TypeScript/Prettier configuration are
protected. protectedTests matches also appear in selfHost summary attribution;
test additions/edits need human approval. Pinning/acceptance use Linux storage,
not DrvFs; trust and execute acceptance inside the returned change worktree.
Template lock stays an upstream baseline, not customized config integrity.
Document identity comparison, full outside-sandbox acceptance without credentials
and the regular-x64 resolver's lack of baseline fallback.

Pins are manually installed outside the repository. Temporary fake executables
and invented tagged test repositories exercise provenance without running an
agent on tuig itself. The root configuration intentionally remains unpinned until
the owner performs Step 3.5b. Offline trusted setup copies a prepared npm cache
and runs npm ci --offline --ignore-scripts before capturing protected baselines.
Missing cache entries fail closed; no network is granted by this setup.

The full Windows suite demonstrably exceeds the existing 60-second check cap.
Keep production deadlines unchanged and partition the same sorted npm-test file
set round-robin into four trusted checks, each retaining concurrency four. A
preceding build check creates the modules. The --list mode exposes all groups
for completeness review. Every invocation discovers all test/*.test.mjs, asserts
each shard is nonempty and their sorted union equals that complete file set
exactly once; newly added matching files cannot silently drop out. No test is
omitted or assertion relaxed. Self-hosting
targets Linux/WSL, and any individual shard exceeding its bound fails closed.

The owner clarified that full doctor diagnostics apply after normal repository
trust. Untrusted repositories retain TUIG_E_UNTRUSTED and early refusal without
reading repository configuration, as required by the existing main regression.
