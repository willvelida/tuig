# Commands

Available now:

- tuig agents-start-here: agent orientation.
- tuig docs get <topic>: offline documentation. Topics: commands, envelope, safety, configuration.
- tuig doctor [--json]: read-only runtime, tools, repository, trust and configuration diagnostics. In a selfHost repository, a dev invocation still reports every diagnostic and returns TUIG_E_SELFHOST_UNPINNED with the pinning procedure.
- tuig checks [--json] [--binary-under-test <path>]: run trusted visible checks in configuration order and return normalized diagnostics; gate failures return error and repair-only failures degraded. --json forces the JSON envelope even on a terminal. The candidate executable replaces exact {binary-under-test} trusted argv entries (default bin/tuig); the invoking harness remains unchanged. Invalid candidates fail with TUIG_E_BINARY_UNDER_TEST.
- tuig init [--write-agents-md]: preserve existing files, propose an AGENTS section, and record template hashes.
- tuig trust: grant user-level repository trust; non-interactive use requires TUIG_TRUST_CI=1.
- tuig template diff: show differences from embedded templates without applying changes.
- tuig run <task-id> or tuig run --instruction <text>: run one task in its own worktree (.tuig/temp/worktrees/<id>) on branch tuig/run-<id>, using configured model/replay and trusted visible checks. The main checkout is never modified; the base must be clean.
- tuig run --resume <id>: continue a cancelled or interrupted run in its worktree. The worktree is restored to the run's last per-turn checkpoint and that turn is asked again, so tool calls that were in flight are re-proposed by the model, never silently re-run. The resumed run gets a new id linked to the original (resumedFrom / resumedAs) and keeps the original's budget counters.
- tuig runs show <id>: inspect summary, timeline and diff.
- tuig runs replay <id> --adapter replay: rebuild recorded decisions offline without reexecuting tools/checks.
- tuig runs cleanup <id>: commit any uncommitted final state onto tuig/run-<id>, then remove the worktree. The branch stays.
- tuig --help and tuig --version.

Planned, not implemented yet: eval. Do not treat planned commands as available.
