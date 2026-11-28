import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { redactor, redactValue } from './redact.js';
export const EVENT_TYPES = [
  'run_start',
  'setup_start',
  'setup_result',
  'model_request',
  'model_response',
  'tool_intent',
  'tool_call',
  'sensor_result',
  'test_tamper',
  'oracle_result',
  'secret_gate',
  'approval_requested',
  'approval_decided',
  'policy_denied',
  'checkpoint',
  'state_transition',
  'run_end',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type RunEvent = {
  schema_version: 1;
  seq: number;
  timestamp: string;
  type: EventType;
  data: Record<string, unknown>;
};
export type RecordStore = { directory: string; clean: (text: string) => string };
export const LIMITATIONS =
  'Passing validation does not prove requirements were right, tests were sufficient, or code is secure.';
function noLink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error('Run storage cannot contain symlinks.');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
export function createRecord(
  root: string,
  id: string,
  options: Parameters<typeof redactor>[0] = {},
): RecordStore {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) throw new Error('Invalid run id.');
  let path = resolve(root);
  noLink(path);
  for (const part of ['.tuig', 'runs', id]) {
    path = join(path, part);
    noLink(path);
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  for (const name of ['events.jsonl', 'summary.json', 'diff.patch', 'tool-logs'])
    noLink(join(path, name));
  mkdirSync(join(path, 'tool-logs'), { recursive: true, mode: 0o700 });
  return { directory: path, clean: redactor(options) };
}
export function existingRecord(root: string, id: string): RecordStore {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) throw new Error('Invalid run id.');
  let path = resolve(root);
  noLink(path);
  for (const part of ['.tuig', 'runs', id]) {
    path = join(path, part);
    noLink(path);
    if (!existsSync(path)) throw new Error('Run does not exist.');
  }
  for (const name of ['events.jsonl', 'summary.json', 'diff.patch', 'tool-logs'])
    noLink(join(path, name));
  return { directory: path, clean: redactor() };
}
export function readRun(store: RecordStore): {
  events: RunEvent[];
  summary: unknown;
  diff: string;
  incompleteTail: boolean;
} {
  const path = join(store.directory, 'events.jsonl');
  noLink(path);
  const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const complete = content.endsWith('\n') || content.length === 0;
  const lines = content.split('\n');
  lines.pop();
  const events: RunEvent[] = lines.map((line, i) => {
    const event = JSON.parse(line) as RunEvent;
    if (
      event.schema_version !== 1 ||
      event.seq !== i ||
      !EVENT_TYPES.includes(event.type) ||
      !event.data ||
      typeof event.data !== 'object' ||
      Array.isArray(event.data)
    )
      throw new Error('Invalid durable event record.');
    return event;
  });
  const summary = join(store.directory, 'summary.json'),
    diff = join(store.directory, 'diff.patch');
  noLink(summary);
  noLink(diff);
  return {
    events,
    summary: existsSync(summary) ? JSON.parse(readFileSync(summary, 'utf8')) : null,
    diff: existsSync(diff) ? readFileSync(diff, 'utf8') : '',
    incompleteTail: !complete,
  };
}
export function appendEvent(
  store: RecordStore,
  type: EventType,
  data: Record<string, unknown>,
): RunEvent {
  if (!EVENT_TYPES.includes(type)) throw new Error('Unknown event type.');
  const current = readRun(store);
  if (current.incompleteTail) throw new Error('Cannot append after an incomplete crash tail.');
  const event = redactValue(
    {
      schema_version: 1,
      seq: current.events.length,
      timestamp: new Date().toISOString(),
      type,
      data,
    },
    store.clean,
  ) as RunEvent;
  const path = join(store.directory, 'events.jsonl');
  noLink(path);
  const fd = openSync(path, 'a', 0o600);
  try {
    const bytes = Buffer.from(JSON.stringify(event) + '\n');
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return event;
}
export function writeArtifact(store: RecordStore, name: string, content: string): string {
  if (!/^(diff\.patch|tool-logs\/[A-Za-z0-9_-]+\.log)$/.test(name))
    throw new Error('Invalid artifact path.');
  const file = join(store.directory, name);
  noLink(join(store.directory, 'tool-logs'));
  noLink(file);
  writeFileSync(file, store.clean(content), { mode: 0o600 });
  return name;
}
export function readArtifact(store: RecordStore, name: string): string {
  if (!/^(diff\.patch|tool-logs\/[A-Za-z0-9_-]+\.log)$/.test(name))
    throw new Error('Invalid artifact path.');
  noLink(join(store.directory, 'tool-logs'));
  noLink(join(store.directory, name));
  return readFileSync(join(store.directory, name), 'utf8');
}
export function writeSummary(store: RecordStore, data: Record<string, unknown>): void {
  const value = redactValue(
    { ...data, schema_version: 1, limitations: LIMITATIONS, claims: data.claims ?? [] },
    store.clean,
  );
  const file = join(store.directory, 'summary.json');
  noLink(file);
  const temp = file + '.' + randomUUID() + '.tmp';
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
}
