import type { Envelope } from './envelope.js';
export type OutputMode = 'json' | 'text';
export function outputMode(isTTY: boolean, override?: string): OutputMode {
  if (override !== undefined && override !== 'json' && override !== 'text') throw new Error('Invalid TUIG_OUTPUT value');
  return override ?? (isTTY ? 'text' : 'json');
}
export function render(result: Envelope, mode: OutputMode): string {
  if (mode === 'json') return JSON.stringify(result) + '\n';
  return [result.command + ': ' + result.status, JSON.stringify(result.data, null, 2),
    ...(result.error ? [result.error.code + ': ' + result.error.message, 'Fix: ' + result.error.fix] : []),
    ...(result.next_action ? ['Next: ' + result.next_action] : []),
  ].join('\n') + '\n';
}
