import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSandbox, sandboxSpec } from '../dist/sandbox/index.js';
import { bwrapArgv } from '../dist/sandbox/linux-bwrap.js';
import { seatbeltProfile } from '../dist/sandbox/macos-seatbelt.js';
import { runProcess } from '../dist/runner/tools/run.js';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { validateConfig } from '../dist/engine/repository-state.js';
import { runCommand } from '../dist/cli/commands/run.js';
import { doctor } from '../dist/cli/commands/doctor.js';

const sandbox = detectSandbox();
// CI must exercise the real sandbox; locally the acceptance tests skip when none works.
const requireSandbox = process.env.TUIG_REQUIRE_SANDBOX === '1';
const skip = !sandbox && !requireSandbox;
const usage = { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 };

function dirs(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-sbx-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const worktree = join(root, 'worktree');
  const outside = join(root, 'outside');
  mkdirSync(worktree);
  mkdirSync(outside);
  return { root, worktree, outside };
}

test('bwrap invocation unshares every namespace, hides home and binds only the worktree read-write', () => {
  const spec = {
    cwd: '/w',
    writable: ['/w', '/tmp/tuig-home-x'],
    hidden: ['/home/u', '/mnt'],
    readOnly: ['/mnt/c/tools/node'],
  };
  const argv = bwrapArgv('/usr/bin/bwrap', { ...spec, hidden: spec.hidden.filter(() => true) }, [
    'python',
    '-m',
    'pytest',
  ]);
  const text = argv.join(' ');
  for (const flag of [
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--ro-bind / /',
    '--tmpfs /tmp',
    '--proc /proc',
    '--dev /dev',
    '--chdir /w',
  ])
    assert.ok(text.includes(flag), flag);
  assert.ok(!text.includes('--share-net'), 'network must stay unshared');
  // Writable binds come after every hide so they sit on top.
  const lastHide = Math.max(...argv.map((arg, i) => (arg === '--tmpfs' ? i : -1)));
  assert.ok(argv.indexOf('--bind') > lastHide);
  assert.deepEqual(argv.slice(argv.indexOf('--') + 1), ['python', '-m', 'pytest']);
});

