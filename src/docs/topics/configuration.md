# Configuration and trust

`secretGate` is `required` in new init templates. It runs an external gitleaks
scanner after the agent loop, before protected-test approval and the final oracle.
Install gitleaks yourself on PATH; tuig never bundles or downloads it. Findings
block success with FAILED_VALIDATION. Missing tools, timeout, crashes and invalid
reports produce ERROR with TUIG_E_PREREQUISITE and installation/retry instructions.
The scanner has a ten-second timeout, uses the trusted subprocess environment and
configured OS sandbox, and cannot receive credentials through passEnv.

Explicit `secretGate: "off"` disables the gate. Missing fields retain legacy
behaviour (disabled); both cases are visible in the run summary and degrade doctor.
Doctor also degrades if gitleaks is missing. A working tool with an unparseable
version is reported as available with version unknown.

The gate scans complete resulting files changed from the run base, including
non-ignored untracked changes in diff.patch. It also scans every added or modified
blob in every commit reachable in base..HEAD, including each parent of merges,
and every commit message in that range. Reverting or deleting a committed secret
does not remove it from the delivered branch history and cannot bypass the gate.
Distinct blobs are scanned once; message findings use commit/<id>/message as
their file label. Ignored uncommitted files are excluded consistently with the
result diff, even though the protected-test gate and oracle snapshot have a
broader ignored-file view. History already reachable from the base is excluded;
deletions do not exempt earlier versions committed during this run. A pre-existing
secret in a changed file also blocks success.
There are separate ten-second preparation and scanner deadlines. Preparation
allows at most 256 changed paths per diff, 256 distinct blobs plus commit
messages, 128 new commits and 64 MiB of scan content. Limit/deadline failures
record a specific diagnostic and next_action to split the work into smaller
runs. A legitimate large diff or slow scan can therefore end in ERROR. Cancel
and Ctrl-C stop the scanner and produce CANCELLED, never success.
Repository scanner configurations, ignore files and inline gitleaks suppression
comments cannot disable this gate. Only rule, original file, line and a redacted
marker are recorded; scanner output and private reports are discarded.

Existing redaction protects known credential formats in earlier agent messages
and tool records. Other formats recognized only by gitleaks can still occur in
the agent's own earlier edit arguments; final scanning does not retroactively
redact those records. It never forwards scanner matches or secrets to the model.

Initialization is detected by .tuig/config.json at the Git root. doctor reads configuration only after trust. The initial format has schema_version: 1, mode: plan|ask|auto-edit|auto, and models.allowedEndpoints as an array of HTTP(S) URLs. Additional configuration fields will be added with their implementing steps.

Trust is stored in XDG_CONFIG_HOME/tuig/trusted.json, or ~/.config/tuig/trusted.json when XDG_CONFIG_HOME is unset. Format: schema_version: 1 and repositories: an array of records with path (canonical absolute Git root) and rootCommit (root commit hash). All root commits must match in repositories with multiple histories. A repository-local trust value has no authority.

Run tuig init to scaffold missing files, then review them and run tuig trust. Init preserves existing files and reports template differences. AGENTS.md changes require --write-agents-md. Do not hand-author trust for repositories you have not reviewed. doctor neither writes state nor runs repository commands.

Model configuration: models.adapter is openai-compat (default) or replay. Compatible mode requires models.baseURL, models.model, models.allowedEndpoints and models.prices keyed by model, with input/cached/output prices in dollars per million tokens. Use explicit zeros for a free local model. models.apiKeyEnv names an environment variable; never place its secret value in config. models.timeoutMs optionally bounds HTTP requests.

Replay mode reads models.replayFile, a JSONL event file. No network calls are made. Local compatible endpoints use localhost, 127.0.0.1 or ::1. Hosted URLs must exactly match the allow-list and development runs require syntheticFixture: true. Review endpoint/model approval separately before development model calls.

run requires a clean committed base and at least one visible executable check. .tuig/checks.json has schema_version: 1 and a checks array. Each check has a unique name, an argv array, optional kind (gate by default, or repair), optional parser (exit-code by default, junit, eslint-json, ruff-json or tsc-text), and optional timeoutSec (10 by default, greater than zero and at most 60). schemas/checks.schema.json publishes the format. Existing version 1 files keep their original defaults.

