import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Ajv from 'ajv';
import { control } from '../dist/runner/controller.js';
import { transition, STATES, EVENTS, TERMINAL } from '../dist/runner/states.js';
import { budgets, DEFAULT_BUDGETS } from '../dist/runner/budgets.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { replayAdapter } from '../dist/runner/adapter/replay.js';
const zero = { input: 0, cached: 0, output: 0, reasoning: 0, cost: 0 };
const answer = (calls = [], usage = zero) => ({
  message: 'done',
  toolCalls: calls,
  usage,
  stopReason: calls.length ? 'tool_calls' : 'stop',
});
const call = (name, args, id = 'one') => ({ id, name, arguments: args });
function events(responses) {
  return responses.map((response, step) => ({
    schema_version: 1,
    seq: step,
    timestamp: new Date().toISOString(),
    type: 'model_response',
    data: { step, response },
  }));
}
function fixture(t, responses) {
  const root = mkdtempSync(join(tmpdir(), 'tuig-controller-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'a.txt'), 'data');
  const store = createRecord(root, 'run', { env: {} });
  return {
    root,
    workspace,
    store,
    options: {
      root: workspace,
      store,
      adapter: replayAdapter(events(responses)),
      messages: [{ role: 'user', content: 'test' }],
      validate: async () => ({ checks: [{ name: 'acceptance', passed: true }] }),
      handleSIGINT: false,
    },
  };
}
test('every state/event pair is exhaustively accepted or rejected', () => {
  const expected = {
    PENDING: { start: 'RUNNING' },
    RUNNING: { request_approval: 'AWAITING_APPROVAL', pause: 'PAUSED', validate: 'VALIDATING' },
    AWAITING_APPROVAL: { approve: 'RUNNING', deny: 'RUNNING', pause: 'PAUSED' },
    PAUSED: { resume: 'RUNNING' },
    VALIDATING: { repair: 'REPAIRING', succeed: 'SUCCEEDED', fail: 'FAILED_VALIDATION' },
    REPAIRING: { request_approval: 'AWAITING_APPROVAL', pause: 'PAUSED', validate: 'VALIDATING' },
  };
  const exits = {
    abort: 'ABORTED_BY_AGENT',
    budget: 'BUDGET_EXCEEDED',
    stuck: 'STUCK',
    cancel: 'CANCELLED',
    error: 'ERROR',
  };
  for (const state of STATES)
    for (const event of EVENTS) {
      const next = TERMINAL.has(state) ? undefined : (expected[state]?.[event] ?? exits[event]);
      if (next) assert.equal(transition(state, event), next);
      else assert.throws(() => transition(state, event));
    }
  assert.deepEqual(budgets(), DEFAULT_BUDGETS);
  for (const invalid of [
    { requests: -1 },
    { cost: Infinity },
    { tokens: NaN },
    { formatErrors: 0 },
  ])
    assert.throws(() => budgets(invalid));
});
test('all terminal states reachable with replay, and run_end/summary match host state', async (t) => {
  const cases = [
    ['SUCCEEDED', [answer()], {}],
    [
      'FAILED_VALIDATION',
      // Each repair attempt does some work first; tool-less replies in a row are a monologue.
      Array.from({ length: 4 }, () => [
        answer([call('read_file', { path: 'a.txt' })]),
        answer(),
      ]).flat(),
      { validate: async () => ({ checks: [{ name: 'test', passed: false }] }) },
    ],
    ['ABORTED_BY_AGENT', [answer([call('abort_with_reason', { reason: 'impossible' })])], {}],
    ['BUDGET_EXCEEDED', [], { limits: { requests: 0 } }],
    ['STUCK', Array.from({ length: 4 }, () => answer([call('read_file', { path: 'a.txt' })])), {}],
    ['CANCELLED', [], { signal: AbortSignal.abort() }],
    ['ERROR', [], {}],
  ];
  const check = new Ajv().compile(JSON.parse(readFileSync('schemas/events.schema.json', 'utf8')));
  for (const [expected, responses, extra] of cases) {
    const f = fixture(t, responses);
    const result = await control({ ...f.options, ...extra });
    assert.equal(result.state, expected);
    const run = readRun(f.store);
    assert.equal(run.summary.state, expected);
    assert.equal(run.events.at(-1).data.state, expected);
    assert.ok(run.events.every((e) => check(e)));
  }
});
test('request/tool budgets preflight; token and cost budgets apply before tool actions', async (t) => {
  const tool = call('edit', { path: 'a.txt', search: 'data', replace: 'bad' });
  const cases = [
    ['requests', [], { requests: 0 }],
    ['tool_calls', [answer([tool])], { toolCalls: 0 }],
    ['tokens', [answer([tool], { ...zero, input: 11 })], { tokens: 10 }],
    ['cost', [answer([tool], { ...zero, cost: 11 })], { cost: 10 }],
    ['wall', [], { wallSeconds: 0 }],
  ];
  for (const [reason, responses, limits] of cases) {
    const f = fixture(t, responses);
    const result = await control({ ...f.options, limits });
    assert.equal(result.state, 'BUDGET_EXCEEDED');
    assert.equal(result.reason, reason);
    assert.equal(readFileSync(join(f.workspace, 'a.txt'), 'utf8'), 'data');
    assert.equal(
      readRun(f.store).events.some((e) => e.type === 'tool_call'),
      false,
    );
  }
});
test('entire oversized tool batch is refused before even the first edit', async (t) => {
  const calls = [
    call('edit', { path: 'a.txt', search: 'data', replace: 'new' }, 'a'),
    call('read_file', { path: 'a.txt' }, 'b'),
  ];
  const f = fixture(t, [answer(calls)]);
  const result = await control({ ...f.options, limits: { toolCalls: 1 } });
  assert.equal(result.reason, 'tool_calls');
  assert.equal(readFileSync(join(f.workspace, 'a.txt'), 'utf8'), 'data');
});
test('format errors terminate, repairs are bounded per check and globally, empty checks never pass', async (t) => {
  let f = fixture(
    t,
    Array.from({ length: 3 }, () => answer([call('edit', {})])),
  );
  assert.equal((await control(f.options)).state, 'ERROR');
  f = fixture(
    t,
    Array.from({ length: 10 }, () => [
      answer([call('read_file', { path: 'a.txt' })]),
      answer(),
    ]).flat(),
  );
  let i = 0;
  const result = await control({
    ...f.options,
    validate: async () => ({ checks: [{ name: 'check-' + i++, passed: false }] }),
  });
  assert.equal(result.state, 'FAILED_VALIDATION');
  assert.equal(result.totals.repairs, 6);
  f = fixture(t, [answer()]);
  assert.equal(
    (await control({ ...f.options, validate: async () => ({ checks: [] }) })).state,
    'FAILED_VALIDATION',
  );
});
test('cancellation after model response prevents tool execution', async (t) => {
  const f = fixture(t, [answer([call('edit', { path: 'a.txt', search: 'data', replace: 'bad' })])]);
  const abort = new AbortController();
  const replay = f.options.adapter;
  const result = await control({
    ...f.options,
    signal: abort.signal,
    adapter: {
      ...replay,
      complete: async (r) => {
        const value = await replay.complete(r);
        abort.abort();
        return value;
      },
    },
  });
  assert.equal(result.state, 'CANCELLED');
  assert.equal(readFileSync(join(f.workspace, 'a.txt'), 'utf8'), 'data');
});
test('SIGINT handler produces CANCELLED and a valid durable terminal record', async (t) => {
  const f = fixture(t, []);
  const controllerURL = pathToFileURL(resolve('dist/runner/controller.js')).href;
  const recordURL = pathToFileURL(resolve('dist/engine/record.js')).href;
  const replayURL = pathToFileURL(resolve('dist/runner/adapter/replay.js')).href;
  const code =
    'const {control}=await import(' +
    JSON.stringify(controllerURL) +
    ');const {createRecord}=await import(' +
    JSON.stringify(recordURL) +
    ');const {replayAdapter}=await import(' +
    JSON.stringify(replayURL) +
    ');const replay=replayAdapter(' +
    JSON.stringify(events([answer()])) +
    ');process.on("message",()=>process.emit("SIGINT"));const adapter={...replay,complete:async r=>{await replay.complete(r);process.send("ready");return await new Promise((_,reject)=>r.signal.addEventListener("abort",()=>reject(r.signal.reason),{once:true}));}};const result=await control({root:' +
    JSON.stringify(f.workspace) +
    ',store:createRecord(' +
    JSON.stringify(f.root) +
    ',"signal"),adapter,messages:[],validate:async()=>({checks:[]})});process.send(result.state);process.disconnect();';
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  t.after(() => child.kill());
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const exit = once(child, 'exit');
  await Promise.race([
    once(child, 'message'),
    exit.then(() => {
      throw Error(stderr);
    }),
  ]);
  const result = once(child, 'message');
  if (process.platform === 'win32') child.send('interrupt');
  else child.kill('SIGINT');
  assert.equal((await result)[0], 'CANCELLED');
  await exit;
  const run = readRun(createRecord(f.root, 'signal'));
  assert.equal(run.summary.state, 'CANCELLED');
  assert.equal(run.events.at(-1).data.state, 'CANCELLED');
});
