export const DEFAULT_BUDGETS = {
  requests: 100,
  cost: 10,
  wallSeconds: 3600,
  formatErrors: 3,
  repairPerCheck: 3,
  repairTotal: 6,
} as const;
export type Budgets = {
  requests: number;
  cost: number;
  wallSeconds: number;
  formatErrors: number;
  repairPerCheck: number;
  repairTotal: number;
  toolCalls?: number;
  tokens?: number;
};
export type Totals = {
  requests: number;
  toolCalls: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  cost: number;
  repairs: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  reasoningKnown?: boolean;
};
export type BudgetKind = 'requests' | 'tool_calls' | 'tokens' | 'cost' | 'wall';
export function budgets(overrides: Partial<Budgets> = {}): Budgets {
  const result = { ...DEFAULT_BUDGETS, ...overrides };
  for (const [key, value] of Object.entries(result))
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (!['cost', 'wallSeconds'].includes(key) && !Number.isInteger(value))
    )
      throw new Error('Invalid budget: ' + key);
  if (result.formatErrors < 1) throw new Error('formatErrors must be positive.');
  return result;
}
export function preflight(
  limits: Budgets,
  totals: Totals,
  elapsedMs: number,
  batchSize = 0,
  request = true,
): BudgetKind | null {
  if (elapsedMs >= limits.wallSeconds * 1000) return 'wall';
  if (request && totals.requests >= limits.requests) return 'requests';
  if (limits.toolCalls !== undefined && totals.toolCalls + batchSize > limits.toolCalls)
    return 'tool_calls';
  return null;
}
export function afterResponse(limits: Budgets, totals: Totals): BudgetKind | null {
  if (limits.tokens !== undefined && totals.input + totals.output > limits.tokens) return 'tokens';
  if (totals.cost > limits.cost) return 'cost';
  return null;
}
