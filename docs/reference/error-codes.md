# Error codes

Generated from src/cli/errors.ts. Run npm run docs:errors to regenerate.

| Code | Message | Fix |
|---|---|---|
| TUIG_E_CONFIG | Configuration or trust state is invalid. | Repair configuration or user trust state, then run tuig doctor. |
| TUIG_E_PREREQUISITE | Required tooling is unavailable. | Install or enable the tools listed in doctor checks. |
| TUIG_E_DOC_TOPIC | Unknown documentation topic. | Run tuig docs get commands. |
| TUIG_E_USAGE | Invalid command arguments. | Run tuig --help. |
| TUIG_E_OUTPUT | Invalid TUIG_OUTPUT value. | Set TUIG_OUTPUT to json or text, or unset it. |
| TUIG_E_UNCONFIGURED | Repository is not configured. | Run tuig init. |
| TUIG_E_UNTRUSTED | Repository is not trusted. | Review the repository, then run tuig trust. |
| TUIG_E_POLICY_DENIED | Action denied by policy. | Review the requested action and repository policy. |
