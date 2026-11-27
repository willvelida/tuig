# Configuration and trust

Initialization is detected by .tuig/config.json at the Git root. doctor reads configuration only after trust. The initial format has schema_version: 1, mode: plan|ask|auto-edit|auto, and models.allowedEndpoints as an array of HTTP(S) URLs. Additional configuration fields will be added with their implementing steps.

Trust is stored in XDG_CONFIG_HOME/tuig/trusted.json, or ~/.config/tuig/trusted.json when XDG_CONFIG_HOME is unset. Format: schema_version: 1 and repositories: an array of records with path (canonical absolute Git root) and rootCommit (root commit hash). All root commits must match in repositories with multiple histories. A repository-local trust value has no authority.

Run tuig init to scaffold missing files, then review them and run tuig trust. Init preserves existing files and reports template differences. AGENTS.md changes require --write-agents-md. Do not hand-author trust for repositories you have not reviewed. doctor neither writes state nor runs repository commands.

Model configuration: models.adapter is openai-compat (default) or replay. Compatible mode requires models.baseURL, models.model, models.allowedEndpoints and models.prices keyed by model, with input/cached/output prices in dollars per million tokens. Use explicit zeros for a free local model. models.apiKeyEnv names an environment variable; never place its secret value in config. models.timeoutMs optionally bounds HTTP requests.

Replay mode reads models.replayFile, a JSONL event file. No network calls are made. Local compatible endpoints use localhost, 127.0.0.1 or ::1. Hosted URLs must exactly match the allow-list and development runs require syntheticFixture: true. Review endpoint/model approval separately before development model calls.

run requires a clean committed base and at least one visible executable check. checks.json has schema_version: 1 and checks with name, argv and optional timeoutSec (up to 60).

Policy modes form a one-way ladder, each allowing a superset of the one before: plan (read-only), ask (default: worktree edits and exact trusted argv run automatically; other commands ask), auto-edit (also allow-listed commands with permitted flags) and auto (also other commands, sandboxed). There is no bypass mode. run currently accepts plan and ask; auto-edit and auto are refused until the OS sandbox is available.

Every agent tool call is decided by every matching rule: deny beats ask, and ask beats allow. Non-interactive runs turn ask into deny, recorded as policy_denied. In every mode these always ask: writes to protected paths, network access, package installs and deletion or writes outside the worktree. These are always denied: flags that run programs or write files (find -exec/-delete, rg --pre, git -c and other git global options, tar --to-command, rsync -e, ssh -o), destructive Git (push --force, reset --hard, clean, rebase, filter-branch, config), sudo-like commands and credential path arguments. Shells, wrappers and inline interpreter code always ask.

policy.allowedCommands lists exact trusted argv (defaulting to check commands). policy.rules lists {decision: allow|ask|deny, command, flags?, subcommands?}. For allow, flags are the permitted flags and any other flag falls back to the mode default; for ask and deny, any listed flag (or the command alone) triggers the rule. Repository rules cannot loosen built-in denies or always-ask categories. policy.passEnv lists extra environment variable names passed from the parent to tools and checks; HOME, TMPDIR, GIT_* and the model credential variable are refused.

Named tasks live in tasksDir (default .tuig/tasks), each with task.json and instruction.md. The host requires matching id and oracleReviewed: true, which may only be recorded after human review. Never include hidden oracle files in the agent workspace. Native Windows run is refused; offline inspection/replay remain available.

Native Anthropic mode: set models.adapter to anthropic and models.baseURL to the full Messages URL, such as https://api.anthropic.com/v1/messages. models.apiKeyEnv names the Anthropic API credential variable. Native prices also accept cacheWrite5m and cacheWrite1h. maxOutputTokens defaults to 8192 and effort to medium. Signed assistant thinking blocks are preserved unchanged; native history stays append-only while compatible adapters keep batched masking. Thinking is billed in output; unavailable reasoning subtotals are marked unknown.
