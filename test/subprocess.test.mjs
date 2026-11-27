import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync, spawn } from 'node:child_process';
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
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { evaluate, describeCommand, MODES } from '../dist/engine/policy.js';
import { control } from '../dist/runner/controller.js';
import { replayAdapter } from '../dist/runner/adapter/replay.js';
import { executeTool } from '../dist/runner/tools/index.js';
import { runProcess } from '../dist/runner/tools/run.js';

const posix = process.platform !== 'win32';
const usage = { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 };

function workspace(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-proc-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Wait until no process command line contains the marker (zombies may linger briefly). */
async function noProcessesMatching(marker) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const listing = spawnSync('ps', ['-eo', 'stat=,args='], { encoding: 'utf8' }).stdout;
    const live = listing
      .split('\n')
      .filter((line) => line.includes(marker) && !line.trim().startsWith('Z'));
    if (live.length === 0) return [];
    await new Promise((done) => setTimeout(done, 100));
    if (attempt === 39) return live;
  }
  return [];
}

test(
  'timeout kills the whole process group: background, nested and TERM-ignoring children leave no orphans',
  { skip: !posix, timeout: 30000 },
  async (t) => {
    const root = workspace(t);
    const cases = [
      ['background children', 'sleep 987651 & sleep 987652 & wait', '98765[12]'],
      ['nested shell grandchild', 'sh -c "sleep 987653" & wait', '987653'],
      [
        'children ignoring SIGTERM',
        'trap "" TERM; sleep 987654 & sleep 987655 & wait',
        '98765[45]',
      ],
    ];
    for (const [name, script, pattern] of cases) {
      const started = Date.now();
      const result = await runProcess(root, ['sh', '-c', script], '.', 300, { graceMs: 300 });
      assert.equal(result.status, 'timeout', name);
      assert.match(result.output, /process group was terminated/, name);
      assert.ok(Date.now() - started < 5000, name + ' took too long');
      for (const marker of pattern.includes('[')
        ? [pattern.replace(/\[(\d)(\d)\]/, '$1'), pattern.replace(/\[(\d)(\d)\]/, '$2')]
        : [pattern])
        assert.deepEqual(await noProcessesMatching('sleep ' + marker), [], name);
    }
  },
);

test(
  'a leader that exits normally does not leave background children running',
  { skip: !posix, timeout: 30000 },
  async (t) => {
    const root = workspace(t);
    const result = await runProcess(root, ['sh', '-c', 'sleep 987656 & echo started'], '.', 5000, {
      graceMs: 300,
    });
    assert.equal(result.status, 'ok');
    assert.match(result.output, /started/);
    assert.deepEqual(await noProcessesMatching('sleep 987656'), []);
  },
);

test(
  'cancellation kills the running tool group, and a cancelled run leaves no orphans',
  { skip: !posix, timeout: 30000 },
  async (t) => {
    const root = workspace(t);
    const store = createRecord(root, 'cancel-tool');
    const abort = new AbortController();
    const argv = ['sh', '-c', 'sleep 987657 & sleep 987658 & wait'];
    setTimeout(() => abort.abort(), 300);
    const result = await executeTool(
      { id: 'c1', name: 'run', arguments: { argv, cwd: '.', timeoutMs: 60000 } },
      { root, store, allowedCommands: [argv], signal: abort.signal },
    );
    assert.equal(result.status, 'cancelled');
    assert.deepEqual(await noProcessesMatching('sleep 987657'), []);
    assert.deepEqual(await noProcessesMatching('sleep 987658'), []);
    // The same through the controller: the run ends CANCELLED while the tool is running.
    const runStore = createRecord(root, 'cancel-run');
    const longArgv = ['sh', '-c', 'sleep 987659 & wait'];
    const recorded = [
      {
        message: null,
        toolCalls: [
          { id: 't1', name: 'run', arguments: { argv: longArgv, cwd: '.', timeoutMs: 60000 } },
        ],
        usage,
        stopReason: 'tool_calls',
      },
      { message: 'done', toolCalls: [], usage, stopReason: 'stop' },
    ].map((response, step) => ({
      schema_version: 1,
      seq: step,
      timestamp: '',
      type: 'model_response',
      data: { step, response },
    }));
    const runAbort = new AbortController();
    setTimeout(() => runAbort.abort(), 400);
    const outcome = await control({
      root,
      store: runStore,
      adapter: replayAdapter(recorded),
      messages: [],
      allowedCommands: [longArgv],
      signal: runAbort.signal,
      handleSIGINT: false,
      validate: async () => ({ checks: [{ name: 'x', passed: true }] }),
    });
    assert.equal(outcome.state, 'CANCELLED');
    const call = readRun(runStore).events.find((e) => e.type === 'tool_call');
    assert.equal(call.data.status, 'cancelled');
    assert.deepEqual(await noProcessesMatching('sleep 987659'), []);
  },
);

