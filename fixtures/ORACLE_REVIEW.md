# Stage 1 oracle review (approved 2026-11-27)

The human approved all three pinned oracles on 2026-11-27. All task.json files now record oracleReviewed: true; oracle/reference bytes are unchanged. Approved reference and isolation verification is recorded in eval/baselines/B0/verification.json. Model B0 measurements remain pending.

| Task | Proposed contract | Visible regression | Hidden coverage |
|---|---|---|---|
| fix-rounding | Exact decimal ROUND_HALF_EVEN; Decimal result at two places | 2.675 -> 2.68 | Ties in both directions, negatives, zero tie, large amount, type and scale |
| fix-minor-units | Integer cents after the same two-place rounding | 12.34 -> 1234 | Negative/small amounts, tie rounding, zero, large cents, int type |
| fix-currency-format | Sign before USD/EUR/GBP symbol, two places, unsigned rounded zero | -12.34 USD -> -$12.34 | All symbols, rounding, negative zero, positive/zero behavior, unsupported-currency error |

Review each instruction.md, bug file, visible test, tests-hidden/test_oracle.py and solution file beside task.json. Metadata pins the exact oracle/reference bytes. An approved revision must keep these hashes consistent; future oracle changes need a new fixture version.

The independent tasks share a correct base library. A setup copies only its bug and visible test into a fresh workspace. Hidden tests and solutions are never copied there. Direct tools deny hidden/credential/outside paths. Stage 1's allowed Python execution still needs an isolated process filesystem to prevent edited code from reading host-side oracles; an optional container with only the workspace mounted is the proposed B0 execution boundary. Do not claim strong oracle isolation before that boundary is chosen and verified.

B0 plan: five independent runs per task, using the same selected model and frozen settings. Record hidden pass, input/cached/output/reasoning tokens, latency, cost and tool calls per run, plus the demo transcript and replay comparison. No baseline results exist yet.

Resolved: the human approved all oracles, native Anthropic Messages with claude-opus-5-5 and supplied standard rates, and Podman/WSL setup. Rootless Podman, Node 24 and ripgrep are prepared. Actual hosted calls still await the credential in the invoking WSL shell.

Podman/WSL verification now passes: each bug fails visible and hidden tests, every reference passes both and Ruff, and agent containers cannot see host oracle paths or the API credential. Node 24/ripgrep tooling is prepared locally; the pre-existing interrupted system dpkg state was not changed. Native Anthropic support was approved separately. The remaining gate is credential availability for actual hosted B0 measurement.
