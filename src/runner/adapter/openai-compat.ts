import { wireMessage } from '../context.js';
import { codedError } from '../../cli/errors.js';
import type { ModelAdapter, ModelConfig, ModelResponse, ToolCall } from './types.js';
export const adapterError = codedError;
export function endpointPolicy(baseURL: string, allowedEndpoints: string[]): URL {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw adapterError('TUIG_E_CONFIG', 'Invalid model base URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw adapterError(
      'TUIG_E_CONFIG',
      'Model base URL must use HTTP(S), with no credentials, query or fragment.',
    );
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const canonical = (value: URL): string => value.href.replace(/\/$/, '');
  if (
    !local &&
    !allowedEndpoints.some((value) => {
      try {
        return canonical(new URL(value)) === canonical(url);
      } catch {
        return false;
      }
    })
  )
    throw adapterError('TUIG_E_EGRESS_DENIED');
  return url;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw adapterError('TUIG_E_MODEL_FORMAT', 'Missing or invalid token usage.');
  return Number(value);
}
export function normalize(
  value: unknown,
  prices: { input: number; cached: number; output: number },
): ModelResponse {
  if (
    !object(value) ||
    !Array.isArray(value.choices) ||
    !object(value.choices[0]) ||
    !object(value.usage)
  )
    throw adapterError('TUIG_E_MODEL_FORMAT');
  const choice = value.choices[0],
    message = choice.message;
  if (
    !object(message) ||
    !(message.content == null || typeof message.content === 'string') ||
    typeof choice.finish_reason !== 'string'
  )
    throw adapterError('TUIG_E_MODEL_FORMAT');
  const calls = message.tool_calls ?? [];
  if (!Array.isArray(calls)) throw adapterError('TUIG_E_MODEL_FORMAT');
  const toolCalls: ToolCall[] = calls.map((call) => {
    if (
      !object(call) ||
      typeof call.id !== 'string' ||
      call.type !== 'function' ||
      !object(call.function) ||
      typeof call.function.name !== 'string' ||
      typeof call.function.arguments !== 'string'
    )
      throw adapterError('TUIG_E_MODEL_FORMAT');
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw adapterError('TUIG_E_MODEL_FORMAT');
    }
    if (!object(args)) throw adapterError('TUIG_E_MODEL_FORMAT');
    return { id: call.id, name: call.function.name, arguments: args };
  });
  if (new Set(toolCalls.map((c) => c.id)).size !== toolCalls.length)
    throw adapterError('TUIG_E_MODEL_FORMAT', 'Duplicate tool call ids.');
  const input = count(value.usage.prompt_tokens),
    output = count(value.usage.completion_tokens);
  const promptDetails = value.usage.prompt_tokens_details,
    completionDetails = value.usage.completion_tokens_details;
  const cached = count(object(promptDetails) ? (promptDetails.cached_tokens ?? 0) : 0);
  const reasoning = count(
    object(completionDetails) ? (completionDetails.reasoning_tokens ?? 0) : 0,
  );
  if (cached > input || reasoning > output)
    throw adapterError('TUIG_E_MODEL_FORMAT', 'Inconsistent token usage.');
  const cost =
    ((input - cached) * prices.input + cached * prices.cached + output * prices.output) / 1_000_000;
  if (!Number.isFinite(cost)) throw adapterError('TUIG_E_MODEL_FORMAT', 'Invalid computed cost.');
  return {
    message: message.content ?? null,
    toolCalls,
    usage: { input, cached, output, reasoning, cost },
    stopReason: choice.finish_reason,
  };
}
export function openAIAdapter(
  config: ModelConfig,
  env: NodeJS.ProcessEnv = process.env,
): ModelAdapter {
  const base = endpointPolicy(config.baseURL, config.allowedEndpoints);
  if (!config.model.trim()) throw adapterError('TUIG_E_CONFIG', 'Model is required.');
  const prices = config.prices[config.model];
  if (
    !prices ||
    ![prices.input, prices.cached, prices.output].every((n) => Number.isFinite(n) && n >= 0)
  )
    throw adapterError(
      'TUIG_E_CONFIG',
      'Explicit non-negative per-million token prices are required for this model (use zero for free local models).',
    );
  if (config.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv))
    throw adapterError('TUIG_E_CONFIG', 'apiKeyEnv must be an environment variable name.');
  const key = config.apiKeyEnv ? env[config.apiKeyEnv] : undefined;
  if (config.apiKeyEnv && !key)
    throw adapterError('TUIG_E_CONFIG', 'Configured API-key environment variable is unset.');
  const endpoint = base.href.replace(/\/$/, '');
  return {
    endpoint,
    model: config.model,
    async complete(request) {
      endpointPolicy(endpoint, config.allowedEndpoints);
      const signal = AbortSignal.any([
        AbortSignal.timeout(config.timeoutMs ?? 60_000),
        ...(request.signal ? [request.signal] : []),
      ]);
      let response: Response;
      try {
        response = await fetch(endpoint + '/chat/completions', {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            'Content-Type': 'application/json',
            ...(key ? { Authorization: 'Bearer ' + key } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages: request.messages.map((message) => wireMessage(message, false)),
            ...(request.tools?.length ? { tools: request.tools } : {}),
            stream: false,
          }),
        });
      } catch {
        if (request.signal?.aborted) throw request.signal.reason;
        throw adapterError(
          'TUIG_E_MODEL_HTTP',
          signal.aborted
            ? 'Model request timed out.'
            : 'Model request failed (redirects are refused).',
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw adapterError('TUIG_E_MODEL_HTTP', 'Model HTTP status ' + response.status + '.');
      }
      // Bound response size while reading instead of allocating an unbounded body.
      const reader = response.body?.getReader();
      if (!reader) throw adapterError('TUIG_E_MODEL_FORMAT');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 8 * 1024 * 1024)
            throw adapterError('TUIG_E_MODEL_FORMAT', 'Model response exceeds 8 MiB.');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw adapterError('TUIG_E_MODEL_FORMAT');
      }
      return normalize(body, prices);
    },
  };
}
