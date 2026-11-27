import { adapterError, endpointPolicy } from './openai-compat.js';
import type {
  Message,
  ModelAdapter,
  ModelConfig,
  ModelResponse,
  Prices,
  ToolCall,
} from './types.js';
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw adapterError('TUIG_E_MODEL_FORMAT', 'Invalid Anthropic token usage.');
  return Number(value);
}
export function anthropicMessages(messages: Message[]): {
  system: string;
  messages: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[];
} {
  const system: string[] = [],
    result: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content ?? '');
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    let content: Record<string, unknown>[];
    if (message.role === 'tool') {
      if (!message.tool_call_id)
        throw adapterError('TUIG_E_MODEL_FORMAT', 'Tool result is missing its call id.');
      content = [
        { type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content ?? '' },
      ];
    } else if (message.role === 'assistant' && message.providerContent)
      content = structuredClone(message.providerContent);
    else {
      content = message.content ? [{ type: 'text', text: message.content }] : [];
      for (const call of message.tool_calls ?? [])
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: JSON.parse(call.function.arguments) as unknown,
        });
    }
    if (!content.length)
      throw adapterError('TUIG_E_MODEL_FORMAT', 'Anthropic messages cannot have empty content.');
    const previous = result.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else result.push({ role, content });
  }
  return { system: system.join('\n'), messages: result };
}
export function normalizeAnthropic(value: unknown, prices: Prices): ModelResponse {
  if (
    !object(value) ||
    !Array.isArray(value.content) ||
    !object(value.usage) ||
    typeof value.stop_reason !== 'string'
  )
    throw adapterError('TUIG_E_MODEL_FORMAT');
  const text: string[] = [],
    toolCalls: ToolCall[] = [],
    content: Record<string, unknown>[] = [];
  for (const block of value.content) {
    if (!object(block)) throw adapterError('TUIG_E_MODEL_FORMAT');
    if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
    else if (
      block.type === 'tool_use' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string' &&
      object(block.input)
    )
      toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
    else if (
      !(
        block.type === 'thinking' &&
        typeof block.thinking === 'string' &&
        typeof block.signature === 'string'
      ) &&
      !(block.type === 'redacted_thinking' && typeof block.data === 'string')
    )
      throw adapterError('TUIG_E_MODEL_FORMAT');
    content.push(structuredClone(block));
  }
  if (new Set(toolCalls.map((call) => call.id)).size !== toolCalls.length)
    throw adapterError('TUIG_E_MODEL_FORMAT');
  const usage = value.usage;
  const uncached = count(usage.input_tokens),
    output = count(usage.output_tokens),
    cached = count(usage.cache_read_input_tokens ?? 0),
    created = count(usage.cache_creation_input_tokens ?? 0);
  const creation = usage.cache_creation;
  const cacheWrite5m = count(
    object(creation) ? (creation.ephemeral_5m_input_tokens ?? 0) : created,
  );
  const cacheWrite1h = count(object(creation) ? (creation.ephemeral_1h_input_tokens ?? 0) : 0);
  if (cacheWrite5m + cacheWrite1h !== created)
    throw adapterError('TUIG_E_MODEL_FORMAT', 'Inconsistent cache creation usage.');
  const reasoningKnown = usage.reasoning_tokens !== undefined;
  const reasoning = count(usage.reasoning_tokens ?? 0);
  if (reasoning > output) throw adapterError('TUIG_E_MODEL_FORMAT');
  if (
    (cacheWrite5m && prices.cacheWrite5m === undefined) ||
    (cacheWrite1h && prices.cacheWrite1h === undefined)
  )
    throw adapterError('TUIG_E_CONFIG', 'Cache creation prices are required.');
  const cost =
    (uncached * prices.input +
      cached * prices.cached +
      cacheWrite5m * (prices.cacheWrite5m ?? 0) +
      cacheWrite1h * (prices.cacheWrite1h ?? 0) +
      output * prices.output) /
    1_000_000;
  if (!Number.isFinite(cost) || cost < 0) throw adapterError('TUIG_E_MODEL_FORMAT');
  return {
    message: text.length ? text.join('\n') : null,
    toolCalls,
    providerContent: content,
    stopReason: value.stop_reason,
    usage: {
      input: uncached + cached + created,
      cached,
      output,
      reasoning,
      reasoningKnown,
      cacheWrite5m,
      cacheWrite1h,
      cost,
    },
  };
}
export function anthropicAdapter(
  config: ModelConfig,
  env: NodeJS.ProcessEnv = process.env,
): ModelAdapter {
  const url = endpointPolicy(config.baseURL, config.allowedEndpoints),
    endpoint = url.href.replace(/\/$/, '');
  const prices = config.prices[config.model];
  if (
    !prices ||
    ![
      prices.input,
      prices.cached,
      prices.output,
      prices.cacheWrite5m ?? 0,
      prices.cacheWrite1h ?? 0,
    ].every((price) => Number.isFinite(price) && price >= 0)
  )
    throw adapterError('TUIG_E_CONFIG');
  if (config.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv))
    throw adapterError('TUIG_E_CONFIG');
  const key = config.apiKeyEnv ? env[config.apiKeyEnv] : undefined;
  if (
    (config.apiKeyEnv && !key) ||
    (!key && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw adapterError('TUIG_E_CONFIG', 'Configured Anthropic credential is unavailable.');
  const maxTokens = config.maxOutputTokens ?? 8192;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw adapterError('TUIG_E_CONFIG');
  return {
    endpoint,
    model: config.model,
    historyMode: 'append-only',
    async complete(request) {
      endpointPolicy(endpoint, config.allowedEndpoints);
      const history = anthropicMessages(request.messages);
      const signal = AbortSignal.any([
        AbortSignal.timeout(config.timeoutMs ?? 120000),
        ...(request.signal ? [request.signal] : []),
      ]);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            ...(key ? { 'x-api-key': key } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            system: history.system,
            messages: history.messages,
            output_config: { effort: config.effort ?? 'medium' },
            ...(request.tools?.length
              ? {
                  tools: request.tools.map((tool) => ({
                    name: tool.function.name,
                    description: tool.function.description,
                    input_schema: tool.function.parameters,
                  })),
                }
              : {}),
          }),
        });
      } catch {
        if (request.signal?.aborted) throw request.signal.reason;
        throw adapterError(
          'TUIG_E_MODEL_HTTP',
          signal.aborted
            ? 'Anthropic request timed out.'
            : 'Anthropic request failed; redirects are refused.',
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw adapterError('TUIG_E_MODEL_HTTP', 'Anthropic HTTP status ' + response.status + '.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw adapterError('TUIG_E_MODEL_FORMAT');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 8 * 1024 * 1024)
            throw adapterError('TUIG_E_MODEL_FORMAT', 'Anthropic response exceeds 8 MiB.');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      let value: unknown;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw adapterError('TUIG_E_MODEL_FORMAT');
      }
      return normalizeAnthropic(value, prices);
    },
  };
}