Optional paths lists repository-relative coverage globs for future check selection; it does not change execution yet. JUnit additionally requires reportPath, a repository-relative XML report file whose parent exists before execution (for example, pytest --junitxml=report.xml with reportPath: report.xml). reportPath is refused for other parsers. Reports cannot traverse or escape the workspace, reach credentials/harness state, or be symlinks; old reports are removed before execution. Other parsers read stdout; stderr stays in the bounded process log. Use tsc --pretty false with parser tsc-text; TypeScript 6.0.3 has no --json mode.

tuig checks [--json] runs the visible checks in order after repository trust and sandbox validation. The envelope's data.verdict and status are ok when all pass, degraded when only repair checks fail, and error when a gate fails. Non-ok results include next_action. Empty lists pass the standalone command; run still requires executable acceptance. Each result includes name, kind, passed, process status, exitCode and diagnostics with tool, file, line, col, rule, severity and message. Unknown positions and rules are null. Error diagnostics fail a check even on exit zero. Missing/malformed reports fail closed; report input is capped at 1 MiB and 1000 diagnostics. Warnings alone do not fail an exit-zero check.

The agent's run_checks tool takes no arguments and runs the host-pinned visible checks with normal command policy, minimal environment and sandbox. Agent edits cannot substitute a new check command. Plan mode refuses agent check execution; an explicit human tuig checks command can execute trusted checks in plan mode. Task acceptance still requires all checks to pass; repair scheduling is separate work.

Policy modes form a one-way ladder, each allowing a superset of the one before: plan (read-only), ask (default: worktree edits and exact trusted argv run automatically; other commands ask), auto-edit (also allow-listed commands with permitted flags) and auto (also other commands, sandboxed). There is no bypass mode. auto-edit and auto require a working OS sandbox (TUIG_E_SANDBOX otherwise). The optional sandbox setting is auto (default: use the sandbox whenever it works) or off, which is accepted only in plan and ask, for example when trusted checks already run in their own container.

Every agent tool call is decided by every matching rule: deny beats ask, and ask beats allow. Non-interactive runs turn ask into deny, recorded as policy_denied. In every mode these always ask: writes to protected paths, network access, package installs and deletion or writes outside the worktree. These are always denied: flags that run programs or write files (find -exec/-delete, rg --pre, git -c and other git global options, tar --to-command, rsync -e, ssh -o), destructive Git (push --force, reset --hard, clean, rebase, filter-branch, config), sudo-like commands and credential path arguments. Shells, wrappers and inline interpreter code always ask.

policy.allowedCommands lists exact trusted argv (defaulting to check commands). policy.rules lists {decision: allow|ask|deny, command, flags?, subcommands?}. For allow, flags are the permitted flags and any other flag falls back to the mode default; for ask and deny, any listed flag (or the command alone) triggers the rule. Repository rules cannot loosen built-in denies or always-ask categories. policy.passEnv lists extra environment variable names passed from the parent to tools and checks; HOME, TMPDIR, GIT_* and the model credential variable are refused.

Named tasks live in tasksDir (default .tuig/tasks), each with task.json and instruction.md. The host requires matching id and oracleReviewed: true, which may only be recorded after human review. Never include hidden oracle files in the agent workspace. Native Windows run is refused; offline inspection/replay remain available.

Optional protectedTests lists repository-relative glob patterns for tests that require human approval to change. Init includes common test directories and filename patterns. Protected edits ask through normal policy; a final diff gate also checks subprocess changes, deletions, renames, new files and modes. Non-interactive runs deny protected changes. The rejected diff remains available for human inspection.

protectedTests supports forward-slash literal paths, * within a path component and whole-component **. Expand braces or extglobs into separate patterns; character classes, ?, embedded double-stars, traversal and absolute paths are refused with TUIG_E_CONFIG and an actionable next_action. Git filters ignored files by these patterns before applying its bounded listing, so unrelated ignored dependencies do not exhaust the gate. A genuine protected-list overflow is recorded and fails closed with a specific TUIG_E_WORKSPACE diagnostic and remediation. An empty list skips the gate's Git work. Python __pycache__ and .pytest_cache directories and *.pyc files are excluded from both protection and oracle snapshots; ignored conftest.py and test sources remain protected.

Reviewed pytest tasks may provide oracle.hidden, oracle.sha256.hidden and timeouts.hiddenSec. The host pins and verifies hidden bytes before running, refuses oracle bytes exposed in the repository or Git objects, and requires a sandbox. Hidden tests run only after the agent loop ends in a separate final snapshot. They never become visible tool feedback. summary.json records taskVerdict separately from visible acceptance and model claims: pass, fail, infrastructure_error or not_evaluated. Ad hoc runs without a hidden oracle are explicitly not_evaluated. Missing Python/pytest, timeout and invalid oracle execution never pass.

