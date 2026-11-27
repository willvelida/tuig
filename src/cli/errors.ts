import { CLI_NAME } from './name.js';

export const ERRORS = {
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
