# Node 24 runtime floor

- Status: Accepted
- Date: 2026-11-27

## Context

The skeleton needs an explicit supported Node version and matching declarations.

## Decision

Require Node >=24.0.0; CI uses Node 24, and declarations are pinned to the Node 24 series. The developer environment runs Node 24.22.1. Prefer Node built-ins and do not use Bun runtime APIs.

## Consequences

Earlier Node releases are unsupported. A newer major runtime requires compatibility checks before raising the floor.
