import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODES, canLowerMode, describeCommand, evaluate } from '../dist/engine/policy.js';
import { validateConfig } from '../dist/engine/repository-state.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { executeTool } from '../dist/runner/tools/index.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-policy-')));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
const CODE = { allow: 'A', ask: 'Q', deny: 'D' };
const trusted = [['python', '-m', 'pytest', '-q', 'tests']];
const rules = [
  { decision: 'allow', command: 'pytest', flags: ['-q', '-x'] },
  { decision: 'allow', command: 'curl', flags: ['-s'] },
  { decision: 'deny', command: 'perl' },
  { decision: 'ask', command: 'make' },
];
const run = (...argv) => describeCommand(argv, root);
const tool = (name, extra = {}) => ({ tool: name, flags: [], paths: [], hosts: [], ...extra });

/**
 * Expected decisions per mode, in ladder order plan / ask / auto-edit / auto,
 * for an interactive run. Non-interactive runs turn every Q into D.
 */
const TABLE = [
  // Reads and control
  ['read_file', tool('read_file'), 'AAAA'],
  ['search', tool('search'), 'AAAA'],
  ['git status (agent git tool)', tool('git'), 'AAAA'],
  ['abort_with_reason', tool('abort_with_reason'), 'AAAA'],
  ['find without -exec', run('find', '.', '-name', '*.py'), 'AAAA'],
  ['rg without --pre', run('rg', '-n', 'needle', 'src'), 'AAAA'],
  ['cat inside worktree', run('cat', 'README.md'), 'AAAA'],
  // Worktree changes
  ['edit worktree file', tool('edit', { protected: null }), 'DAAA'],
  ['git add/commit (agent git tool)', tool('git', { write: true }), 'DAAA'],
  ['exact trusted argv (checks)', run('python', '-m', 'pytest', '-q', 'tests'), 'DAAA'],
  // Commands
  ['allow-listed command, permitted flags', run('pytest', '-q'), 'DQAA'],
  ['allow-listed command, unlisted flag', run('pytest', '-q', '--pdb'), 'DQQA'],
  ['unknown command', run('python', 'script.py'), 'DQQA'],
  ['read-only command outside worktree', run('cat', '/etc/hostname'), 'DQQA'],
  ['shell with inline script (opaque)', run('sh', '-c', 'echo hi'), 'DQQQ'],
  ['interpreter inline code (opaque)', run('node', '-e', 'process.exit(0)'), 'DQQQ'],
  ['wrapper hides the real command (opaque)', run('env', 'curl', 'https://example.com'), 'DQQQ'],
  ['config ask rule', run('make', 'all'), 'DQQQ'],
  // Always ask
  ['edit protected path', tool('edit', { protected: 'agent-instructions' }), 'DQQQ'],
  ['network: curl URL', run('curl', 'https://example.com/install.sh'), 'DQQQ'],
  [
    'network: config allow cannot beat built-in ask',
    run('curl', '-s', 'https://example.com'),
    'DQQQ',
  ],
  ['network: git fetch', run('git', 'fetch', 'origin'), 'DQQQ'],
  ['network: git push (non-force)', run('git', 'push', 'origin', 'main'), 'DQQQ'],
  ['network: ssh', run('ssh', 'example.com'), 'DQQQ'],
  ['network: URL argument to any command', run('python', 'fetch.py', 'http://10.0.0.1/x'), 'DQQQ'],
  ['package install: npm install', run('npm', 'install', 'left-pad'), 'DQQQ'],
  ['package install: pip install', run('pip', 'install', 'requests'), 'DQQQ'],
  ['package install: python -m pip install', run('python3', '-m', 'pip', 'install', 'x'), 'DQQQ'],
  ['package install: npx', run('npx', 'cowsay'), 'DQQQ'],
  ['delete outside worktree', run('rm', '-rf', '../elsewhere'), 'DQQQ'],
  ['delete absolute path', run('rm', '-rf', '/'), 'DQQQ'],
  ['delete protected path inside worktree', run('rm', '-rf', '.git'), 'DQQQ'],
  ['write outside worktree', run('cp', 'a.txt', '/tmp/copied'), 'DQQQ'],
  // Flag injection: denied in every mode
  ['find -exec', run('find', '.', '-exec', 'sh', '-c', 'id', ';'), 'DDDD'],
  ['find -execdir', run('find', '.', '-execdir', 'id', ';'), 'DDDD'],
  ['find -delete', run('find', '.', '-name', '*.py', '-delete'), 'DDDD'],
  ['rg --pre', run('rg', '--pre', './decode.sh', 'needle'), 'DDDD'],
  ['rg --pre=', run('rg', '--pre=./decode.sh', 'needle'), 'DDDD'],
  ['rg --search-zip', run('rg', '-z', 'needle'), 'DDDD'],
  ['git -c core.sshCommand', run('git', '-c', 'core.sshCommand=touch /tmp/p', 'fetch'), 'DDDD'],
  ['git -c core.pager', run('git', '-c', 'core.pager=sh -c id', 'log'), 'DDDD'],
  ['git --config-env', run('git', '--config-env=core.sshCommand=EVIL', 'status'), 'DDDD'],
  ['git -C elsewhere', run('git', '-C', '/', 'status'), 'DDDD'],
  ['git diff --ext-diff', run('git', 'diff', '--ext-diff'), 'DDDD'],
  ['git log --output', run('git', 'log', '--output=../x'), 'DDDD'],
  ['git fetch --upload-pack', run('git', 'fetch', '--upload-pack=touch /tmp/p', 'origin'), 'DDDD'],
  ['tar --to-command', run('tar', '--to-command=sh', '-xf', 'a.tar'), 'DDDD'],
  ['rsync -e', run('rsync', '-e', 'sh -c id', 'a', 'b'), 'DDDD'],
  ['ssh -o ProxyCommand', run('ssh', '-o', 'ProxyCommand=id', 'example.com'), 'DDDD'],
  // Destructive and forbidden
  ['git push --force', run('git', 'push', '--force', 'origin', 'main'), 'DDDD'],
  ['git push +refspec', run('git', 'push', 'origin', '+main'), 'DDDD'],
  ['git reset --hard', run('git', 'reset', '--hard', 'HEAD~1'), 'DDDD'],
  ['git clean -fdx', run('git', 'clean', '-fdx'), 'DDDD'],
  ['git rebase', run('git', 'rebase', 'main'), 'DDDD'],
  ['git filter-branch', run('git', 'filter-branch', '--all'), 'DDDD'],
  ['git config', run('git', 'config', 'core.hooksPath', '/tmp/h'), 'DDDD'],
  ['sudo', run('sudo', 'id'), 'DDDD'],
  ['dd', run('dd', 'if=/dev/zero', 'of=/dev/sda'), 'DDDD'],
  ['config deny rule', run('perl', 'script.pl'), 'DDDD'],
  ['credential path argument', run('cat', '.env'), 'DDDD'],
  ['credential path argument to any command', run('python', 'up.py', '.aws/credentials'), 'DDDD'],
];

