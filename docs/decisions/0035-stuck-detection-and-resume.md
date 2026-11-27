# Stuck detection and resume

- Status: Accepted
- Date: 2026-11-28

## Context

Stage 1 ended a run as `STUCK` after the fourth identical action/observation pair anywhere in the run (ADR 0023). Step 2.6 requires the four OpenHands-style thresholds of guide §2, and `tuig run --resume <id>` restoring from the last checkpoint ref and the event log without silently re-executing in-flight side effects.

## Decision

**Stuck detection** (`src/runner/stuck.ts`) keeps an ordered history of entries: one per executed tool call (a hash of tool name and arguments, plus a hash of status and output with per-call log paths normalized away), and one per tool-less assistant reply. Malformed calls are excluded because they have their own consecutive format-error limit (`ERROR`). The run ends `STUCK` with a named reason when the tail shows:

- the same action and observation 4 times in a row;
- the same action with the same error (non-`ok` status) 3 times in a row;
- 3 tool-less replies in a row (monologue);
- two different action/observation pairs alternating over 6 steps (ping-pong, as in OpenHands' six-step window).

Interpretation: a tool-less reply always triggers validation, and without a tool call nothing can change, so the repeated sensor feedback does not count as new input. Repair budgets therefore apply to real repair attempts; an agent that only repeats "done" stops as `STUCK` after three replies. Tests that exhausted repairs with tool-less replies now interleave a tool call.

**Resume** creates a new run record linked to the interrupted one, so every record stays a single append-only session that replays on its own:

- Only runs that crashed (no `run_end`) or ended `CANCELLED`, that have a checkpoint and that were not already resumed qualify (`TUIG_E_RESUME` otherwise). `run_start` now records the workspace id and the task (id and instruction) so a run can be resumed later; older records are refused.
- The worktree is restored to the last checkpoint: the run branch and index return to the checkpoint's parent commit, files return to the checkpoint tree, and files added since are removed (ignored files are kept). The interrupted turn is asked again. Tool calls recorded after the checkpoint, completed or in flight, are listed in `run_start.resume.discarded` and rolled back with it. The model re-proposes them; nothing is re-executed by the harness on its own, so no side effect inside the worktree is applied twice.
- The conversation and counters (requests, tool calls, tokens, cost, repairs) up to the checkpoint turn are rebuilt from the event log, following earlier resumes. The controller continues from them, so killing and resuming cannot reset budgets. The shared message builders make the rebuilt conversation identical to the original.
- Re-entering the checkpointed turn reuses its ref when the tree matches; a checkpoint ref with different content is never overwritten.
- The old record's summary gets `resumedAs` and keeps its state (`CANCELLED` or `INTERRUPTED`); the new record's summary has `resumedFrom`. Both links are written before the resumed run starts, so a crash of the resumed run is itself resumable. Replay of a resumed record starts from the recorded totals.

## Consequences

Work done in the interrupted turn is redone rather than trusted, which costs one model request but keeps the worktree and the record consistent. Side effects outside the worktree cannot be rolled back; the sandbox (ADR 0034) and policy (ADR 0031) keep tools from causing them. A resumed run is a new id; `tuig runs show` on either record shows the link.
