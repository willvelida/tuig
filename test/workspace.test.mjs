import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import {
  checkpoint,
  cleanupWorkspace,
  createWorkspace,
  diffPatch,
  mainStatus,
} from '../dist/engine/workspace.js';
import { cleanupRun, runCommand } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';
import { executeTool } from '../dist/runner/tools/index.js';
import { gitArgv } from '../dist/runner/tools/git.js';
import { runProcess } from '../dist/runner/tools/run.js';

const posix = process.platform !== 'win32';
const usage = { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 };
const HOOKS = ['pre-commit', 'post-commit', 'post-checkout', 'reference-transaction', 'commit-msg'];

function sh(cwd, args, env = process.env) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  assert.equal(r.status, 0, args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}
const commit = (cwd, message) =>
  sh(cwd, [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    message,
  ]);

/** Trusted, initialized repository whose replay "agent" makes the given tool calls. */
function fixture(t, steps) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-ws-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(root, 'state');
  t.after(() => {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = old;
  });
  const repo = join(root, 'repo');
  mkdirSync(repo);
  sh(repo, ['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'a.txt'), 'broken\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Agents\n\nOriginal guidance.\n');
  writeFileSync(join(repo, '.gitignore'), 'checks.log\n');
  initialize(repo);
  const configPath = join(repo, '.tuig/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.models = { ...config.models, adapter: 'replay', replayFile: 'responses.jsonl' };
  writeFileSync(configPath, JSON.stringify(config));
  const responses = [
    ...steps.map((toolCalls) => ({ message: null, toolCalls, usage, stopReason: 'tool_calls' })),
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
  const argv = [
    process.execPath,
    '-e',
    'const f=require("fs");f.appendFileSync("checks.log","ran\\n");if(f.readFileSync("a.txt","utf8").trim()!=="fixed")process.exit(1)',
  ];
  writeFileSync(
    join(repo, '.tuig/checks.json'),
    JSON.stringify({ schema_version: 1, checks: [{ name: 'visible', argv, timeoutSec: 10 }] }),
  );
  sh(repo, ['add', '.']);
  commit(repo, 'fixture');
  trustRepository(repo);
  return { root, repo };
}

const call = (id, name, args) => ({ id, name, arguments: args });
const fixEdit = (id) => call(id, 'edit', { path: 'a.txt', search: 'broken', replace: 'fixed' });

/** Plant executable hooks that write marker files, in .git/hooks and a configured hooksPath. */
function plantHooks(repo, markers) {
  mkdirSync(markers, { recursive: true });
  const configured = join(repo, '.git', 'planted-hooks');
  mkdirSync(configured);
  for (const directory of [join(repo, '.git', 'hooks'), configured]) {
    for (const hook of HOOKS) {
      const file = join(directory, hook);
      writeFileSync(file, '#!/bin/sh\necho ran > "' + join(markers, hook) + '"\n');
      chmodSync(file, 0o755);
    }
  }
  sh(repo, ['config', 'core.hooksPath', configured]);
}

/** Every byte the human could see in the main checkout, plus HEAD, index and refs. */
function mainCheckoutFingerprint(repo) {
  const hash = createHash('sha256');
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const rel = relative(repo, path).replaceAll('\\', '/');
      if (rel === '.git' || rel === '.tuig/runs' || rel === '.tuig/temp') continue;
      if (statSync(path).isDirectory()) walk(path);
      else
        hash
          .update(rel + '\0')
          .update(readFileSync(path))
          .update('\0');
    }
  };
  walk(repo);
  hash.update(readFileSync(join(repo, '.git', 'index')));
  hash.update(readFileSync(join(repo, '.git', 'HEAD')));
  hash.update(sh(repo, ['-c', 'core.hooksPath=/dev/null', 'rev-parse', 'HEAD']));
  hash.update(sh(repo, ['-c', 'core.hooksPath=/dev/null', 'branch', '--show-current']));
  return hash.digest('hex');
}

test(
  'control: planted hooks really run for plain Git in this environment',
  { skip: !posix },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), 'tuig-hook-control-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    sh(root, ['init', '-q']);
    writeFileSync(join(root, 'f'), 'x');
    sh(root, ['add', 'f']);
    const markers = join(root, 'markers');
    plantHooks(root, markers);
    sh(root, ['-c', 'user.name=T', '-c', 'user.email=t@e.invalid', 'commit', '-q', '-m', 'c']);
    assert.ok(existsSync(join(markers, 'pre-commit')), 'control hook did not run');
  },
);

