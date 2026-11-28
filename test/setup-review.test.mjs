import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { cleanupRun, runCommand } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';
import { existingRecord, readRun } from '../dist/engine/record.js';

const usage = { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 };
const node = (script) => [process.execPath, '-e', script];
const install =
  "const fs=require('node:fs');fs.mkdirSync('node_modules/dep/test',{recursive:true});fs.writeFileSync('node_modules/dep/test/a.test.js','original');";
function fixture(t, { setup = [], steps = [[]], check = node('0') } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tuig-setup-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(root, 'state');
  t.after(() => {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = old;
  });
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (args, cwd = repo) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(['init', '-q']);
  writeFileSync(join(repo, '.gitignore'), '.tuig/\nnode_modules/\n');
  writeFileSync(join(repo, 'trigger.test.js'), 'old\n');
  initialize(repo);
  const path = join(repo, '.tuig/config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.mode = 'ask';
  config.sandbox = 'off';
  config.secretGate = 'off';
  config.protectedTests = ['**/*.test.js'];
  config.models = { adapter: 'replay', allowedEndpoints: [], replayFile: 'responses.jsonl' };
  config.policy = {
    allowedCommands: [
      check,
      ...steps
        .flat()
        .filter((t) => t.name === 'run')
        .map((t) => t.arguments.argv),
    ],
  };
  writeFileSync(path, JSON.stringify(config));
  writeFileSync(
    join(repo, '.tuig/checks.json'),
    JSON.stringify({
      schema_version: 1,
      setup,
      checks: [{ name: 'visible', argv: check, timeoutSec: 10 }],
    }),
  );
  writeFileSync(
    join(repo, 'responses.jsonl'),
    steps
      .map((toolCalls, step) =>
        JSON.stringify({
          type: 'model_response',
          data: {
            step,
            response: {
              message: toolCalls.length ? null : 'done',
              toolCalls,
              usage,
              stopReason: toolCalls.length ? 'tool_calls' : 'stop',
            },
          },
        }),
      )
      .join('\n') + '\n',
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
    '-qm',
    'base',
  ]);
  trustRepository(repo);
  const run = (options = {}) =>
    runCommand({
      cwd: repo,
      platform: 'linux',
      instruction: 'Perform the recorded task.',
      interactive: false,
      ...options,
    });
  return { root, repo, git, run };
}
const dependency = { name: 'offline-install', argv: node(install), timeoutSec: 10 };
const record = (f, result) => readRun(existingRecord(f.repo, result.data.id));

test('setup review: dependency setup precedes baseline and permits success', async (t) => {
  const f = fixture(t, {
    setup: [
      dependency,
      {
        name: 'verify install',
        argv: node(
          "if(require('node:fs').readFileSync('node_modules/dep/test/a.test.js','utf8')!=='original')process.exit(8)",
        ),
      },
    ],
  });
  const result = await f.run();
  assert.equal(result.data.state, 'SUCCEEDED', JSON.stringify(result));
  const r = record(f, result);
  const start = r.events.find((e) => e.type === 'run_start');
  assert.ok(start.data.protectionBaseline.ignored['node_modules/dep/test/a.test.js']);
  assert.equal(result.data.setup?.status, 'pass');
  assert.equal(r.events.filter((e) => e.type === 'setup_result').length, 2);
  const setupEvents = r.events.filter((e) => e.type.startsWith('setup_'));
  assert.deepEqual(
    setupEvents.map((e) => e.type),
    ['setup_start', 'setup_result', 'setup_start', 'setup_result'],
  );
  assert.ok(r.events.find((e) => e.type === 'setup_result').seq < start.seq);
  assert.equal((await replayRun(result.data.id, f.repo)).data.verified, true);
});
for (const change of ['create', 'modify'])
  test('setup review: checks cannot ' + change + ' ignored tests after setup', async (t) => {
    const script =
      change === 'create'
        ? install
        : "require('node:fs').writeFileSync('node_modules/dep/test/a.test.js','changed')";
    const f = fixture(t, {
      setup: [{ name: 'install', argv: node(change === 'create' ? '0' : install) }],
      check: node(script),
    });
    const result = await f.run();
    assert.equal(result.data.state, 'FAILED_VALIDATION', JSON.stringify(result));
    assert.match(result.data.reason, /Protected test/);
    assert.equal(result.data.setup?.status, 'pass');
  });
