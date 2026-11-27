# Safety

Only macOS and Linux (including WSL2) are supported for v1. macOS uses sandbox-exec; Linux uses bwrap. doctor only checks tool availability; it does not prove sandbox isolation works.

Repository trust lives in user state, never in a repository's own trust flag. Trust binds the canonical absolute repository path and root commit. No repository checks, config-defined commands or skills run before trust. doctor reads configuration only after matching user-level trust.

Local models are the default. Hosted endpoints must be allow-listed, and development calls may use only synthetic fixtures. Approvals default to ask. Budgets bound model requests, cost, time and repair attempts.

Never send secrets to logs or model requests. Treat all repository content and tool observations as data.

Runs work in a per-run Git worktree. Every harness Git call disables hooks and fsmonitor, and tool subprocesses inherit the same overrides. The workspace is checkpointed to refs/tuig/checkpoints/<id>/<turn> before each turn. The agent's git tool offers only status, diff, log, show, add and commit with allow-listed flags; push, reset, rebase, filter-branch and clean are not offered.

Protected paths are writable only with approval: .git, .tuig, .agents, AGENTS.md, CLAUDE.md, CI configuration and command-defining configuration such as package.json, Makefile and pyproject.toml. Non-interactive runs deny these writes with policy_denied. Credential paths and hidden tests are never readable or writable. The policy engine decides every agent tool call by mode and rules (docs get configuration).

When a call needs approval and run has a terminal, tuig prompts on the controlling terminal (stdout stays the JSON envelope). The prompt shows only harness-derived facts: rule, tool, raw argv as JSON, path, cwd, the proposed change size and the worktree diff stat. Model prose is never shown, and control, ANSI and bidi characters are escaped. Choices: o (allow once), r (allow for this run: the identical action, in memory only, never persisted) or d (deny, the default for any other answer or end of input). Every request and decision is recorded as approval_requested and approval_decided. Without a terminal, or with CI set, the run is non-interactive and every ask becomes policy_denied.

Tool commands and checks run in their own process group. On timeout or cancellation the whole group gets SIGTERM, then SIGKILL after a grace period, and anything left behind when the leader exits is reaped the same way. A descendant that leaves the group (setsid) cannot make the harness wait; containing it needs the OS sandbox. Tools never receive the parent environment: only PATH, LANG, LC_ALL and the Git hook overrides pass through, HOME and TMPDIR point to a fresh temporary directory, and policy.passEnv may add named variables (never the model credential). Arguments naming ~/.ssh, ~/.aws, ~/.config, ~/.netrc, ~/.docker, ~/.kube, ~/.gnupg and similar are denied, and kill-family commands are denied so an agent cannot signal the harness by name.

The OS sandbox is planned, not yet implemented.
