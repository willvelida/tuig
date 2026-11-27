# Validated workspace tools

- Status: Accepted
- Date: 2026-11-27

## Context

Stage 1 needs a small tool table with consistent schema checks and observable outcomes, before Stage 2 introduces full sandbox and approval enforcement.

## Decision

Reuse pinned Ajv 8.20.0 at runtime to validate every tool argument object before dispatch. This moves the existing MIT dependency from development to production; version/licence/maintenance were verified for ADR 0017. Avoid a bespoke JSON Schema subset.

Resolve workspace paths canonically, reject traversal, absolute paths, credential/state paths and escaping symlinks. Search uses only fixed ripgrep flags, safe exclusions and a positional separator; it never follows links. Edits require one unique exact search block. Protected agent/CI edits are denied at this stage.

Run accepts only exact complete argv entries supplied by trusted harness configuration, stricter than a program-name-only list. No shell, a small environment allow-list, timeout and 64 MiB process capture limit. Full process-group cleanup and OS isolation arrive in Stage 2; this is a trusted synthetic-fixture prototype, not a hostile-code sandbox.

Every valid call records fsynced intent before action. Every attempted call, including invalid ones, records one outcome with status, escaped untrusted observation and full-log pointer. Redact full output before persistence; observations retain 8 KiB head and tail. Escape delimiter characters to prevent forged trust boundaries. Abort is explicit data handled by the controller.

## Consequences

One runtime dependency, no new version. Exact command lists cannot express arbitrary shell composition. Logs capture up to the documented process capture limit; overflow is a failed process, not silently successful output. Agent tools must never be given oracle directories as workspace contents.
