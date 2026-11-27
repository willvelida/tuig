# Process groups and minimal tool environment

- Status: Accepted
- Date: 2026-11-27

## Context

Stage 1 ran tools with `spawnSync` (ADR 0022). That killed only the direct child on timeout, blocked the event loop so cancellation could not reach a running tool, and passed a small but HOME-less environment. Step 2.4 requires per-tool process groups, group kill on timeout or cancel with a SIGTERM→SIGKILL grace, a minimal environment with a temporary HOME, denial of credential reads, and protection of the harness process.

## Decision

- **Async execution.** `runProcess` uses `spawn` with `detached: true`, so each tool and check leads its own process group. `executeTool` is now async and the controller awaits it. The controller's cancellation signal (SIGINT or caller abort) reaches the running tool.
- **Group termination.** On timeout, cancellation or output overflow, the harness sends SIGTERM to the negative pid (the whole group), then SIGKILL after a grace period (default 2 s). When the leader exits normally, the same termination reaps any background children left in its group. Results gain a `cancelled` status.
- **No hang on escapees.** A descendant that leaves the group (for example via `setsid`) can keep the output pipes open. One grace period after SIGKILL the harness destroys the pipes and returns. Killing such escapees needs the PID namespace of the Step 2.5 sandbox.
- **Minimal environment.** Tools and checks receive only PATH, LANG, LC_ALL, the Git hook/fsmonitor overrides, HOME and TMPDIR pointing to a fresh per-call temporary directory (removed afterwards), plus names listed in `policy.passEnv`. `passEnv` must be variable names, excludes HOME/TMPDIR/TEMP/TMP/GIT_*, and may never include `models.apiKeyEnv`; the run command also filters it. On Windows (development only) SystemRoot, WINDIR and PATHEXT are kept so Node can start.
- **Credential reads.** With HOME redirected, `~`-relative lookups inside tools miss the real credentials. The file tools refuse credential names and paths outside the worktree, and the policy denies any command argument naming `.ssh`, `.aws`, `.config` (so `~/.config/gh`), `.netrc`, `.npmrc`, `.pypirc`, `.docker`, `.kube`, `.gnupg`, `id_*`, `.env*`, `credentials*` or hidden tests, in every mode and regardless of approval.
- **Harness protection.** `kill`, `pkill`, `killall`, `skill`, `snice` and `xkill` join the always-denied commands, and shells that could run them are opaque (always ask, denied non-interactively). The acceptance test runs the real CLI with a stub `pkill` first on PATH, so a regression can never kill unrelated processes, plus a real `pkill -f <token>` matching only the harness under test.

## Consequences

Tool calls and checks no longer block the event loop, and Ctrl-C during a long tool ends the run as `CANCELLED` with the tool's group terminated. Tools that relied on the user's HOME (caches, global config) start clean each call. A trusted script can still signal its parent by pid, or open files by absolute path, until the Step 2.5 sandbox adds namespaces and filesystem confinement. The Stage 1 fixture verification script now awaits `runProcess`.
