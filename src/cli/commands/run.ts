import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLI_NAME } from '../name.js';
import { budgets } from '../../runner/budgets.js';
import { envelope, type Envelope } from '../envelope.js';
import { cliError, ERRORS, type ErrorCode } from '../errors.js';
import {
  git,
  isTrusted,
  repositoryIdentity,
  trustFile,
  validateConfig,
} from '../../engine/repository-state.js';
import {
  createRecord,
  existingRecord,
  readRun,
  writeArtifact,
  writeSummary,
  type RunEvent,
} from '../../engine/record.js';
import { anthropicAdapter } from '../../runner/adapter/anthropic.js';
import { openAIAdapter, adapterError } from '../../runner/adapter/openai-compat.js';
import { replayAdapter } from '../../runner/adapter/replay.js';
import type { ModelConfig } from '../../runner/adapter/types.js';
import { control } from '../../runner/controller.js';
import type { Approver } from '../../runner/approval.js';
import { openTerminal, terminalApprover, type TerminalIO } from '../approval-prompt.js';
import type { Mode, PolicyRule } from '../../engine/policy.js';
import type { Budgets } from '../../runner/budgets.js';
import { runProcess } from '../../runner/tools/run.js';
import {
  checkpoint,
  cleanupWorkspace,
  createWorkspace,
  diffPatch,
  diffStat,
  openWorkspace,
} from '../../engine/workspace.js';
type Check = { name: string; argv: string[]; timeoutSec?: number };
type Config = {
  mode: Mode;
  models: ModelConfig & { adapter?: string; replayFile?: string };
  budgets?: Partial<Budgets>;
  policy?: { allowedCommands?: string[][]; rules?: PolicyRule[] };
  tasksDir?: string;
  syntheticFixture?: boolean;
};
export function rootAt(cwd: string): string {
  return realpathSync(git(['rev-parse', '--show-toplevel'], cwd));
}
function trusted(root: string): Config {
  if (!isTrusted(repositoryIdentity(root), trustFile())) throw adapterError('TUIG_E_UNTRUSTED');
  const file = join(root, '.tuig/config.json');
  if (!existsSync(file)) throw adapterError('TUIG_E_UNCONFIGURED');
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (validateConfig(value).length) throw adapterError('TUIG_E_CONFIG');
  return value as Config;
}
export function commandFailure(command: string, error: unknown): Envelope {
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    Object.hasOwn(ERRORS, String(error.code))
      ? (String(error.code) as ErrorCode)
      : 'TUIG_E_CONFIG';
  const diagnostic = cliError(code);
  return envelope(
    command,
    {},
    {
      status: ['TUIG_E_UNTRUSTED', 'TUIG_E_UNCONFIGURED'].includes(code) ? 'unconfigured' : 'error',
      error: diagnostic,
      next_action: diagnostic.fix,
    },
  );
}
export async function runCommand(options: {
  taskId?: string;
  instruction?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  /** Decides approval requests. Defaults to the terminal prompt when one is available. */
  approver?: Approver;
  /** Force non-interactive behaviour (ask becomes deny) even on a terminal. */
  interactive?: boolean;
}): Promise<Envelope> {
  let terminal: TerminalIO | null = null;
  try {
    const root = rootAt(options.cwd ?? process.cwd()),
      config = trusted(root);
    if (!['linux', 'darwin'].includes(options.platform ?? process.platform))
      throw adapterError('TUIG_E_PREREQUISITE');
    // auto-edit and auto require the OS sandbox (Step 2.5); fail closed until it exists.
    if (config.mode !== 'plan' && config.mode !== 'ask') throw adapterError('TUIG_E_POLICY_DENIED');
    let instruction = options.instruction;
    if (options.taskId) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.taskId)) throw adapterError('TUIG_E_USAGE');
      const taskDir = join(resolve(root, config.tasksDir ?? '.tuig/tasks'), options.taskId);
      const task = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8')) as {
        id: string;
        oracleReviewed: boolean;
      };
      if (task.id !== options.taskId || task.oracleReviewed !== true)
        throw adapterError('TUIG_E_ORACLE_REVIEW');
      instruction = readFileSync(join(taskDir, 'instruction.md'), 'utf8');
    }
    if (!instruction?.trim()) throw adapterError('TUIG_E_USAGE');
    const checkConfig = JSON.parse(readFileSync(join(root, '.tuig/checks.json'), 'utf8')) as {
      schema_version: number;
      checks: Check[];
    };
    if (
      checkConfig.schema_version !== 1 ||
      !Array.isArray(checkConfig.checks) ||
      !checkConfig.checks.length ||
      !checkConfig.checks.every(
        (check) =>
          typeof check.name === 'string' &&
          Array.isArray(check.argv) &&
          check.argv.length > 0 &&
          check.argv.every((arg) => typeof arg === 'string' && arg.length > 0) &&
          (check.timeoutSec === undefined ||
            (Number.isFinite(check.timeoutSec) && check.timeoutSec > 0 && check.timeoutSec <= 60)),
      )
    )
      throw adapterError('TUIG_E_CONFIG');
    if (
      config.policy?.allowedCommands &&
      (!Array.isArray(config.policy.allowedCommands) ||
        !config.policy.allowedCommands.every(
          (argv) =>
            Array.isArray(argv) &&
            argv.length > 0 &&
            argv.every((arg) => typeof arg === 'string' && arg.length > 0),
        ))
    )
      throw adapterError('TUIG_E_CONFIG');
    budgets(config.budgets ?? {});
    if (
      config.models.adapter &&
      !['replay', 'openai-compat', 'anthropic'].includes(config.models.adapter)
    )
      throw adapterError('TUIG_E_CONFIG');
    const adapter =
      config.models.adapter === 'replay'
        ? replayAdapter(
            readFileSync(resolve(root, config.models.replayFile ?? ''), 'utf8')
              .trim()
              .split(/\r?\n/)
              .map((line) => JSON.parse(line) as RunEvent),
          )
        : config.models.adapter === 'anthropic'
          ? anthropicAdapter(config.models)
          : openAIAdapter(config.models);
    if (
      adapter.endpoint !== 'replay' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(adapter.endpoint).hostname) &&
      config.syntheticFixture !== true
    )
      throw adapterError('TUIG_E_POLICY_DENIED');
    // Each run works in its own worktree; the human's checkout is never touched.
    const id = randomUUID();
    const workspace = createWorkspace(root, id);
    const branch = workspace.branch;
    const store = createRecord(root, id, {
      sensitiveEnv: config.models.apiKeyEnv ? [config.models.apiKeyEnv] : [],
    });
    terminal = options.approver || options.interactive === false ? null : openTerminal();
    const approver =
      options.approver ??
      (terminal ? terminalApprover(terminal, () => diffStat(workspace)) : undefined);
    const agents = existsSync(join(root, 'AGENTS.md'))
      ? readFileSync(join(root, 'AGENTS.md'), 'utf8')
      : '';
    const result = await control({
      root: workspace.path,
      store,
      start: { workspace: { branch, base: workspace.base }, mode: config.mode },
      policy: { mode: config.mode, rules: config.policy?.rules ?? [] },
      ...(approver ? { approver } : {}),
      beforeTurn: (turn) => {
        appendEvent(store, 'checkpoint', { turn, ...checkpoint(workspace, turn) });
      },
      adapter,
      messages: [],
      context: { agents, instruction },
      limits: config.budgets ?? {},
      allowedCommands:
        config.policy?.allowedCommands ?? checkConfig.checks.map((check) => check.argv),
      validate: async () => {
        const checks = checkConfig.checks.map((check) => {
          // The check command is host-owned trusted configuration, not model text.
          const sequence = appendCheckIntent(store, check);
          const result = runProcess(
            workspace.path,
            check.argv,
            '.',
            (check.timeoutSec ?? 10) * 1000,
          );
          writeArtifact(store, 'tool-logs/check-' + sequence + '.log', result.output);
          return { name: check.name, passed: result.status === 'ok' };
        });
        return { checks };
      },
    });
    writeArtifact(store, 'diff.patch', diffPatch(workspace));
    const summary = readRun(store).summary as Record<string, unknown>;
    const location = { branch, base: workspace.base, worktree: workspace.path };
    writeSummary(store, { ...summary, id, ...location, taskId: options.taskId ?? null });
    const data = { id, ...location, ...result };
    return result.state === 'SUCCEEDED'
      ? envelope('run', data, { status: 'ok' })
      : envelope('run', data, {
          status: 'error',
          next_action: 'Inspect ' + CLI_NAME + ' runs show ' + id,
        });
  } catch (error) {
    return commandFailure('run', error);
  } finally {
    terminal?.close?.();
  }
}
import { appendEvent, type RecordStore } from '../../engine/record.js';
function appendCheckIntent(store: RecordStore, check: Check): number {
  return appendEvent(store, 'tool_intent', { name: 'acceptance_check', argv: check.argv }).seq;
}
/** Remove a run's worktree, keeping tuig/run-<id> with any uncommitted final state. */
export function cleanupRun(id: string, cwd = process.cwd()): Envelope {
  try {
    const root = rootAt(cwd);
    trusted(root);
    const start = readRun(existingRecord(root, id)).events.find((e) => e.type === 'run_start');
    const recorded = start?.data.workspace as { base?: unknown } | undefined;
    if (typeof recorded?.base !== 'string') throw adapterError('TUIG_E_WORKSPACE');
    const result = cleanupWorkspace(openWorkspace(root, id, recorded.base));
    return envelope('runs cleanup', { id, ...result }, { status: 'ok' });
  } catch (error) {
    return commandFailure('runs cleanup', error);
  }
}
export function showRun(id: string, cwd = process.cwd()): Envelope {
  try {
    const root = rootAt(cwd);
    trusted(root);
    return envelope('runs show', { id, ...readRun(existingRecord(root, id)) }, { status: 'ok' });
  } catch (error) {
    return commandFailure('runs show', error);
  }
}
