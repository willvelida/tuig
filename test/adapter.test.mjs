import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAIAdapter, endpointPolicy, normalize } from '../dist/runner/adapter/openai-compat.js';
import { replayAdapter } from '../dist/runner/adapter/replay.js';
import { recordingAdapter } from '../dist/runner/adapter/recording.js';
import { createRecord, readRun } from '../dist/engine/record.js';
const prices = { input: 1, cached: 0.5, output: 2 };
const payload = () => ({
  choices: [
    {
      message: {
        content: 'hello',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"money.py"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    prompt_tokens_details: { cached_tokens: 20 },
    completion_tokens_details: { reasoning_tokens: 10 },
  },
});
async function server(t, handler) {
  const s = createServer(handler);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => {
    s.closeAllConnections();
    s.close();
  });
  return 'http://127.0.0.1:' + s.address().port + '/v1';
}
function config(baseURL) {
  return {
    baseURL,
    model: 'fixture-model',
    allowedEndpoints: [],
    prices: { 'fixture-model': prices },
  };
}
test('local compatible request, normalized usage/cost, secret-safe record and deterministic replay', async (t) => {
  const key = 'custom-private-value';
  let received;
  const url = await server(t, (req, res) => {
    let data = '';
    req.on('data', (s) => (data += s));
    req.on('end', () => {
      received = { url: req.url, headers: req.headers, body: JSON.parse(data) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload()));
    });
  });
  const root = mkdtempSync(join(tmpdir(), 'tuig-adapter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createRecord(root, 'run', { env: { UNUSUAL: key }, sensitiveEnv: ['UNUSUAL'] });
  const adapter = recordingAdapter(
    openAIAdapter({ ...config(url), apiKeyEnv: 'UNUSUAL' }, { UNUSUAL: key }),
    store,
  );
  const request = {
    step: 0,
    messages: [{ role: 'user', content: 'hello ' + key }],
    tools: [
      {
        type: 'function',
        function: { name: 'read_file', description: 'read', parameters: { type: 'object' } },
      },
    ],
  };
  const response = await adapter.complete(request);
  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.headers.authorization, 'Bearer ' + key);
  assert.equal(received.body.model, 'fixture-model');
  assert.equal(received.body.stream, false);
  assert.equal(received.body.tools[0].function.name, 'read_file');
  assert.deepEqual(response.toolCalls, [
    { id: 'call-1', name: 'read_file', arguments: { path: 'money.py' } },
  ]);
  assert.deepEqual(response.usage, {
    input: 100,
    cached: 20,
    output: 50,
    reasoning: 10,
    cost: 0.00019,
  });
  assert.equal(readFileSync(join(store.directory, 'events.jsonl'), 'utf8').includes(key), false);
  const replay = replayAdapter(readRun(store).events);
  assert.deepEqual(await replay.complete(request), response);
  const mutated = await replay.complete(request);
  mutated.toolCalls[0].name = 'changed';
  assert.deepEqual(await replay.complete(request), response);
  await assert.rejects(
    () => replay.complete({ ...request, step: 1 }),
    (e) => e.code === 'TUIG_E_REPLAY',
  );
});
test('egress denies all unlisted nonlocal hosts and accepts only exact endpoint matches', () => {
  for (const base of [
    'https://example.invalid/v1',
    'https://localhost.example.invalid/v1',
    'https://127.0.0.1.example.invalid/v1',
  ])
    assert.throws(
      () => endpointPolicy(base, []),
      (e) => e.code === 'TUIG_E_EGRESS_DENIED' && !!e.fix,
    );
  assert.equal(
    endpointPolicy('https://example.invalid/v1/', ['https://example.invalid/v1']).hostname,
    'example.invalid',
  );
  assert.throws(() =>
    endpointPolicy('https://example.invalid/other', ['https://example.invalid/v1']),
  );
  assert.equal(endpointPolicy('http://[::1]:123/v1', []).hostname, '[::1]');
  for (const bad of [
    'file:///tmp/model',
    'https://user:secret@example.invalid/v1',
    'https://example.invalid/v1?key=secret',
  ])
    assert.throws(() => endpointPolicy(bad, []));
});
test('configuration requires explicit model prices and env-var names, never literal keys', () => {
  assert.throws(() => openAIAdapter({ ...config('http://localhost:1/v1'), prices: {} }));
  assert.throws(() =>
    openAIAdapter({ ...config('http://localhost:1/v1'), apiKeyEnv: 'literal-secret-value' }, {}),
  );
  assert.throws(() =>
    openAIAdapter({ ...config('http://localhost:1/v1'), apiKeyEnv: 'MISSING' }, {}),
  );
});
test('malformed responses, nonfinite usage and inconsistent counts are rejected', () => {
  for (const mutate of [
    (v) => (v.choices = []),
    (v) => delete v.usage,
    (v) => (v.usage.prompt_tokens = -1),
    (v) => (v.usage.completion_tokens = Infinity),
    (v) => (v.usage.prompt_tokens_details.cached_tokens = 101),
    (v) => (v.choices[0].message.tool_calls[0].function.arguments = 'bad'),
    (v) => v.choices[0].message.tool_calls.push(v.choices[0].message.tool_calls[0]),
  ]) {
    const p = payload();
    mutate(p);
    assert.throws(
      () => normalize(p, prices),
      (e) => e.code === 'TUIG_E_MODEL_FORMAT',
    );
  }
});
test('redirects never forward credentials or follow to a different endpoint', async (t) => {
  let reached = 0;
  const target = await server(t, (_q, r) => {
    reached++;
    r.end(JSON.stringify(payload()));
  });
  const source = await server(t, (_q, r) => {
    r.writeHead(302, { location: target + '/chat/completions' });
    r.end();
  });
  await assert.rejects(
    () => openAIAdapter(config(source)).complete({ step: 0, messages: [] }),
    (e) => e.code === 'TUIG_E_MODEL_HTTP',
  );
  assert.equal(reached, 0);
});
test('HTTP errors do not echo server bodies; timeout and caller cancellation stop requests', async (t) => {
  const url = await server(t, (_q, r) => {
    r.writeHead(401);
    r.end('secret server body');
  });
  await assert.rejects(
    () => openAIAdapter(config(url)).complete({ step: 0, messages: [] }),
    (e) => e.code === 'TUIG_E_MODEL_HTTP' && !e.message.includes('secret'),
  );
  const slow = await server(t, () => {});
  await assert.rejects(
    () => openAIAdapter({ ...config(slow), timeoutMs: 25 }).complete({ step: 0, messages: [] }),
    /timed out/,
  );
  const abort = new AbortController();
  abort.abort(new Error('cancelled'));
  await assert.rejects(
    () => openAIAdapter(config(slow)).complete({ step: 0, messages: [], signal: abort.signal }),
    /cancelled/,
  );
});

test('tool-only compatible responses may omit content', () => {
  const p = payload();
  delete p.choices[0].message.content;
  assert.equal(normalize(p, prices).message, null);
});
