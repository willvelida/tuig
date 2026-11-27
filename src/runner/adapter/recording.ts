import { appendEvent, type RecordStore } from '../../engine/record.js';
import type { ModelAdapter } from './types.js';
export function recordingAdapter(adapter: ModelAdapter, store: RecordStore): ModelAdapter {
  return {
    endpoint: adapter.endpoint,
    model: adapter.model,
    ...(adapter.historyMode ? { historyMode: adapter.historyMode } : {}),
    async complete(request) {
      appendEvent(store, 'model_request', {
        step: request.step,
        endpoint: adapter.endpoint,
        model: adapter.model,
        messages: request.messages,
        tools: request.tools ?? [],
      });
      const start = performance.now();
      try {
        const response = await adapter.complete(request);
        appendEvent(store, 'model_response', {
          step: request.step,
          response,
          latencyMs: performance.now() - start,
        });
        return response;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
        appendEvent(store, 'model_response', {
          step: request.step,
          error: { code },
          latencyMs: performance.now() - start,
        });
        throw error;
      }
    },
  };
}
