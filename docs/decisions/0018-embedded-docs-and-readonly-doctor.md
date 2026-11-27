# Embedded docs and read-only doctor

- Status: Accepted
- Date: 2026-11-27

## Context

Step 1.3 must teach agents offline and report prerequisites. Step 1.4 introduces initialization and trust commands, so doctor needs a read-only state contract before those writers exist.

## Decision

Bundle Markdown into generated TypeScript before Node and Bun builds. Serve embedded strings only: no network, file path lookup or runtime Markdown dependency. List currently implemented and planned commands separately.

Doctor invokes only fixed system-tool argument arrays with timeouts. Git calls disable hooks. Supported platforms are macOS and Linux; Windows is reported degraded. Tool versions are diagnostic availability checks, not proof of sandbox functionality. Missing Bun is reported with a compiler installation fix, even though the distributed executable itself does not need Bun.

Use canonical Git-root paths and root commit hashes for user trust. Store version 1 records in XDG_CONFIG_HOME/tuig/trusted.json or ~/.config/tuig/trusted.json as repositories: [{path, rootCommit}]. Require matching records for all roots. Never honor repository-local trust. Read repository configuration only after matching user trust; never load checks or skills in doctor.

The initial config validator requires schema_version 1, a guide-defined mode, and models.allowedEndpoints as HTTP(S) URLs without embedded credentials. Later steps extend validation when they implement further fields. Doctor prioritizes missing initialization, then trust, then config errors, then missing runtime prerequisites, so an empty Git repository always points to tuig init.

## Consequences

No new dependencies. Healthy-state tests use initialized and trusted fixture files with deterministic probes. Actual init/trust command integration is verified in Step 1.4. This defines shared read-only helpers for that step, without implementing those commands early. Generated docs match the sources at build time.
