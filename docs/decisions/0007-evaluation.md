# Evaluation runner

- Status: Accepted
- Date: 2026-11-27

## Context

The project needs an agreed boundary for evaluation runner.

## Decision

**Own `tuig eval`**, with task folders shaped like Harbor/Terminal-Bench tasks (instruction, setup, reference solution, visible tests, hidden tests) so moving to Harbor or Inspect AI later stays possible. **Proposed, confirm with the human at Stage 5:** a suite-level cost cap of $150 per full evaluation.

## Consequences

Implementation must respect this boundary; changes require human agreement and a new decision.
