import type { RunEvent } from '../../engine/record.js';
import { adapterError } from './openai-compat.js';
import type { ModelAdapter, ModelResponse } from './types.js';
export function replayAdapter(events: RunEvent[]): ModelAdapter {
  const steps = new Map<number, ModelResponse>();
  const errors = new Map<number, string | null>();
  for (const event of events.filter((event) => event.type === 'model_response')) {
    const step = event.data.step;
    if (
      !Number.isSafeInteger(step) ||
      Number(step) < 0 ||
      steps.has(Number(step)) ||
      errors.has(Number(step))
    )
      throw adapterError('TUIG_E_REPLAY', 'Invalid or duplicate replay step.');
    if (event.data.error && typeof event.data.error === 'object' && 'code' in event.data.error) {
      errors.set(
        Number(step),
        typeof event.data.error.code === 'string' ? event.data.error.code : null,
      );
      continue;
    }
    const response = event.data.response as ModelResponse;
    if (
      !response ||
      !Array.isArray(response.toolCalls) ||
      !response.usage ||
      typeof response.stopReason !== 'string'
    )
      throw adapterError('TUIG_E_REPLAY', 'Invalid recorded model response.');
    steps.set(Number(step), structuredClone(response));
  }
  return {
    endpoint: 'replay',
    model: 'replay',
    async complete(request) {
      request.signal?.throwIfAborted();
      if (errors.has(request.step)) {
        const code = errors.get(request.step);
        throw code
          ? Object.assign(new Error('Recorded adapter error.'), { code })
          : new Error('Recorded adapter error.');
      }
      const value = steps.get(request.step);
      if (!value)
        throw adapterError(
          'TUIG_E_REPLAY',
          'No recorded model response at step ' + request.step + '.',
        );
      return structuredClone(value);
    },
  };
}