for (const [name, script, timeoutSec, status] of [
  ['failure', 'process.exit(7)', 10, 'nonzero_exit'],
  ['timeout', 'setTimeout(()=>{},30000)', 0.1, 'timeout'],
])
  test('setup review: ' + name + ' is typed before model execution', async (t) => {
    const f = fixture(t, {
      setup: [
        { name, argv: node(script), timeoutSec },
        {
          name: 'must-not-run',
          argv: node("require('node:fs').writeFileSync('after-setup.marker','bad')"),
        },
      ],
    });
    const result = await f.run();
    assert.equal(result.data.state, 'ERROR', JSON.stringify(result));
    assert.equal(result.error?.code, 'TUIG_E_PREREQUISITE');
    assert.ok(result.next_action);
    const r = record(f, result);
    assert.equal(
      r.events.some((e) => e.type === 'model_request'),
      false,
    );
    assert.equal(result.data.setup.commands[0].status, status);
    assert.equal(result.data.setup.commands.length, 1);
    assert.equal(existsSync(join(result.data.worktree, 'after-setup.marker')), false);
    assert.equal((await replayRun(result.data.id, f.repo)).data.verified, true);
    assert.equal(cleanupRun(result.data.id, f.repo).status, 'ok');
  });
test('setup review: setup list is pinned and protected from agent edits', async (t) => {
  const seed =
    install +
    "require('node:fs').mkdirSync('.tuig',{recursive:true});require('node:fs').writeFileSync('.tuig/checks.json','original')";
  const tool = {
    id: 'alter',
    name: 'edit',
    arguments: { path: '.tuig/checks.json', search: 'original', replace: 'untrusted setup' },
  };
  const f = fixture(t, { setup: [{ name: 'seed', argv: node(seed) }], steps: [[tool], []] });
  const result = await f.run();
  assert.equal(result.data.state, 'SUCCEEDED', JSON.stringify(result));
  assert.equal(
    record(f, result).events.find((e) => e.type === 'tool_call').data.status,
    'policy_denied',
  );
  assert.equal(readFileSync(join(result.data.worktree, '.tuig/checks.json'), 'utf8'), 'original');
  assert.equal(result.data.setup.commands.length, 1);
});
test('setup review: cancellation is typed before model execution', async (t) => {
  const f = fixture(t, {
    setup: [{ name: 'slow', argv: node('setTimeout(()=>{},30000)'), timeoutSec: 60 }],
  });
  const abort = new AbortController();
  abort.abort();
  const result = await f.run({ signal: abort.signal });
  assert.equal(result.data.state, 'CANCELLED', JSON.stringify(result));
  assert.equal(result.data.setup?.status, 'cancelled');
  assert.ok(result.next_action);
  assert.equal(
    record(f, result).events.some((e) => e.type === 'model_request'),
    false,
  );
});
for (const setup of [
  null,
  {},
  [{ name: 'x', argv: [] }],
  [{ name: 'x', argv: node('0'), timeoutSec: 61 }],
  [{ name: 'x', argv: node('0'), timeoutSec: null }],
  [
    { name: 'x', argv: node('0') },
    { name: 'x', argv: node('0') },
  ],
])
  test('setup review: invalid trusted setup ' + JSON.stringify(setup), async (t) => {
    const f = fixture(t, { setup });
    const result = await f.run();
    assert.equal(result.error?.code, 'TUIG_E_CONFIG', JSON.stringify(result));
    assert.ok(result.next_action);
  });

