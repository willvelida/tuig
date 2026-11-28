import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { envelope, type Envelope } from '../envelope.js';
import {
  appendEvent,
  createRecord,
  existingRecord,
  readArtifact,
  readRun,
  writeArtifact,
  type RunEvent,
} from '../../engine/record.js';
import { replayAdapter } from '../../runner/adapter/replay.js';
import { adapterError } from '../../runner/adapter/openai-compat.js';
import { control, type ValidationResult } from '../../runner/controller.js';
import type { Message, ToolDefinition } from '../../runner/adapter/types.js';
import type { ApprovalDecision, ApprovalRequest } from '../../runner/approval.js';
import type { Budgets, Totals } from '../../runner/budgets.js';
import type { ToolResult } from '../../runner/tools/index.js';
import { commandFailure, rootAt, showRun } from './run.js';
export function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['timestamp', 'latencyMs', 'durationMs'].includes(key))
        .map(([key, item]) => [key, comparable(item)]),
    );
  return value;
}
export async function replayRun(id: string, cwd = process.cwd()): Promise<Envelope> {
  try {
    const shown = showRun(id, cwd);
    if (shown.status !== 'ok') return shown;
    const root = rootAt(cwd),
      sourceStore = existingRecord(root, id),
      source = readRun(sourceStore);
    if (source.incompleteTail || source.events.at(-1)?.type !== 'run_end')
      throw adapterError('TUIG_E_REPLAY');
    const replayId = 'replay-' + randomUUID(),
      store = createRecord(root, replayId);
    const replay = replayAdapter(source.events),
      cancellation = new AbortController();
    const cursor = (): number => readRun(store).events.length;
    const next = (): RunEvent | undefined => source.events[cursor()];
    const cancelAtBoundary = (): void => {
      if (next()?.type === 'state_transition' && next()?.data.to === 'CANCELLED')
        cancellation.abort(new Error('Recorded cancellation'));
    };
    if (
      !source.events.some((e) => e.type === 'model_request') &&
      source.events.some((e) => e.type === 'state_transition' && e.data.to === 'CANCELLED')
    )
      cancellation.abort();
    const start = source.events.find((event) => event.type === 'run_start');
    if (!start) throw adapterError('TUIG_E_REPLAY');
    const requests = source.events.filter((event) => event.type === 'model_request');
    let requestIndex = 0;
    const adapter = {
      endpoint: String(start.data.endpoint),
      model: String(start.data.model),
      ...(start.data.historyMode === 'append-only' ? { historyMode: 'append-only' as const } : {}),
      async complete(request: Parameters<typeof replay.complete>[0]) {
        try {
          const response = await replay.complete(request);
          cancelAtBoundaryAfterResponse();
          return response;
        } catch (error) {
          cancelAtBoundaryAfterResponse();
          throw error;
        }
      },
    };
    function cancelAtBoundaryAfterResponse(): void {
      // recordingAdapter will append model_response next, then the controller observes cancellation.
      const event = source.events[cursor() + 1];
      if (event?.type === 'state_transition' && event.data.to === 'CANCELLED')
        cancellation.abort(new Error('Recorded cancellation'));
    }
    const result = await control({
      root,
      store,
      adapter,
      messages: [],
      signal: cancellation.signal,
      handleSIGINT: false,
      limits: start.data.budgets as Partial<Budgets>,
      now: () =>
        next()?.type === 'state_transition' && next()?.data.reason === 'wall'
          ? Number((start.data.budgets as Budgets).wallSeconds) * 1000
          : 0,
      ...(start.data.resume
        ? {
            resume: {
              conversation: [],
              totals: (start.data.resume as { totals: Totals }).totals,
              ...((start.data.resume as { repaired?: Record<string, number> }).repaired
                ? { repaired: (start.data.resume as { repaired: Record<string, number> }).repaired }
                : {}),
            },
          }
        : {}),
      start: Object.fromEntries(
        Object.entries(start.data).filter(
          ([key]) => !['endpoint', 'model', 'budgets', 'historyMode'].includes(key),
        ),
      ),
      assemble: () => {
        const request = requests[requestIndex++];
        if (!request) throw adapterError('TUIG_E_REPLAY');
        return request.data.messages as Message[];
      },
      // Records made before a tool was added must replay with the tools they were offered.
      tools: () => (requests[requestIndex - 1]?.data.tools ?? []) as ToolDefinition[],
      beforeTurn: () => {
        const event = next();
        if (event?.type === 'checkpoint') appendEvent(store, 'checkpoint', event.data);
      },
      approver: (): ApprovalDecision => {
        const event = next();
        if (event?.type !== 'approval_decided') throw adapterError('TUIG_E_REPLAY');
        return event.data.decision as ApprovalDecision;
      },
      execute: (call, context) => {
        if (next()?.type === 'tool_intent') {
          const event = next()!;
          appendEvent(store, 'tool_intent', event.data);
        }
        if (next()?.type === 'approval_requested') {
          if (!context.approve) throw adapterError('TUIG_E_REPLAY');
          context.approve(next()!.data.request as ApprovalRequest);
        }
        if (next()?.type === 'policy_denied') appendEvent(store, 'policy_denied', next()!.data);
        const outcome = next();
        if (
          outcome?.type !== 'tool_call' ||
          outcome.data.id !== call.id ||
          outcome.data.name !== call.name
        )
          throw adapterError('TUIG_E_REPLAY');
        const log = String(outcome.data.log);
        writeArtifact(store, log, readArtifact(sourceStore, log));
        appendEvent(store, 'tool_call', outcome.data);
        const value: ToolResult = {
          id: call.id,
          status: outcome.data.status as ToolResult['status'],
          output: String(outcome.data.output),
          log,
        };
        if (call.name === 'abort_with_reason' && value.status === 'ok')
          value.aborted = String(call.arguments.reason);
        cancelAtBoundary();
        return value;
      },
      validate: async () => {
        while (next()?.type === 'tool_intent' && next()?.data.name === 'acceptance_check') {
          const intent = next()!;
          appendEvent(store, 'tool_intent', intent.data);
        }
        const event = next();
        if (
          event?.type === 'state_transition' &&
          event.data.to === 'BUDGET_EXCEEDED' &&
          event.data.reason === 'wall'
        )
          return { checks: [] };
        if (event?.type !== 'sensor_result') {
          cancelAtBoundary();
          if (cancellation.signal.aborted) return { checks: [] };
          throw adapterError('TUIG_E_REPLAY');
        }
        return { checks: event.data.checks as ValidationResult['checks'] };
      },
    });
    writeArtifact(store, 'diff.patch', source.diff);
    const rebuilt = readRun(store);
    const verified = isDeepStrictEqual(comparable(rebuilt.events), comparable(source.events));
    if (!verified)
      throw adapterError('TUIG_E_REPLAY', 'Rebuilt event sequence differs from the recorded run.');
    return envelope(
      'runs replay',
      { id, replayId, ...result, verified, events: rebuilt.events },
      { status: 'ok' },
    );
  } catch (error) {
    return commandFailure('runs replay', error);
  }
}
