# B0 baseline - not measured

Status: oracles approved and verified; native adapter and isolated Podman runtime prepared. Actual hosted B0 measurement awaits credential availability.

Do not interpret the implementation's offline replay integration tests as model benchmark results. Five independent runs are planned for each of fix-rounding, fix-minor-units and fix-currency-format. Save per-run artifacts, hidden verdicts, token subtotals, cost, latency and tool calls here only after actual execution. Freeze the baseline only after all required measurements and replay verification are complete.

Review proposal: fixtures/ORACLE_REVIEW.md. The Stage 1 checkpoint has not been passed.

Approved setup: native Anthropic Messages, claude-opus-5-5, standard rates in settings.json; rootless Podman under Ubuntu WSL. Oracle/reference/isolation verification is complete; verification.json is not a model baseline.

From an authenticated Ubuntu shell in this repository, after npm build:

```sh
sh scripts/stage1-node.sh scripts/verify-stage1-fixtures.mjs
sh scripts/stage1-node.sh scripts/measure-stage1-b0.mjs --measure
```

Export CLAUDE_ACCESS_TOKEN in that same shell before the measurement command. Do not put the secret in repository files or command arguments. A shell-local export in another terminal is not inherited by new WSL processes. The measurement script records five runs per task, verifies offline replay, evaluates hidden tests only after each run is terminal, and refuses to replace existing result files.
