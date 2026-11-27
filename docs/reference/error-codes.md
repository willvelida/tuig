# Error codes

Generated from src/cli/errors.ts. Run npm run docs:errors to regenerate.

| Code | Message | Fix |
|---|---|---|
| TUIG_E_DIRTY | Run base has uncommitted changes. | Review and commit or otherwise preserve your changes before starting a run. |
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
