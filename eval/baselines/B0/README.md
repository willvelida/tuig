# B0 baseline - measured and frozen

Completed 2026-11-27 using claude-opus-5-5 through the approved native Anthropic Messages endpoint. Frozen implementation: 451cdafbb82f63d298c3c55c97afe4c2840ffc6f. Rootless Podman/Ubuntu WSL image and token prices are recorded in the dataset.

- 15 hosted runs: five per human-approved synthetic task. All 15 passed hidden checks and verified replay.
- Estimated cost: $1.966016 at the approved standard rates; 340,294 input and 30,242 output tokens.
- [Report, metrics and deviations](report.md), [aggregate summary](summary.json), [individual results](results.json), [demo transcript](demo-transcript.md).
- Full redacted records, diffs, tool logs and host-only hidden logs are in runs/. SHA256SUMS.json inventories the artifacts.
- verification.json is oracle/runtime evidence; pipeline-verification.json is local-stub workflow evidence. Neither is a hosted model measurement.
- results.partial.json is retained as the final incremental snapshot; results.json is the finalized dataset.

The measurement command refuses to replace this frozen baseline. Credentials were supplied only through the authenticated WSL process environment; settings.json contains the variable name, never its value.

Stage 1 implementation is complete. The human checkpoint remains open before Stage 2.
