# Budgets (per run, all overridable)

- Status: Accepted
- Date: 2026-11-27

## Context

The project needs an agreed boundary for budgets (per run, all overridable).

## Decision

**100 model requests, $10 cost, 60 min wall clock**, 3 consecutive format errors, 3 repair attempts per failing check and 6 in total.

## Consequences

Implementation must respect this boundary; changes require human agreement and a new decision.
