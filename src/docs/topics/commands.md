# Commands

Available now:

- tuig agents-start-here: agent orientation.
- tuig docs get <topic>: offline documentation. Topics: commands, envelope, safety, configuration.
- tuig doctor: read-only runtime, tools, repository, trust and configuration diagnostics.
- tuig init [--write-agents-md]: preserve existing files, propose an AGENTS section, and record template hashes.
- tuig trust: grant user-level repository trust; non-interactive use requires TUIG_TRUST_CI=1.
- tuig template diff: show differences from embedded templates without applying changes.
- tuig run <task-id> or tuig run --instruction <text>: run one task in its own worktree (.tuig/temp/worktrees/<id>) on branch tuig/run-<id>, using configured model/replay and trusted visible checks. The main checkout is never modified; the base must be clean.
- tuig runs show <id>: inspect summary, timeline and diff.
- tuig runs replay <id> --adapter replay: rebuild recorded decisions offline without reexecuting tools/checks.
- tuig runs cleanup <id>: commit any uncommitted final state onto tuig/run-<id>, then remove the worktree. The branch stays.
- tuig --help and tuig --version.

Planned, not implemented yet: eval and checks. Do not treat planned commands as available.
