# Stage 5: Measurement (outline)

- **Stage:** 5 — Measurement
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 5: Measurement (outline)
- **Depends on:** Stage 4: Persistent context
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Human sign-off

- **Plan approved by:** —  **Date:** —
- **Stage result approved by:** —  **Date:** —

## Checklist

- [ ] Re-read `PROGRESS.md` and the Stage 1–3 measurements
- [ ] Break this stage into numbered steps (add them below and in `PROGRESS.md`)
- [ ] Plan for this stage confirmed with the human

### Outline from the guide

- [ ] **Build the rest of the 21-task suite:** 3 tasks × 7 types, across `ledger-lite` and `todo-api`:
  - bug fix with a failing regression test;
  - feature from acceptance criteria;
  - ambiguous or contradictory requirements, including one impossible variant where any "pass" counts as cheating;
  - recovery from a failed tool or an interrupted run;
  - rejecting an unauthorised or destructive action;
  - resisting injected instructions (canary token);
  - integrating independent changes without losing hunks.
- [ ] **`tuig eval --suite core --runs 5 --compare B0`:**
  - Measures pass@1 with confidence intervals, pass^k, per-criterion pass rate, regressions, human interventions, tool calls (total, failed, denied), latency, tokens (input, cached, output, reasoning), cost and recovery.
  - Reports the infrastructure-error rate separately.
  - Pins the model, temperature and fixture versions.
  - **Suite cost cap** (proposed $150; confirm with the human).
  - Comparisons are paired by task. Safety tasks are judged on zero-tolerance counts.
- [ ] **Ablations:**
  - sensors off;
  - context files off;
  - masking vs uncompressed history (don't assume shorter is better).
- [ ] **Optional OpenTelemetry exporter** to localhost (otel-tui as the viewer). It maps events to GenAI `invoke_agent` → `chat` → `execute_tool` spans. Those conventions are still "Development" status, so pin the version and keep message content opt-in.
- [ ] **Mutation testing** (StrykerJS for TS, mutmut for Python) and property tests (fast-check, Hypothesis) run on the changed diff only, periodically, as a test-strength sensor.
- [ ] **Regression gate:** harness changes must not regress the suite.
- [ ] **Exit:**
  - Reruns reproduce results within confidence intervals.
  - Every harness feature's value is reported with effect size and uncertainty.
  - Note: 21 tasks × 5 runs can only reliably detect large effects (around 10 points). Say so in reports.

## Stop conditions (from the guide)

This stage is only outlined in the guide. Do not start building until the plan above is confirmed by the human.

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
