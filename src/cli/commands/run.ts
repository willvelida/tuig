import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLI_NAME } from '../name.js';
import { budgets } from '../../runner/budgets.js';
import { envelope, type Envelope } from '../envelope.js';
import { cliError, ERRORS, type ErrorCode } from '../errors.js';
import { git, isTrusted, repositoryIdentity, trustFile, validateConfig } from '../../engine/repository-state.js';
import { createRecord, existingRecord, readRun, writeArtifact, writeSummary, type RunEvent } from '../../engine/record.js';
import { anthropicAdapter } from '../../runner/adapter/anthropic.js';
import { openAIAdapter, adapterError } from '../../runner/adapter/openai-compat.js';
import { replayAdapter } from '../../runner/adapter/replay.js';
import type { ModelConfig } from '../../runner/adapter/types.js';
import { control } from '../../runner/controller.js';
import type { Budgets } from '../../runner/budgets.js';
import { runProcess } from '../../runner/tools/run.js';
type Check = { name: string; argv: string[]; timeoutSec?: number };
type Config = { mode: string; models: ModelConfig & { adapter?: string; replayFile?: string }; budgets?: Partial<Budgets>; policy?: { allowedCommands?: string[][] }; tasksDir?: string; syntheticFixture?: boolean };
export function rootAt(cwd: string): string { return realpathSync(git(['rev-parse', '--show-toplevel'], cwd)); }
function trusted(root: string): Config {
  if (!isTrusted(repositoryIdentity(root), trustFile())) throw adapterError('TUIG_E_UNTRUSTED');
  const file = join(root, '.tuig/config.json');
  if (!existsSync(file)) throw adapterError('TUIG_E_UNCONFIGURED');
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (validateConfig(value).length) throw adapterError('TUIG_E_CONFIG');
  return value as Config;
}
export function commandFailure(command: string, error: unknown): Envelope {
  const code = error && typeof error === 'object' && 'code' in error && Object.hasOwn(ERRORS, String(error.code)) ? String(error.code) as ErrorCode : 'TUIG_E_CONFIG';
  const diagnostic = cliError(code);
  return envelope(command, {}, { status: ['TUIG_E_UNTRUSTED', 'TUIG_E_UNCONFIGURED'].includes(code) ? 'unconfigured' : 'error', error: diagnostic, next_action: diagnostic.fix });
}
export async function runCommand(options: { taskId?: string; instruction?: string; cwd?: string; platform?: NodeJS.Platform }): Promise<Envelope> {
  try {
    const root = rootAt(options.cwd ?? process.cwd()), config = trusted(root);
    if (!['linux', 'darwin'].includes(options.platform ?? process.platform)) throw adapterError('TUIG_E_PREREQUISITE');
    if (config.mode !== 'ask') throw adapterError('TUIG_E_POLICY_DENIED');
    let instruction = options.instruction;
    if (options.taskId) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.taskId)) throw adapterError('TUIG_E_USAGE');
      const taskDir = join(resolve(root, config.tasksDir ?? '.tuig/tasks'), options.taskId);
      const task = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8')) as { id: string; oracleReviewed: boolean };
      if (task.id !== options.taskId || task.oracleReviewed !== true) throw adapterError('TUIG_E_ORACLE_REVIEW');
      instruction = readFileSync(join(taskDir, 'instruction.md'), 'utf8');
    }
    if (!instruction?.trim()) throw adapterError('TUIG_E_USAGE');
    const checkConfig = JSON.parse(readFileSync(join(root, '.tuig/checks.json'), 'utf8')) as { schema_version: number; checks: Check[] };
    if (checkConfig.schema_version !== 1 || !Array.isArray(checkConfig.checks) || !checkConfig.checks.length || !checkConfig.checks.every(check => typeof check.name === 'string' && Array.isArray(check.argv) && check.argv.length > 0 && check.argv.every(arg => typeof arg === 'string' && arg.length > 0) && (check.timeoutSec === undefined || Number.isFinite(check.timeoutSec) && check.timeoutSec > 0 && check.timeoutSec <= 60))) throw adapterError('TUIG_E_CONFIG');
    if (config.policy?.allowedCommands && (!Array.isArray(config.policy.allowedCommands) || !config.policy.allowedCommands.every(argv => Array.isArray(argv) && argv.length > 0 && argv.every(arg => typeof arg === 'string' && arg.length > 0)))) throw adapterError('TUIG_E_CONFIG');
    budgets(config.budgets ?? {});
    if (config.models.adapter && !['replay','openai-compat','anthropic'].includes(config.models.adapter)) throw adapterError('TUIG_E_CONFIG');
    const adapter = config.models.adapter === 'replay'
      ? replayAdapter(readFileSync(resolve(root, config.models.replayFile ?? ''), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line) as RunEvent))
      : config.models.adapter === 'anthropic' ? anthropicAdapter(config.models) : openAIAdapter(config.models);
    if (adapter.endpoint !== 'replay' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(adapter.endpoint).hostname) && config.syntheticFixture !== true) throw adapterError('TUIG_E_POLICY_DENIED');
    // Stage 1 branches are deliberately simple; worktrees arrive in Stage 2.
    if (git(['status', '--porcelain'], root)) throw adapterError('TUIG_E_DIRTY');
    const id = randomUUID(), branch = 'tuig/run-' + id;
    git(['switch', '-c', branch], root);
    const store = createRecord(root, id, { sensitiveEnv: config.models.apiKeyEnv ? [config.models.apiKeyEnv] : [] });
    const agents = existsSync(join(root, 'AGENTS.md')) ? readFileSync(join(root, 'AGENTS.md'), 'utf8') : '';
    const result = await control({ root, store, adapter, messages: [], context: { agents, instruction }, limits: config.budgets ?? {}, allowedCommands: config.policy?.allowedCommands ?? checkConfig.checks.map(check => check.argv), validate: async () => {
      const checks = checkConfig.checks.map(check => {
        // The check command is host-owned trusted configuration, not model text.
        const sequence = appendCheckIntent(store, check);
        const result = runProcess(root, check.argv, '.', (check.timeoutSec ?? 10) * 1000, [check.argv]);
        writeArtifact(store, 'tool-logs/check-' + sequence + '.log', result.output);
        return { name: check.name, passed: result.status === 'ok' };
      });
      return { checks };
    } });
    writeArtifact(store, 'diff.patch', git(['diff', '--binary', 'HEAD', '--', '.'], root));
    const summary = readRun(store).summary as Record<string, unknown>;
    writeSummary(store, { ...summary, id, branch, taskId: options.taskId ?? null });
    const data = { id, branch, ...result };
    return result.state === 'SUCCEEDED' ? envelope('run', data, { status: 'ok' }) : envelope('run', data, { status: 'error', next_action: 'Inspect ' + CLI_NAME + ' runs show ' + id });
  } catch (error) { return commandFailure('run', error); }
}
import { appendEvent, type RecordStore } from '../../engine/record.js';
function appendCheckIntent(store: RecordStore, check: Check): number { return appendEvent(store, 'tool_intent', { name: 'acceptance_check', argv: check.argv }).seq; }
export function showRun(id: string, cwd = process.cwd()): Envelope {
  try { const root = rootAt(cwd); trusted(root); return envelope('runs show', { id, ...readRun(existingRecord(root, id)) }, { status: 'ok' }); }
  catch (error) { return commandFailure('runs show', error); }
}
