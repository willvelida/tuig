# Publishing

- Status: Accepted
- Date: 2026-11-27

## Context

The project needs an agreed boundary for publishing.

## Decision

**Public on npm + GitHub (`willvelida/tuig`), Apache-2.0 licence** (already in the repo). The npm package name is `tuig` if available; otherwise ask the human (e.g. a scoped `@willvelida/tuig`). AGPL or source-available tools (e.g. TruffleHog, Arize Phoenix) may only be optional external tools, never bundled.

## Consequences

Implementation must respect this boundary; changes require human agreement and a new decision.
