# Lint on edit and bounded structured repair

- Status: Accepted
- Date: 2026-11-28

## Context

Step 3.1 provides host-pinned checks with coverage globs and structured diagnostics. Step 3.2 must reject edits introducing lint errors and return useful validation feedback without allowing checker output to become instructions. Repair budgets and the monologue STUCK rule already exist. Frozen B0 records must continue to replay without running checks.

## Decision

Select repair-kind checks with an eslint-json, ruff-json or tsc-text parser and at least one paths glob matching the edited workspace-relative path. Use Node's built-in path.matchesGlob, with slash-normalized paths and patterns, including its standard ** semantics. Gate, JUnit and exit-code checks do not qualify. No new configuration marker or dependency is needed. Coverage opts a structured lint/type checker into edit-time execution; operators should keep these commands fast. Preserve pinned argv exactly: never append an agent-supplied filename or reload editable configuration. Each selected check retains its configured timeout (default 10 seconds, maximum 60 seconds).

Run selected checks sequentially before and after the edit through executeChecks, the same policy evaluator, trusted argv list, minimal environment, cancellation and OS sandbox as run_checks. Compare error-severity diagnostics by a multiset of their complete structured fields. Existing errors and new warnings do not block edits; additional occurrences and changed locations/messages are new errors. Compare the complete selected reports, so errors caused elsewhere in a covered check also reject the edit. Files without qualifying coverage keep the existing edit behavior.

New errors restore the edited file's exact pre-edit bytes and produce tool_call status lint_rejected. Timeout, cancellation, invalid reports, missing executables, unexplained nonzero exits and truncated reports are inconclusive: return lint_failed, leaving the original bytes intact. A pre-edit failure prevents applying the edit; any post-edit exception restores it in finally. Command policy refusal remains policy_denied. Successful lint findings accompanying a nonzero exit remain comparable; process failures without file diagnostics fail closed. This is an edit guard, not a transaction for arbitrary side effects of trusted check commands. Existing missing/ambiguous edit statuses remain unchanged.

Validation records now retain check kind and diagnostics. A failed gate terminates FAILED_VALIDATION immediately, with no repair attempts, as clarified by the coordinator. Harness/infrastructure exceptions retain ERROR. Repair failures return structured feedback inside escaped untrusted sensor delimiters. Feedback preserves valid JSON, with a bounded diagnostic payload and an explicit truncation indicator; names are capped and feedback is redacted before reaching the adapter. Recorded checks retain the existing parser bounds. Three attempts per failed check and six repair rounds total remain unchanged; simultaneous failures each consume one per-check attempt and one total round. Exhaustion terminates FAILED_VALIDATION. Tool-less responses still count toward the three-message monologue rule and can terminate STUCK first. Resume reconstructs per-check attempt counts as well as the existing total count from recorded repair transitions.

Compatibility is based on recorded data: sensor results without kinds/diagnostics retain their historical name-only repair feedback and behavior. Thus old records, including frozen B0, replay unchanged. Live legacy checks.json entries default to gate under Step 3.1, so failures now terminate without repair attempts; consumers that want repairs must explicitly set kind: repair. Resume reconstructs both legacy name-only and structured feedback. The event schema previously left data unconstrained and had no tool status enum; add a reusable definition listing all existing statuses plus lint_rejected and lint_failed, without restricting legacy or future open event data. No summary counters or schema changes are needed.

Parser output exceeding 1000 diagnostics now retains the first 1000 plus one error diagnostic announcing truncation. The marker ensures failure even if the retained findings are warnings and the process exits zero. Inconclusive edit lint cannot use truncated data to accept an edit.

## Consequences and verification

No dependencies were added and protected budgets, stuck detection, sandbox implementation, frozen fixtures and baseline records remain unchanged. New replay/scripted tests cover each budget, successful repair, immediate gate failure, resumed attempts, structured bounded feedback, exact byte rollback, pre-existing errors, warnings, timeouts/crashes, policy enforcement and OS sandbox confinement. A table enumerates all sixteen two-check/two-round pass/fail combinations with and without intervening tools, asserting a typed terminal state within request and repair bounds. Mutation probes remove individual protections in generated build output and require the corresponding regression tests to fail.

Two existing tests received narrow coordinator authorization: the Step 3.1 diagnostic-bound test now asserts retained diagnostics and a truncation marker; the resume monologue fixture explicitly declares its failing check repair-kind while retaining the STUCK assertion. The optional Ruff severity change and unrelated edit-failure status cleanup are deferred.
