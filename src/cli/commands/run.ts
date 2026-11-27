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
import { detectSandbox, type Sandbox } from '../../sandbox/index.js';
import type { Budgets } from '../../runner/budgets.js';
import { runProcess } from '../../runner/tools/run.js';
import {
  checkpoint,
  cleanupWorkspace,
  createWorkspace,
  diffPatch,
  diffStat,
  openWorkspace,
  restoreCheckpoint,
  type Workspace,
} from '../../engine/workspace.js';
import { resumePoint } from '../../runner/resume.js';
type Check = { name: string; argv: string[]; timeoutSec?: number };
type Config = {
  mode: Mode;
  sandbox?: 'auto' | 'off';
  models: ModelConfig & { adapter?: string; replayFile?: string };
  budgets?: Partial<Budgets>;
  policy?: { allowedCommands?: string[][]; rules?: PolicyRule[]; passEnv?: string[] };
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
  /** Override sandbox detection (tests); null means no sandbox is available. */
  sandbox?: Sandbox | null;
  /** Continue a cancelled or interrupted run from its last checkpoint. */
  resume?: string;
}): Promise<Envelope> {
  let terminal: TerminalIO | null = null;
  try {
    const root = rootAt(options.cwd ?? process.cwd()),
      config = trusted(root);
    if (!['linux', 'darwin'].includes(options.platform ?? process.platform))
      throw adapterError('TUIG_E_PREREQUISITE');
    // auto-edit and auto run commands without asking, so they require a working OS sandbox.
    const autonomous = config.mode === 'auto-edit' || config.mode === 'auto';
    if (autonomous && config.sandbox === 'off') throw adapterError('TUIG_E_CONFIG');
    const sandbox =
      config.sandbox === 'off'
        ? null
        : options.sandbox === undefined
          ? detectSandbox(options.platform ?? process.platform)
          : options.sandbox;
    if (autonomous && !sandbox) throw adapterError('TUIG_E_SANDBOX');
    // Resuming continues the original task; the interrupted turn is rolled back and re-asked.
    const point = options.resume === undefined ? undefined : resumePoint(root, options.resume);
    let instruction = point ? point.task.instruction : options.instruction;
    const taskId = point ? point.task.taskId : (options.taskId ?? null);
    if (!point && options.taskId) {
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
    let workspace: Workspace;
    if (point) {
      workspace = openWorkspace(root, point.workspace.id, point.workspace.base);
      restoreCheckpoint(workspace, point.checkpoint.ref);
    } else workspace = createWorkspace(root, id);
    const branch = workspace.branch;
    const store = createRecord(root, id, {
      sensitiveEnv: config.models.apiKeyEnv ? [config.models.apiKeyEnv] : [],
    });
    if (point) {
      // Link both ways before running, so a crash of the resumed run is itself resumable.
      const previous = existingRecord(root, point.from);
      const summary = (readRun(previous).summary ?? {}) as Record<string, unknown>;
      writeSummary(previous, {
        ...summary,
        id: point.from,
        state: summary.state ?? point.previous,
        resumedAs: id,
      });
    }
    terminal = options.approver || options.interactive === false ? null : openTerminal();
    const approver =
      options.approver ??
      (terminal ? terminalApprover(terminal, () => diffStat(workspace)) : undefined);
    const agents = existsSync(join(root, 'AGENTS.md'))
      ? readFileSync(join(root, 'AGENTS.md'), 'utf8')
      : '';
    // Tools see only explicitly configured parent variables, never the model credential.
    const passEnv = (config.policy?.passEnv ?? []).filter(
      (name) => name !== config.models.apiKeyEnv,
    );
    const result = await control({
      root: workspace.path,
      store,
      start: {
        workspace: { id: workspace.id, branch, base: workspace.base },
        mode: config.mode,
        sandbox: sandbox?.kind ?? 'none',
        task: { taskId, instruction },
        ...(point
          ? {
              resume: {
                from: point.from,
                previous: point.previous,
                turn: point.turn,
                checkpoint: point.checkpoint,
                discarded: point.discarded,
                totals: point.totals,
              },
            }
          : {}),
      },
      ...(point ? { resume: { conversation: point.conversation, totals: point.totals } } : {}),
      policy: {
        mode: config.mode,
        rules: config.policy?.rules ?? [],
        passEnv,
        ...(sandbox ? { sandbox } : {}),
      },
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
        const checks = [];
        for (const check of checkConfig.checks) {
          // The check command is host-owned trusted configuration, not model text.
          const sequence = appendCheckIntent(store, check);
          const result = await runProcess(
            workspace.path,
            check.argv,
            '.',
            (check.timeoutSec ?? 10) * 1000,
            { passEnv, ...(sandbox ? { sandbox } : {}) },
          );
          writeArtifact(store, 'tool-logs/check-' + sequence + '.log', result.output);
          checks.push({ name: check.name, passed: result.status === 'ok' });
        }
        return { checks };
      },
    });
    writeArtifact(store, 'diff.patch', diffPatch(workspace));
    const summary = readRun(store).summary as Record<string, unknown>;
    const location = { branch, base: workspace.base, worktree: workspace.path };
    writeSummary(store, {
      ...summary,
      id,
      ...location,
      taskId,
      ...(point ? { resumedFrom: point.from } : {}),
    });
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
    const recorded = start?.data.workspace as { id?: unknown; base?: unknown } | undefined;
    if (typeof recorded?.base !== 'string') throw adapterError('TUIG_E_WORKSPACE');
    const workspaceId = typeof recorded.id === 'string' ? recorded.id : id;
    const result = cleanupWorkspace(openWorkspace(root, workspaceId, recorded.base));
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
