import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv from 'ajv';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { runCommand } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';
import { actionEntry, stuckDetector } from '../dist/runner/stuck.js';

const posix = process.platform !== 'win32';
const usage = { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 };
const validEvent = new Ajv().compile(
  JSON.parse(readFileSync('schemas/events.schema.json', 'utf8')),
);
const call = (id, name, args) => ({ id, name, arguments: args });
const read = (id, path) => call(id, 'read_file', { path });

/** Trusted repository with a replay agent; each step is a list of tool calls ([] means a tool-less reply). */
function fixture(t, steps, { check, allowed = [], kind } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-resume-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'state'), TUIG_OUTPUT: 'json' };
  delete env.CI;
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME;
  t.after(() => {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = old;
  });
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  };
  git(['init', '-q']);
  writeFileSync(join(repo, 'a.txt'), 'alpha\n');
  writeFileSync(join(repo, 'b.txt'), 'beta\n');
  writeFileSync(join(repo, '.gitignore'), 'resume.marker\n');
  initialize(repo);
  const configPath = join(repo, '.tuig/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.models = { ...config.models, adapter: 'replay', replayFile: 'responses.jsonl' };
  const checkArgv = check ?? [process.execPath, '-e', 'process.exit(0)'];
  config.policy = { allowedCommands: [...allowed, checkArgv] };
  writeFileSync(configPath, JSON.stringify(config));
  const responses = [
    ...steps.map((toolCalls) => ({
      message: toolCalls.length ? null : 'I think it is done.',
      toolCalls,
      usage,
      stopReason: toolCalls.length ? 'tool_calls' : 'stop',
    })),
    { message: 'done', toolCalls: [], usage, stopReason: 'stop' },
  ];
  writeFileSync(
    join(repo, 'responses.jsonl'),
    responses
      .map((response, step) =>
        JSON.stringify({
          schema_version: 1,
          seq: step,
          timestamp: '',
          type: 'model_response',
          data: { step, response },
        }),
      )
      .join('\n') + '\n',
  );
  writeFileSync(
    join(repo, '.tuig/checks.json'),
    JSON.stringify({
      schema_version: 1,
      checks: [{ name: 'visible', argv: checkArgv, timeoutSec: 20, ...(kind ? { kind } : {}) }],
    }),
  );
  git(['add', '.']);
  git([
    '-c',
    'user.name=T',
    '-c',
    'user.email=t@e.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'f',
  ]);
  trustRepository(repo);
  return { root, repo, env };
}
const events = (repo, id) => readRun(createRecord(repo, id)).events;

test('detector: thresholds trigger only on consecutive patterns', () => {
  const a = actionEntry('read_file', { path: 'a' }, 'ok', 'A');
  const b = actionEntry('read_file', { path: 'b' }, 'ok', 'B');
  const err = actionEntry('read_file', { path: 'x' }, 'policy_denied', 'missing');
  const feed = (entries) => {
    const detect = stuckDetector();
    return entries.map((entry) => detect(entry)).findIndex(Boolean);
  };
  assert.equal(feed([a, a, a, a]), 3);
  assert.equal(feed([a, a, b, a, a]), -1, 'interrupted repeats are not stuck');
  assert.equal(feed([err, err, err]), 2);
  assert.equal(feed([{ kind: 'message' }, { kind: 'message' }, { kind: 'message' }]), 2);
  assert.equal(feed([{ kind: 'message' }, a, { kind: 'message' }, { kind: 'message' }]), -1);
  assert.equal(feed([a, b, a, b, a, b]), 5);
  assert.equal(feed([a, b, a, b, a]), -1);
  // Log paths differ per call but do not make observations distinct.
  const logged = (n) =>
    actionEntry(
      'run',
      { argv: ['x'] },
      'ok',
      'out [truncated; full log: tool-logs/call-' + n + '.log]',
    );
  assert.equal(feed([logged(1), logged(2), logged(3), logged(4)]), 3);
});