test('tools never see the parent environment: a secret is not visible to run env', async (t) => {
  const root = workspace(t);
  const store = createRecord(root, 'env');
  const canary = 'tuig-canary-' + Math.random().toString(36).slice(2);
  process.env.TUIG_TEST_CANARY = canary;
  process.env.TUIG_TEST_PASSED = 'passed-value';
  t.after(() => {
    delete process.env.TUIG_TEST_CANARY;
    delete process.env.TUIG_TEST_PASSED;
  });
  const argv = posix
    ? ['env']
    : [
        process.execPath,
        '-e',
        'for (const [k, v] of Object.entries(process.env)) console.log(k + "=" + v)',
      ];
  const run = (passEnv) =>
    executeTool(
      { id: 'e', name: 'run', arguments: { argv, cwd: '.', timeoutMs: 5000 } },
      { root, store, allowedCommands: [argv], passEnv },
    );
  const result = await run([]);
  assert.equal(result.status, 'ok', result.output);
  assert.equal(result.output.includes(canary), false, 'parent secret leaked to the tool');
  const full = readFileSync(join(store.directory, result.log), 'utf8');
  assert.equal(full.includes(canary), false);
  const names = full
    .split('\n')
    .map((line) => line.split('=')[0])
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
  const allowed = new Set([
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'SystemRoot',
    'WINDIR',
    'PATHEXT',
    'TEMP',
    'TMP',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
    'GIT_CONFIG_KEY_1',
    'GIT_CONFIG_VALUE_1',
  ]);
  // Windows itself adds profile variables (USERPROFILE, HOMEPATH, ...) to every new process.
  assert.deepEqual(
    posix ? names.filter((name) => !allowed.has(name)) : [],
    [],
    'unexpected variables reached the tool',
  );
  const home = /^HOME=(.*)$/m.exec(full)?.[1];
  assert.ok(
    home && home !== homedir() && home.includes('tuig-home-'),
    'HOME must be a temporary directory: ' + home,
  );
  // Only explicitly configured names are added.
  const passed = await run(['TUIG_TEST_PASSED']);
  assert.match(
    readFileSync(join(store.directory, passed.log), 'utf8'),
    /TUIG_TEST_PASSED=passed-value/,
  );
  assert.equal(readFileSync(join(store.directory, passed.log), 'utf8').includes(canary), false);
});

test('reads of ~/.ssh, ~/.aws, ~/.config/gh and similar are denied in every mode, even with approval', async (t) => {
  const root = workspace(t);
  const store = createRecord(root, 'creds');
  const home = homedir();
  const targets = [
    '.ssh/id_ed25519',
    '.aws/credentials',
    '.config/gh/hosts.yml',
    '.netrc',
    '.docker/config.json',
    '.kube/config',
    '.gnupg/secring.gpg',
  ];
  for (const target of targets) {
    const path = join(home, target);
    for (const mode of MODES) {
      const verdict = evaluate(describeCommand(['cat', path], root), {
        mode,
        root,
        interactive: true,
      });
      assert.equal(verdict.decision, 'deny', mode + ' ' + target);
    }
    const viaRun = await executeTool(
      {
        id: 'r-' + target,
        name: 'run',
        arguments: { argv: ['cat', path], cwd: '.', timeoutMs: 5000 },
      },
      { root, store, mode: 'auto', approve: () => 'allow_run' },
    );
    assert.equal(viaRun.status, 'policy_denied', target);
    const viaRead = await executeTool(
      { id: 'f-' + target, name: 'read_file', arguments: { path } },
      { root, store },
    );
    assert.equal(viaRead.status, 'policy_denied', target);
  }
  assert.ok(
    readRun(store)
      .events.filter((e) => e.type === 'policy_denied')
      .every((e) => e.data.rule === 'builtin:credential-path'),
  );
});

test('kill-family commands are denied in every mode, including pkill -f tuig', () => {
  const root = realpathSync(tmpdir());
  for (const argv of [
    ['pkill', '-f', 'tuig'],
    ['killall', 'node'],
    ['kill', '-9', '1'],
    ['/usr/bin/pkill', 'tuig'],
  ])
    for (const mode of MODES)
      for (const interactive of [true, false])
        assert.equal(
          evaluate(describeCommand(argv, root), { mode, root, interactive }).decision,
          'deny',
          argv.join(' ') + ' ' + mode,
        );
});