async function interrupted(t, setup = []) {
  const agentInstall = install
    .replaceAll('dep/test/a.test.js', 'agent/test/b.test.js')
    .replaceAll('dep/test', 'agent/test');
  const create = {
    id: 'create',
    name: 'run',
    arguments: { argv: node(agentInstall), cwd: '.', timeoutMs: 10000 },
  };
  const edit = {
    id: 'pause',
    name: 'edit',
    arguments: { path: 'trigger.test.js', search: 'old', replace: 'new' },
  };
  const f = fixture(t, { setup, steps: [[create], [edit], []] });
  const first = await f.run({
    approver: (request) => {
      if (request.tool === 'edit') throw new Error('simulated approval interruption');
      return 'allow_once';
    },
  });
  assert.equal(
    readFileSync(join(first.data.worktree, 'node_modules/agent/test/b.test.js'), 'utf8'),
    'original',
  );
  const store = existingRecord(f.repo, first.data.id);
  const events = readRun(store).events;
  const pause = events.find(
    (e) => e.type === 'approval_requested' && e.data.request.tool === 'edit',
  );
  assert.ok(pause, 'reached approval boundary after ignored file creation');
  writeFileSync(
    join(store.directory, 'events.jsonl'),
    events
      .slice(0, pause.seq + 1)
      .map((e) => JSON.stringify(e))
      .join('\n') + '\n',
  );
  return { ...f, first, store };
}
test('resume review: original baseline still denies ignored creation before approval crash', async (t) => {
  const f = await interrupted(t);
  const result = await f.run({ resume: f.first.data.id });
  assert.equal(result.data.state, 'FAILED_VALIDATION', JSON.stringify(result));
  assert.match(result.data.reason, /Protected test/);
  assert.ok(
    record(f, result).events.some(
      (e) => e.type === 'test_tamper' && e.data.paths.includes('node_modules/agent/test/b.test.js'),
    ),
  );
});
for (const missing of ['missing', 'pre-hardening'])
  test('resume review: ' + missing + ' baseline refuses before model request', async (t) => {
    const f = await interrupted(t);
    const events = readRun(f.store).events;
    const start = events.find((e) => e.type === 'run_start');
    if (missing === 'missing') delete start.data.protectionBaseline;
    else start.data.protectionBaseline = { exclude: 'old', excludeHash: 'missing' };
    writeFileSync(
      join(f.store.directory, 'events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
    const result = await f.run({ resume: f.first.data.id });
    assert.equal(result.error?.code, 'TUIG_E_WORKSPACE', JSON.stringify(result));
    assert.match(result.error.message, /baseline/i);
    assert.ok(result.next_action);
    assert.equal(result.data.id, undefined);
  });
test('resume review: pinned Git directory is verified before checkpoint restoration', async (t) => {
  const f = await interrupted(t);
  const start = readRun(f.store).events.find((e) => e.type === 'run_start');
  const worktree = f.first.data.worktree;
  const ref = 'refs/heads/' + start.data.workspace.branch;
  f.git(['symbolic-ref', 'HEAD', ref]);
  const original = f.git(['rev-parse', ref]);
  const advanced = f.git([
    '-c',
    'user.name=T',
    '-c',
    'user.email=t@e.invalid',
    'commit-tree',
    f.git(['rev-parse', original + '^{tree}']),
    '-p',
    original,
    '-m',
    'human advance before resume',
  ]);
  f.git(['update-ref', ref, advanced]);
  rmSync(join(worktree, '.git'));
  writeFileSync(join(worktree, '.git'), 'gitdir: ' + join(f.repo, '.git') + '\n');
  const before = f.git(['rev-parse', ref]);
  const result = await f.run({ resume: f.first.data.id });
  assert.equal(result.error?.code, 'TUIG_E_WORKSPACE', JSON.stringify(result));
  assert.match(result.error.message, /identity|branch/i);
  assert.ok(result.next_action);
  assert.equal(f.git(['rev-parse', ref]), before);
  assert.equal(result.data.id, undefined, 'refuse before creating a resumed run');
});

test('setup review: resumed run never reruns setup or replaces its baseline', async (t) => {
  const script =
    install +
    "const p='node_modules/setup-count';if(fs.existsSync(p))throw new Error('setup reran');fs.writeFileSync(p,'1');";
  const f = await interrupted(t, [{ name: 'once', argv: node(script), timeoutSec: 10 }]);
  assert.equal(readFileSync(join(f.first.data.worktree, 'node_modules/setup-count'), 'utf8'), '1');
  const result = await f.run({ resume: f.first.data.id });
  assert.equal(result.data.state, 'FAILED_VALIDATION', JSON.stringify(result));
  assert.match(result.data.reason, /Protected test/);
  assert.equal(result.data.setup.commands.length, 1);
  assert.equal(
    record(f, result).events.some((e) => e.type === 'setup_start'),
    false,
  );
  assert.equal(readFileSync(join(result.data.worktree, 'node_modules/setup-count'), 'utf8'), '1');
});

test('setup review: passEnv reaches setup but recorded output and argv are redacted', async (t) => {
  const previous = process.env.SETUP_REVIEW_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  });
  process.env.SETUP_REVIEW_SECRET = 'synthetic-review-value';
  t.after(() => {
    if (previous === undefined) delete process.env.SETUP_REVIEW_SECRET;
    else process.env.SETUP_REVIEW_SECRET = previous;
  });
  const f = fixture(t, {
    setup: [
      {
        name: 'environment',
        argv: node(
          "if(process.env.SETUP_REVIEW_SECRET!=='synthetic-review-value')process.exit(9);console.log(process.env.SETUP_REVIEW_SECRET)",
        ),
      },
    ],
  });
  const path = join(f.repo, '.tuig/config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.policy.passEnv = ['SETUP_REVIEW_SECRET', 'NODE_ENV'];
  writeFileSync(path, JSON.stringify(config));
  const result = await f.run();
  assert.equal(result.data.state, 'SUCCEEDED', JSON.stringify(result));
  assert.equal(result.data.setup?.commands[0].status, 'ok');
  assert.equal(JSON.stringify(result).includes('synthetic-review-value'), false);
  const r = record(f, result);
  assert.equal(JSON.stringify(r).includes('synthetic-review-value'), false);
  assert.equal(
    r.summary.testTamperAttempts,
    0,
    'non-secret passEnv values must not corrupt record keys',
  );
  const log = readFileSync(
    join(f.repo, '.tuig/runs', result.data.id, result.data.setup.commands[0].log),
    'utf8',
  );
  assert.match(log, /\[REDACTED\]/);
  assert.equal(log.includes('synthetic-review-value'), false);
});
