import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anthropicAdapter, normalizeAnthropic } from '../dist/runner/adapter/anthropic.js';
import { control } from '../dist/runner/controller.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { assemble, wireMessage } from '../dist/runner/context.js';
const prices = { input: 4, cached: 0.2, output: 20, cacheWrite5m: 5, cacheWrite1h: 8 };
const usage = {
  input_tokens: 100,
  output_tokens: 10,
  cache_read_input_tokens: 20,
  cache_creation_input_tokens: 50,
  cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 20 },
};
const content = [
  { type: 'thinking', thinking: '', signature: 'opaque-signature-keep-exactly' },
  { type: 'tool_use', id: 'native-1', name: 'read_file', input: { path: 'a.txt' } },
];
async function server(t, handler) {
  const s = createServer(handler);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => {
    s.closeAllConnections();
    s.close();
  });
  return 'http://127.0.0.1:' + s.address().port + '/v1/messages';
}
const config = (baseURL) => ({
  baseURL,
  model: 'claude-opus-5-5',
  prices: { 'claude-opus-5-5': prices },
  allowedEndpoints: [],
});
test('native usage includes reads/writes in total input and charges each category once', () => {
  const result = normalizeAnthropic({ content, stop_reason: 'tool_use', usage }, prices);
  assert.equal(result.usage.input, 170);
  assert.equal(result.usage.cached, 20);
  assert.equal(result.usage.cacheWrite5m, 30);
  assert.equal(result.usage.cacheWrite1h, 20);
  assert.equal(result.usage.output, 10);
  assert.equal(result.usage.reasoningKnown, false);
  assert.equal(result.usage.cost, 0.000914);
  assert.deepEqual(result.providerContent, content);
  const known = normalizeAnthropic(
    { content, stop_reason: 'tool_use', usage: { ...usage, reasoning_tokens: 5 } },
    prices,
  );
  assert.equal(known.usage.reasoning, 5);
  assert.equal(known.usage.cost, result.usage.cost);
});
test('signed thinking survives controller/context/tool loop unchanged with native request schema', async (t) => {
  const bodies = [];
  const headers = [];
  const key = 'native-credential-value';
  const url = await server(t, (req, res) => {
    let text = '';
    req.on('data', (d) => (text += d));
    req.on('end', () => {
      bodies.push(JSON.parse(text));
      headers.push(req.headers);
      res.end(
        JSON.stringify({
          content: bodies.length === 1 ? content : [{ type: 'text', text: 'done' }],
          stop_reason: bodies.length === 1 ? 'tool_use' : 'end_turn',
          usage,
        }),
      );
    });
  });
  const root = mkdtempSync(join(tmpdir(), 'tuig-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'a.txt'), 'fixture data');
  const store = createRecord(root, 'native', { env: { CUSTOM: key }, sensitiveEnv: ['CUSTOM'] });
  const result = await control({
    root,
    store,
    adapter: anthropicAdapter({ ...config(url), apiKeyEnv: 'CUSTOM' }, { CUSTOM: key }),
    messages: [],
    context: { agents: 'repo data', instruction: 'Read the fixture.' },
    handleSIGINT: false,
    validate: async () => ({ checks: [{ name: 'visible', passed: true }] }),
  });
  assert.equal(result.state, 'SUCCEEDED');
  assert.equal(headers[0]['x-api-key'], key);
  assert.equal(headers[0]['anthropic-version'], '2023-06-01');
  assert.equal(bodies[0].model, 'claude-opus-5-5');
  assert.equal(bodies[0].output_config.effort, 'medium');
  assert.equal(bodies[0].max_tokens, 8192);
  assert.equal(bodies[0].tools[0].input_schema.type, 'object');
  assert.equal(Object.hasOwn(bodies[0], 'thinking'), false);
  assert.equal(Object.hasOwn(bodies[0], 'tool_choice'), false);
  assert.deepEqual(bodies[1].messages[1].content, content);
  assert.equal(bodies[1].messages[2].content[0].tool_use_id, 'native-1');
  assert.deepEqual(bodies[1].messages.slice(0, 1), bodies[0].messages);
  assert.equal(bodies[1].system, bodies[0].system);
  assert.equal(result.totals.cacheWrite5m, 60);
  assert.equal(result.totals.reasoningKnown, false);
  assert.equal(readFileSync(join(store.directory, 'events.jsonl'), 'utf8').includes(key), false);
  assert.equal(readRun(store).events[0].data.historyMode, 'append-only');
});
test('native append-only context preserves older observations and provider blocks', () => {
  const conversation = Array.from({ length: 20 }, (_, i) => [
    {
      role: 'assistant',
      content: null,
      providerContent: content,
      tool_calls: [
        {
          id: 'native-' + i,
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
        },
      ],
    },
    {
      role: 'tool',
      content: 'old-' + i,
      log: 'tool-logs/' + i + '.log',
      tool_call_id: 'native-' + i,
    },
  ]).flat();
  const messages = assemble({
    agents: 'data',
    instruction: 'task',
    conversation,
    preserveHistory: true,
  });
  assert.equal(
    messages.some((m) => m.content?.includes('Older observation masked')),
    false,
  );
  assert.deepEqual(messages[2].providerContent, content);
  assert.equal(Object.hasOwn(wireMessage(messages[2], false), 'providerContent'), false);
});
test('native malformed usage/blocks fail and cache creation cannot be silently unpriced', () => {
  for (const value of [
    { content: [{ type: 'thinking', thinking: '' }], stop_reason: 'end_turn', usage },
    { content, stop_reason: 'tool_use', usage: { ...usage, input_tokens: -1 } },
    { content, stop_reason: 'tool_use', usage: { ...usage, cache_creation_input_tokens: 51 } },
  ])
    assert.throws(
      () => normalizeAnthropic(value, prices),
      (e) => e.code === 'TUIG_E_MODEL_FORMAT',
    );
  assert.throws(
    () =>
      normalizeAnthropic(
        { content, stop_reason: 'tool_use', usage },
        { input: 4, cached: 0.2, output: 20 },
      ),
    (e) => e.code === 'TUIG_E_CONFIG',
  );
  assert.throws(() =>
    anthropicAdapter(
      {
        ...config('https://api.anthropic.com/v1/messages'),
        allowedEndpoints: ['https://api.anthropic.com/v1/messages'],
        apiKeyEnv: 'MISSING',
      },
      {},
    ),
  );
  assert.throws(
    () => anthropicAdapter(config('https://api.anthropic.com/v1/messages')),
    (e) => e.code === 'TUIG_E_EGRESS_DENIED',
  );
});
test('native redirects/errors/timeouts/cancellation are bounded without leaking response bodies', async (t) => {
  let reached = 0;
  const target = await server(t, (_q, r) => {
    reached++;
    r.end('{}');
  });
  const redirect = await server(t, (_q, r) => {
    r.writeHead(302, { location: target });
    r.end();
  });
  await assert.rejects(
    () =>
      anthropicAdapter(config(redirect)).complete({
        step: 0,
        messages: [{ role: 'user', content: 'test' }],
      }),
    (e) => e.code === 'TUIG_E_MODEL_HTTP',
  );
  assert.equal(reached, 0);
  const denied = await server(t, (_q, r) => {
    r.writeHead(401);
    r.end('private error body');
  });
  await assert.rejects(
    () =>
      anthropicAdapter(config(denied)).complete({
        step: 0,
        messages: [{ role: 'user', content: 'test' }],
      }),
    (e) => e.code === 'TUIG_E_MODEL_HTTP' && !e.message.includes('private'),
  );
  const slow = await server(t, () => {});
  await assert.rejects(
    () =>
      anthropicAdapter({ ...config(slow), timeoutMs: 20 }).complete({
        step: 0,
        messages: [{ role: 'user', content: 'test' }],
      }),
    /timed out/,
  );
  const signal = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(
    () =>
      anthropicAdapter(config(slow)).complete({
        step: 0,
        messages: [{ role: 'user', content: 'test' }],
        signal,
      }),
    /cancelled/,
  );
});
