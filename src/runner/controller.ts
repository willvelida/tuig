import { createHash } from 'node:crypto';
import { appendEvent, writeSummary, type RecordStore } from '../engine/record.js';
import { recordingAdapter } from './adapter/recording.js';
import type { Message, ModelAdapter } from './adapter/types.js';
import { budgets, preflight, afterResponse, type Budgets, type Totals } from './budgets.js';
import { transition, TERMINAL, type State, type StateEvent } from './states.js';
import { executeTool, TOOL_DEFINITIONS, untrusted, type ToolResult } from './tools/index.js';
import { assemble } from './context.js';
export type ValidationResult = { checks: { name: string; passed: boolean }[] };
export type ControllerOptions = {
  root: string; store: RecordStore; adapter: ModelAdapter; messages: Message[];
  validate: () => Promise<ValidationResult>; limits?: Partial<Budgets>; allowedCommands?: string[][];
  signal?: AbortSignal; handleSIGINT?: boolean; now?: () => number;
  assemble?: (conversation: Message[]) => Message[];
  context?: { agents: string; instruction: string };
  execute?: (call: Parameters<typeof executeTool>[0]) => ToolResult;
};
export async function control(options: ControllerOptions): Promise<{ state: State; reason: string; totals: Totals }> {
  const limits = budgets(options.limits), now = options.now ?? (() => performance.now()), started = now();
  const cancellation = new AbortController();
  const interrupt = (): void => cancellation.abort(new Error('SIGINT'));
  if (options.handleSIGINT !== false) process.on('SIGINT', interrupt);
  const signal = AbortSignal.any([cancellation.signal, ...(options.signal ? [options.signal] : [])]);
  const adapter = recordingAdapter(options.adapter, options.store);
  const conversation: Message[] = [];
  const totals: Totals = { requests: 0, toolCalls: 0, input: 0, cached: 0, output: 0, reasoning: 0, cost: 0, repairs: 0 };
  let state: State = 'PENDING', reason = '', formatErrors = 0;
  const repaired = new Map<string, number>(), repeated = new Map<string, number>();
  function move(event: StateEvent, detail = ''): void {
    const next = transition(state, event);
    appendEvent(options.store, 'state_transition', { from: state, to: next, reason: detail });
    state = next; reason = detail;
  }
  function boundary(batchSize = 0, request = true): boolean {
    if (signal.aborted) { move('cancel', 'SIGINT or cancellation requested'); return false; }
    const exceeded = preflight(limits, totals, now() - started, batchSize, request);
    if (exceeded) { move('budget', exceeded); return false; }
    return true;
  }
  appendEvent(options.store, 'run_start', { endpoint: adapter.endpoint, model: adapter.model, budgets: limits });
  move('start');
  try {
    while (!TERMINAL.has(state)) {
      await new Promise<void>(resolve => setImmediate(resolve));
      if (!boundary()) break;
      const step = totals.requests++;
      let response;
      try {
        const messages = options.assemble ? options.assemble(conversation) : options.context ? assemble({ ...options.context, conversation }) : [...options.messages, ...conversation];
        response = await adapter.complete({ step, messages, tools: TOOL_DEFINITIONS, signal });
      } catch (error) {
        if (signal.aborted) { move('cancel', 'SIGINT or cancellation requested'); break; }
        if ((error as { code?: string }).code === 'TUIG_E_MODEL_FORMAT' && ++formatErrors < limits.formatErrors) continue;
        move('error', (error as { code?: string }).code ?? 'Model request failed'); break;
      }
      for (const key of ['input', 'cached', 'output', 'reasoning', 'cost'] as const) {
        const value = response.usage[key];
        if (!Number.isFinite(value) || value < 0) throw new Error('Invalid model usage');
        totals[key] += value;
      }
      const exceeded = afterResponse(limits, totals);
      if (exceeded) { move('budget', exceeded); break; }
      if (!boundary(response.toolCalls.length, false)) break;
      conversation.push({ role: 'assistant', content: response.message, ...(response.toolCalls.length ? { tool_calls: response.toolCalls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) });
      if (response.toolCalls.length) {
        let invalid = false;
        for (const call of response.toolCalls) {
          if (!boundary(1, false)) break;
          totals.toolCalls++;
          const result: ToolResult = options.execute ? options.execute(call) : executeTool(call, { root: options.root, store: options.store, allowedCommands: options.allowedCommands ?? [] });
          conversation.push({ role: 'tool', content: result.output, tool_call_id: call.id, log: result.log });
          if (result.aborted !== undefined) { move('abort', result.aborted); break; }
          if (result.status === 'invalid_args') invalid = true;
          const hash = createHash('sha256').update(JSON.stringify([call.name, call.arguments, result.status, result.output])).digest('hex');
          const count = (repeated.get(hash) ?? 0) + 1; repeated.set(hash, count);
          if (count >= 4) { move('stuck', 'Repeated identical action and observation'); break; }
        }
        formatErrors = invalid ? formatErrors + 1 : 0;
        if (!TERMINAL.has(state) && formatErrors >= limits.formatErrors) move('error', 'Consecutive tool format errors');
        continue;
      }
      formatErrors = 0;
      move('validate');
      const validation = await options.validate();
      if (!boundary(0, false)) break;
      appendEvent(options.store, 'sensor_result', { checks: validation.checks });
      const failed = validation.checks.filter(check => !check.passed);
      if (!validation.checks.length) { move('fail', 'No executable acceptance checks configured'); break; }
      if (!failed.length) { move('succeed'); break; }
      if (totals.repairs >= limits.repairTotal || failed.some(check => (repaired.get(check.name) ?? 0) >= limits.repairPerCheck)) { move('fail', 'Repair attempts exhausted'); break; }
      totals.repairs++;
      for (const check of failed) repaired.set(check.name, (repaired.get(check.name) ?? 0) + 1);
      conversation.push({ role: 'user', content: untrusted('sensor', 'Visible acceptance checks failed: ' + failed.map(check => check.name).join(', ')) });
      move('repair');
    }
  } catch { if (!TERMINAL.has(state)) move(signal.aborted ? 'cancel' : 'error', signal.aborted ? 'Cancellation requested' : 'Controller or validation failed'); }
  finally { if (options.handleSIGINT !== false) process.removeListener('SIGINT', interrupt); }
  const result = { state, reason, totals };
  appendEvent(options.store, 'run_end', { ...result, durationMs: now() - started });
  writeSummary(options.store, { ...result, endpoint: adapter.endpoint, model: adapter.model, durationMs: now() - started, claims: [{ claim: 'Terminal state and recorded counters', grade: 'deterministic' }, { claim: 'Task requirements are sufficient', grade: 'human-judgement' }] });
  return result;
}
