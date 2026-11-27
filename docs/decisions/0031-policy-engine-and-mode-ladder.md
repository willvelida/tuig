# Policy engine and mode ladder

- Status: Accepted
- Date: 2026-11-27

## Context

Stage 1 let the agent run only exact trusted argv and edit non-protected files (ADR 0022). Step 2.2 needs a policy engine over structured calls, deny > ask > allow precedence, flag-aware allow-lists, four modes forming a one-way ladder, categories that always ask, and no bypass mode. The guide's one-line descriptions of `ask` and `auto-edit` overlap ("non-allow-listed commands ask" versus "allow-listed commands run automatically"), so the exact table needs a decision.

## Decision

`src/engine/policy.ts` reduces every agent tool call to `{tool, command, argv, subcommand, flags, paths, hosts}` (`describeCommand` normalizes the program name, unwraps `python -m <module>`, strips `=value` from flags, resolves path arguments against the cwd and extracts URL and `user@host:` hosts). `evaluate` collects every applicable match, built-in and repository rules plus the mode's baseline for the call's primary category, and the most severe wins: deny beats ask, ask beats allow. Without an approver, ask becomes deny.

Mode baselines, chosen so each mode is a superset of the one before (a test asserts this monotonicity for every case):

| Category | plan | ask | auto-edit | auto |
|---|---|---|---|---|
| Reads; read-only commands with permitted flags inside the worktree | allow | allow | allow | allow |
| Worktree edits; agent `git add`/`commit`; exact trusted argv | deny | allow | allow | allow |
| Repository allow rule (command and permitted flags) | deny | ask | allow | allow |
| Unknown command | deny | ask | ask | allow |
| Opaque command (shells, wrappers like `env`/`xargs`/`timeout`, `sed`/`awk`, containers, inline interpreter code) | deny | ask | ask | ask |

Interpretation: `ask` keeps Stage 1 behaviour, where exact trusted argv such as the configured checks run without asking. `auto-edit` adds commands matching a repository allow rule with only permitted flags. `auto` adds unknown but classifiable commands, which Step 2.5 will run under the OS sandbox. Opaque commands never run without a human because their effect cannot be classified from argv.

Always ask, in every mode above plan (plan denies them): writes to protected paths (edits and `rm`/`mv`/`cp`/`touch`/... targets), network access (curl/wget/ssh/nc/..., git clone/fetch/pull/push/ls-remote/submodule, any URL or `user@host:` argument), package installs (npm/pnpm/yarn/bun install-like subcommands, npx/uvx/pipx, pip/uv/poetry, apt/brew/cargo/gem/go/bundle/composer/conda), and deletion or writes outside the worktree.

Always deny, in every mode: flag injection (`find -exec/-execdir/-ok/-delete/-fprint*`, `rg --pre/--pre-glob/-z`, `tar --to-command/-I/--checkpoint-action/...`, `rsync -e/--rsh/--rsync-path`, `ssh -o/-F`, `scp -o/-S/-F`, `zip -TT`, `npm --script-shell`, every git global option except `--no-pager/--version/--help` (so `git -c core.sshCommand=...`, `--config-env`, `-C`), git `--upload-pack/--receive-pack/--exec/--ext-diff/--output`); destructive Git (`push --force/--mirror/--delete/+refspec`, `reset --hard/--keep/--merge`, `clean`, `rebase`, `filter-branch`, `filter-repo`, `reflog`, `update-ref`, `worktree`, `gc`, `prune`, `config`); `sudo/su/doas/pkexec/dd/mkfs/shutdown/reboot/halt/poweroff`; and any argument that names a credential or hidden-test path.

Repository rules in `policy.rules` are `{decision, command, flags?, subcommands?}`, validated in `validateConfig`. For `allow`, `flags` are the permitted flags; for `ask`/`deny`, any listed flag (or the command alone) triggers. Because built-in denies and always-ask matches are always present, repository rules can tighten but never loosen them. `policy.allowedCommands` keeps its meaning as exact trusted argv.

Every policy denial, including an approver's denial, appends a `policy_denied` event with rule, category and reason before the `tool_call` outcome. `runProcess` no longer checks an allow-list itself; callers decide (policy for agent calls, trusted configuration for checks).

There is no bypass-everything mode: `MODES` holds exactly the four ladder modes, configuration rejects anything else, `evaluate` throws on an unknown mode, and no option skips evaluation. `canLowerMode` permits only moving down the ladder.

`tuig run` accepts `plan` and `ask`. `auto-edit` and `auto` stay refused (fail closed) until the Step 2.5 sandbox exists.

## Consequences

Agent commands outside the trusted list now reach the approval path instead of failing outright, and remain denied in non-interactive runs. Classification is argv-based: a classifiable command can still misbehave internally (for example a script that opens a socket). That is why `auto` is gated on the OS sandbox and why opaque commands always ask. The built-in lists are deliberately conservative and will grow with the safety fixtures in Step 2.7.
