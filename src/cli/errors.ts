import { CLI_NAME } from './name.js';

export const ERRORS = {
  TUIG_E_DIRTY: {message:'Run base has uncommitted changes.',fix:'Review and commit or otherwise preserve your changes before starting a run.'},
  TUIG_E_ORACLE_REVIEW: {message:'Task oracle has not been reviewed.',fix:'Have the human review the oracle and record oracleReviewed: true before using this task.'},
  TUIG_E_EGRESS_DENIED: {message:'Model endpoint is not allow-listed.',fix:'Review and add the exact base URL to models.allowedEndpoints, or use a local endpoint.'},
  TUIG_E_MODEL_FORMAT: {message:'Invalid model response format.',fix:'Check the model server supports chat completions, tool calls and token usage.'},
  TUIG_E_MODEL_HTTP: {message:'Model HTTP request failed.',fix:'Check model endpoint availability and credentials; retry only after review.'},
  TUIG_E_REPLAY: {message:'Replay response is missing or invalid.',fix:'Select a complete recorded run with matching step indices.'},
  TUIG_E_CONFIG: { message: 'Configuration or trust state is invalid.', fix: 'Repair configuration or user trust state, then run ' + CLI_NAME + ' doctor.' },
  TUIG_E_PREREQUISITE: { message: 'Required tooling is unavailable.', fix: 'Install or enable the tools listed in doctor checks.' },
  TUIG_E_DOC_TOPIC: { message: 'Unknown documentation topic.', fix: 'Run ' + CLI_NAME + ' docs get commands.' },
  TUIG_E_USAGE: { message: 'Invalid command arguments.', fix: `Run ${CLI_NAME} --help.` },
  TUIG_E_OUTPUT: { message: 'Invalid TUIG_OUTPUT value.', fix: 'Set TUIG_OUTPUT to json or text, or unset it.' },
  TUIG_E_UNCONFIGURED: { message: 'Repository is not configured.', fix: `Run ${CLI_NAME} init.` },
  TUIG_E_UNTRUSTED: { message: 'Repository is not trusted.', fix: `Review the repository, then run ${CLI_NAME} trust.` },
  TUIG_E_POLICY_DENIED: { message: 'Action denied by policy.', fix: 'Review the requested action and repository policy.' },
} as const;
export type ErrorCode = keyof typeof ERRORS;
export type CliError = { code: ErrorCode; message: string; fix: string };
export function cliError(code: ErrorCode, message?: string): CliError {
  return { code, message: message ?? ERRORS[code].message, fix: ERRORS[code].fix };
}