test('seatbelt profile denies network, signals outside the sandbox, writes outside and reads of hidden paths', () => {
  const profile = seatbeltProfile({
    cwd: '/w',
    writable: ['/w', '/private/tmp/h'],
    hidden: ['/Users/u'],
    readOnly: ['/Users/u/.nvm/versions/node/v24'],
  });
  for (const rule of [
    '(deny network*)',
    '(deny signal)',
    '(allow signal (target same-sandbox))',
    '(deny file-write*)',
    '(deny file-read* (subpath "/Users/u"))',
  ])
    assert.ok(profile.includes(rule), rule);
  assert.match(profile, /\(allow file-write\* \(subpath "\/w"\) \(subpath "\/private\/tmp\/h"\)/);
  assert.match(profile, /\(allow file-read\* \(subpath "\/Users\/u\/\.nvm\/versions\/node\/v24"\)/);
  // Later rules win in SBPL: the write allow-list must follow the blanket write deny.
  assert.ok(profile.indexOf('(deny file-write*)') < profile.indexOf('(allow file-write*'));
  // Paths are quoted so a crafted directory name cannot end the string.
  assert.match(
    seatbeltProfile({ cwd: '/w"x', writable: ['/w"x'], hidden: [], readOnly: [] }),
    /\(subpath "\/w\\"x"\)/,
  );
});

test(
  'tool installs under hidden roots stay readable, but never a home-like directory',
  { skip: process.platform === 'win32' },
  (t) => {
    const { root } = dirs(t);
    const fakeHome = join(root, 'home');
    mkdirSync(join(fakeHome, '.ssh'), { recursive: true });
    mkdirSync(join(fakeHome, 'tools', 'node', 'bin'), { recursive: true });
    mkdirSync(join(fakeHome, 'bin'));
    const old = process.env.PATH;
    process.env.PATH = [join(fakeHome, 'tools', 'node', 'bin'), join(fakeHome, 'bin'), old].join(
      process.platform === 'win32' ? ';' : ':',
    );
    t.after(() => (process.env.PATH = old));
    const worktree = join(root, 'worktree');
    const spec = sandboxSpec({ cwd: worktree, writable: [worktree], realHome: fakeHome });
    assert.ok(spec.hidden.includes(realpathSync(fakeHome)));
    assert.ok(spec.readOnly.includes(realpathSync(join(fakeHome, 'tools', 'node'))));
    assert.equal(
      spec.readOnly.includes(realpathSync(fakeHome)),
      false,
      'a PATH entry of ~/bin must not re-expose ~',
    );
  },
);

test('fail closed: without a working sandbox auto-edit and auto refuse to run, and doctor degrades', async (t) => {
  for (const mode of ['auto-edit', 'auto']) {
    const f = repo(t, [], mode);
    const r = await runCommand({ cwd: f.repo, platform: 'linux', instruction: 'x', sandbox: null });
    assert.equal(r.status, 'error', mode);
    assert.equal(r.error.code, 'TUIG_E_SANDBOX', mode);
    assert.equal(existsSync(join(f.repo, '.tuig/temp/worktrees')), false, mode);
  }
  // A missing sandbox binary is reported by doctor's functional check.
  const report = doctor({
    cwd: tmpdir(),
    platform: 'linux',
    probe: (tool) => ({ ok: tool !== 'bwrap', detail: 't' }),
  });
  const check = report.data.checks.find((c) => c.name === 'sandbox');
  assert.equal(check.ok, false);
  assert.match(check.fix, /refuse to run without it/);
  assert.equal(detectSandbox('linux', '/nonexistent-path'), null);
  // The sandbox cannot be switched off for autonomous modes.
  const base = { schema_version: 1, models: { allowedEndpoints: [] } };
  assert.ok(validateConfig({ ...base, mode: 'auto', sandbox: 'off' }).length > 0);
  assert.ok(validateConfig({ ...base, mode: 'auto-edit', sandbox: 'off' }).length > 0);
  assert.equal(validateConfig({ ...base, mode: 'ask', sandbox: 'off' }).length, 0);
  assert.ok(validateConfig({ ...base, mode: 'ask', sandbox: 'disabled' }).length > 0);
});

test('a working sandbox is detected where CI requires one', { skip: !requireSandbox }, () => {
  assert.ok(sandbox, 'TUIG_REQUIRE_SANDBOX=1 but no working sandbox was detected');
  assert.equal(sandbox.kind, process.platform === 'darwin' ? 'seatbelt' : 'bwrap');
});

const run = (worktree, argv, extra = {}) =>
  runProcess(worktree, argv, '.', 10000, { sandbox, graceMs: 300, ...extra });

test(
  'under the sandbox, writing outside the worktree fails; the worktree and temporary home are writable',
  { skip, timeout: 60000 },
  async (t) => {
    const { worktree, outside } = dirs(t);
    const target = join(outside, 'escaped');
    const write = (path) => ['/bin/sh', '-c', 'echo pwned > "$0"', path];
    const blocked = await run(worktree, write(target));
    assert.notEqual(blocked.status, 'ok', blocked.output);
    assert.equal(existsSync(target), false, 'write outside the worktree succeeded');
    // Control: without the sandbox the identical write succeeds, so the sandbox is what blocked it.
    const control = join(outside, 'control');
    assert.equal((await runProcess(worktree, write(control), '.', 10000)).status, 'ok');
    assert.ok(existsSync(control));
    // /tmp is a private tmpfs inside the sandbox, so also try a real filesystem the user can write.
    const durable = realpathSync(mkdtempSync('/var/tmp/tuig-sbx-outside-'));
    t.after(() => rmSync(durable, { recursive: true, force: true }));
    const durableTarget = join(durable, 'escaped');
    assert.notEqual((await run(worktree, write(durableTarget))).status, 'ok');
    assert.equal(
      existsSync(durableTarget),
      false,
      'write to /var/tmp outside the worktree succeeded',
    );
    assert.equal((await runProcess(worktree, write(durableTarget), '.', 10000)).status, 'ok');
    const home = await run(worktree, [
      '/bin/sh',
      '-c',
      'echo x > "$HOME/h" && echo x > "$TMPDIR/t" && echo inside > in.txt',
    ]);
    assert.equal(home.status, 'ok', home.output);
    assert.equal(readFileSync(join(worktree, 'in.txt'), 'utf8').trim(), 'inside');
    // The same through a program that builds the path itself, bypassing any argv inspection.
    const sneaky = await run(worktree, [
      process.execPath,
      '-e',
      'require("fs").writeFileSync(process.env.TMPDIR.split("/tuig-home")[0] + "/../" + "sneaky", "x")',
    ]);
    assert.notEqual(sneaky.status, 'ok');
  },
);

test(
  'under the sandbox, network access fails (curl https://example.com and a raw fetch)',
  { skip, timeout: 60000 },
  async (t) => {
    const { worktree } = dirs(t);
    if (spawnSync('curl', ['--version']).status === 0) {
      const curl = await run(worktree, ['curl', '-sS', '--max-time', '5', 'https://example.com']);
      assert.notEqual(curl.status, 'ok', curl.output);
    }
    const fetchCode =
      'fetch("https://example.com").then(() => process.exit(0), () => process.exit(7))';
    const fetched = await run(worktree, [process.execPath, '-e', fetchCode]);
    // No unsandboxed control here: CI may or may not have internet, so only the denial is asserted.
    assert.equal(fetched.exitCode, 7, fetched.output);
  },
);

test(
  'under the sandbox, reading ~/.ssh fails even when the program hides the path from policy',
  { skip, timeout: 60000 },
  async (t) => {
    const { worktree } = dirs(t);
    // Never touch the real ~/.ssh: only check that it is invisible if it exists.
    const real = join(homedir(), '.ssh');
    const listing = await run(worktree, ['/bin/sh', '-c', 'ls "$0"', real]);
    if (existsSync(real))
      assert.notEqual(listing.status, 'ok', 'real ~/.ssh is visible: ' + listing.output);
    const code =
      'const p=require("path").join(' +
      JSON.stringify(homedir()) +
      ', ".s" + "sh"); try { require("fs").readdirSync(p); process.exit(0) } catch { process.exit(9) }';
    const hidden = await run(worktree, [process.execPath, '-e', code]);
    if (existsSync(real)) assert.equal(hidden.exitCode, 9, hidden.output);
    // A planted fake home credential is unreadable too.
    const fakeHome = mkdtempSync(join(homedir(), '.tuig-fake-home-test-'));
    t.after(() => rmSync(fakeHome, { recursive: true, force: true }));
    mkdirSync(join(fakeHome, '.ssh'));
    writeFileSync(join(fakeHome, '.ssh', 'id_test'), 'PRIVATE');
    const planted = await run(worktree, ['/bin/cat', join(fakeHome, '.ssh', 'id_test')]);
    assert.notEqual(planted.status, 'ok');
    assert.equal(planted.output.includes('PRIVATE'), false);
    // Control: the same read without the sandbox succeeds.
    const control = await runProcess(
      worktree,
      ['/bin/cat', join(fakeHome, '.ssh', 'id_test')],
      '.',
      10000,
    );
    assert.match(control.output, /PRIVATE/);
  },
);

test(
  'under the sandbox, processes cannot signal the harness and escaped descendants die with it',
  { skip: skip || process.platform !== 'linux', timeout: 60000 },
  async (t) => {
    const { worktree } = dirs(t);
    const code =
      'try { process.kill(' +
      process.pid +
      ', 0); process.exit(0) } catch (e) { process.exit(e.code === "ESRCH" || e.code === "EPERM" ? 5 : 6) }';
    const signal = await run(worktree, [process.execPath, '-e', code]);
    assert.equal(signal.exitCode, 5, signal.output);
    const timedOut = await runProcess(
      worktree,
      ['/bin/sh', '-c', 'setsid sleep 987671 & wait'],
      '.',
      300,
      { sandbox, graceMs: 300 },
    );
    assert.equal(timedOut.status, 'timeout');
    await new Promise((done) => setTimeout(done, 500));
    const left = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8' })
      .stdout.split('\n')
      .filter((line) => line.startsWith('sleep 98767'));
    assert.deepEqual(left, [], 'escaped descendant survived the sandbox');
  },
);

/** A trusted repository with a replay agent, in the given mode. */
function repo(t, toolCalls, mode = 'ask') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-sbx-run-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(root, 'state');
  t.after(() => {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = old;
  });
  const path = join(root, 'repo');
  mkdirSync(path);
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: path,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  };
  git(['init', '-q']);
  writeFileSync(join(path, 'a.txt'), 'x\n');
  initialize(path);
  const configPath = join(path, '.tuig/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.mode = mode;
  config.models = { ...config.models, adapter: 'replay', replayFile: 'responses.jsonl' };
  writeFileSync(configPath, JSON.stringify(config));
  const responses = [
    ...(toolCalls.length ? [{ message: null, toolCalls, usage, stopReason: 'tool_calls' }] : []),
    { message: 'done', toolCalls: [], usage, stopReason: 'stop' },
  ];
  writeFileSync(
    join(path, 'responses.jsonl'),
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
    join(path, '.tuig/checks.json'),
    JSON.stringify({
      schema_version: 1,
      checks: [
        {
          name: 'ok',
          argv: [process.execPath, '-e', 'require("fs").writeFileSync("checked", "1")'],
          timeoutSec: 20,
        },
      ],
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
  trustRepository(path);
  return { root, repo: path };
}

test(
  'auto mode runs sandboxed end to end: tools and checks are confined and the run records the sandbox',
  { skip, timeout: 120000 },
  async (t) => {
    const f = repo(
      t,
      [
        {
          id: 'w',
          name: 'run',
          arguments: {
            argv: ['/bin/sh', '-c', 'echo ok > made.txt; echo pwned > ../../escaped.txt'],
            cwd: '.',
            timeoutMs: 10000,
          },
        },
        {
          id: 'n',
          name: 'run',
          arguments: {
            argv: [
              process.execPath,
              '-e',
              'fetch("http://example.com").then(()=>process.exit(0),()=>process.exit(7))',
            ],
            cwd: '.',
            timeoutMs: 10000,
          },
        },
      ],
      'auto',
    );
    const r = await runCommand({
      cwd: f.repo,
      platform: process.platform,
      instruction: 'x',
      approver: () => 'allow_once',
    });
    assert.equal(r.status, 'ok', JSON.stringify(r));
    const events = readRun(createRecord(f.repo, r.data.id)).events;
    assert.equal(events.find((e) => e.type === 'run_start').data.sandbox, sandbox.kind);
    assert.equal(readFileSync(join(r.data.worktree, 'made.txt'), 'utf8').trim(), 'ok');
    assert.equal(existsSync(join(r.data.worktree, '..', '..', 'escaped.txt')), false);
    assert.equal(existsSync(join(f.repo, '.tuig', 'temp', 'escaped.txt')), false);
    assert.ok(
      existsSync(join(r.data.worktree, 'checked')),
      'sandboxed check did not run in the worktree',
    );
    const calls = Object.fromEntries(
      events.filter((e) => e.type === 'tool_call').map((e) => [e.data.id, e.data.status]),
    );
    assert.equal(calls.n, 'nonzero_exit');
  },
);