test(
  'a planted pre-commit (and every other) hook never runs during a full run, agent commits, checkpoints and cleanup',
  { skip: !posix },
  async (t) => {
    const f = fixture(t, [
      [fixEdit('e1')],
      [
        call('g1', 'git', { subcommand: 'add', args: ['-A'] }),
        call('g2', 'git', { subcommand: 'commit', args: ['-m', 'agent fix'] }),
        call('g3', 'git', { subcommand: 'status', args: ['--short'] }),
      ],
    ]);
    const markers = join(f.root, 'markers');
    plantHooks(f.repo, markers);
    const r = await runCommand({ cwd: f.repo, platform: 'linux', instruction: 'Fix a.txt.' });
    assert.equal(r.status, 'ok', JSON.stringify(r));
    const outcomes = readRun(createRecord(f.repo, r.data.id)).events.filter(
      (e) => e.type === 'tool_call',
    );
    assert.deepEqual(
      outcomes.map((e) => [e.data.name, e.data.status]),
      [
        ['edit', 'ok'],
        ['git', 'ok'],
        ['git', 'ok'],
        ['git', 'ok'],
      ],
    );
    assert.match(
      sh(r.data.worktree, ['-c', 'core.hooksPath=/dev/null', 'log', '-1', '--format=%s']),
      /agent fix/,
    );
    // A trusted check or tool that invokes Git itself inherits the overrides through the environment.
    const nestedArgv = [
      'git',
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@e.invalid',
      'commit',
      '--allow-empty',
      '-q',
      '-m',
      'nested',
    ];
    const nested = await runProcess(r.data.worktree, nestedArgv, '.', 5000);
    assert.equal(nested.status, 'ok', nested.output);
    const cleaned = cleanupRun(r.data.id, f.repo);
    assert.equal(cleaned.status, 'ok', JSON.stringify(cleaned));
    assert.deepEqual(existsSync(markers) ? readdirSync(markers) : [], []);
  },
);

