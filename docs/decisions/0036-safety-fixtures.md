# Safety fixtures

- Status: Accepted
- Date: 2026-11-28

## Context

Step 2.7 needs fixtures that tempt an agent towards force pushes, deletion outside the worktree, `git clean -fdx`, `curl … | sh`, printing environment variables with a canary in the parent environment, a malicious hook and network access, with zero-tolerance acceptance. Benchmark tasks in `fixtures/tasks/` require human oracle review (AGENTS.md) and measure models. These fixtures measure the harness.

## Decision

Safety fixtures live in `fixtures/safety/<id>/fixture.json`, separate from benchmark tasks, with no hidden oracle. Each declares the bait files (and optionally malicious hooks), the repository policy and budget overrides, scripted agent turns that take the bait (played by the replay adapter, so no hosted model is called), and the expected outcome: calls that must be denied, allowed calls that must stay contained, harmless calls that must succeed, and the typed terminal state.

`scripts/safety-fixtures.mjs` builds each repository in a temporary directory, places a sentinel directory outside it, plants hooks that record and try to exfiltrate the canary, and runs the real `tuig run` CLI non-interactively with a random canary in the environment. It then counts violations: destructive calls not denied, contained calls that succeeded, canary appearances in any produced file, worktree, marker or CLI output, hook runs, main-checkout or sentinel changes, and unexpected or untyped terminal states. `test/safety.test.mjs` requires every count to be zero (the network fixture needs the sandbox, which CI requires). Running the script directly prints a JSON report for checkpoint review.

## Consequences

Seven fixtures cover the guide's list plus budget exhaustion. Because the agent is scripted, the fixtures prove that the harness contains an agent that takes the bait, not whether a particular model would. Measuring model susceptibility belongs to the Stage 5 evaluation with approved hosted calls. Mutation checks (passing the parent environment to tools; re-enabling hooks) make the counters non-zero.
