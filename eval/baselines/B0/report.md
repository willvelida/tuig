# B0: Stage 1 hosted baseline

Measured 2026-11-27 and frozen at implementation commit 451cdafbb82f63d298c3c55c97afe4c2840ffc6f. Configured model: claude-opus-5-5, through the native Anthropic Messages endpoint. Three human-approved synthetic Python bug-fix tasks, five independent runs each, sequentially executed in rootless Podman under Ubuntu WSL.

All 15 runs ended SUCCEEDED, passed the independent hidden oracle, and reproduced their event sequence through offline replay. No tests or harness configuration were changed by the model; every diff touches only the task's intended library module.

| Task | Hidden pass | Estimated USD | Mean model latency/run (s) | Tool calls |
|---|---:|---:|---:|---:|
| fix-currency-format | 5/5 | $0.542904 | 16.58 | 31 |
| fix-minor-units | 5/5 | $0.607356 | 21.26 | 36 |
| fix-rounding | 5/5 | $0.815756 | 26.93 | 48 |
| Total | 15/15 | $1.966016 | 21.59 | 115 |

The 83 model requests consumed 340,294 input and 30,242 output tokens. Cache reads and 5-minute/1-hour cache writes were all zero. Reasoning tokens are not separately exposed by this provider response: their subtotal is unknown, and thinking is already billed in output. Total measured model latency was 323.81 seconds; median/run 20.52 seconds and nearest-rank p95/run 36.02 seconds. Latency is the sum of model-request elapsed times within a run, excluding tool/oracle/replay time.

Cost is calculated from the approved standard prices: $4/M uncached input, $20/M output, $0.20/M cache read, $5/M 5-minute cache write and $8/M 1-hour cache write. No batch or fast modifier and no explicit caching request were used. This is a usage-based estimate, not an invoice.

## Evidence and verification

- [Final per-run metrics](results.json), [aggregate summary](summary.json), [settings](settings.json), and [frozen plan](plan.json).
- [Demo transcript and reviewed rounding diff](demo-transcript.md); actual CLI output is in demo-show.json and demo-replay.json.
- Original redacted events, summaries, diffs, full tool logs and host-only hidden-oracle logs are retained under runs/. results.partial.json is the retained final incremental snapshot.
- 516 actual run events and 15 summaries validate against their published schemas. Sequence numbers, terminal states, request/tool counts and price arithmetic were independently checked. All 15 replay comparisons ignore only timestamps, durations and model latency.
- [Oracle/runtime verification](verification.json) proves the approved bugs fail, references pass visible/hidden checks plus Ruff, and the actual agent subprocess sees only its workspace with network disabled and credentials absent.
- pipeline-verification.json is explicitly local-stub workflow evidence, not a model measurement. It is separate from this hosted dataset.
- SHA256SUMS.json inventories the frozen artifacts byte-for-byte.

## Decisions and deviations

1. Human-approved native Anthropic support extends locked decision 3 (ADR 0027). Signed thinking is preserved unchanged; native context remains append-only instead of masking older observations. Compatible adapters retain masking.
2. User-selected rootless Podman provides optional fixture isolation before Stage 2's general sandbox exists (ADR 0028). Hidden tests are mounted only after model execution ends, with read-only candidate and oracle mounts; hidden output never enters model observations.
3. The measurement driver calls runCommand, the implementation behind tuig run, directly. The demo identifies this honestly and executes runs show/runs replay through the actual CLI; it does not claim an extra hosted CLI invocation.
4. API credentials stayed in the user's WSL process environment. The initial Windows/WSL LICENSE newline mismatch was caught by a regression test and fixed before measurement at commit 451cdaf; license text and the clean-source guard were preserved.

These are three small invented tasks with repeated runs, not a broad performance or security result. Passing validation does not prove requirements were right, tests were sufficient, or code is secure. Stage 2 has not started and requires human checkpoint approval.