/** A trusted repository whose replay agent makes one turn of tool calls. */
function harnessFixture(t, toolCalls) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-kill-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'state'), TUIG_OUTPUT: 'json' };
  delete env.CI;
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repo,
      encoding: 'utf8',
      env,
    });
    assert.equal(r.status, 0, r.stderr);
  };
  git(['init', '-q']);
  writeFileSync(join(repo, 'a.txt'), 'x\n');
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME;
  try {
    initialize(repo);
    const configPath = join(repo, '.tuig/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.models = { ...config.models, adapter: 'replay', replayFile: 'responses.jsonl' };
    writeFileSync(configPath, JSON.stringify(config));
    const responses = [
      { message: null, toolCalls, usage, stopReason: 'tool_calls' },
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
        checks: [{ name: 'ok', argv: [process.execPath, '-e', '0'], timeoutSec: 10 }],
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
  } finally {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = old;
  }
  return { root, repo, env };
}

test(
  'an agent cannot kill the harness: pkill -f tuig and pkill of the harness command line are denied and the run completes',
  { skip: !posix, timeout: 30000 },
  async (t) => {
    const token = 'tuig-harness-' + Math.random().toString(36).slice(2);
    const stubs = join(tmpdir(), 'tuig-stub-' + Math.random().toString(36).slice(2));
    mkdirSync(stubs);
    t.after(() => rmSync(stubs, { recursive: true, force: true }));
    const marker = join(stubs, 'pkill-ran');
    // A stub first on PATH: if policy ever let "pkill -f tuig" through, it records instead of killing.
    writeFileSync(join(stubs, 'pkill'), '#!/bin/sh\necho "$@" >> "' + marker + '"\n', {
      mode: 0o755,
    });
    const f = harnessFixture(t, [
      {
        id: 'k1',
        name: 'run',
        arguments: { argv: ['pkill', '-f', 'tuig'], cwd: '.', timeoutMs: 5000 },
      },
      {
        id: 'k2',
        name: 'run',
        arguments: { argv: ['sh', '-c', 'pkill -f tuig'], cwd: '.', timeoutMs: 5000 },
      },
      {
        id: 'k3',
        name: 'run',
        arguments: { argv: ['/usr/bin/pkill', '-f', token], cwd: '.', timeoutMs: 5000 },
      },
      {
        id: 'k4',
        name: 'run',
        arguments: { argv: ['killall', 'node'], cwd: '.', timeoutMs: 5000 },
      },
    ]);
    const env = { ...f.env, PATH: stubs + ':' + f.env.PATH };
    // The instruction puts the unique token on the harness command line, so k3 would match only it.
    const child = spawn(
      process.execPath,
      [resolve('dist/main.js'), 'run', '--instruction', token],
      { cwd: f.repo, env },
    );
    let stdout = '';
    child.stdout.on('data', (data) => (stdout += data));
    const [code, signal] = await new Promise((done) => child.on('close', (c, s) => done([c, s])));
    assert.equal(signal, null, 'harness was killed by ' + signal);
    assert.equal(code, 0, stdout);
    assert.equal(JSON.parse(stdout).data.state, 'SUCCEEDED');
    assert.equal(existsSync(marker), false, 'pkill was executed');
    const [id] = readdirSync(join(f.repo, '.tuig/runs'));
    const events = readRun(createRecord(f.repo, id)).events;
    assert.equal(events.at(-1).type, 'run_end');
    const outcomes = Object.fromEntries(
      events.filter((e) => e.type === 'tool_call').map((e) => [e.data.id, e.data.status]),
    );
    assert.deepEqual(outcomes, {
      k1: 'policy_denied',
      k2: 'policy_denied',
      k3: 'policy_denied',
      k4: 'policy_denied',
    });
  },
);

const hasSetsid = posix && spawnSync('setsid', ['--version']).status === 0;
test(
  'a descendant that escapes the process group cannot hang the harness',
  { skip: !hasSetsid, timeout: 30000 },
  async (t) => {
    const root = workspace(t);
    // setsid moves sleep into its own session, outside the group; it keeps stdout open.
    t.after(() => spawnSync('pkill', ['-f', '^sleep 987660$']));
    const started = Date.now();
    const result = await runProcess(root, ['sh', '-c', 'setsid sleep 987660 & wait'], '.', 300, {
      graceMs: 300,
    });
    assert.equal(result.status, 'timeout');
    assert.ok(Date.now() - started < 3000, 'runProcess waited on an escaped descendant');
  },
);

test('policy.passEnv accepts variable names only and never the model credential or harness-owned names', async () => {
  const { validateConfig } = await import('../dist/engine/repository-state.js');
  const base = {
    schema_version: 1,
    mode: 'ask',
    models: { allowedEndpoints: [], apiKeyEnv: 'MODEL_KEY' },
  };
  const ok = (passEnv) => validateConfig({ ...base, policy: { passEnv } }).length === 0;
  assert.ok(ok(['PYTHONPATH', 'NODE_OPTIONS_EXTRA']));
  for (const passEnv of [
    ['MODEL_KEY'],
    ['HOME'],
    ['TMPDIR'],
    ['GIT_DIR'],
    ['BAD NAME'],
    ['A=B'],
    'PATH',
    [1],
  ])
    assert.equal(ok(passEnv), false, JSON.stringify(passEnv));
});
