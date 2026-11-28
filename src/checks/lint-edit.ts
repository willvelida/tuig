import { matchesGlob } from 'node:path';
import type { Check } from './config.js';
import type { CheckResult } from './execute.js';
import type { Diagnostic } from './parsers.js';

/** Coverage is host-pinned; argv is never interpolated with model-supplied paths. */
export function lintChecks(checks: Check[], path: string): Check[] {
  return checks.filter(
    (check) =>
      check.kind === 'repair' &&
      ['eslint-json', 'ruff-json', 'tsc-text'].includes(check.parser) &&
      check.paths?.some((pattern) =>
        matchesGlob(path.replaceAll('\\', '/'), pattern.replaceAll('\\', '/')),
      ),
  );
}
export function lintUnavailable(results: CheckResult[]): boolean {
  return results.some(
    (result) =>
      !['ok', 'nonzero_exit'].includes(result.status) ||
      (result.status === 'nonzero_exit' && !result.diagnostics.some((d) => d.file !== null)) ||
      result.diagnostics.some((d) => d.message === 'Diagnostic list truncated after 1000 entries.'),
  );
}
/** Location shifts preserve identity; extra occurrences are new, warnings never block. */
export function newErrors(before: CheckResult[], after: CheckResult[]): Diagnostic[] {
  const identity = (d: Diagnostic): string =>
    JSON.stringify([d.tool, d.file, d.rule, d.severity, d.message]);
  const counts = new Map<string, number>();
  for (const result of before)
    for (const d of result.diagnostics) {
      if (d.severity !== 'error') continue;
      const key = identity(d);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const added: Diagnostic[] = [];
  for (const result of after)
    for (const d of result.diagnostics) {
      if (d.severity !== 'error') continue;
      const key = identity(d),
        count = counts.get(key) ?? 0;
      if (count) counts.set(key, count - 1);
      else added.push(d);
    }
  return added;
}
