# Approvals

- Status: Accepted
- Date: 2026-11-27

## Context

The project needs an agreed boundary for approvals.

## Decision

Default mode **`ask`**. Approvals use a **terminal prompt showing the raw argv**, cwd and diff stats, never an LLM-written summary.

## Consequences

Implementation must respect this boundary; changes require human agreement and a new decision.
