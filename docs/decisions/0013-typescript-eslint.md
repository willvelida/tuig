# typescript-eslint

- Status: Accepted
- Date: 2026-11-27

## Context

Step 1.1 requires reproducible development tooling.

## Decision

Use typescript-eslint 8.74.0, licence MIT. TypeScript lint rules; supports ESLint 10 and TypeScript 6.0.

Checked npm registry metadata on 2026-11-27: package updated in November 2026 (within 12 months). Pin exact versions and retain lockfile.

## Consequences

Development dependency only; no production dependencies. Recheck licences and compatibility on upgrades.
