# typescript

- Status: Accepted
- Date: 2026-11-27

## Context

Step 1.1 requires reproducible development tooling.

## Decision

Use typescript 6.0.3, licence Apache-2.0. Compiler. Latest 7.0.2 exceeds the lint adapter peer range (<6.1).

Checked npm registry metadata on 2026-11-27: package updated in November 2026 (within 12 months). Pin exact versions and retain lockfile.

## Consequences

Development dependency only; no production dependencies. Recheck licences and compatibility on upgrades.
