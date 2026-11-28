import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  approveTests,
  changedTests,
  isProtectedTest,
  oracleSnapshotPath,
  protectedTests,
} from '../dist/engine/protected-tests.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { finalOracle, loadOracle } from '../dist/engine/oracle.js';
import { detectSandbox } from '../dist/sandbox/index.js';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { runCommand, commandFailure } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tuig-final-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (args) => {
    const r = spawnSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(['init', '-q']);
  mkdirSync(join(repo, 'tests-visible'));
  writeFileSync(join(repo, 'tests-visible', 'visible.py'), 'assert True\n');
  writeFileSync(
    join(repo, '.gitignore'),
    '.tuig/\nnode_modules/\n__pycache__/\n*.pyc\n.pytest_cache/\n',
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
  return {
    root,
    repo,
    git,
    workspace: {
      root: repo,
      path: repo,
      base: git(['rev-parse', 'HEAD']),
      id: 'review',
      branch: 'review',
    },
  };
}

test(
  'round2: large ignored dependencies are filtered and genuine protected overflow is recorded',
  { timeout: 240000 },
  async (t) => {
    const f = fixture(t);
    mkdirSync(join(f.repo, 'node_modules'));
    for (let i = 0; i < 20000; i++)
      writeFileSync(
        join(
          f.repo,
          'node_modules',
          'dependency_payload_' + String(i).padStart(6, '0') + '_unchanged_runtime_file.js',
        ),
        '',
      );
    await t.test('empty protectedTests skips Git entirely', () => {
      assert.deepEqual(
        changedTests({ ...f.workspace, path: join(f.root, 'does-not-exist') }, []),
        [],
      );
    });
    await t.test('unrelated ignored output over 1 MiB does not break the gate', () => {
      const store = createRecord(f.repo, 'filtered');
      assert.equal(approveTests(f.workspace, ['tests-visible/**'], store), true);
      writeFileSync(join(f.repo, 'tests-visible', 'visible.py'), 'assert False\n');
      assert.equal(approveTests(f.workspace, ['tests-visible/**'], store), false);
    });
    await t.test(
      'filtered protected overflow has a specific typed error, remediation and event',
      () => {
        const store = createRecord(f.repo, 'overflow');
        assert.throws(
          () => approveTests(f.workspace, ['node_modules/**'], store),
          (error) => {
            assert.equal(error.code, 'TUIG_E_WORKSPACE');
            assert.match(error.message, /protected.*list.*limit/i);
            assert.match(error.next_action, /protectedTests/);
            return true;
          },
        );
        const event = readRun(store).events.find((e) => e.type === 'policy_denied');
        assert.equal(event?.data.code, 'TUIG_E_WORKSPACE');
        assert.match(event.data.next_action, /protectedTests/);
      },
    );
    await t.test(
      'CLI records and replays a specific final-gate infrastructure error',
      { timeout: 120000 },
      async (sub) => {
        writeFileSync(join(f.repo, 'tests-visible', 'visible.py'), 'assert True\n');
        const old = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = join(f.root, 'state');
        sub.after(() => {
          if (old === undefined) delete process.env.XDG_CONFIG_HOME;
          else process.env.XDG_CONFIG_HOME = old;
        });
        initialize(f.repo);
        const configPath = join(f.repo, '.tuig', 'config.json');
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        config.secretGate = 'off';
        config.models = { ...config.models, adapter: 'replay', replayFile: 'responses.jsonl' };
        config.sandbox = 'off';
        config.protectedTests = ['node_modules/**'];
        writeFileSync(configPath, JSON.stringify(config));
        const argv = [
          process.execPath,
          '-e',
          `require('fs').cpSync(${JSON.stringify(join(f.repo, 'node_modules'))},'node_modules',{recursive:true})`,
        ];
        writeFileSync(
          join(f.repo, '.tuig', 'checks.json'),
          JSON.stringify({
            schema_version: 1,
            checks: [{ name: 'populate', argv, timeoutSec: 60 }],
          }),
        );
        writeFileSync(
          join(f.repo, 'responses.jsonl'),
          JSON.stringify({
            type: 'model_response',
            data: {
              step: 0,
              response: {
                message: 'Done.',
                toolCalls: [],
                usage: { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 },
                stopReason: 'stop',
              },
            },
          }) + '\n',
        );
        f.git(['add', '.']);
        f.git([
          '-c',
          'user.name=T',
          '-c',
          'user.email=t@e.invalid',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '-qm',
          'configure',
        ]);
        trustRepository(f.repo);
        const result = await runCommand({
          cwd: f.repo,
          platform: 'linux',
          instruction: 'No edits.',
          interactive: false,
        });
        assert.equal(result.data.state, 'ERROR');
        assert.equal(result.error.code, 'TUIG_E_WORKSPACE');
        assert.match(result.error.message, /protected.*list.*limit/i);
        assert.match(result.next_action, /protectedTests/);
        const summary = JSON.parse(
          readFileSync(join(f.repo, '.tuig', 'runs', result.data.id, 'summary.json'), 'utf8'),
        );
        assert.deepEqual(summary.protectionError, result.error);
        assert.equal((await replayRun(result.data.id, f.repo)).status, 'ok');
      },
    );
  },
);

test('round2: Python caches are neither protected modifications nor oracle snapshot inputs', (t) => {
  const f = fixture(t);
  for (const path of [
    'tests-visible/__pycache__/x.pyc',
    'tests-visible/.pytest_cache/v/cache/nodeids',
    'tests-visible/loose.pyc',
  ]) {
    mkdirSync(join(f.repo, path, '..'), { recursive: true });
    writeFileSync(join(f.repo, path), 'cache');
    assert.equal(isProtectedTest(path, ['tests-visible/**']), false, path);
    assert.equal(oracleSnapshotPath(path), false, path);
  }
  assert.deepEqual(changedTests(f.workspace, ['tests-visible/**']), []);
  assert.equal(isProtectedTest('tests-visible/conftest.py', ['tests-visible/**']), true);
});

test('round2: unsupported protected globs have actionable config errors', () => {
  for (const pattern of [
    '**/*.{test,spec}.js',
    '**/!(*.py)',
    '**/[ab].py',
    'tests/a**b',
    'tests/?.py',
  ]) {
    assert.throws(
      () => protectedTests([pattern]),
      (error) => {
        assert.equal(error.code, 'TUIG_E_CONFIG');
        assert.ok(error.message.includes(pattern));
        assert.match(error.next_action, /expand|separate|literal/i);
        const response = commandFailure('run', error);
        assert.equal(response.error.code, 'TUIG_E_CONFIG');
        assert.ok(response.error.message.includes(pattern));
        assert.equal(response.next_action, error.next_action);
        return true;
      },
    );
  }
});

test('round2: every init glob matches intended ignored files through Git and the post-filter', (t) => {
  const f = fixture(t);
  const defaults = JSON.parse(readFileSync('templates/init/v1/config.json', 'utf8')).protectedTests;
  const examples = [
    'test/.hidden/a.py',
    'tests/.hidden/a.py',
    'tests-visible/.hidden/a.py',
    'nested/.a.test.js',
    'nested/.a.spec.ts',
    '.hidden/test_a.py',
    'conftest.py',
    'nested/.hidden/conftest.py',
    'nested/pytest.ini',
    '.pytest.ini',
    'nested/pyproject.toml',
    'nested/tox.ini',
    'nested/setup.cfg',
  ];
  writeFileSync(join(f.repo, '.gitignore'), '*\n');
  for (const path of examples) {
    mkdirSync(join(f.repo, path, '..'), { recursive: true });
    writeFileSync(join(f.repo, path), 'data');
  }
  for (const pattern of defaults) {
    assert.deepEqual(protectedTests([pattern]), [pattern]);
    const expected = examples.filter((path) => isProtectedTest(path, [pattern]));
    assert.ok(expected.length, pattern);
    const listed = f
      .git([
        'ls-files',
        '-z',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--',
        ':(glob)' + pattern,
      ])
      .split('\0');
    for (const path of expected) assert.ok(listed.includes(path), pattern + ': ' + path);
  }
});

const reportError =
  '<testsuite tests="1" errors="1"><testcase name="import"><error message="broken solution import"/></testcase></testsuite>';
for (const [name, report, exitCode, verdict, code] of [
  ['collection error', reportError, 2, 'fail', undefined],
  [
    'inconsistent report',
    '<testsuite tests="2"><testcase name="one"/></testsuite>',
    0,
    'infrastructure_error',
    'TUIG_E_PREREQUISITE',
  ],
  ['missing report', null, 2, 'infrastructure_error', 'TUIG_E_PREREQUISITE'],
  [
    'final pinned hash',
    '<testsuite tests="1"><testcase name="one"/></testsuite>',
    0,
    'infrastructure_error',
    'TUIG_E_ORACLE_REVIEW',
  ],
  [
    'flags and excluded caches',
    '<testsuite tests="1"><testcase name="one"/></testsuite>',
    0,
    'pass',
    undefined,
  ],
])
  test(
    'round2 fake Python: ' + name,
    { skip: process.platform === 'win32', timeout: 15000 },
    async (t) => {
      const sandbox = detectSandbox();
      if (!sandbox) {
        assert.notEqual(process.env.TUIG_REQUIRE_SANDBOX, '1');
        t.skip('sandbox unavailable');
        return;
      }
      const f = fixture(t);
      const bin = mkdtempSync('/var/tmp/tuig-final-python-');
      const old = process.env.PATH;
      t.after(() => {
        process.env.PATH = old;
        rmSync(bin, { recursive: true, force: true });
      });
      process.env.PATH = bin + delimiter + old;
      const task = join(f.root, 'task');
      mkdirSync(join(task, 'tests-hidden'), { recursive: true });
      const bytes = Buffer.from('def test_final_oracle(): assert True\n');
      writeFileSync(join(task, 'tests-hidden', 'test_oracle.py'), bytes);
      const oracle = loadOracle(f.repo, task, {
        oracle: {
          framework: 'pytest',
          hidden: 'tests-hidden/test_oracle.py',
          sha256: { hidden: createHash('sha256').update(bytes).digest('hex') },
        },
        timeouts: { hiddenSec: 5 },
      });
      if (name === 'final pinned hash') oracle.bytes.fill(0x20);
      mkdirSync(join(f.repo, 'tests-visible', '__pycache__'));
      writeFileSync(join(f.repo, 'tests-visible', '__pycache__', 'x.pyc'), 'stale bytecode');
      mkdirSync(join(f.repo, 'tests-visible', '.pytest_cache'));
      writeFileSync(join(f.repo, 'tests-visible', '.pytest_cache', 'nodeids'), 'cache');
      writeFileSync(
        join(bin, 'python'),
        '#!' +
          process.execPath +
          '\n' +
          `const fs=require('fs'),assert=require('assert');const args=process.argv.slice(2);const reportArg=args.find(a=>a.startsWith('--junitxml='));assert.deepEqual(args,['-I','-m','pytest','-p','no:cacheprovider','--noconftest','-o','pythonpath=.','-o','xfail_strict=true','-c','tests-hidden/pytest.ini',reportArg,'tests-hidden/test_oracle.py']);if(${name === 'flags and excluded caches'}){assert(!fs.existsSync('tests-visible/__pycache__'));assert(!fs.existsSync('tests-visible/.pytest_cache'));}if(${report !== null})fs.writeFileSync(reportArg.slice('--junitxml='.length),${JSON.stringify(report)});process.exit(${exitCode});\n`,
      );
      chmodSync(join(bin, 'python'), 0o755);
      const result = await finalOracle(f.repo, oracle, { sandbox });
      assert.equal(result.verdict, verdict);
      if (code) assert.equal(result.code, code);
    },
  );