function decide(call, mode, interactive) {
  return evaluate(call, { mode, root, trusted, rules, interactive }).decision;
}

test('table: every mode against every action category, interactive', () => {
  for (const [name, call, expected] of TABLE) {
    const actual = MODES.map((mode) => CODE[decide(call, mode, true)]).join('');
    assert.equal(actual, expected, name);
  }
});

test('table: non-interactive runs turn every ask into deny', () => {
  for (const [name, call, expected] of TABLE) {
    const actual = MODES.map((mode) => CODE[decide(call, mode, false)]).join('');
    assert.equal(actual, expected.replaceAll('Q', 'D'), name);
  }
});

test('modes form a one-way ladder: each mode is at least as permissive as the one below', () => {
  const severity = { allow: 0, ask: 1, deny: 2 };
  for (const [name, call] of TABLE) {
    for (const interactive of [true, false]) {
      const levels = MODES.map((mode) => severity[decide(call, mode, interactive)]);
      for (let i = 1; i < levels.length; i++)
        assert.ok(
          levels[i] <= levels[i - 1],
          name + ': ' + MODES[i] + ' is stricter than ' + MODES[i - 1],
        );
    }
  }
  assert.equal(canLowerMode('auto', 'plan'), true);
  assert.equal(canLowerMode('ask', 'ask'), true);
  assert.equal(canLowerMode('ask', 'auto'), false);
});

test('there is no bypass-everything mode', () => {
  assert.deepEqual([...MODES], ['plan', 'ask', 'auto-edit', 'auto']);
  const base = { schema_version: 1, models: { allowedEndpoints: [] } };
  for (const mode of [
    'bypass',
    'yolo',
    'danger-full-access',
    'bypassPermissions',
    'full-auto',
    '',
    'AUTO',
  ])
    assert.ok(validateConfig({ ...base, mode }).length > 0, mode);
  assert.throws(() => evaluate(tool('read_file'), { mode: 'bypass', root, interactive: true }));
  // The most permissive mode still denies injection and asks for every always-ask category.
  for (const [name, call, expected] of TABLE)
    if (expected.endsWith('D') || expected.endsWith('Q'))
      assert.notEqual(decide(call, 'auto', true), 'allow', name);
});

