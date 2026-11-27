# node-types

- Status: Accepted
- Date: 2026-11-27

## Context

Step 1.1 requires reproducible development tooling.

## Decision

Use node-types 24.19.4, licence MIT. Node declarations aligned to Node 24 runtime floor.

Checked npm registry metadata on 2026-11-27: package updated in November 2026 (within 12 months). Pin exact versions and retain lockfile.

## Consequences

Development dependency only; no production dependencies. Recheck licences and compatibility on upgrades.
