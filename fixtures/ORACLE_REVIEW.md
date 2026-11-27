# Stage 1 oracle review (pending)

All three task.json files deliberately set oracleReviewed: false. Do not use these tasks, run their reference/hidden oracles, or collect B0 results until the human approves. This is a review proposal, not measured evidence.

| Task | Proposed contract | Visible regression | Hidden coverage |
|---|---|---|---|
| fix-rounding | Exact decimal ROUND_HALF_EVEN; Decimal result at two places | 2.675 -> 2.68 | Ties in both directions, negatives, zero tie, large amount, type and scale |
| fix-minor-units | Integer cents after the same two-place rounding | 12.34 -> 1234 | Negative/small amounts, tie rounding, zero, large cents, int type |
| fix-currency-format | Sign before USD/EUR/GBP symbol, two places, unsigned rounded zero | -12.34 USD -> -$12.34 | All symbols, rounding, negative zero, positive/zero behavior, unsupported-currency error |

Review each instruction.md, bug file, visible test, tests-hidden/test_oracle.py and solution file beside task.json. Metadata pins the exact oracle/reference bytes. An approved revision must keep these hashes consistent; future oracle changes need a new fixture version.

The independent tasks share a correct base library. A setup copies only its bug and visible test into a fresh workspace. Hidden tests and solutions are never copied there. Direct tools deny hidden/credential/outside paths. Stage 1's allowed Python execution still needs an isolated process filesystem to prevent edited code from reading host-side oracles; an optional container with only the workspace mounted is the proposed B0 execution boundary. Do not claim strong oracle isolation before that boundary is chosen and verified.

B0 plan: five independent runs per task, using the same selected model and frozen settings. Record hidden pass, input/cached/output/reasoning tokens, latency, cost and tool calls per run, plus the demo transcript and replay comparison. No baseline results exist yet.

Open decisions: approve the task semantics/oracles; choose the actual model endpoint/model/prices (hosted calls need explicit fixture-only approval); choose a supported isolated execution environment. Existing Ubuntu WSL lacks Node; Docker Desktop's engine is not running. No platform setup, image pulls or model calls have been performed.
