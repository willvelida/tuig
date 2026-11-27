# eslint

- Status: Accepted
- Date: 2026-11-27

## Context

Step 1.1 requires reproducible development tooling.

## Decision

Use eslint 10.15.0, licence MIT. Lint engine.

Checked npm registry metadata on 2026-11-27: package updated in November 2026 (within 12 months). Pin exact versions and retain lockfile.

## Consequences

Development dependency only; no production dependencies. Recheck licences and compatibility on upgrades.
