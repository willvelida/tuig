# Prettier code formatting

- Status: Accepted
- Date: 2026-11-27

## Context

Stage 1 code was written as dense single-line bodies, which made review and the coming Stage 2 safety changes hard to read. ESLint (ADR 0012) checks correctness rules only, not layout.

## Decision

Add Prettier 3.10.1 as an exact-pinned development dependency. Checked on 2026-11-27: MIT licence; 3.10.1 was published on 2026-11-12, so it is actively maintained and older than two weeks. It has no runtime footprint and is not bundled into the CLI or binary.

Configuration: 100-column lines, single quotes, trailing commas, LF line endings. `npm run format` rewrites and `npm run format:check` runs in CI. Scope is code only: `src/**/*.ts`, `test/**/*.mjs`, `scripts/**/*.mjs` and root `*.js`.

Excluded so their bytes never change: generated bundles (`src/docs/bundled.ts`, `src/engine/templates.ts`), frozen B0 evidence (`eval/`), hash-pinned fixtures (`fixtures/`) and versioned init templates (`templates/`). No B0 record pins source-file hashes, so reformatting does not affect frozen evidence. `.gitattributes` pins LF for formatted file types so Windows checkouts with `core.autocrlf` pass the same check.

## Consequences

One development dependency. Formatting changes are mechanical and land in their own commit, separate from behaviour changes. Markdown and JSON schemas are not reformatted.
