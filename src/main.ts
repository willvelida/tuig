#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { initialize, templateDiff } from './engine/init.js';
import { trustRepository } from './engine/trust.js';
import { repositoryIdentity } from './engine/repository-state.js';
import { CLI_NAME, VERSION } from './cli/name.js';
import { envelope, EXIT_CODES, type Envelope } from './cli/envelope.js';
import { cliError } from './cli/errors.js';
import { outputMode, render, type OutputMode } from './cli/output.js';
import { DOCS } from './docs/bundled.js';
import { doctor } from './cli/commands/doctor.js';
import { BUILD_IDENTITY } from './cli/build-identity.js';

let mode: OutputMode = 'json';
let result: Envelope;
try {
  mode = outputMode(Boolean(process.stdout.isTTY), process.env.TUIG_OUTPUT);
} catch {
  const error = cliError('TUIG_E_OUTPUT');
  process.stdout.write(
    render(envelope(CLI_NAME, {}, { status: 'error', error, next_action: error.fix }), mode),
  );
  process.exitCode = EXIT_CODES.error;
}
if (process.exitCode === undefined) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        version: { type: 'boolean' },
        'build-identity': { type: 'boolean' },
        'binary-under-test': { type: 'string' },
        help: { type: 'boolean' },
        json: { type: 'boolean' },
        'write-agents-md': { type: 'boolean' },
        instruction: { type: 'string' },
        resume: { type: 'string' },
        adapter: { type: 'string' },
      },
    });
    const [verb, operation, topic] = positionals;
    if (values['build-identity']) {
      if (positionals.length || Object.keys(values).length !== 1)
        throw new Error('Use --build-identity alone.');
      process.stdout.write(JSON.stringify(BUILD_IDENTITY) + '\n');
      process.exit(0);
    }
    if (values['binary-under-test'] !== undefined && verb !== 'checks')
      throw new Error('--binary-under-test is only valid with checks.');
    if (values.json) {
      if (verb !== 'checks' && verb !== 'doctor')
        throw new Error('--json is only valid with checks or doctor.');
      mode = 'json';
    }
    if (values.instruction !== undefined && verb !== 'run')
      throw new Error('--instruction is only valid with run.');
    if (values.resume !== undefined && (verb !== 'run' || values.instruction !== undefined))
      throw new Error('--resume is only valid with run, without a task or --instruction.');
    if (values.adapter !== undefined && !(verb === 'runs' && operation === 'replay'))
      throw new Error('--adapter is only valid with runs replay.');
    if (values['write-agents-md'] && verb !== 'init')
      throw new Error('--write-agents-md is only valid with init.');
    if (values.version || values.help || positionals.length === 0) {
      if (positionals.length || (values.version && values.help))
        throw new Error('Use a single command or option.');
      result = values.version
        ? envelope('version', { version: VERSION }, { status: 'ok' })
        : envelope(
            'help',
            {
              usage:
                CLI_NAME +
                ' [--help | --version | agents-start-here | docs get <topic> | doctor | checks [--json] [--binary-under-test <path>] | init [--write-agents-md] | trust | template diff | run <task-id> | run --instruction <text> | run --resume <id> | runs show <id> | runs replay <id> --adapter replay | runs cleanup <id>]',
            },
            { status: 'ok' },
          );
    } else if (verb === 'agents-start-here' && positionals.length === 1) {
      result = envelope(verb, { content: DOCS['agents-start-here'] }, { status: 'ok' });
    } else if (verb === 'docs' && operation === 'get' && topic && positionals.length === 3) {
      if (Object.hasOwn(DOCS, topic)) {
        result = envelope('docs get', { topic, content: DOCS[topic] }, { status: 'ok' });
      } else {
        const error = cliError('TUIG_E_DOC_TOPIC');
        result = envelope(
          'docs get',
          { topics: Object.keys(DOCS).sort() },
          { status: 'error', error, next_action: error.fix },
        );
      }
    } else if (verb === 'init' && positionals.length === 1) {
      try {
        const data = initialize(process.cwd(), values['write-agents-md']);
        result = data.conflicts.length
          ? envelope('init', data, {
              status: 'degraded',
              next_action: 'Review preserved files with ' + CLI_NAME + ' template diff.',
            })
          : envelope('init', data, { status: 'ok' });
      } catch (cause) {
        const error = cliError(
          'TUIG_E_CONFIG',
          cause instanceof Error ? cause.message : String(cause),
        );
        result = envelope('init', {}, { status: 'error', error, next_action: error.fix });
      }
    } else if (verb === 'template' && operation === 'diff' && positionals.length === 2) {
      result = envelope('template diff', { files: templateDiff(process.cwd()) }, { status: 'ok' });
    } else if (verb === 'trust' && positionals.length === 1) {
      let approved = process.env.TUIG_TRUST_CI === '1';
      if (!approved && process.stdin.isTTY && process.stderr.isTTY) {
        const identity = repositoryIdentity(process.cwd());
        const prompt = createInterface({ input: process.stdin, output: process.stderr });
        try {
          approved =
            (
              await prompt.question(
                'Trust ' +
                  identity.path +
                  ' (roots ' +
                  identity.rootCommits.join(', ') +
                  ')? [y/N] ',
              )
            )
              .trim()
              .toLowerCase() === 'y';
        } finally {
          prompt.close();
        }
      }
      if (!approved) {
        const error = cliError('TUIG_E_UNTRUSTED');
        result = envelope(
          'trust',
          {},
          {
            status: 'unconfigured',
            error,
            next_action:
              'Review the repository, then confirm interactively or set TUIG_TRUST_CI=1 in non-interactive mode.',
          },
        );
      } else {
        try {
          result = envelope('trust', trustRepository(process.cwd()), { status: 'ok' });
        } catch (cause) {
          const error = cliError(
            'TUIG_E_CONFIG',
            cause instanceof Error ? cause.message : String(cause),
          );
          result = envelope('trust', {}, { status: 'error', error, next_action: error.fix });
        }
      }
    } else if (
      verb === 'run' &&
      ((values.resume !== undefined && positionals.length === 1) ||
        (values.instruction !== undefined && positionals.length === 1) ||
        (values.resume === undefined &&
          values.instruction === undefined &&
          positionals.length === 2))
    ) {
      const { runCommand } = await import('./cli/commands/run.js');
      result = await runCommand(
        values.resume !== undefined
          ? { resume: values.resume }
          : values.instruction !== undefined
            ? { instruction: values.instruction }
            : { taskId: operation! },
      );
    } else if (verb === 'runs' && operation === 'cleanup' && topic && positionals.length === 3) {
      const { cleanupRun } = await import('./cli/commands/run.js');
      result = cleanupRun(topic);
    } else if (verb === 'runs' && operation === 'show' && topic && positionals.length === 3) {
      const { showRun } = await import('./cli/commands/run.js');
      result = showRun(topic);
    } else if (
      verb === 'runs' &&
      operation === 'replay' &&
      topic &&
      positionals.length === 3 &&
      values.adapter === 'replay'
    ) {
      const { replayRun } = await import('./cli/commands/replay.js');
      result = await replayRun(topic);
    } else if (verb === 'checks' && positionals.length === 1) {
      const { checksCommand } = await import('./cli/commands/checks.js');
      result = await checksCommand(process.cwd(), values['binary-under-test']);
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
