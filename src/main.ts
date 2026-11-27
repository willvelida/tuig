#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { CLI_NAME, VERSION } from './cli/name.js';
import { envelope, EXIT_CODES, type Envelope } from './cli/envelope.js';
import { cliError } from './cli/errors.js';
import { outputMode, render, type OutputMode } from './cli/output.js';
let mode: OutputMode = 'json';
let result: Envelope;
try {
  mode = outputMode(Boolean(process.stdout.isTTY), process.env.TUIG_OUTPUT);
} catch {
  const error = cliError('TUIG_E_OUTPUT');
  process.stdout.write(render(envelope(CLI_NAME, {}, { status: 'error', error, next_action: error.fix }), mode));
  process.exitCode = EXIT_CODES.error;
}
if (process.exitCode === undefined) {
  try {
    const { values } = parseArgs({ options: { version: { type: 'boolean' }, help: { type: 'boolean' } } });
    result = values.version
      ? envelope('version', { version: VERSION }, { status: 'ok' })
      : envelope('help', { usage: CLI_NAME + ' [--help | --version]' }, { status: 'ok' });
  } catch (cause) {
    const error = cliError('TUIG_E_USAGE', cause instanceof Error ? cause.message : String(cause));
    result = envelope(CLI_NAME, {}, { status: 'error', error, next_action: error.fix });
  }
  process.stdout.write(render(result, mode));
  process.exitCode = EXIT_CODES[result.status];
}
