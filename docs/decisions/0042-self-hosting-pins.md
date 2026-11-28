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

checks --binary-under-test validates a regular executable with a bounded --version
probe. Trusted argv entries exactly equal to {binary-under-test} are replaced with
its absolute path; they default to bin/tuig for the repository's ordinary build
then safety-check sequence. This does not change the invoking harness. The safety
fixture script passes that binary as the executable for its real CLI runs rather
than substituting source under test. Invalid candidates produce a typed error and
next_action. No shell interpolation or environment-based executable selection is
added. In run worktrees the default resolves against the worktree after creation;
the preceding trusted build check creates it before the safety suite.

## Consequences

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
