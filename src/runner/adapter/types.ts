export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; log?: string; tool_call_id?: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] };
export type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type Usage = { input: number; cached: number; output: number; reasoning: number; cost: number };
export type ModelResponse = { message: string | null; toolCalls: ToolCall[]; usage: Usage; stopReason: string };
export type ModelRequest = { step: number; messages: Message[]; tools?: ToolDefinition[]; signal?: AbortSignal };
export interface ModelAdapter {
  endpoint: string;
  model: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}
export type Prices = { input: number; cached: number; output: number };
export type ModelConfig = { baseURL: string; model: string; apiKeyEnv?: string; allowedEndpoints: string[]; prices: Record<string, Prices>; timeoutMs?: number };
