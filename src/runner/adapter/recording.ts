import { appendEvent, type RecordStore } from '../../engine/record.js';
import type { ModelAdapter } from './types.js';
export function recordingAdapter(adapter: ModelAdapter, store: RecordStore): ModelAdapter {
  return { endpoint: adapter.endpoint, model: adapter.model, async complete(request) {
    appendEvent(store, 'model_request', { step: request.step, endpoint: adapter.endpoint, model: adapter.model, messages: request.messages, tools: request.tools ?? [] });
    const start = performance.now();
    const response = await adapter.complete(request);
    appendEvent(store, 'model_response', { step: request.step, response, latencyMs: performance.now() - start });
    return response;
  } };
}
