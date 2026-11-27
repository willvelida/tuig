import { codedError } from '../cli/errors.js';
import { existingRecord, readRun, type RunEvent } from '../engine/record.js';
import type { Message, ModelResponse } from './adapter/types.js';
import type { Totals } from './budgets.js';
import { assistantMessage, repairMessage, toolMessage } from './controller.js';

export type ResumeWorkspace = { id: string; branch: string; base: string };
export type ResumeTask = { taskId: string | null; instruction: string };
export type DiscardedCall = { id: string; name: string; outcome: string };

/** Everything needed to continue an interrupted run from its last checkpoint. */
export type ResumePoint = {
  from: string;
  turn: number;
  checkpoint: { ref: string; commit: string };
  workspace: ResumeWorkspace;
  task: ResumeTask;
  conversation: Message[];
  totals: Totals;
  /** Tool calls after the checkpoint: rolled back with it and re-proposed by the model, never re-run. */
  discarded: DiscardedCall[];
  previous: string;
};

const ZERO: Totals = {
  requests: 0,
  toolCalls: 0,
  input: 0,
  cached: 0,
  output: 0,
  reasoning: 0,
  cost: 0,
  repairs: 0,
};

function startOf(events: RunEvent[]): RunEvent {
  const start = events.find((event) => event.type === 'run_start');
  if (!start) throw codedError('TUIG_E_RESUME', 'Run record has no run_start event.');
  return start;
}

/**
 * Rebuild the conversation and counters the controller held before `turn`,
 * following earlier resumes back to the original run.
 */
function history(
  root: string,
  id: string,
  turn: number,
  depth = 0,
): { conversation: Message[]; totals: Totals } {
  if (depth > 100) throw codedError('TUIG_E_RESUME', 'Resume chain is too long.');
  const { events } = readRun(existingRecord(root, id));
  const resumed = startOf(events).data.resume as { from: string; turn: number } | undefined;
  const prior = resumed
    ? history(root, resumed.from, resumed.turn, depth + 1)
    : { conversation: [], totals: { ...ZERO } };
  const conversation = [...prior.conversation];
  const totals: Totals = { ...prior.totals };
  let failed: string[] = [];
  for (const event of events) {
    if (event.type === 'model_request') {
      if (Number(event.data.step) >= turn) break;
      totals.requests++;
    } else if (event.type === 'model_response' && event.data.response) {
      const response = event.data.response as ModelResponse;
      conversation.push(assistantMessage(response));
      for (const key of ['input', 'cached', 'output', 'reasoning', 'cost'] as const)
        totals[key] += response.usage[key];
      for (const key of ['cacheWrite5m', 'cacheWrite1h'] as const) {
        const value = response.usage[key];
        if (value !== undefined) totals[key] = (totals[key] ?? 0) + value;
      }
      if (response.usage.reasoningKnown === false) totals.reasoningKnown = false;
    } else if (event.type === 'tool_call') {
      totals.toolCalls++;
      conversation.push(
        toolMessage(String(event.data.id), String(event.data.output), String(event.data.log)),
      );
    } else if (event.type === 'sensor_result') {
      failed = (event.data.checks as { name: string; passed: boolean }[])
        .filter((c) => !c.passed)
        .map((c) => c.name);
    } else if (event.type === 'state_transition' && event.data.to === 'REPAIRING') {
      totals.repairs++;
      conversation.push(repairMessage(failed));
    }
  }
  return { conversation, totals };
}

/**
 * Find where an interrupted run can continue. A run is resumable when it
 * crashed (no run_end) or was cancelled, and has not been resumed already.
 */
export function resumePoint(root: string, id: string): ResumePoint {
  const store = existingRecord(root, id);
  const run = readRun(store);
  const summary = run.summary as { resumedAs?: string } | null;
  if (summary?.resumedAs)
    throw codedError('TUIG_E_RESUME', 'Run was already resumed as ' + summary.resumedAs + '.');
  const end = [...run.events].reverse().find((event) => event.type === 'run_end');
  if (end && end.data.state !== 'CANCELLED')
    throw codedError(
      'TUIG_E_RESUME',
      'Run finished as ' + String(end.data.state) + '; only cancelled or interrupted runs resume.',
    );
  const start = startOf(run.events);
  const recorded = start.data.workspace as
    { id?: string; branch?: string; base?: string } | undefined;
  const task = start.data.task as ResumeTask | undefined;
  if (!recorded?.branch || !recorded.base || !task?.instruction)
    throw codedError(
      'TUIG_E_RESUME',
      'Run predates resumable records (no workspace or task in run_start).',
    );
  const workspace: ResumeWorkspace = {
    id: recorded.id ?? recorded.branch.replace(/^tuig\/run-/, ''),
    branch: recorded.branch,
    base: recorded.base,
  };
  const last = [...run.events].reverse().find((event) => event.type === 'checkpoint');
  if (!last) throw codedError('TUIG_E_RESUME', 'Run has no checkpoint to resume from.');
  const turn = Number(last.data.turn);
  // Every tool call after the checkpoint is undone by restoring it; record what was in flight.
  const outcomes = new Map<string, string>();
  for (const event of run.events.slice(last.seq))
    if (event.type === 'tool_call') outcomes.set(String(event.data.id), String(event.data.status));
  const discarded = run.events
    .slice(last.seq)
    .filter(
      (event) =>
        event.type === 'tool_intent' &&
        event.data.name !== 'acceptance_check' &&
        event.data.id !== undefined,
    )
    .map((event) => ({
      id: String(event.data.id),
      name: String(event.data.name),
      outcome: outcomes.get(String(event.data.id)) ?? 'in-flight',
    }));
  return {
    from: id,
    turn,
    checkpoint: { ref: String(last.data.ref), commit: String(last.data.commit) },
    workspace,
    task,
    ...history(root, id, turn),
    discarded,
    previous: end ? 'CANCELLED' : 'INTERRUPTED',
  };
}
