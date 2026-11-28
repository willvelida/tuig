# External gitleaks gate for the resulting run diff

- Status: Accepted
- Date: 2026-11-28

## Context

Step 3.4 must prevent a run from succeeding after introducing credentials,
including writes made by subprocesses. Frozen records and older configurations
must remain usable. Scanner output is untrusted data and can itself contain
credentials. No new npm dependency is needed.

## Decision

Add trusted configuration `secretGate: required|off`. Init defaults to required.
With coordinator approval, an absent field is legacy-disabled, preserving earlier
configurations. Both absent and explicit off are visible as disabled in the run
summary and CLI result; doctor reports degraded with instructions to enable the
gate and install gitleaks. The run_start event pins required, off or legacy-off.
Agent edits cannot change the loaded choice. Existing test fixtures that are not
testing secrets explicitly opt out in configuration setup, with coordinator
authorization; their assertions remain unchanged.

After the agent loop, when the controller is eligible for success, run the gate
before protected-test approval and the final oracle. A finding produces a typed
secretGate status fail and FAILED_VALIDATION, without repair or model feedback.
Infrastructure failures produce status infrastructure_error, ERROR and
TUIG_E_PREREQUISITE with installation and retry instructions. Missing gitleaks is
checked at final validation, including for empty diffs, rather than refusing the
run up front. Ineligible runs record not_evaluated. Offline replay consumes the
secret_gate event and never executes a scanner. Historical records remain valid.

Use the existing snapshotTree and a hook-disabled NUL-delimited Git diff against
the run base. Copy resulting blobs for added, modified, copied and type-changed
files into an isolated random temporary directory. This is the changed file set
represented by diff.patch: it includes agent commits and non-ignored untracked
files, excludes deleted files, ignored files and unchanged history. This differs
intentionally from ADR 0039's broader oracle/protected-test view: this gate protects
the delivered result diff, not ignored execution inputs. Scan complete changed
files, conservatively also catching pre-existing credentials in those files. Mode
changes can cause their resulting file to be scanned as well. Git blob reads use
the existing UTF-8 Git runner; binary blobs are scanned as decoded text, preserving
ASCII token bytes, rather than trusting binary patch encodings. Submodule blobs
that cannot be read as files fail closed.

Opaque UUID.txt snapshot names prevent a repository .gitleaks.toml or
.gitleaksignore from configuring the scanner and avoid filename allowlist
evasion. 8.16 has no ignore-allow-comments flag, so replace `gitleaks:allow` with
equal-length spaces in scanner input to neutralize agent-controlled inline
suppression without changing line positions. Original result bytes stay intact.
The built-in detector rules and their intrinsic content allowlists still apply;
gitleaks is a detector, not proof of absence of secrets.

Invoke an argv array through runProcess, with minimal environment, no passEnv,
a ten-second timeout, process-group termination and bounded output. It follows
the trusted run's configured OS sandbox (network off when sandboxed). Explicit
sandbox off in ask/plan retains its existing meaning; autonomous runs require
isolation. The scanner runs in the private snapshot, never the agent workspace.
Only its process receives an additional writable report-directory mount. Reports
use a UUID filename in a separate private random directory. Neither snapshot nor
report path is passed to agent tools. Both are removed in finally.

Flags used and verified with `/usr/bin/gitleaks detect --help` in WSL:
`detect --no-git --source <snapshot> --redact --report-format json
--report-path <private-report> --exit-code 42 --no-banner`.
`detect --pipe` was also verified available, but is not used: runProcess deliberately
has no stdin input channel. Exit 42 means findings; exit zero requires an empty
valid report. Any other exit, timeout, missing executable, missing/malformed/
oversized report, non-regular report, symlink, inconsistent status/report or
unknown snapshot filename fails closed. Report reads use O_NOFOLLOW where
available, cap input at 1 MiB and accept at most 1000 findings; the snapshot has a
64 MiB aggregate bound and the changed-path list a 1 MiB bound.

Never persist scanner stdout/stderr or raw report fields such as Match/Secret.
Use --redact and copy only validated rule id, mapped original filename, positive
line number and [REDACTED] marker through the existing redactor. No scanner
feedback reaches the model, approval prompt or repair loop. The new gate's
outputs never contain matched secret values. Earlier agent messages and edit
arguments retain the existing redactor's coverage (AWS/GitHub/OpenAI/Bearer and
environment/literal values); other gitleaks-only formats may still appear in
those earlier records. A final gate cannot retroactively protect that exposure.
Acceptance plants a synthetic AWS-format value covered by both detectors and
checks every run-directory file and the CLI result for its absence.

## External tool verification

On 2026-11-28 in WSL Ubuntu 24.04, `dpkg-query -W gitleaks` returned
`8.16.0-1ubuntu0.24.04.3`; executable `/usr/bin/gitleaks`.
`gitleaks version` returned `version is set by build process`, so version parsing
is never required. Doctor reports available with version unknown for this build.
`/usr/share/doc/gitleaks/copyright` identifies upstream Zachary Rice, source
https://github.com/gitleaks/gitleaks, and Expat (MIT) terms for upstream and Debian
packaging. The complete permission notice was inspected locally.

The Ubuntu package lags upstream, as supplied by the owner. The latest upstream
release version/date and current upstream maintenance activity could not be
independently verified offline: this task permits network only to npm/PyPI
registries, and neither is an authoritative source for gitleaks releases. No
release date or maintenance claim is inferred. Operators should review upstream
releases separately when upgrading. Gitleaks remains optional externally
installed software: never bundled, installed or downloaded by tuig or doctor.

## Verification and consequences

New deterministic tests place a real fake executable on a test-controlled PATH
on every platform. POSIX uses a Node shebang; Windows compiles a small test-only
C# executable with the installed .NET Framework compiler, without dependencies
or downloads. Cases cover edits, subprocess writes, clean results, committed and
untracked files, ignored/deleted files, timeout/crash/missing tool, invalid
reports, opt-out/legacy summaries, unknown versions and degraded doctor states.
A separate real-gitleaks run test is mandatory with TUIG_REQUIRE_GITLEAKS=1,
otherwise skips only when the tool is unavailable. Mutation probes against
generated build output verify regressions reject removal of blocking checks.
No CI workflow or frozen fixture is changed.