test('writes to protected paths take the approval path; denials and non-interactive runs record policy_denied', async (t) => {
  const f = fixture(t, []);
  const workspace = createWorkspace(f.repo, 'approval');
  mkdirSync(join(workspace.path, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(workspace.path, '.github', 'workflows', 'ci.yml'), 'on: push\n');
  writeFileSync(join(workspace.path, 'package.json'), '{"scripts":{"test":"node t"}}\n');
  writeFileSync(join(workspace.path, '.env'), 'SECRET=1\n');
  const store = createRecord(f.repo, 'approval');
  const requests = [];
  const run = (id, path, search, replace, decision) =>
    executeTool(call(id, 'edit', { path, search, replace }), {
      root: workspace.path,
      store,
      ...(decision === undefined
        ? {}
        : {
            approve: (request) => {
              requests.push(request);
              return decision;
            },
          }),
    });
  const targets = [
    ['AGENTS.md', 'Original', 'protected-path:agent-instructions'],
    ['.github/workflows/ci.yml', 'push', 'protected-path:ci-config'],
    ['package.json', 'node t', 'protected-path:command-config'],
    ['.tuig/checks.json', 'visible', 'protected-path:harness-config'],
  ];
  for (const [path, search, rule] of targets) {
    const before = readFileSync(join(workspace.path, path), 'utf8');
    // Denied by the approver: nothing written.
    assert.equal((await run('d-' + path, path, search, 'X', 'deny')).status, 'policy_denied');
    assert.equal(readFileSync(join(workspace.path, path), 'utf8'), before);
    assert.equal(requests.at(-1).rule, rule);
    assert.equal(requests.at(-1).path, path);
    // Non-interactive (no approver): denied without asking.
    const count = requests.length;
    assert.equal((await run('n-' + path, path, search, 'X')).status, 'policy_denied');
    assert.equal(requests.length, count);
    assert.equal(readFileSync(join(workspace.path, path), 'utf8'), before);
    // Approved: the write happens.
    assert.equal((await run('a-' + path, path, search, 'APPROVED', 'allow_once')).status, 'ok');
    assert.match(readFileSync(join(workspace.path, path), 'utf8'), /APPROVED/);
  }
  // Ordinary files never ask; credentials are refused even with an approver that would allow.
  const asked = requests.length;
  assert.equal((await run('plain', 'a.txt', 'broken', 'fixed', 'allow_once')).status, 'ok');
  assert.equal((await run('cred', '.env', 'SECRET', 'X', 'allow_once')).status, 'policy_denied');
  assert.equal(requests.length, asked);
  assert.equal(readFileSync(join(workspace.path, '.env'), 'utf8'), 'SECRET=1\n');
  const denials = readRun(store).events.filter((e) => e.type === 'policy_denied');
  assert.equal(denials.length, targets.length * 2);
  assert.ok(denials.some((e) => /non-interactive/.test(e.data.reason)));
});

test('an approval during a run suspends in AWAITING_APPROVAL, is recorded, and replays exactly', async (t) => {
  const protectedEdit = call('p1', 'edit', {
    path: 'AGENTS.md',
    search: 'Original',
    replace: 'Updated',
  });
  for (const decision of ['allow_once', 'deny']) {
    const f = fixture(t, [[fixEdit('e1'), protectedEdit]]);
    const seen = [];
    const r = await runCommand({
      cwd: f.repo,
      platform: 'linux',
      instruction: 'Fix a.txt.',
      approver: (request) => {
        seen.push(request);
        return decision;
      },
    });
    assert.equal(r.status, 'ok', JSON.stringify(r));
    assert.deepEqual(
      seen.map((request) => [request.tool, request.path, request.rule]),
      [['edit', 'AGENTS.md', 'protected-path:agent-instructions']],
    );
    const events = readRun(createRecord(f.repo, r.data.id)).events;
    const types = events.map((e) => e.type);
    const requested = types.indexOf('approval_requested');
    assert.ok(requested > types.indexOf('tool_intent'));
    assert.deepEqual(events[requested + 1].data, {
      from: 'RUNNING',
      to: 'AWAITING_APPROVAL',
      reason: 'protected-path:agent-instructions',
    });
    assert.equal(events[requested + 2].data.decision, decision);
    assert.equal(events[requested + 3].data.to, 'RUNNING');
    assert.equal(types.includes('policy_denied'), decision === 'deny');
    const agents = readFileSync(join(r.data.worktree, 'AGENTS.md'), 'utf8');
    assert.equal(agents.includes('Updated'), decision === 'allow_once');
    const replay = await replayRun(r.data.id, f.repo);
    assert.equal(replay.status, 'ok', JSON.stringify(replay));
    assert.equal(replay.data.verified, true);
  }
});

test('the human main checkout is never modified by a run, even by escape attempts', async (t) => {
  const f = fixture(t, [
    [fixEdit('e1')],
    [
      call('x1', 'edit', { path: '../../repo/a.txt', search: 'broken', replace: 'pwned' }),
      call('x2', 'read_file', { path: '../../../../repo/a.txt' }),
      call('x3', 'git', { subcommand: 'add', args: ['../../../a.txt'] }),
      call('x4', 'git', { subcommand: 'diff', args: ['--output=../../../a.txt'] }),
      call('x5', 'git', { subcommand: 'commit', args: ['--amend', '-m', 'rewrite'] }),
      call('x6', 'git', { subcommand: 'push', args: [] }),
      call('g1', 'git', { subcommand: 'add', args: ['a.txt'] }),
      call('g2', 'git', { subcommand: 'commit', args: ['-m', 'agent fix'] }),
    ],
  ]);
  // A newer mtime with unchanged content leaves the index stale, so a careless status would rewrite it.
  const later = new Date(Date.now() + 60000);
  utimesSync(join(f.repo, 'a.txt'), later, later);
  const before = mainCheckoutFingerprint(f.repo);
  const r = await runCommand({ cwd: f.repo, platform: 'linux', instruction: 'Fix a.txt.' });
  assert.equal(r.status, 'ok', JSON.stringify(r));
  const outcomes = Object.fromEntries(
    readRun(createRecord(f.repo, r.data.id))
      .events.filter((e) => e.type === 'tool_call')
      .map((e) => [e.data.id, e.data.status]),
  );
  assert.equal(outcomes.x1, 'policy_denied');
  assert.equal(outcomes.x2, 'policy_denied');
  assert.equal(outcomes.x3, 'nonzero_exit');
  assert.equal(outcomes.x4, 'policy_denied');
  assert.equal(outcomes.x5, 'policy_denied');
  assert.equal(outcomes.x6, 'invalid_args');
  assert.equal(outcomes.g2, 'ok');
  assert.equal(mainCheckoutFingerprint(f.repo), before);
  assert.equal(mainStatus(f.repo), '');
  assert.equal(readFileSync(join(f.repo, 'a.txt'), 'utf8'), 'broken\n');
  // Cleanup removes only the worktree; the main checkout is still untouched.
  assert.equal(cleanupRun(r.data.id, f.repo).status, 'ok');
  assert.equal(mainCheckoutFingerprint(f.repo), before);
});

test('a dirty base is refused with a fix, including untracked files, before any run state exists', async (t) => {
  const f = fixture(t, []);
  writeFileSync(join(f.repo, 'untracked.txt'), 'unsaved');
  const r = await runCommand({ cwd: f.repo, platform: 'linux', instruction: 'Fix a.txt.' });
  assert.equal(r.status, 'error');
  assert.equal(r.error.code, 'TUIG_E_DIRTY');
  assert.match(r.next_action, /commit|preserve/i);
  assert.equal(existsSync(join(f.repo, '.tuig/runs')), false);
  assert.equal(existsSync(join(f.repo, '.tuig/temp/worktrees')), false);
});

test('checkpoints land on shadow refs per turn without touching the agent index; diff includes new files', async (t) => {
  const f = fixture(t, []);
  const ws = createWorkspace(f.repo, 'shadow');
  assert.equal(ws.branch, 'tuig/run-shadow');
  writeFileSync(join(ws.path, 'a.txt'), 'fixed\n');
  writeFileSync(join(ws.path, 'new.txt'), 'brand new\n');
  const status = sh(ws.path, ['status', '--porcelain']);
  const first = checkpoint(ws, 0);
  assert.equal(first.ref, 'refs/tuig/checkpoints/shadow/0');
  assert.equal(sh(f.repo, ['rev-parse', first.ref]), first.commit);
  assert.equal(sh(f.repo, ['show', first.ref + ':new.txt']), 'brand new');
  assert.equal(
    sh(ws.path, ['status', '--porcelain']),
    status,
    'checkpoint changed the agent index',
  );
  // The same state reuses the ref (resume); different content never overwrites it.
  assert.equal(checkpoint(ws, 0).commit, first.commit);
  writeFileSync(join(ws.path, 'later.txt'), 'later\n');
  assert.throws(() => checkpoint(ws, 0), 'a checkpoint ref is never overwritten');
  rmSync(join(ws.path, 'later.txt'));
  assert.equal(checkpoint(ws, 1).ref, 'refs/tuig/checkpoints/shadow/1');
  const patch = diffPatch(ws);
  assert.match(patch, /\+fixed/);
  assert.match(patch, /new\.txt/);
  assert.match(patch, /\+brand new/);
  // Cleanup keeps the branch, carrying the uncommitted final state.
  const result = cleanupWorkspace(ws);
  assert.equal(existsSync(ws.path), false);
  assert.equal(sh(f.repo, ['rev-parse', 'refs/heads/tuig/run-shadow']), result.commit);
  assert.equal(sh(f.repo, ['show', 'tuig/run-shadow:new.txt']), 'brand new');
  assert.equal(sh(f.repo, ['show', 'tuig/run-shadow:a.txt']), 'fixed');
  assert.equal(readFileSync(join(f.repo, 'a.txt'), 'utf8'), 'broken\n');
});

test('git tool offers six subcommands with allow-listed flags only', async () => {
  assert.deepEqual(gitArgv('commit', ['-m', '--amend']), ['-m', '--amend']);
  assert.deepEqual(gitArgv('log', ['--oneline', '-n', '5']), ['--oneline', '-n', '5']);
  assert.deepEqual(gitArgv('diff', ['--stat', '--', '-weird-path']), [
    '--stat',
    '--',
    '-weird-path',
  ]);
  for (const [subcommand, args] of [
    ['diff', ['--output=/tmp/x']],
    ['diff', ['--ext-diff']],
    ['diff', ['--no-index', '/etc/passwd', 'a']],
    ['log', ['--format=%H']],
    ['log', ['-p']],
    ['log', ['-n', '$(id)']],
    ['commit', ['--amend']],
    ['commit', ['-F', '/etc/passwd']],
    ['commit', ['--template=/etc/passwd']],
    ['add', ['--pathspec-from-file=/etc/passwd']],
    ['status', ['-c', 'core.pager=sh']],
    ['show', ['HEAD:.env']],
    ['add', ['.ssh/id_rsa']],
    ['show', ['HEAD:tests-hidden/test_x.py']],
  ])
    assert.throws(() => gitArgv(subcommand, args), subcommand + ' ' + args.join(' '));
});

test('every harness Git invocation goes through the safe helper', async () => {
  const offenders = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.js') && !path.endsWith(join('engine', 'git.js'))) {
        if (/spawn(Sync)?\(\s*['"]git['"]/.test(readFileSync(path, 'utf8'))) offenders.push(path);
      }
    }
  };
  walk('dist');
  assert.deepEqual(offenders, []);
});

test('run honours the configured mode: plan denies edits; auto-edit and auto fail closed without a sandbox', async (t) => {
  const plan = fixture(t, [[fixEdit('e1'), call('r1', 'read_file', { path: 'a.txt' })]]);
  const configPath = join(plan.repo, '.tuig/config.json');
  const setMode = (repo, mode) => {
    const path = join(repo, '.tuig/config.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), mode }));
    sh(repo, ['add', '.tuig/config.json']);
    commit(repo, 'mode ' + mode);
  };
  setMode(plan.repo, 'plan');
  assert.ok(existsSync(configPath));
  const r = await runCommand({ cwd: plan.repo, platform: 'linux', instruction: 'Fix a.txt.' });
  const events = readRun(createRecord(plan.repo, r.data.id)).events;
  const outcomes = Object.fromEntries(
    events.filter((e) => e.type === 'tool_call').map((e) => [e.data.id, e.data.status]),
  );
  assert.deepEqual(outcomes, { e1: 'policy_denied', r1: 'ok' });
  assert.equal(events.find((e) => e.type === 'run_start').data.mode, 'plan');
  assert.equal(readFileSync(join(r.data.worktree, 'a.txt'), 'utf8').trim(), 'broken');
  for (const mode of ['auto-edit', 'auto']) {
    const f = fixture(t, []);
    setMode(f.repo, mode);
    const refused = await runCommand({
      cwd: f.repo,
      platform: 'linux',
      instruction: 'Fix a.txt.',
      sandbox: null,
    });
    assert.equal(refused.status, 'error', mode);
    assert.equal(refused.error.code, 'TUIG_E_SANDBOX', mode);
    assert.equal(existsSync(join(f.repo, '.tuig/temp/worktrees')), false, mode);
  }
});
