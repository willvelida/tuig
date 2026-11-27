# Native Anthropic Messages adapter

- Status: Accepted (human approved extension of locked decision 3)
- Date: 2026-11-27

## Context

The human selected https://api.anthropic.com/v1/messages, claude-opus-5-5 and credential env-var name CLAUDE_ACCESS_TOKEN for synthetic-fixture B0 measurements, and explicitly approved native Messages support and official Anthropic documentation access.

## Decision

Retain compatible/replay adapters and add native anthropic transport with Node fetch. Use the full configured Messages URL and exact hosted allow-list matching, x-api-key authentication by env-var name, API version 2023-06-01, explicit medium effort, and 8192 output-token limit by default. Use standard mode, with neither batch nor fast modifiers and no explicit cache-control request. User-provided per-million rates are input 4, output 20, cache read 0.20, 5-minute cache creation 5 and 1-hour cache creation 8 USD.

Preserve all assistant content blocks, including empty signed thinking blocks, unchanged in tool loops. Native adapters declare append-only history; their context does not mask older tool observations because changing signed prefixes can invalidate Messages requests. Compatible adapters retain Step 1.9 masking. Strip provider-only metadata from compatible wire messages.

Normalize total input as uncached input plus cache reads plus cache writes. Track 5m/1h writes separately and bill them once. Output includes thinking; do not add thinking cost twice. If the provider does not expose a reasoning-token subtotal, mark it unknown and report null in B0 rather than pretending it is zero.

References checked 2026-11-27: https://platform.claude.com/docs/en/api/messages/create ; https://platform.claude.com/docs/en/models/opus-5-5/migration-guide ; https://platform.claude.com/docs/en/api/typescript/messages .

## Consequences

No SDK or dependency added. Local mock tests precede any hosted call. Existing egress, timeout, body-size, cancellation and secret-record safeguards apply. The native append-only requirement is a documented provider-specific deviation from observation masking. Credential availability is a separate runtime prerequisite; no secret is stored in settings.
