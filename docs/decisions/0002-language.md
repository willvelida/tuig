# Language

- Status: Accepted
- Date: 2026-11-27

## Context

The project needs an agreed boundary for language.

## Decision

**TypeScript**, strict mode, written only against Node-compatible APIs. Distributed (a) as an npm package and (b) as single-file executables built with `bun build --compile` for macOS (arm64, x64) and Linux (x64, arm64). Tests run under Node; CI also smoke-tests the compiled Bun binary. Avoid Bun-only APIs and native addons (no `node-pty` in v1).

## Consequences

Implementation must respect this boundary; changes require human agreement and a new decision.
