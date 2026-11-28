import { appendEvent, writeSummary, type RecordStore } from '../engine/record.js';
import { recordingAdapter } from './adapter/recording.js';
import type { Message, ModelAdapter, ModelResponse, ToolDefinition } from './adapter/types.js';
import type { ApprovalDecision, ApprovalRequest, Approver } from './approval.js';
import type { Mode, PolicyRule } from '../engine/policy.js';
import type { Sandbox } from '../sandbox/index.js';
import { budgets, preflight, afterResponse, type Budgets, type Totals } from './budgets.js';
import { transition, TERMINAL, type State, type StateEvent } from './states.js';
import { executeTool, TOOL_DEFINITIONS, untrusted, type ToolResult } from './tools/index.js';
import { assemble } from './context.js';
import type { Check } from '../checks/config.js';
import type { Diagnostic } from '../checks/parsers.js';
import { actionEntry, stuckDetector } from './stuck.js';
export type ValidationResult = {
  checks: { name: string; passed: boolean; kind?: Check['kind']; diagnostics?: Diagnostic[] }[];
};
export type ControllerOptions = {
  root: string;
  store: RecordStore;
  adapter: ModelAdapter;
  messages: Message[];
  validate: () => Promise<ValidationResult>;
  limits?: Partial<Budgets>;
  allowedCommands?: string[][];
  checks?: Check[];
  signal?: AbortSignal;
  handleSIGINT?: boolean;
  now?: () => number;
  assemble?: (conversation: Message[]) => Message[];
  context?: { agents: string; instruction: string };
  execute?: (
    call: Parameters<typeof executeTool>[0],
    context: ToolContext,
  ) => ToolResult | Promise<ToolResult>;
  /** Human decision source. Absent means non-interactive: approvals become denials. */
  approver?: Approver;
  /** Runs before every model request, e.g. to checkpoint the workspace. */
  beforeTurn?: (turn: number) => void;
  /** Tool definitions sent with each request; replay supplies the recorded ones. */
  tools?: () => ToolDefinition[];
  /** Permission mode and repository rules for agent tool calls; defaults to ask. */
  policy?: { mode: Mode; rules: PolicyRule[]; passEnv?: string[]; sandbox?: Sandbox };
  /** Continue an interrupted run: prior conversation and counters, carried over. */
  resume?: { conversation: Message[]; totals: Totals; repaired?: Record<string, number> };
  /** Extra run_start fields, such as the workspace identity. */
  start?: Record<string, unknown>;
};
export type ToolContext = { approve?: (request: ApprovalRequest) => ApprovalDecision };
/** Conversation entries, shared with resume so a rebuilt history is byte-identical. */
export function assistantMessage(response: ModelResponse): Message {
  return {
    role: 'assistant',
    content: response.message,
    ...(response.providerContent ? { providerContent: response.providerContent } : {}),
    ...(response.toolCalls.length
      ? {
          tool_calls: response.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        }
      : {}),
  };
}
export function toolMessage(id: string, output: string, log: string): Message {
  return { role: 'tool', content: output, tool_call_id: id, log };
}
export function repairMessage(
  failed: string[] | ValidationResult['checks'],
  clean: (value: string) => string = (value) => value,
): Message {
  const structured = failed.filter(
    (c): c is ValidationResult['checks'][number] => typeof c !== 'string',
  );
  const bounded: ValidationResult['checks'] = [];
  let truncated = false;
  let remaining = 12000;
  for (const check of structured) {
    const diagnostics: Diagnostic[] = [];
    for (const d of check.diagnostics ?? []) {
      const size = Buffer.byteLength(JSON.stringify(d));
      if (size > remaining) {
        truncated = true;
        break;
      }
      diagnostics.push(d);
      remaining -= size;
    }
    const value = {
      name: check.name.slice(0, 256),
      passed: check.passed,
      ...(check.kind ? { kind: check.kind } : {}),
      diagnostics,
    };
    const size = Buffer.byteLength(JSON.stringify(value));
    if (check.name.length > 256) truncated = true;
    if (Buffer.byteLength(JSON.stringify(bounded)) + size > 16000) {
      truncated = true;
      break;
    }
    bounded.push(value);
  }
  return {
    role: 'user',
    content: untrusted(
      'sensor',
      clean(
        'Visible acceptance checks failed: ' +
          (failed.every((c) => typeof c === 'string')
            ? failed.join(', ')
            : JSON.stringify({
                checks: bounded,
                truncated,
              })),
      ),
    ),
  };
}
export async function control(
  options: ControllerOptions,
): Promise<{ state: State; reason: string; totals: Totals }> {
  const limits = budgets(options.limits),
    now = options.now ?? (() => performance.now()),
    started = now();
  const cancellation = new AbortController();
  const interrupt = (): void => cancellation.abort(new Error('SIGINT'));
  if (options.handleSIGINT !== false) process.on('SIGINT', interrupt);
  const signal = AbortSignal.any([
    cancellation.signal,
    ...(options.signal ? [options.signal] : []),
  ]);
  const adapter = recordingAdapter(options.adapter, options.store);
  // A resumed run continues the conversation and counters of the interrupted one,
  // so budgets cannot be reset by killing and resuming.
  const conversation: Message[] = [...(options.resume?.conversation ?? [])];
  const totals: Totals = {
    requests: 0,
    toolCalls: 0,
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    cost: 0,
    repairs: 0,
    ...options.resume?.totals,
  };
  let state: State = 'PENDING',
    reason = '',
    formatErrors = 0;
  const repaired = new Map<string, number>(Object.entries(options.resume?.repaired ?? {}));
  const stuck = stuckDetector();
  function move(event: StateEvent, detail = ''): void {
    const next = transition(state, event);
    appendEvent(options.store, 'state_transition', { from: state, to: next, reason: detail });
    state = next;
    reason = detail;
  }
  function boundary(batchSize = 0, request = true): boolean {
    if (signal.aborted) {
      move('cancel', 'SIGINT or cancellation requested');
      return false;
    }
    const exceeded = preflight(limits, totals, now() - started, batchSize, request);
    if (exceeded) {
      move('budget', exceeded);
      return false;
    }
    return true;
  }
  appendEvent(options.store, 'run_start', {
    endpoint: adapter.endpoint,
    model: adapter.model,
    budgets: limits,
    ...(adapter.historyMode ? { historyMode: adapter.historyMode } : {}),
    ...options.start,
  });
  move('start');
  // Approval suspends the run in AWAITING_APPROVAL until the approver decides.
  const approver = options.approver;
  const toolContext: ToolContext = approver
    ? {
        approve(request) {
          appendEvent(options.store, 'approval_requested', { request });
          move('request_approval', request.rule);
          const decision = approver(request);
          appendEvent(options.store, 'approval_decided', { id: request.id, decision });
          move(decision === 'deny' ? 'deny' : 'approve', decision);
          return decision;
        },
      }
    : {};
  try {
    while (!TERMINAL.has(state)) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!boundary()) break;
      const step = totals.requests++;
      options.beforeTurn?.(step);
      let response;
      try {
        const messages = options.assemble
          ? options.assemble(conversation)
          : options.context
            ? assemble({
                ...options.context,
                conversation,
                preserveHistory: adapter.historyMode === 'append-only',
              })
            : [...options.messages, ...conversation];
        const tools = options.tools ? options.tools() : TOOL_DEFINITIONS;
        response = await adapter.complete({ step, messages, tools, signal });
      } catch (error) {
        if (signal.aborted) {
          move('cancel', 'SIGINT or cancellation requested');
          break;
        }
        if (
          (error as { code?: string }).code === 'TUIG_E_MODEL_FORMAT' &&
          ++formatErrors < limits.formatErrors
        )
          continue;
        move('error', (error as { code?: string }).code ?? 'Model request failed');
        break;
      }
      for (const key of ['input', 'cached', 'output', 'reasoning', 'cost'] as const) {
        const value = response.usage[key];
        if (!Number.isFinite(value) || value < 0) throw new Error('Invalid model usage');
        totals[key] += value;
      }
      for (const key of ['cacheWrite5m', 'cacheWrite1h'] as const) {
        const value = response.usage[key];
        if (value !== undefined) {
          if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid cache usage');
          totals[key] = (totals[key] ?? 0) + value;
        }
      }
      if (response.usage.reasoningKnown === false) totals.reasoningKnown = false;
      const exceeded = afterResponse(limits, totals);
      if (exceeded) {
        move('budget', exceeded);
        break;
      }
      if (!boundary(response.toolCalls.length, false)) break;
      conversation.push(assistantMessage(response));
      if (response.toolCalls.length) {
        let invalid = false;
        for (const call of response.toolCalls) {
          if (!boundary(1, false)) break;
          totals.toolCalls++;
          const result: ToolResult = options.execute
            ? await options.execute(call, toolContext)
            : await executeTool(call, {
                signal,
                root: options.root,
                store: options.store,
                allowedCommands: options.allowedCommands ?? [],
                ...(options.checks ? { checks: options.checks } : {}),
                ...(options.policy ?? {}),
                ...toolContext,
              });
          conversation.push(toolMessage(call.id, result.output, result.log));
          if (result.aborted !== undefined) {
            move('abort', result.aborted);
            break;
          }
          if (result.status === 'invalid_args') {
            // Malformed calls have their own consecutive format-error limit.
            invalid = true;
            continue;
          }
          const looping = stuck(
            actionEntry(call.name, call.arguments, result.status, result.output),
          );
          if (looping) {
            move('stuck', looping);
            break;
          }
        }
        formatErrors = invalid ? formatErrors + 1 : 0;
        if (!TERMINAL.has(state) && formatErrors >= limits.formatErrors)
          move('error', 'Consecutive tool format errors');
        continue;
      }
      formatErrors = 0;
      const monologue = stuck({ kind: 'message' });
      if (monologue) {
        move('stuck', monologue);
        break;
      }
      move('validate');
      const validation = await options.validate();
      if (!boundary(0, false)) break;
      appendEvent(options.store, 'sensor_result', { checks: validation.checks });
      const failed = validation.checks.filter((check) => !check.passed);
      if (!validation.checks.length) {
        move('fail', 'No executable acceptance checks configured');
        break;
      }
      if (!failed.length) {
        move('succeed');
        break;
      }
      if (failed.some((check) => check.kind === 'gate')) {
        move('fail', 'Visible gate check failed');
        break;
      }
      if (
        totals.repairs >= limits.repairTotal ||
        failed.some((check) => (repaired.get(check.name) ?? 0) >= limits.repairPerCheck)
      ) {
        move('fail', 'Repair attempts exhausted');
        break;
      }
      totals.repairs++;
      for (const check of failed) repaired.set(check.name, (repaired.get(check.name) ?? 0) + 1);
      const feedback = repairMessage(
        failed.some((c) => c.diagnostics !== undefined)
          ? failed
          : failed.map((check) => check.name),
        options.store.clean,
      );
      conversation.push(feedback);
      move('repair');
    }
  } catch {
    if (!TERMINAL.has(state))
      move(
        signal.aborted ? 'cancel' : 'error',
        signal.aborted ? 'Cancellation requested' : 'Controller or validation failed',
      );
  } finally {
    if (options.handleSIGINT !== false) process.removeListener('SIGINT', interrupt);
  }
  const result = { state, reason, totals };
  appendEvent(options.store, 'run_end', { ...result, durationMs: now() - started });
  writeSummary(options.store, {
    ...result,
    endpoint: adapter.endpoint,
    model: adapter.model,
    durationMs: now() - started,
    claims: [
      { claim: 'Terminal state and recorded counters', grade: 'deterministic' },
      { claim: 'Task requirements are sufficient', grade: 'human-judgement' },
    ],
  });
  return result;
}
