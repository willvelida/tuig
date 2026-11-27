# Initialization and user trust

- Status: Accepted
- Date: 2026-11-27

## Context

Consumer scaffolding must be reproducible without overwriting hand edits. Trust must remain outside the repository and cannot be granted implicitly by initialization.

## Decision

Bundle immutable v1 JSON and marked AGENTS templates at build time. Create missing files only; append ignore entries without replacing existing lines. Append an AGENTS section only with --write-agents-md; otherwise return the proposal in data. Preserve an existing marked section. Record each generated file's template version and actual SHA-256. Template diff is read-only and returns current/upstream content. Reject symlinks in scaffold paths before any writes.

Use the path/root-commit trust contract in ADR 0018. Atomic user-state replacement preserves other repository entries. Interactive trust displays repository identity and requires y; non-interactive trust requires exactly TUIG_TRUST_CI=1. Init and trust do not execute repository checks, commands or skills.

## Consequences

Hand edits may produce degraded initialization with a review action. This is deliberate preservation, not a migration failure. Init works in an empty Git repository; trust requires a committed root identity. No new dependencies.
