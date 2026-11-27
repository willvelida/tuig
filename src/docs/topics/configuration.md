# Configuration and trust

Initialization is detected by .tuig/config.json at the Git root. doctor reads configuration only after trust. The initial format has schema_version: 1, mode: plan|ask|auto-edit|auto, and models.allowedEndpoints as an array of HTTP(S) URLs. Additional configuration fields will be added with their implementing steps.

Trust is stored in XDG_CONFIG_HOME/tuig/trusted.json, or ~/.config/tuig/trusted.json when XDG_CONFIG_HOME is unset. Format: schema_version: 1 and repositories: an array of records with path (canonical absolute Git root) and rootCommit (root commit hash). All root commits must match in repositories with multiple histories. A repository-local trust value has no authority.

Run tuig init to scaffold missing files, then review them and run tuig trust. Init preserves existing files and reports template differences. AGENTS.md changes require --write-agents-md. Do not hand-author trust for repositories you have not reviewed. doctor neither writes state nor runs repository commands.

Model configuration: models.adapter is openai-compat (default) or replay. Compatible mode requires models.baseURL, models.model, models.allowedEndpoints and models.prices keyed by model, with input/cached/output prices in dollars per million tokens. Use explicit zeros for a free local model. models.apiKeyEnv names an environment variable; never place its secret value in config. models.timeoutMs optionally bounds HTTP requests.

Replay mode reads models.replayFile, a JSONL event file. No network calls are made. Local compatible endpoints use localhost, 127.0.0.1 or ::1. Hosted URLs must exactly match the allow-list and development runs require syntheticFixture: true. Review endpoint/model approval separately before development model calls.

Stage 1 run requires mode ask, a clean committed base and at least one visible executable check. checks.json has schema_version: 1 and checks with name, argv and optional timeoutSec (up to 60). Only exact trusted argv entries in policy.allowedCommands (defaulting to check commands) may be run by the model. Other policy modes await Stage 2.

Named tasks live in tasksDir (default .tuig/tasks), each with task.json and instruction.md. The host requires matching id and oracleReviewed: true, which may only be recorded after human review. Never include hidden oracle files in the agent workspace. Native Windows run is refused; offline inspection/replay remain available.

Native Anthropic mode: set models.adapter to anthropic and models.baseURL to the full Messages URL, such as https://api.anthropic.com/v1/messages. models.apiKeyEnv names the Anthropic API credential variable. Native prices also accept cacheWrite5m and cacheWrite1h. maxOutputTokens defaults to 8192 and effort to medium. Signed assistant thinking blocks are preserved unchanged; native history stays append-only while compatible adapters keep batched masking. Thinking is billed in output; unavailable reasoning subtotals are marked unknown.
