# Platforms and sandbox

- Status: Accepted
- Date: 2026-11-27

## Context

The project needs an agreed boundary for platforms and sandbox.

## Decision

**macOS + Linux (incl. WSL2).** Seatbelt (`sandbox-exec`) on macOS, bubblewrap (`bwrap`) on Linux. Devcontainer optional. Native Windows is out of scope for v1.

## Consequences

Implementation must respect this boundary; changes require human agreement and a new decision.
