import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codedError } from '../cli/errors.js';
import { appendEvent, writeArtifact, type RecordStore } from './record.js';
import { runProcess, type ProcessOptions, type ProcessResult } from '../runner/tools/run.js';

export type SetupCommand = { name: string; argv: string[]; timeoutSec: number };
export type SetupResult = {
  status: 'pass' | 'fail' | 'cancelled';
  commands: {
    name: string;
    argv: string[];
    status: ProcessResult['status'];
    exitCode: number | null;
    durationMs: number;
    log: string;
  }[];
};
export function loadSetup(root: string): SetupCommand[] {
  const config = JSON.parse(readFileSync(join(root, '.tuig/checks.json'), 'utf8')) as {
    setup?: unknown;
  };
  if (config.setup === undefined) return [];
  if (!Array.isArray(config.setup) || config.setup.length > 16) throw codedError('TUIG_E_CONFIG');
  const names = new Set<string>();
  return config.setup.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw codedError('TUIG_E_CONFIG');
    const entry = value as Record<string, unknown>;
    const { name, argv } = entry;
    const timeoutSec = entry.timeoutSec === undefined ? 60 : entry.timeoutSec;
    if (
      Object.keys(entry).some((key) => !['name', 'argv', 'timeoutSec'].includes(key)) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 256 ||
      names.has(name) ||
      !Array.isArray(argv) ||
      !argv.length ||
      argv.length > 100 ||
      !argv.every(
        (arg: unknown) =>
          typeof arg === 'string' && arg.length > 0 && arg.length <= 8192 && !arg.includes('\0'),
      ) ||
      typeof timeoutSec !== 'number' ||
      !Number.isFinite(timeoutSec) ||
      timeoutSec <= 0 ||
      timeoutSec > 60
    )
      throw codedError('TUIG_E_CONFIG');
    names.add(name);
    return { name, argv: [...argv] as string[], timeoutSec };
  });
}

/** Host-pinned setup runs before baseline capture, never through the agent tool interface. */
export async function executeSetup(
  root: string,
  commands: SetupCommand[],
  store: RecordStore,
  options: ProcessOptions,
): Promise<SetupResult> {
  const result: SetupResult = { status: 'pass', commands: [] };
  const interruption = new AbortController();
  const onInterrupt = (): void => interruption.abort();
  process.on('SIGINT', onInterrupt);
  const signal = options.signal
    ? AbortSignal.any([options.signal, interruption.signal])
    : interruption.signal;
  try {
    for (const command of commands) {
      const event = appendEvent(store, 'setup_start', {
        name: command.name,
        argv: command.argv,
        timeoutSec: command.timeoutSec,
      });
      const start = performance.now();
      let output: Awaited<ReturnType<typeof runProcess>>;
      try {
        output = await runProcess(root, command.argv, '.', command.timeoutSec * 1000, {
          ...options,
          signal,
        });
      } catch {
        output = {
          status: signal.aborted ? 'cancelled' : 'nonzero_exit',
          exitCode: null,
          output: 'Setup subprocess could not start.',
          stdout: '',
        };
      }
      const log = writeArtifact(store, 'tool-logs/setup-' + event.seq + '.log', output.output);
      const recorded = appendEvent(store, 'setup_result', {
        name: command.name,
        argv: command.argv,
        status: output.status,
        exitCode: output.exitCode,
        durationMs: performance.now() - start,
        log,
      });
      result.commands.push(recorded.data as SetupResult['commands'][number]);
      if (output.status !== 'ok') {
        result.status = output.status === 'cancelled' ? 'cancelled' : 'fail';
        break;
      }
    }
    return result;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }
}
