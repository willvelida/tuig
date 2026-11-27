# Durable redacted run records

- Status: Accepted
- Date: 2026-11-27

## Context

Runs need auditable JSONL that survives abrupt termination without persisting secrets.

## Decision

Use a single-writer record store per run. Redact string values and keys recursively before JSON serialization, and raw diffs/logs before writing. Discover sensitive environment values by name and allow explicit names/literals. Mask common API, AWS, GitHub and bearer token patterns.

Append newline-terminated events, handle partial writes, fsync and close before returning. Accept only complete newline-terminated events with contiguous sequence numbers; report partial final tails and reject completed corruption. Refuse append after a crash tail. Replace summaries atomically after fsync. Include fixed limitations and graded claims.

Add tool_intent before side effects, followed by exactly one tool_call outcome. This additional event distinguishes durable intent from outcome. Sensor and final verdicts belong to harness code, not model-supplied event fields. Permit only fixed artifact path shapes and refuse storage symlinks.

## Consequences

No dependency added. Durability depends on filesystem fsync semantics. Readers recover a valid prefix after crashes. Pattern-based redaction cannot prove identification of every arbitrary secret.
