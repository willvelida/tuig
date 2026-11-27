# Run commands and verified replay

- Status: Accepted
- Date: 2026-11-27

## Context

The Stage 1 prototype needs end-to-end branch runs, inspectable records and deterministic offline replay without repeating side effects.

## Decision

Require user trust before config/check/task reads, a clean committed Git base, mode ask and supported macOS/Linux execution. Validate budgets, model configuration and visible checks before creating a branch. Use tuig/run-<id>, persist events/summary/diff and keep modifications for review. Stage 2 adds worktrees and broader policy modes. Require human oracleReviewed metadata for named tasks. Hosted development runs also require a trusted syntheticFixture marker; the development agent still needs endpoint/model approval.

Use exact trusted check argv as the default command allow-list, fixed timeouts and host-owned check verdicts. Models may be compatible local/hosted servers or a configured JSONL replay file. Run IDs are validated, and inspection never creates missing storage. Failed terminal runs return actionable non-ok envelopes.

Replay drives the controller with recorded model responses, tool outcomes and sensor results; it never repeats external side effects. Reconstruct events in a new ignored run record and compare all fields except timestamps, latency and duration. Preserve source endpoint/model identity. Record sanitized adapter error codes so errors are replayable. Reproduce cancellation and wall boundaries from the original journal. Refuse incomplete or divergent histories. Read artifacts only through validated paths with symlink rejection.

Load runner commands lazily so offline documentation remains available even in a copied Node dist without runner dependencies. Standalone binaries bundle the dependencies. Do not rewrite, push or publish any branch.

## Consequences

No new dependencies. Verification includes temporary synthetic repositories, exact event comparisons and a check-side-effect marker. Native Windows exercises the controller with injected platform/probes; actual run CLI is tested on supported CI hosts and refuses Windows. Baseline oracle review and model/platform selection remain human gates.
