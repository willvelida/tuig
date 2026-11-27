#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { CLI_NAME, VERSION } from './cli/name.js';
import { envelope, EXIT_CODES, type Envelope } from './cli/envelope.js';
import { cliError } from './cli/errors.js';
import { outputMode, render, type OutputMode } from './cli/output.js';
import { DOCS } from './docs/bundled.js';
import { doctor } from './cli/commands/doctor.js';

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
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { version: { type: 'boolean' }, help: { type: 'boolean' } } });
    const [verb, operation, topic] = positionals;
    if (values.version || values.help || positionals.length === 0) {
      if (positionals.length || (values.version && values.help)) throw new Error('Use a single command or option.');
      result = values.version
        ? envelope('version', { version: VERSION }, { status: 'ok' })
        : envelope('help', { usage: CLI_NAME + ' [--help | --version | agents-start-here | docs get <topic> | doctor]' }, { status: 'ok' });
    } else if (verb === 'agents-start-here' && positionals.length === 1) {
      result = envelope(verb, { content: DOCS['agents-start-here'] }, { status: 'ok' });
    } else if (verb === 'docs' && operation === 'get' && topic && positionals.length === 3) {
      if (Object.hasOwn(DOCS, topic)) {
        result = envelope('docs get', { topic, content: DOCS[topic] }, { status: 'ok' });
      } else {
        const error = cliError('TUIG_E_DOC_TOPIC');
        result = envelope('docs get', { topics: Object.keys(DOCS).sort() }, { status: 'error', error, next_action: error.fix });
      }
    } else if (verb === 'doctor' && positionals.length === 1) {
      result = doctor();
    } else {
      throw new Error('Unknown command or unexpected arguments.');
    }
  } catch (cause) {
    const error = cliError('TUIG_E_USAGE', cause instanceof Error ? cause.message : String(cause));
    result = envelope(CLI_NAME, {}, { status: 'error', error, next_action: error.fix });
  }
  process.stdout.write(render(result, mode));
  process.exitCode = EXIT_CODES[result.status];
}
