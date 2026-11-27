import { createHash } from 'node:crypto';

/**
 * Stuck detection over the run's recent history (thresholds from OpenHands):
 *
 * | Pattern                                   | Threshold   |
 * |-------------------------------------------|-------------|
 * | Same action and same observation          | 4 in a row  |
 * | Same action and same error                | 3 in a row  |
 * | Agent messages with no tool call (monologue) | 3 in a row |
 * | Two actions alternating (ping-pong)       | 6 steps     |
 *
 * A tool-less message always triggers validation, and its feedback cannot change
 * without a tool call, so repeated sensor feedback does not count as new input.
 */
export const STUCK_THRESHOLDS = { repeat: 4, error: 3, monologue: 3, pingPong: 6 } as const;

export type StuckEntry =
  { kind: 'action'; action: string; observation: string; error: boolean } | { kind: 'message' };

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Normalize one tool call and its outcome. Per-call log paths are removed so
 * identical observations hash identically.
 */
export function actionEntry(
  name: string,
  args: unknown,
  status: string,
  output: string,
): StuckEntry {
  const observation = output.replace(/tool-logs\/[A-Za-z0-9_-]+\.log/g, 'tool-logs/<log>');
  return {
    kind: 'action',
    action: digest([name, args]),
    observation: digest([status, observation]),
    error: status !== 'ok',
  };
}

/** Returns a detector: feed it each entry; it answers with a reason once a pattern completes. */
export function stuckDetector(): (entry: StuckEntry) => string | null {
  const history: StuckEntry[] = [];
  const same = (a: StuckEntry, b: StuckEntry): boolean =>
    a.kind === 'action' &&
    b.kind === 'action' &&
    a.action === b.action &&
    a.observation === b.observation;
  return (entry) => {
    history.push(entry);
    const tail = (n: number): StuckEntry[] | null =>
      history.length >= n ? history.slice(-n) : null;
    const errors = tail(STUCK_THRESHOLDS.error);
    if (errors && errors.every((e) => e.kind === 'action' && e.error && same(e, errors[0]!)))
      return 'Same action and same error ' + STUCK_THRESHOLDS.error + ' times in a row';
    const repeats = tail(STUCK_THRESHOLDS.repeat);
    if (repeats && repeats.every((e) => same(e, repeats[0]!)))
      return 'Same action and same observation ' + STUCK_THRESHOLDS.repeat + ' times in a row';
    const monologue = tail(STUCK_THRESHOLDS.monologue);
    if (monologue && monologue.every((e) => e.kind === 'message'))
      return 'Agent messages without tool calls ' + STUCK_THRESHOLDS.monologue + ' times in a row';
    const pingPong = tail(STUCK_THRESHOLDS.pingPong);
    if (
      pingPong &&
      pingPong.every((e, i) => e.kind === 'action' && same(e, pingPong[i % 2]!)) &&
      !same(pingPong[0]!, pingPong[1]!)
    )
      return 'Two actions alternating for ' + STUCK_THRESHOLDS.pingPong + ' steps';
    return null;
  };
}
