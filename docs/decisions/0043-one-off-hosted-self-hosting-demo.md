# Owner exception for the Step 3.5b hosted Anthropic demo

- Status: Accepted
- Date: 2026-11-28

## Context

Locked decision 3 normally restricts model usage. The owner explicitly approved
a one-off hosted endpoint exception on 2026-11-28, solely for the subsequent
Step 3.5b self-hosted demonstration.

## Decision

Allow the hosted Anthropic endpoint for that single demo on tuig's own repository.
The owner launches the pinned binary from their WSL terminal. The credential
exists only in that process environment and never in files or command arguments.
This does not authorize any hosted call during Step 3.5a, other repositories,
additional experiments, or any adapter/egress-policy implementation change.

## Consequences

The owner must review configuration and the later demo diff. Existing endpoint
and policy gates remain in force; this exception supplies human authorization,
not a bypass in code. All other requirements of locked decision 3 remain intact.
