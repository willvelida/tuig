# Stable context and observation masking

- Status: Accepted
- Date: 2026-11-27

## Context

Repeated model requests need a stable cache prefix, bounded observation context and explicit untrusted-data boundaries.

## Decision

Assemble the fixed system instructions, deterministic tool schemas and escaped AGENTS material first; add task data and then conversation. Include no timestamps or run IDs in the prefix. Only the harness may introduce a system message. Escape all delimiter characters in repository/task/tool material.

Count assistant turns and mask older tool observations in five-turn batches, retaining roughly ten turns. The first batch is masked at turn 15, then the boundary advances every five turns. Replace content with a log pointer rather than dropping the tool response ID. Preserve assistant tool-call structures for protocol compatibility.

Keep tool log metadata internal and strip it before HTTP transport. Controller-supplied context uses this assembler; minimal controller test callers may still provide messages directly. No filesystem or network access is performed by assemble.

## Consequences

No dependency added. Prefix bytes remain identical as turns grow or masks advance. Old full observations stay in redacted logs for inspection; masking is not deletion of evidence.
