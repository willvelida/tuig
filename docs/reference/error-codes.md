# Error codes

Generated from src/cli/errors.ts. Run npm run docs:errors to regenerate.

| Code | Message | Fix |
|---|---|---|
| TUIG_E_SELFHOST_UNPINNED | Self-hosting requires a verified pinned executable from a clean tagged commit. | Follow docs/self-hosting.md: install the pin outside the repository, set selfHost.pinnedVersion/pinnedSha256, ensure the tag exists locally, and launch runs with that executable. |
| TUIG_E_BINARY_UNDER_TEST | The binary under test is missing, invalid or cannot be executed. | Build the changed code with npm run build:binary, then pass its executable path to tuig checks --binary-under-test <path>. |
| TUIG_E_DIRTY | Run base has uncommitted changes. | Review and commit or otherwise preserve your changes before starting a run. |
| TUIG_E_RESUME | Run cannot be resumed. | Resume only cancelled or interrupted runs that have a checkpoint and were not resumed already; inspect with tuig runs show <id>. |
| TUIG_E_SANDBOX | A working OS sandbox is required for this mode but none is available. | Install bubblewrap (Linux) or use sandbox-exec (macOS), confirm with tuig doctor, or use mode ask. |
| TUIG_E_WORKSPACE | Run workspace could not be created or used safely. | Ensure .tuig/temp/ is gitignored and committed (tuig init adds it), that no tuig/run-<id> branch or worktree already exists, then retry. |
| TUIG_E_ORACLE_REVIEW | Task oracle has not been reviewed. | Have the human review the oracle and record oracleReviewed: true before using this task. |
| TUIG_E_EGRESS_DENIED | Model endpoint is not allow-listed. | Review and add the exact base URL to models.allowedEndpoints, or use a local endpoint. |
| TUIG_E_MODEL_FORMAT | Invalid model response format. | Check the model server supports chat completions, tool calls and token usage. |
| TUIG_E_MODEL_HTTP | Model HTTP request failed. | Check model endpoint availability and credentials; retry only after review. |
| TUIG_E_REPLAY | Replay response is missing or invalid. | Select a complete recorded run with matching step indices. |
| TUIG_E_CONFIG | Configuration or trust state is invalid. | Repair configuration or user trust state, then run tuig doctor. |
| TUIG_E_PREREQUISITE | Required tooling is unavailable. | Install or enable the tools listed in doctor checks. |
| TUIG_E_DOC_TOPIC | Unknown documentation topic. | Run tuig docs get commands. |
| TUIG_E_USAGE | Invalid command arguments. | Run tuig --help. |
| TUIG_E_OUTPUT | Invalid TUIG_OUTPUT value. | Set TUIG_OUTPUT to json or text, or unset it. |
| TUIG_E_UNCONFIGURED | Repository is not configured. | Run tuig init. |
| TUIG_E_UNTRUSTED | Repository is not trusted. | Review the repository, then run tuig trust. |
| TUIG_E_POLICY_DENIED | Action denied by policy. | Review the requested action and repository policy. |
