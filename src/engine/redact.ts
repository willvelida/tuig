export const REDACTED = '[REDACTED]';
export function redactor(
  options: { env?: NodeJS.ProcessEnv; literals?: string[]; sensitiveEnv?: string[] } = {},
): (text: string) => string {
  const env = options.env ?? process.env;
  const names = new Set([
    ...Object.keys(env).filter((name) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name)),
    ...(options.sensitiveEnv ?? []),
  ]);
  const literals = [
    ...new Set(
      [...(options.literals ?? []), ...Array.from(names, (name) => env[name] ?? '')].filter(
        Boolean,
      ),
    ),
  ].sort((a, b) => b.length - a.length);
  return (text) => {
    for (const literal of literals) text = text.split(literal).join(REDACTED);
    return text
      .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, REDACTED)
      .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED)
      .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED)
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1' + REDACTED);
  };
}
export function redactValue(value: unknown, clean: (text: string) => string): unknown {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, clean));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [clean(key), redactValue(item, clean)]),
    );
  return value;
}