Native Anthropic mode: set models.adapter to anthropic and models.baseURL to the full Messages URL, such as https://api.anthropic.com/v1/messages. models.apiKeyEnv names the Anthropic API credential variable. Native prices also accept cacheWrite5m and cacheWrite1h. maxOutputTokens defaults to 8192 and effort to medium. Signed assistant thinking blocks are preserved unchanged; native history stays append-only while compatible adapters keep batched masking. Thinking is billed in output; unavailable reasoning subtotals are marked unknown.

## Trusted setup before run baselines

Optional `selfHost: {pinnedVersion, pinnedSha256}` requires an external pinned
executable under $XDG_DATA_HOME/tuig/pinned/<version>/tuig (default ~/.local/share;
Windows diagnostics use tuig.exe). Doctor verifies its hash and clean embedded
commit/tree identity against the locally available pinnedVersion tag. Run and
checks also verify the invoking executable matches that hash; source invocations
refuse. Unknown/dirty/missing pins fail with TUIG_E_SELFHOST_UNPINNED. See
docs/self-hosting.md for the owner-only pinning procedure. Optional protectedPaths
uses the same validated glob grammar and approval gates as protectedTests.
Self-hosted summaries retain the pin and protected paths attempted or changed.

`.tuig/checks.json` may include `setup`, an ordered array (empty by default) of
`{ "name": "offline install", "argv": ["npm", "ci", "--offline"], "timeoutSec": 60 }`.
Names must be unique and nonblank (at most 256 characters); argv has 1-100
nonempty, NUL-free arguments of at most 8192 characters each. There are at most
16 commands; timeoutSec defaults to 60 and must be greater than zero and at most
60. Unknown setup-command fields are rejected. Review setup along with checks
before trusting a repository. Setup is a host action, not an agent tool, and its
commands are not added to the agent's allowedCommands.

For each new `run`, the harness creates its worktree, pins the trusted command
list, then runs setup in order before recording the protected-file baseline or
making a model request. Commands receive argv exactly as configured, the minimal
environment plus policy.passEnv, bounded output logs with redaction, and a fresh
temporary HOME. A detected OS sandbox is used even when agent sandbox is off;
its network remains off. With no sandbox available, setup follows the existing
trusted subprocess fallback; it does not gain a network capability or exception.
A failure, timeout, unavailable executable or cancellation stops setup and the run
before the agent acts, with ERROR or CANCELLED, TUIG_E_PREREQUISITE and next_action.
Later commands do not run. setup_start/setup_result events and the summary's setup
field record names, redacted argv, process status, exitCode, durationMs and log
references. Offline replay consumes these records without executing setup.

Setup runs once per new run; resume never reruns it and must restore the original
saved baseline. Dependencies installed by setup are baseline inputs. Any ignored
protected source created, modified or deleted by later checks or agent commands
still requires approval. A plain `npm ci` executed after baseline capture is not
exempt. `tuig checks` runs checks only and does not execute setup.

For an offline npm install, fully populate a cache beforehand, including every
locked package tarball, using the same npm/lockfile versions. To avoid writes to a
read-only external seed cache, set `TUIG_NPM_CACHE_SEED` to its absolute path and
`npm_config_cache` to `.tuig/temp/offline-npm-cache` in the parent environment. Add both
names to policy.passEnv and use this setup (the first command copies the existing
seed into the writable worktree; fresh HOME is not shared between commands):

```json
{
  "schema_version": 1,
  "setup": [
    {
      "name": "copy offline cache",
      "argv": ["node", "-e", "require('node:fs').cpSync(process.env.TUIG_NPM_CACHE_SEED,'.tuig/temp/offline-npm-cache',{recursive:true})"],
      "timeoutSec": 60
    },
    {
      "name": "offline dependencies",
      "argv": ["npm", "ci", "--offline", "--ignore-scripts"],
      "timeoutSec": 60
    }
  ],
  "checks": [{ "name": "tests", "argv": ["npm", "test"] }]
}
```

Keep credentials in environment variables, never argv or configuration values.
The external seed must be readable and outside hidden-oracle locations. Cache
misses fail offline; the harness does not enable network to repair them. Review
any needed install/build lifecycle scripts separately and keep them offline.