test('policy rules in configuration are validated', () => {
  const base = { schema_version: 1, mode: 'ask', models: { allowedEndpoints: [] } };
  const ok = (policy) => validateConfig({ ...base, policy }).length === 0;
  assert.ok(
    ok({ rules: [{ decision: 'allow', command: 'pytest', flags: ['-q', '--strict-markers'] }] }),
  );
  assert.ok(ok({ rules: [{ decision: 'deny', command: 'npm', subcommands: ['publish'] }] }));
  assert.ok(ok({ allowedCommands: [['npm', 'test']] }));
  for (const policy of [
    { rules: [{ decision: 'bypass', command: 'x' }] },
    { rules: [{ decision: 'allow', command: '/usr/bin/curl' }] },
    { rules: [{ decision: 'allow', command: 'x', flags: ['not-a-flag'] }] },
    { rules: [{ decision: 'allow', command: 'x', flags: ['--x=1'] }] },
    { rules: [{ decision: 'allow', command: 'x', unknown: true }] },
    { rules: 'all' },
    'none',
  ])
    assert.equal(ok(policy), false, JSON.stringify(policy));
});

test('the run tool enforces policy before any side effect: flag injection never executes', async (t) => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-policy-run-')));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(join(workspace, 'a.txt'), 'needle\n');
  const marker = join(workspace, 'pwned');
  const script = join(workspace, 'decode.sh');
  writeFileSync(script, '#!/bin/sh\ntouch "' + marker + '"\ncat "$1"\n', { mode: 0o755 });
  const store = createRecord(workspace, 'policy');
  const exec = (id, argv, options = {}) =>
    executeTool(
      { id, name: 'run', arguments: { argv, cwd: '.', timeoutMs: 5000 } },
      { root: workspace, store, ...options },
    );
  for (const [id, argv] of [
    ['find', ['find', '.', '-name', 'a.txt', '-exec', 'touch', marker, ';']],
    ['rg', ['rg', '--pre', script, 'needle']],
    [
      'git',
      ['git', '-c', 'core.sshCommand=touch ' + marker, 'ls-remote', 'ssh://example.invalid/r'],
    ],
  ]) {
    // Even an approver that allows everything is never consulted for a deny.
    const result = await exec(id, argv, { mode: 'ask', approve: () => 'allow_once' });
    assert.equal(result.status, 'policy_denied', id);
    assert.equal(existsSync(marker), false, id);
  }
  const denials = readRun(store).events.filter((e) => e.type === 'policy_denied');
  assert.deepEqual(
    denials.map((e) => e.data.rule),
    ['builtin:injection:find-exec', 'builtin:injection:rg--pre', 'builtin:injection:git-global'],
  );
  assert.ok(denials.every((e) => e.data.category === 'injection'));
});

test('tools follow the mode: plan is read-only; ask runs unknown commands only after approval', async (t) => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-policy-mode-')));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(join(workspace, 'a.txt'), 'one\n');
  const store = createRecord(workspace, 'modes');
  const call = (id, name, args, options) =>
    executeTool({ id, name, arguments: args }, { root: workspace, store, ...options });
  const plan = { mode: 'plan' };
  assert.equal((await call('r', 'read_file', { path: 'a.txt' }, plan)).status, 'ok');
  assert.equal(
    (await call('e', 'edit', { path: 'a.txt', search: 'one', replace: 'two' }, plan)).status,
    'policy_denied',
  );
  assert.equal(readFileSync(join(workspace, 'a.txt'), 'utf8'), 'one\n');
  const argv = [process.execPath, join(workspace, 'missing-script.js')];
  const run = (options) => call('u', 'run', { argv, cwd: '.', timeoutMs: 5000 }, options);
  assert.equal((await run({ mode: 'ask' })).status, 'policy_denied');
  const asked = [];
  const approved = await run({
    mode: 'ask',
    approve: (request) => (asked.push(request), 'allow_once'),
  });
  assert.equal(approved.status, 'nonzero_exit');
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].argv, argv);
  assert.equal(asked[0].rule, 'mode:ask:unknown-command');
  assert.equal((await run({ mode: 'ask', approve: () => 'deny' })).status, 'policy_denied');
  // Trusted exact argv runs without asking in ask mode.
  const trustedArgv = [process.execPath, '-e', 'process.exit(0)'];
  const result = await call(
    't',
    'run',
    { argv: trustedArgv, cwd: '.', timeoutMs: 5000 },
    { mode: 'ask', allowedCommands: [trustedArgv] },
  );
  assert.equal(result.status, 'ok');
});