test('replayed loops of each stuck pattern end in STUCK and replay identically', async (t) => {
  const failing = [process.execPath, '-e', 'process.exit(1)'];
  const cases = [
    [
      'repeat',
      Array.from({ length: 4 }, (_, i) => [read('r' + i, 'a.txt')]),
      {},
      /same observation 4/,
    ],
    [
      'error',
      Array.from({ length: 3 }, (_, i) => [read('e' + i, 'missing.txt')]),
      {},
      /same error 3/,
    ],
    ['monologue', [[], [], []], { check: failing, kind: 'repair' }, /without tool calls 3/],
    [
      'ping-pong',
      Array.from({ length: 6 }, (_, i) => [read('p' + i, i % 2 ? 'b.txt' : 'a.txt')]),
      {},
      /alternating for 6/,
    ],
  ];
  for (const [name, steps, options, reason] of cases) {
    const f = fixture(t, steps, options);
    const r = await runCommand({
      cwd: f.repo,
      platform: 'linux',
      instruction: 'Loop.',
      interactive: false,
    });
    assert.equal(r.data.state, 'STUCK', name + ': ' + JSON.stringify(r.data));
    assert.match(r.data.reason, reason, name);
    const replay = await replayRun(r.data.id, f.repo);
    assert.equal(replay.status, 'ok', name + ' ' + JSON.stringify(replay.error));
    assert.equal(replay.data.verified, true, name);
    assert.equal(replay.data.state, 'STUCK', name);
  }
});

/** Steps for the side-effect fixture: turn 0 appends A, turn 1 appends B then blocks until resumed. */
function sideEffects() {
  const appendA = ['/bin/sh', '-c', 'echo A >> log.txt'];
  const appendB = ['/bin/sh', '-c', 'echo B >> log.txt; [ -e resume.marker ] || sleep 987680'];
  const check = [
    process.execPath,
    '-e',
    'process.exit(require("fs").readFileSync("log.txt","utf8") === "A\\nB\\n" ? 0 : 1)',
  ];
  return {
    steps: [
      [call('a', 'run', { argv: appendA, cwd: '.', timeoutMs: 60000 })],
      [call('b', 'run', { argv: appendB, cwd: '.', timeoutMs: 60000 })],
    ],
    options: { check, allowed: [appendA, appendB] },
  };
}

function cli(f, args) {
  const child = spawn(process.execPath, [resolve('dist/main.js'), ...args], {
    cwd: f.repo,
    env: f.env,
  });
  let stdout = '';
  child.stdout.on('data', (data) => (stdout += data));
  child.stderr.on('data', () => {});
  const done = new Promise((settle) =>
    child.on('close', (code, signal) => settle({ code, signal, stdout })),
  );
  return { child, done };
}

/** Wait until the in-flight call b has started and already appended B. */
async function untilInFlight(f) {
  for (let i = 0; i < 300; i++) {
    const runs = existsSync(join(f.repo, '.tuig/runs'))
      ? readdirSync(join(f.repo, '.tuig/runs'))
      : [];
    if (runs.length === 1) {
      const id = runs[0];
      const log = join(f.repo, '.tuig/temp/worktrees', id, 'log.txt');
      if (
        events(f.repo, id).some((e) => e.type === 'tool_intent' && e.data.id === 'b') &&
        existsSync(log) &&
        readFileSync(log, 'utf8').includes('B')
      )
        return id;
    }
    await new Promise((settle) => setTimeout(settle, 100));
  }
  throw new Error('tool b never started');
}

