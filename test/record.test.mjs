import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Ajv from 'ajv';
import {
  createRecord,
  appendEvent,
  readRun,
  writeSummary,
  writeArtifact,
  EVENT_TYPES,
  LIMITATIONS,
} from '../dist/engine/record.js';
import { redactor } from '../dist/engine/redact.js';
function fixture(t, options) {
  const root = mkdtempSync(join(tmpdir(), 'tuig-record-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, store: createRecord(root, 'run-1', options) };
}
const ajv = new Ajv({ strict: true });
const eventCheck = ajv.compile(JSON.parse(readFileSync('schemas/events.schema.json', 'utf8')));
const summaryCheck = ajv.compile(JSON.parse(readFileSync('schemas/summary.schema.json', 'utf8')));
test('all events validate; contiguous ordering, schema version and fixed summary limitations', (t) => {
  const { store } = fixture(t, { env: {} });
  for (const type of EVENT_TYPES) {
    const e = appendEvent(store, type, { example: 'data' });
    assert.ok(eventCheck(e), JSON.stringify(eventCheck.errors));
  }
  const run = readRun(store);
  assert.equal(run.events.length, EVENT_TYPES.length);
  assert.equal(run.incompleteTail, false);
  writeSummary(store, {
    state: 'SUCCEEDED',
    limitations: 'model claims secure',
    claims: [{ claim: 'check passed', grade: 'deterministic' }],
  });
  assert.ok(summaryCheck(readRun(store).summary));
  assert.equal(readRun(store).summary.limitations, LIMITATIONS);
});
test('fake secrets absent from every persisted file, including JSON keys, summaries, diffs and tool logs', (t) => {
  const secrets = [
    'sk-test-secretplanted',
    'AKIA1234567890ABCDEF',
    'custom-token-123',
    'literal with "quotes" and \n newline',
    'custom-api-env-value',
  ];
  const { store } = fixture(t, {
    env: { OPENAI_API_KEY: secrets[2], UNUSUAL_NAME: secrets[4] },
    sensitiveEnv: ['UNUSUAL_NAME'],
    literals: [secrets[3]],
  });
  const text = secrets.join(' ');
  appendEvent(store, 'model_response', { text, nested: [{ [secrets[2]]: text }] });
  writeSummary(store, { text });
  writeArtifact(store, 'diff.patch', text);
  writeArtifact(store, 'tool-logs/one.log', text);
  for (const e of readdirSync(store.directory, { recursive: true, withFileTypes: true }).filter(
    (e) => e.isFile(),
  )) {
    const content = readFileSync(join(e.parentPath, e.name), 'utf8');
    for (const secret of secrets) {
      assert.equal(content.includes(secret), false);
      assert.equal(content.includes(JSON.stringify(secret).slice(1, -1)), false);
    }
  }
  const event = readRun(store).events[0];
  assert.match(JSON.stringify(event), /REDACTED/);
  assert.equal(redactor({ env: {} })('Bearer exampletoken-123'), 'Bearer [REDACTED]');
});
test('abrupt killed writer leaves readable prefix and reports partial final line', async (t) => {
  const { root, store } = fixture(t, { env: {} });
  const url = pathToFileURL(resolve('dist/engine/record.js')).href;
  const script =
    'const m=await import(' +
    JSON.stringify(url) +
    ');const fs=await import("node:fs");const s=m.createRecord(' +
    JSON.stringify(root) +
    ',"run-1",{env:{}});m.appendEvent(s,"run_start",{});fs.appendFileSync(s.directory+"/events.jsonl",\'{"partial":\');process.send("ready");setInterval(()=>{},1000);';
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let error = '';
  child.stderr.on('data', (s) => (error += s));
  const ready = once(child, 'message');
  const exited = once(child, 'exit');
  await Promise.race([
    ready,
    exited.then(() => {
      throw Error('Writer exited early: ' + error);
    }),
  ]);
  child.kill('SIGKILL');
  await exited;
  const run = readRun(store);
  assert.equal(run.events.length, 1);
  assert.ok(eventCheck(run.events[0]));
  assert.equal(run.incompleteTail, true);
  assert.throws(() => appendEvent(store, 'run_end', {}), /incomplete/);
});
test('completed corruption and unsafe artifact names fail closed', (t) => {
  const { store } = fixture(t);
  appendEvent(store, 'run_start', {});
  appendFileSync(join(store.directory, 'events.jsonl'), 'bad JSON\n');
  assert.throws(() => readRun(store));
  assert.throws(() => writeArtifact(store, '../secret', 'x'));
  assert.throws(() => createRecord(store.directory, '../escape'));
});
