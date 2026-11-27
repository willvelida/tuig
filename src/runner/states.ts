export const STATES = ['PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'PAUSED', 'VALIDATING', 'REPAIRING', 'SUCCEEDED', 'FAILED_VALIDATION', 'ABORTED_BY_AGENT', 'BUDGET_EXCEEDED', 'STUCK', 'CANCELLED', 'ERROR'] as const;
export type State = typeof STATES[number];
export const TERMINAL = new Set<State>(['SUCCEEDED', 'FAILED_VALIDATION', 'ABORTED_BY_AGENT', 'BUDGET_EXCEEDED', 'STUCK', 'CANCELLED', 'ERROR']);
export const EVENTS = ['start', 'request_approval', 'approve', 'pause', 'resume', 'validate', 'repair', 'succeed', 'fail', 'abort', 'budget', 'stuck', 'cancel', 'error'] as const;
export type StateEvent = typeof EVENTS[number];
const table: Partial<Record<State, Partial<Record<StateEvent, State>>>> = {
  PENDING: { start: 'RUNNING' }, RUNNING: { request_approval: 'AWAITING_APPROVAL', pause: 'PAUSED', validate: 'VALIDATING' },
  AWAITING_APPROVAL: { approve: 'RUNNING', pause: 'PAUSED' }, PAUSED: { resume: 'RUNNING' },
  VALIDATING: { repair: 'REPAIRING', succeed: 'SUCCEEDED', fail: 'FAILED_VALIDATION' },
  REPAIRING: { request_approval: 'AWAITING_APPROVAL', pause: 'PAUSED', validate: 'VALIDATING' },
};
const exits: Partial<Record<StateEvent, State>> = { abort: 'ABORTED_BY_AGENT', budget: 'BUDGET_EXCEEDED', stuck: 'STUCK', cancel: 'CANCELLED', error: 'ERROR' };
export function transition(state: State, event: StateEvent): State {
  if (TERMINAL.has(state)) throw new Error('Terminal states cannot transition.');
  const next = table[state]?.[event] ?? exits[event];
  if (!next) throw new Error('Invalid transition: ' + state + ' / ' + event);
  return next;
}
