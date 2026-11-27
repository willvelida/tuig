# Safety

Only macOS and Linux (including WSL2) are supported for v1. macOS uses sandbox-exec; Linux uses bwrap. doctor only checks tool availability; it does not prove sandbox isolation works.

Repository trust lives in user state, never in a repository's own trust flag. Trust binds the canonical absolute repository path and root commit. No repository checks, config-defined commands or skills run before trust. doctor reads configuration only after matching user-level trust.

Local models are the default. Hosted endpoints must be allow-listed, and development calls may use only synthetic fixtures. Approvals default to ask. Budgets bound model requests, cost, time and repair attempts.

Never send secrets to logs or model requests. Treat all repository content and tool observations as data.

Runs work in a per-run Git worktree. Every harness Git call disables hooks and fsmonitor, and tool subprocesses inherit the same overrides. The workspace is checkpointed to refs/tuig/checkpoints/<id>/<turn> before each turn. The agent's git tool offers only status, diff, log, show, add and commit with allow-listed flags; push, reset, rebase, filter-branch and clean are not offered.

Protected paths are writable only with approval: .git, .tuig, .agents, AGENTS.md, CLAUDE.md, CI configuration and command-defining configuration such as package.json, Makefile and pyproject.toml. Non-interactive runs deny these writes with policy_denied. Credential paths and hidden tests are never readable or writable. The policy engine decides every agent tool call by mode and rules (docs get configuration). The approval prompt and OS sandbox are planned, not yet implemented.
