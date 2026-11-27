import type { CliError } from './errors.js';
export const EXIT_CODES = { ok: 0, degraded: 0, unconfigured: 2, error: 1 } as const;
export type Status = keyof typeof EXIT_CODES;
type Outcome =
  | { status: 'ok'; next_action?: string; error?: never }
  | { status: Exclude<Status, 'ok'>; next_action: string; error?: CliError };
export type Envelope<T = unknown> = { schema_version: 1; command: string; data: T } & Outcome;
export function envelope<T>(command: string, data: T, outcome: Outcome): Envelope<T> {
  if (!command.trim()) throw new Error('command must be non-empty');
  if (!Object.hasOwn(EXIT_CODES, outcome.status)) throw new Error('Unknown status');
  if (outcome.status !== 'ok' && !outcome.next_action?.trim()) throw new Error('Non-ok results require next_action');
  return { schema_version: 1, command, data, ...outcome };
}
