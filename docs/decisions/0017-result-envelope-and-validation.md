# Result envelope and schema validation

- Status: Accepted
- Date: 2026-11-27

## Context

All CLI results need a stable machine interface, readable output and actionable failures. Tests must independently validate the published schema.

## Decision

Use the version 1 envelope for help, version and argument errors, writing results to stdout. Pipes default to JSON; TUIG_OUTPUT overrides TTY detection. Invalid overrides return JSON errors. Text renders the same fields. Require non-empty next_action for non-ok results with TypeScript and runtime guards.

Keep error definitions in one registry; generate the reference document and schema error enum from it. Check generated files in CI.

Use Ajv 8.20.0 as a development-only draft-07 JSON Schema validator. npm metadata checked 2026-11-27: latest version 8.20.0, MIT licence, updated 2026-04-24 (within 12 months). No production dependencies added.

## Consequences

Piped version output now exposes data.version; binary smoke checks parse it. Schema validation remains test-only. Registry changes require reference regeneration.