async function resumeAndVerify(t, f, id, previous) {
  const worktree = join(f.repo, '.tuig/temp/worktrees', id);
  assert.equal(
    readFileSync(join(worktree, 'log.txt'), 'utf8'),
    'A\nB\n',
    'interrupted state should include the in-flight effect',
  );
  writeFileSync(join(worktree, 'resume.marker'), '');
  const resumed = await cli(f, ['run', '--resume', id]).done;
  assert.equal(resumed.code, 0, resumed.stdout);
  const result = JSON.parse(resumed.stdout);
  assert.equal(result.data.state, 'SUCCEEDED');
  // The in-flight call ran once in total: rolled back with its checkpoint, then re-proposed.
  assert.equal(readFileSync(join(worktree, 'log.txt'), 'utf8'), 'A\nB\n');
  const next = result.data.id;
  const old = readRun(createRecord(f.repo, id));
  assert.equal(old.summary.resumedAs, next);
  assert.equal(old.summary.state, previous);
  const fresh = events(f.repo, next);
  assert.ok(fresh.every((e) => validEvent(e)));
  assert.deepEqual(
    fresh.map((e) => e.seq),
    fresh.map((_, i) => i),
  );
  const start = fresh.find((e) => e.type === 'run_start').data;
  assert.equal(start.resume.from, id);
  assert.equal(start.resume.turn, 1);
  assert.equal(start.resume.previous, previous);
  assert.deepEqual(
    start.resume.discarded.map((d) => [d.id, d.outcome]),
    [['b', previous === 'CANCELLED' ? 'cancelled' : 'in-flight']],
  );
  assert.equal(start.resume.totals.toolCalls, 1);
  // Turn 0 is never re-run; turn 1 is re-proposed by the model and runs exactly once.
  assert.deepEqual(
    fresh.filter((e) => e.type === 'tool_call').map((e) => e.data.id),
    ['b'],
  );
  assert.equal(fresh.at(-1).type, 'run_end');
  assert.equal(readRun(createRecord(f.repo, next)).summary.resumedFrom, id);
  const replay = await replayRun(next, f.repo);
  assert.equal(replay.status, 'ok', JSON.stringify(replay.error));
  assert.equal(replay.data.verified, true);
  // A resumed run cannot be resumed again, and a finished one cannot be resumed.
  for (const target of [id, next]) {
    const again = await runCommand({
      cwd: f.repo,
      platform: 'linux',
      resume: target,
      interactive: false,
    });
    assert.equal(again.error?.code, 'TUIG_E_RESUME', target);
  }
}

test(
  'SIGKILL mid-tool after step k, then --resume, completes with no duplicated side effects',
  { skip: !posix, timeout: 120000 },
  async (t) => {
    t.after(() => spawnSync('pkill', ['-f', '^sleep 987680$']));
    const { steps, options } = sideEffects();
    const f = fixture(t, steps, options);
    const { child, done } = cli(f, ['run', '--instruction', 'Append A then B.']);
    const id = await untilInFlight(f);
    child.kill('SIGKILL');
    assert.equal((await done).signal, 'SIGKILL');
    const crashed = readRun(createRecord(f.repo, id));
    assert.equal(
      crashed.events.some((e) => e.type === 'run_end'),
      false,
    );
    await resumeAndVerify(t, f, id, 'INTERRUPTED');
  },
);

test(
  'Ctrl-C mid-run gives CANCELLED with the worktree intact, and --resume completes the task',
  { skip: !posix, timeout: 120000 },
  async (t) => {
    t.after(() => spawnSync('pkill', ['-f', '^sleep 987680$']));
    const { steps, options } = sideEffects();
    const f = fixture(t, steps, options);
    const { child, done } = cli(f, ['run', '--instruction', 'Append A then B.']);
    const id = await untilInFlight(f);
    child.kill('SIGINT');
    const cancelled = await done;
    assert.equal(JSON.parse(cancelled.stdout).data.state, 'CANCELLED', cancelled.stdout);
    assert.ok(
      existsSync(join(f.repo, '.tuig/temp/worktrees', id, 'log.txt')),
      'worktree was not kept',
    );
    await resumeAndVerify(t, f, id, 'CANCELLED');
  },
);
