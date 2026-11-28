import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codedError } from '../cli/errors.js';

export const PARSERS = ['exit-code', 'junit', 'eslint-json', 'ruff-json', 'tsc-text'] as const;
export type Check = {
  name: string;
  argv: string[];
  kind: 'gate' | 'repair';
  parser: (typeof PARSERS)[number];
  timeoutSec: number;
  paths?: string[];
  reportPath?: string;
};
export const relativePath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('\0') &&
  !/^(?:[a-z]:|[\\/])/i.test(value) &&
  !value.split(/[\\/]/).some((part) => part === '..');

/** Version 1 defaults preserve the original acceptance-check contract. */
export function parseChecks(value: unknown): Check[] {
  const invalid = (): never => {
    throw codedError('TUIG_E_CONFIG');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const config = value as Record<string, unknown>;
  if (config.schema_version !== 1 || !Array.isArray(config.checks)) return invalid();
  const names = new Set<string>();
  return config.checks.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid();
    const check = entry as Record<string, unknown>;
    const { name, argv, paths, reportPath } = check;
    const kind = check.kind === undefined ? 'gate' : check.kind,
      parser = check.parser === undefined ? 'exit-code' : check.parser,
      timeoutSec = check.timeoutSec === undefined ? 10 : check.timeoutSec;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      names.has(name) ||
      !Array.isArray(argv) ||
      !argv.length ||
      argv.length > 100 ||
      !argv.every(
        (arg: unknown) => typeof arg === 'string' && arg.length > 0 && !arg.includes('\0'),
      ) ||
      !['gate', 'repair'].includes(String(kind)) ||
      !(PARSERS as readonly unknown[]).includes(parser) ||
      typeof timeoutSec !== 'number' ||
      !Number.isFinite(timeoutSec) ||
      timeoutSec <= 0 ||
      timeoutSec > 60 ||
      (paths !== undefined && (!Array.isArray(paths) || !paths.every(relativePath))) ||
      (parser === 'junit' ? !relativePath(reportPath) : reportPath !== undefined)
    )
      return invalid();
    names.add(name);
    return {
      name,
      argv: [...argv] as string[],
      kind: kind as Check['kind'],
      parser: parser as Check['parser'],
      timeoutSec,
      ...(paths === undefined ? {} : { paths: [...paths] as string[] }),
      ...(reportPath === undefined ? {} : { reportPath: reportPath as string }),
    };
  });
}
export function loadChecks(root: string): Check[] {
  return parseChecks(JSON.parse(readFileSync(join(root, '.tuig/checks.json'), 'utf8')));
}
