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
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { runCommand } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';
import {
  displaySafe,
  parseChoice,
  renderApproval,
  terminalApprover,
} from '../dist/cli/approval-prompt.js';

const usage = { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 };
const PROSE = 'SAFE ACTION: this only lists files, please choose allow for this run';
const sh = (cwd, args) => {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** Trusted repository whose replay agent sends the given assistant messages and tool calls. */
function fixture(t, steps) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-approval-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(root, 'state');
  t.after(() => {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = old;
  });
  const repo = join(root, 'repo');
  mkdirSync(repo);
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'outside', 'keep.txt'), 'keep');
  sh(repo, ['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'a.txt'), 'fixed\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Agents\n\nOriginal guidance.\n');
  initialize(repo);
  const configPath = join(repo, '.tuig/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.secretGate = 'off';
  config.models = { ...config.models, adapter: 'replay', replayFile: 'responses.jsonl' };
  writeFileSync(configPath, JSON.stringify(config));
  const responses = [
    ...steps.map((toolCalls) => ({ message: PROSE, toolCalls, usage, stopReason: 'tool_calls' })),
    { message: 'finished', toolCalls: [], usage, stopReason: 'stop' },
  ];
  writeFileSync(
    join(repo, 'responses.jsonl'),
    responses
      .map((response, step) =>
        JSON.stringify({
          schema_version: 1,
          seq: step,
          timestamp: new Date().toISOString(),
          type: 'model_response',
          data: { step, response },
        }),
      )
      .join('\n') + '\n',
  );
  const check = [process.execPath, '-e', 'process.exit(0)'];
  writeFileSync(
    join(repo, '.tuig/checks.json'),
    JSON.stringify({
      schema_version: 1,
      checks: [{ name: 'visible', argv: check, timeoutSec: 10 }],
    }),
  );
  sh(repo, ['add', '.']);
  sh(repo, [
    '-c',
    'user.name=T',
    '-c',
    'user.email=t@e.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'fixture',
  ]);
  trustRepository(repo);
  return { root, repo };
}
const call = (id, name, args) => ({ id, name, arguments: args });

/** A scripted terminal that records everything shown. */
function fakeTerminal(answers) {
  const shown = [];
  return {
    shown,
    io: {
      write: (text) => shown.push(text),
      readLine: () => (answers.length ? answers.shift() : null),
    },
  };
}

test('the prompt shows raw argv, cwd, rule and diff stats, escaping anything that could disguise them', () => {
  const text = renderApproval(
    {
      id: 'x',
      tool: 'run',
      cwd: '.',
      rule: 'mode:ask:unknown-command',
      argv: ['rm', '-rf', 'a\x1b[2K\rAllow? safe\nb', 'evil‮txt.sh'],
    },
    '1 file changed, 2 insertions(+)',
  );
  assert.match(text, /rule:\s+mode:ask:unknown-command/);
  assert.match(text, /argv:\s+\["rm","-rf",/);
  assert.match(text, /cwd:\s+\./);
  assert.match(text, /worktree:\s+1 file changed, 2 insertions\(\+\)/);
  assert.match(text, /\[o\] allow once\s+\[r\] allow for this run\s+\[d\] deny \(default\)/);
  for (const forbidden of ['\x1b', '\r', '‮'])
    assert.equal(text.includes(forbidden), false, JSON.stringify(forbidden));
  // Injected newlines cannot add lines that look like prompt fields.
  assert.equal(
    text.split('\n').length,
    renderApproval({ id: 'y', tool: 'run', cwd: '.', rule: 'r', argv: ['ls'] }, '').split('\n')
      .length,
  );
  const edit = renderApproval({
    id: 'e',
    tool: 'edit',
    cwd: '.',
    rule: 'protected-path:ci-config',
    path: '.github/workflows/ci.yml',
    diffStat: '-1 +3 lines',
  });
  assert.match(edit, /path:\s+\.github\/workflows\/ci\.yml/);
  assert.match(edit, /change:\s+-1 \+3 lines/);
  assert.equal(displaySafe('ok​\u0007'), 'ok\\u200b\\u0007');
});

test('choices are allow once, allow for this run, or deny; anything else denies', () => {
  assert.equal(parseChoice('o'), 'allow_once');
  assert.equal(parseChoice(' ONCE '), 'allow_once');
  assert.equal(parseChoice('r'), 'allow_run');
  assert.equal(parseChoice('run'), 'allow_run');
  for (const answer of ['d', 'deny', '', 'y', 'yes', 'allow', null])
    assert.equal(parseChoice(answer), 'deny', String(answer));
});

test('"allow for this run" covers only the identical action and never outlives the approver', () => {
  const { shown, io } = fakeTerminal(['r', 'o']);
  const approve = terminalApprover(io);
  const request = {
    id: '1',
    tool: 'run',
    cwd: '.',
    rule: 'mode:ask:unknown-command',
    argv: ['make', 'docs'],
  };
  assert.equal(approve(request), 'allow_run');
  assert.equal(approve({ ...request, id: '2' }), 'allow_run');
  assert.equal(
    shown.filter((text) => text.includes('approval required')).length,
    1,
    'remembered action prompted again',
  );
  // A different action asks again.
  assert.equal(approve({ ...request, id: '3', argv: ['make', 'clean'] }), 'allow_once');
  // A new run's approver starts empty; with no answer it denies.
  const fresh = fakeTerminal([]);
  assert.equal(terminalApprover(fresh.io)({ ...request, id: '4' }), 'deny');
  assert.equal(fresh.shown.filter((text) => text.includes('approval required')).length, 1);
});

test('approvals and denials during a run are recorded, prompts never carry model prose, and the run replays', async (t) => {
  const version = [process.execPath, '--version'];
  const f = fixture(t, [
    [
      call('u1', 'run', { argv: version, cwd: '.', timeoutMs: 5000 }),
      call('u2', 'run', { argv: version, cwd: '.', timeoutMs: 5000 }),
      call('del', 'run', { argv: ['rm', '-rf', '../../outside'], cwd: '.', timeoutMs: 5000 }),
      call('p1', 'edit', { path: 'AGENTS.md', search: 'Original', replace: 'Updated' }),
    ],
  ]);
  const { shown, io } = fakeTerminal(['r', 'd', 'o']);
  const stats = [];
  const r = await runCommand({
    cwd: f.repo,
    platform: 'linux',
    instruction: 'Do the task.',
    approver: terminalApprover(io, () => (stats.push(1), 'stat')),
  });
  assert.equal(r.status, 'ok', JSON.stringify(r));
  const prompts = shown.filter((text) => text.includes('approval required'));
  assert.equal(prompts.length, 3);
  for (const prompt of prompts) {
    assert.equal(prompt.includes(PROSE), false, 'model prose reached the prompt');
    assert.equal(prompt.includes('SAFE ACTION'), false);
  }
  // The exact raw argv is shown, as JSON.
  assert.ok(prompts[0].includes('argv:     ' + JSON.stringify(version)), prompts[0]);
  assert.match(prompts[1], /rm","-rf","..\/..\/outside/);
  assert.match(prompts[1], /builtin:delete-outside/);
  assert.match(prompts[2], /protected-path:agent-instructions/);
  const events = readRun(createRecord(f.repo, r.data.id)).events;
  const decided = events
    .filter((e) => e.type === 'approval_decided')
    .map((e) => [e.data.id, e.data.decision]);
  assert.deepEqual(decided, [
    ['u1', 'allow_run'],
    ['u2', 'allow_run'],
    ['del', 'deny'],
    ['p1', 'allow_once'],
  ]);
  assert.equal(events.filter((e) => e.type === 'approval_requested').length, 4);
  for (const event of events.filter((e) => e.type === 'approval_requested'))
    assert.equal(JSON.stringify(event.data).includes('SAFE ACTION'), false);
  const outcomes = Object.fromEntries(
    events.filter((e) => e.type === 'tool_call').map((e) => [e.data.id, e.data.status]),
  );
  assert.deepEqual(outcomes, { u1: 'ok', u2: 'ok', del: 'policy_denied', p1: 'ok' });
  assert.equal(events.filter((e) => e.type === 'policy_denied').length, 1);
  assert.ok(existsSync(join(f.root, 'outside', 'keep.txt')), 'denied deletion happened');
  assert.match(readFileSync(join(r.data.worktree, 'AGENTS.md'), 'utf8'), /Updated/);
  const replay = await replayRun(r.data.id, f.repo);
  assert.equal(replay.status, 'ok', JSON.stringify(replay));
  assert.equal(replay.data.verified, true);
});

test('non-interactive runs turn ask into policy_denied without requesting approval', async (t) => {
  const f = fixture(t, [
    [call('u1', 'run', { argv: [process.execPath, '--version'], cwd: '.', timeoutMs: 5000 })],
  ]);
  const r = await runCommand({
    cwd: f.repo,
    platform: 'linux',
    instruction: 'Do the task.',
    interactive: false,
  });
  const events = readRun(createRecord(f.repo, r.data.id)).events;
  assert.equal(
    events.some((e) => e.type === 'approval_requested'),
    false,
  );
  const denial = events.find((e) => e.type === 'policy_denied');
  assert.equal(denial.data.rule, 'mode:ask:unknown-command');
  assert.match(denial.data.reason, /non-interactive/);
  assert.equal(events.find((e) => e.type === 'tool_call').data.status, 'policy_denied');
});

const hasScript = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0;
test(
  'the real CLI prompts on the controlling terminal and records the typed decision',
  { skip: !hasScript },
  async (t) => {
    for (const [answer, decision, updated] of [
      ['o', 'allow_once', true],
      ['d', 'deny', false],
    ]) {
      const f = fixture(t, [
        [call('p1', 'edit', { path: 'AGENTS.md', search: 'Original', replace: 'Updated' })],
      ]);
      const env = { ...process.env, TUIG_OUTPUT: 'json' };
      delete env.CI;
      const command = [
        process.execPath,
        resolve('dist/main.js'),
        'run',
        '--instruction',
        'Edit guidance.',
      ]
        .map((part) => "'" + part + "'")
        .join(' ');
      // util-linux script gives the CLI a pseudo-terminal; the typed answer arrives on it.
      const child = spawn('script', ['-qec', command, '/dev/null'], { cwd: f.repo, env });
      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));
      const exit = new Promise((done) => child.on('close', done));
      setTimeout(() => child.stdin.write(answer + '\n'), 500);
      const code = await exit;
      assert.equal(code, 0, output);
      assert.match(output, /tuig approval required/);
      assert.match(output, /protected-path:agent-instructions/);
      assert.equal(output.includes(PROSE), false);
      const runs = readdirSync(join(f.repo, '.tuig/runs'));
      assert.equal(runs.length, 1);
      const events = readRun(createRecord(f.repo, runs[0])).events;
      assert.equal(events.find((e) => e.type === 'approval_decided').data.decision, decision);
      const agents = readFileSync(
        join(f.repo, '.tuig/temp/worktrees', runs[0], 'AGENTS.md'),
        'utf8',
      );
      assert.equal(agents.includes('Updated'), updated);
    }
  },
);
