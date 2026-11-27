# Structured visible checks and bounded diagnostics

- Status: Accepted
- Date: 2026-11-28

## Context

Step 3.1 needs deterministic feedback from visible repository checks, a standalone command, and an agent tool. Version 1 checks already contain name, argv and optional timeoutSec. Existing runs and frozen B0 replay records must continue to work. The next step needs file coverage metadata to select fast checks after edits.

## Decision

Keep schema_version 1 and add optional kind (gate or repair), parser (exit-code, junit, eslint-json, ruff-json, tsc-text), paths and reportPath. Missing kind defaults to gate, parser to exit-code and timeoutSec to 10, retaining the existing 60 second maximum. Empty configurations are valid for the standalone command (nothing to run); task runs still require at least one check. Check names must be unique. Unknown object properties remain accepted for forward compatibility. Publish checks.schema.json and diagnostic.schema.json; cross-entry name uniqueness is checked at runtime.

paths is an optional list of repository-relative coverage globs. It has no execution effect in this step; argv is passed exactly as configured, without shell expansion or path injection. As clarified by the coordinator, add reportPath separately, required only for junit and refused for other parsers. It names an existing-parent, workspace-relative regular report file. Reject traversal, absolute paths, credential/harness locations and symlink escapes. Remove an old report before running to prevent stale success, then read the new report with a 1 MiB cap. A missing, invalid, oversized or unsafe report is a failed check with an error diagnostic, even after exit zero. Report parents must exist before execution.

All structured parsers read stdout, except JUnit, which reads reportPath. The subprocess retains its existing combined bounded output for logs and additionally exposes stdout separately so stderr warnings cannot corrupt JSON. Parsers accept at most 1 MiB of input and 1000 diagnostics; messages are capped at 8192 characters. Diagnostic fields are always present, with null for unavailable file, line, col and rule. Positions are positive and one-based. File names come from tool reports as data, never as authority to read files. Error diagnostics or abnormal process status fail a check; warnings alone do not. Exit-code failures get a generic diagnostic rather than interpreting arbitrary output as instructions.

Use a small bounded JUnit XML reader instead of adding a dependency. It supports suites, test cases, failure/error elements, attributes, built-in/numeric entities and CDATA; refuses DTDs, external entities, malformed markup and excessive nesting. Suite failure counters without failure elements still fail. Failure messages stay untrusted. This supports the actual pytest report without adding a general-purpose XML stack.

tsc-text is an intentional addition to the guide's parser enumeration. Installed TypeScript 6.0.3 lists no --json option in --help --all and rejects --json with TS5023. Capture that probe alongside the outputs, and parse --pretty false text, including global TS errors and multiline details. No unverified JSON format is assumed.

tuig checks [--json] verifies repository trust before reading config or executing checks, follows config sandbox requirements, and runs every check sequentially. It returns the existing envelope with data.verdict equal to status: ok, degraded for repair failures only, or error if a gate fails. Non-ok results include next_action. Existing exit codes remain 0 for ok/degraded and 1 for error. Untrusted state uses the existing unconfigured envelope and registry errors. No new error codes are needed.

run_checks takes no arguments. The task host supplies a copy of the trusted check list loaded before the agent runs; it never reloads workspace checks.json. Each pinned argv passes the existing policy evaluator (including plan-mode refusal and built-in denies) and the existing runProcess implementation, minimal environment, cancellation and sandbox. Structured tool output uses the existing untrusted delimiter and bounded visibility/logging. Direct human CLI checks is explicitly requested execution and can run in plan mode, just as existing host acceptance checks can.

The run acceptance sensor shares the validator and check executor, but keeps the existing check intent, output log and {name, passed} sensor event shape. It continues to require every visible acceptance check to pass; changing repair orchestration is Step 3.2. Offline replay keeps using recorded definitions and sensor results, preserving frozen B0 records.

## Evidence and consequences

Committed recordings under test/data/checks come from invented snippets, never benchmark repositories or hidden tests. scripts/record-check-outputs.mjs uses the existing rootless Stage 1 image with --pull never and no network for pytest 9.2.0 and Ruff 0.17.6, plus installed ESLint 10.15.0 and TypeScript 6.0.3. versions.json records image identity, versions and argv; tsc-json-probe.txt records the rejected option. The capture script is optional maintenance tooling, not part of normal tests.

test/checks.test.mjs exercises the published schemas and recordings, sequential aggregation, process failures, stale/missing/bad reports, trust refusal, pinned tool configuration, policy refusal and OS sandbox confinement. Its CLI integration test compares the exact same portable envelope on repeated local executions. The existing CI matrix already runs npm test on Ubuntu and macOS with TUIG_REQUIRE_SANDBOX=1; no workflow changes are needed. Native Windows also executes this command integration test; POSIX symlink/sandbox tests run under WSL locally.

No dependencies were added. A subset XML reader needs explicit extension for additional JUnit dialects; unsupported syntax fails closed rather than silently passing. Coverage globs remain metadata until Step 3.2. Neither repair scheduling, test protection nor new security gates are part of this decision.
