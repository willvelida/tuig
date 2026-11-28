import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { doctor } from '../dist/cli/commands/doctor.js';
import { checksCommand } from '../dist/cli/commands/checks.js';
import { runCommand } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';
import { binaryHash, verifySelfHost } from '../dist/engine/self-host.js';

const require = createRequire(import.meta.url);
function bunPath() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
  const musl =
    process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
      ? '-musl'
      : '';
  try {
    return require.resolve(
      '@oven/bun-' +
        platform +
        '-' +
        arch +
        musl +
        '/bin/bun' +
        (process.platform === 'win32' ? '.exe' : ''),
    );
  } catch {
    return require.resolve('bun/bin/bun.exe');
  }
}
function exec(file, args, options = {}) {
  return spawnSync(file, args, {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
}
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-selfhost-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  };
  process.env.XDG_CONFIG_HOME = join(dir, 'state');
  process.env.XDG_DATA_HOME = join(dir, 'data');
  t.after(() => {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (args) => {
    const r = exec(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      { cwd: repo },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(['init', '-q']);
  git(['config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, '.gitignore'), '.tuig/temp/\n.tuig/runs/\n');
  writeFileSync(join(repo, 'a.txt'), 'old\n');
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
  initialize(repo);
  const config = JSON.parse(readFileSync(join(repo, '.tuig/config.json'), 'utf8'));
  config.sandbox = 'off';
  config.secretGate = 'required';
  config.protectedPaths = JSON.parse(readFileSync('.tuig/config.json', 'utf8')).protectedPaths;
  const save = () => writeFileSync(join(repo, '.tuig/config.json'), JSON.stringify(config));
  save();
  trustRepository(repo);
  const commit = () => {
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
      'configured',
    ]);
  };
  return { dir, repo, git, config, save, commit };
}
function compile(entry, output, identity) {
  const r = exec(bunPath(), [
    'build',
    '--compile',
    entry,
    '--outfile',
    output,
    ...(identity ? ['--define', 'TUIG_BUILD_IDENTITY=' + JSON.stringify(identity)] : []),
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
function identity(f) {
  return {
    commit: f.git(['rev-parse', 'HEAD']),
    tree: f.git(['rev-parse', 'HEAD^{tree}']),
    dirty: false,
  };
}
function pinFile() {
  const file = join(
    process.env.XDG_DATA_HOME,
    'tuig/pinned/test-pin',
    process.platform === 'win32' ? 'tuig.exe' : 'tuig',
  );
  mkdirSync(join(file, '..'), { recursive: true });
  return file;
}
function setPin(f, file) {
  f.git(['tag', 'test-pin']);
  f.config.selfHost = { pinnedVersion: 'test-pin', pinnedSha256: binaryHash(file) };
  f.save();
}

test('self host doctor verifies hash, external path and clean tagged identity; source run refuses', async (t) => {
  const f = fixture(t),
    file = pinFile();
  const entry = join(f.dir, 'fake.js'),
    data = join(f.dir, 'identity.json');
  const expected = identity(f);
  writeFileSync(data, JSON.stringify(expected));
  writeFileSync(
    entry,
    'import {doctor} from ' +
      JSON.stringify(resolve('dist/cli/commands/doctor.js').replaceAll('\\', '/')) +
      ';\n' +
      'if(process.argv.includes("--build-identity")) console.log(require("node:fs").readFileSync(' +
      JSON.stringify(data) +
      ',"utf8")); else console.log(JSON.stringify(doctor({platform:"linux",probe:()=>({ok:true,detail:"1.0.0"})})));',
  );
  compile(entry, file);
  setPin(f, file);
  let executable = file;
  const inspect = () => {
    const result = exec(executable, ['doctor'], { cwd: f.repo });
    assert.equal(result.error, undefined, result.error?.message);
    return JSON.parse(result.stdout);
  };
  assert.equal(inspect().status, 'ok');
  const dev = doctor({
    cwd: f.repo,
    platform: 'linux',
    probe: (name) => ({ ok: name !== 'rg', detail: name === 'rg' ? 'Missing' : '1.0.0' }),
  });
  assert.equal(dev.status, 'error');
  assert.equal(dev.error.code, 'TUIG_E_SELFHOST_UNPINNED');
  const sourceDoctor = JSON.parse(
    exec(process.execPath, [resolve('dist/main.js'), 'doctor', '--json'], { cwd: f.repo }).stdout,
  );
  assert.equal(sourceDoctor.error.code, 'TUIG_E_SELFHOST_UNPINNED');
  assert.ok(sourceDoctor.data.checks.some((c) => c.name === 'secret gate'));
  for (const args of [['docs', 'get', 'commands'], ['agents-start-here']]) {
    const result = JSON.parse(
      exec(process.execPath, [resolve('dist/main.js'), ...args], { cwd: f.repo }).stdout,
    );
    assert.equal(result.status, 'ok');
  }
  assert.deepEqual(
    dev.data.checks.map((c) => c.name),
    [
      'node',
      'platform',
      'bun',
      'git',
      'rg',
      'gitleaks',
      'sandbox',
      'initialized',
      'trusted',
      'config',
      'secret gate',
      'self host',
    ],
  );
  assert.equal(dev.data.checks.find((c) => c.name === 'rg').ok, false);
  for (const name of [
    'node',
    'bun',
    'git',
    'gitleaks',
    'sandbox',
    'trusted',
    'config',
    'secret gate',
  ])
    assert.equal(dev.data.checks.find((c) => c.name === name).ok, true, name);
  const denied = () => {
    const r = inspect();
    assert.equal(r.status, 'error', JSON.stringify(r));
    assert.equal(r.error.code, 'TUIG_E_SELFHOST_UNPINNED');
    assert.equal(r.data.checks.length, 12);
    assert.equal(r.data.checks.filter((c) => !c.ok).length, 1);
    assert.equal(r.data.checks.at(-1).code, 'TUIG_E_SELFHOST_UNPINNED');
    assert.ok(r.next_action);
  };
  f.config.selfHost.pinnedSha256 = '0'.repeat(64);
  f.save();
  assert.throws(() => verifySelfHost(f.repo, f.config.selfHost), {
    code: 'TUIG_E_SELFHOST_UNPINNED',
  });
  denied();
  f.config.selfHost.pinnedSha256 = binaryHash(file);
  f.save();
  for (const value of [
    {},
    { ...expected, dirty: true },
    { ...expected, commit: '0'.repeat(40) },
    { ...expected, tree: '0'.repeat(40) },
  ]) {
    writeFileSync(data, JSON.stringify(value));
    denied();
  }
  writeFileSync(data, JSON.stringify(expected));
  f.git(['tag', '-d', 'test-pin']);
  denied();
  f.git(['tag', 'test-pin']);
  const source = await runCommand({
    cwd: f.repo,
    platform: 'linux',
    instruction: 'do nothing',
    interactive: false,
  });
  assert.equal(source.error.code, 'TUIG_E_SELFHOST_UNPINNED');
  assert.equal((await checksCommand(f.repo)).error.code, 'TUIG_E_SELFHOST_UNPINNED');
  process.env.XDG_DATA_HOME = f.repo;
  const inside = pinFile();
  require('node:fs').copyFileSync(file, inside);
  assert.throws(() => verifySelfHost(f.repo, f.config.selfHost), {
    code: 'TUIG_E_SELFHOST_UNPINNED',
  });
  process.env.XDG_DATA_HOME = join(f.dir, 'data');
  executable = join(f.dir, process.platform === 'win32' ? 'dev-copy.exe' : 'dev-copy');
  require('node:fs').copyFileSync(file, executable);
  rmSync(file);
  denied();
});

test('checks binary under test substitutes argv without replacing invoking harness; invalid candidates fail closed', async (t) => {
  const f = fixture(t),
    candidate = join(f.dir, process.platform === 'win32' ? 'candidate.exe' : 'candidate');
  const entry = join(f.dir, 'candidate.js');
  writeFileSync(entry, 'console.log(JSON.stringify({status:"ok",data:{version:"test"}}))');
  compile(entry, candidate);
  f.config.secretGate = 'off';
  f.save();
  writeFileSync(
    join(f.repo, '.tuig/checks.json'),
    JSON.stringify({
      schema_version: 1,
      checks: [
        {
          name: 'safety candidate selection',
          argv: [
            process.execPath,
            '-e',
            'require("node:assert/strict").equal(process.argv[1],' +
              JSON.stringify(candidate) +
              '); require("node:fs").writeFileSync("invoker",process.execPath)',
            '{binary-under-test}',
          ],
        },
      ],
    }),
  );
  assert.equal((await checksCommand(f.repo, candidate)).status, 'ok');
  assert.equal(readFileSync(join(f.repo, 'invoker'), 'utf8'), process.execPath);
  for (const path of [join(f.dir, 'missing'), f.dir, entry]) {
    const result = await checksCommand(f.repo, path);
    assert.equal(result.error.code, 'TUIG_E_BINARY_UNDER_TEST');
    assert.ok(result.next_action);
  }
});

for (const path of ['src/engine/policy.ts', 'fixtures/example/tests-hidden/test_hidden.py']) {
  test(
    'self hosted replay run denies and records protected attempt ' + path,
    { timeout: 60000 },
    async (t) => {
      const f = fixture(t),
        file = pinFile();
      f.config.secretGate = 'off';
      f.config.models = { adapter: 'replay', allowedEndpoints: [], replayFile: 'responses.jsonl' };
      f.save();
      mkdirSync(join(f.repo, path, '..'), { recursive: true });
      writeFileSync(join(f.repo, path), 'old\n');
      writeFileSync(
        join(f.repo, '.tuig/checks.json'),
        JSON.stringify({
          schema_version: 1,
          checks: [{ name: 'visible', argv: [process.execPath, '-e', 'process.exit(0)'] }],
        }),
      );
      const responses = [
        {
          message: '',
          toolCalls: [
            {
              id: 'edit-protected',
              name: 'edit',
              arguments: { path, search: 'old', replace: 'new' },
            },
          ],
          stopReason: 'tool_calls',
        },
        { message: 'Done.', toolCalls: [], stopReason: 'stop' },
      ].map((r, step) => ({
        type: 'model_response',
        data: {
          step,
          response: { ...r, usage: { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 } },
        },
      }));
      writeFileSync(
        join(f.repo, 'responses.jsonl'),
        responses.map((r) => JSON.stringify(r)).join('\n') + '\n',
      );
      f.commit();
      let entry = resolve('dist/main.js');
      if (process.platform === 'win32') {
        // Exercise the real run handler on Windows, whose production CLI requires WSL.
        entry = join(f.dir, 'harness.ts');
        writeFileSync(
          entry,
          'import {runCommand} from ' +
            JSON.stringify(resolve('dist/cli/commands/run.js').replaceAll('\\', '/')) +
            ';\n' +
            'if(process.argv.includes("--build-identity")) console.log(' +
            JSON.stringify(JSON.stringify(identity(f))) +
            '); else console.log(JSON.stringify(await runCommand({platform:"linux",instruction:"Synthetic replay only.",interactive:false})));',
        );
      }
      compile(entry, file, identity(f));
      setPin(f, file);
      // Pin config belongs to a later commit, so the pin remains the previous release.
      f.commit();
      const r = exec(file, ['run', '--instruction', 'Synthetic replay only.'], {
        cwd: f.repo,
        env: { ...process.env, TUIG_OUTPUT: 'json' },
      });
      const result = JSON.parse(r.stdout);
      assert.ok(result.data.id, r.stdout + r.stderr);
      const record = join(f.repo, '.tuig/runs', result.data.id);
      const summary = JSON.parse(readFileSync(join(record, 'summary.json'), 'utf8'));
      assert.deepEqual(summary.selfHost, { ...f.config.selfHost, protectedPathsTouched: [path] });
      const events = readFileSync(join(record, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.equal(
        events.find((e) => e.type === 'tool_call' && e.data.id === 'edit-protected').data.status,
        'policy_denied',
      );
      assert.equal(readFileSync(join(result.data.worktree, path), 'utf8'), 'old\n');
      assert.equal((await replayRun(result.data.id, f.repo)).status, 'ok');
    },
  );
}
