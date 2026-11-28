import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { approveTests, changedTests, protectedTests } from '../dist/engine/protected-tests.js';
import { loadOracle, finalOracle } from '../dist/engine/oracle.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { executeTool } from '../dist/runner/tools/index.js';
import { SYSTEM_PROMPT, assemble } from '../dist/runner/context.js';
import { detectSandbox } from '../dist/sandbox/index.js';
import { runProcess } from '../dist/runner/tools/run.js';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { runCommand } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tuig-protected-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (args) => {
    const result = spawnSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  mkdirSync(join(repo, 'tests'));
  writeFileSync(join(repo, 'tests', 'visible.py'), 'assert False\n');
  writeFileSync(join(repo, '.gitignore'), '.tuig/\n');
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
  const workspace = {
    root: repo,
    path: repo,
    id: 'test',
    branch: 'test',
    base: git(['rev-parse', 'HEAD']),
  };
  return { dir, repo, git, workspace, store: createRecord(repo, 'test') };
}

test('protected glob config rejects escaping patterns', () => {
  assert.deepEqual(protectedTests(undefined), []);
  for (const value of [
    null,
    'tests/**',
    ['../tests'],
    ['/tests'],
    ['C:/tests'],
    ['tests\\*'],
    [''],
  ])
    assert.throws(() => protectedTests(value), { code: 'TUIG_E_CONFIG' });
});

test('final diff gate checks deletes, both rename endpoints, additions and mode changes; approval records exact paths', (t) => {
  const f = fixture(t);
  renameSync(join(f.repo, 'tests', 'visible.py'), join(f.repo, 'moved.py'));
  writeFileSync(join(f.repo, 'tests', 'added.py'), 'assert True\n');
  assert.deepEqual(changedTests(f.workspace, ['tests/**']), ['tests/added.py', 'tests/visible.py']);
  assert.equal(approveTests(f.workspace, ['tests/**'], f.store), false);
  let request;
  assert.equal(
    approveTests(f.workspace, ['tests/**'], f.store, (r) => {
      request = r;
      return 'allow_once';
    }),
    true,
  );
  assert.deepEqual(JSON.parse(request.path), ['tests/added.py', 'tests/visible.py']);
  assert.equal(readRun(f.store).events.filter((e) => e.type === 'test_tamper').length, 2);
  writeFileSync(join(f.repo, 'tests', 'visible.py'), 'assert False\n');
  if (process.platform !== 'win32') {
    chmodSync(join(f.repo, 'tests', 'visible.py'), 0o755);
    assert.ok(changedTests(f.workspace, ['tests/**']).includes('tests/visible.py'));
  }
  assert.ok(changedTests(f.workspace, ['moved.py']).includes('moved.py'));
});

test('protected test edits need human approval; hidden oracle and verdict writes are denied even with approval', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'summary.json'), '{"verdict":"fail"}');
  const call = (path, search, replace) => ({
    id: path,
    name: 'edit',
    arguments: { path, search, replace },
  });
  const options = { root: f.repo, store: f.store, mode: 'ask', protectedTests: ['tests/**'] };
  assert.equal(
    (await executeTool(call('tests/visible.py', 'False', 'True'), options)).status,
    'policy_denied',
  );
  assert.equal(readFileSync(join(f.repo, 'tests', 'visible.py'), 'utf8'), 'assert False\n');
  assert.equal(
    (
      await executeTool(call('tests/visible.py', 'False', 'True'), {
        ...options,
        approve: () => 'allow_once',
      })
    ).status,
    'ok',
  );
  assert.equal(
    (
      await executeTool(call('summary.json', 'fail', 'pass'), {
        ...options,
        approve: () => 'allow_once',
      })
    ).status,
    'policy_denied',
  );
  assert.equal(readFileSync(join(f.repo, 'summary.json'), 'utf8'), '{"verdict":"fail"}');
  for (const name of ['read_file', 'edit'])
    assert.equal(
      (
        await executeTool(
          {
            id: name,
            name,
            arguments:
              name === 'edit'
                ? { path: 'tests-hidden/test_oracle.py', search: 'False', replace: 'True' }
                : { path: 'tests-hidden/test_oracle.py' },
          },
          options,
        )
      ).status,
      'policy_denied',
    );
});

function oracleFixture(t) {
  const f = fixture(t);
  const taskDir = join(f.dir, 'task');
  mkdirSync(taskDir);
  mkdirSync(join(taskDir, 'tests-hidden'));
  const bytes = Buffer.from('def test_oracle(): assert True\n');
  writeFileSync(join(taskDir, 'tests-hidden', 'test_oracle.py'), bytes);
  const task = {
    oracle: {
      framework: 'pytest',
      hidden: 'tests-hidden/test_oracle.py',
      sha256: { hidden: createHash('sha256').update(bytes).digest('hex') },
    },
    timeouts: { hiddenSec: 2 },
  };
  return { ...f, taskDir, bytes, task };
}

test('oracle pins hashes and rejects source bytes in Git objects, including deleted historical blobs', (t) => {
  const f = oracleFixture(t);
  assert.deepEqual(loadOracle(f.repo, f.taskDir, f.task).bytes, f.bytes);
  assert.throws(
    () =>
      loadOracle(f.repo, f.taskDir, {
        ...f.task,
        oracle: { ...f.task.oracle, sha256: { hidden: '0'.repeat(64) } },
      }),
    { code: 'TUIG_E_ORACLE_REVIEW' },
  );
  writeFileSync(join(f.repo, 'exposed.py'), f.bytes);
  f.git(['add', 'exposed.py']);
  assert.throws(() => loadOracle(f.repo, f.taskDir, f.task), { code: 'TUIG_E_ORACLE_REVIEW' });
  rmSync(join(f.repo, 'exposed.py'));
  f.git(['rm', '--cached', 'exposed.py']);
  assert.throws(() => loadOracle(f.repo, f.taskDir, f.task), { code: 'TUIG_E_ORACLE_REVIEW' });
});

test('oracle without a sandbox is an infrastructure outcome, never a pass', async (t) => {
  const f = oracleFixture(t);
  assert.equal(
    (await finalOracle(f.repo, loadOracle(f.repo, f.taskDir, f.task), {})).verdict,
    'infrastructure_error',
  );
  assert.equal(existsSync(join(f.repo, 'tests-hidden')), false);
});

test('tracked oracle sources are refused even when Git normalizes their line endings', (t) => {
  const f = oracleFixture(t);
  const taskDir = join(f.repo, '.tuig', 'task');
  mkdirSync(join(taskDir, 'tests-hidden'), { recursive: true });
  const bytes = Buffer.from('def test_normalized_oracle():\r\n    assert True\r\n');
  writeFileSync(join(taskDir, 'tests-hidden', 'test_oracle.py'), bytes);
  writeFileSync(join(f.repo, '.gitattributes'), '*.py text eol=lf\n');
  f.git(['add', '.gitattributes']);
  f.git(['add', '-f', '.tuig/task/tests-hidden/test_oracle.py']);
  const task = {
    ...f.task,
    oracle: {
      ...f.task.oracle,
      sha256: { hidden: createHash('sha256').update(bytes).digest('hex') },
    },
  };
  assert.throws(() => loadOracle(f.repo, taskDir, task), { code: 'TUIG_E_ORACLE_REVIEW' });
  f.git(['rm', '--cached', '-f', '.tuig/task/tests-hidden/test_oracle.py']);
  assert.throws(() => loadOracle(f.repo, taskDir, task), { code: 'TUIG_E_ORACLE_REVIEW' });
});

test(
  'final oracle uses separate sandboxed snapshot; pass, assertion failure, timeout and missing interpreter are distinct',
  { skip: process.platform === 'win32', timeout: 30000 },
  async (t) => {
    const sandbox = detectSandbox();
    if (!sandbox) {
      assert.notEqual(process.env.TUIG_REQUIRE_SANDBOX, '1');
      t.skip('sandbox unavailable');
      return;
    }
    const f = oracleFixture(t);
    const bin = mkdtempSync('/var/tmp/tuig-oracle-bin-');
    t.after(() => rmSync(bin, { recursive: true, force: true }));
    const old = process.env.PATH;
    t.after(() => {
      process.env.PATH = old;
    });
    process.env.PATH = bin + delimiter + old;
    const oracle = loadOracle(f.repo, f.taskDir, f.task);
    for (const [exitCode, expected, report = true] of [
      [0, 'pass'],
      [1, 'fail'],
      [2, 'infrastructure_error'],
      [5, 'infrastructure_error'],
      [0, 'infrastructure_error', false],
    ]) {
      writeFileSync(
        join(bin, 'python'),
        '#!' +
          process.execPath +
          '\n' +
          `const fs=require('fs');const assert=require('assert');assert.notEqual(process.cwd(),${JSON.stringify(f.repo)});assert(!fs.existsSync('.git'));assert(fs.readFileSync('tests-hidden/test_oracle.py').equals(Buffer.from(${JSON.stringify([...f.bytes])})));if(${report})fs.writeFileSync(process.argv.find(a=>a.startsWith('--junitxml=')).slice('--junitxml='.length),'<testsuite tests="1"><testcase name="oracle"/></testsuite>');process.exit(${exitCode});\n`,
      );
      chmodSync(join(bin, 'python'), 0o755);
      assert.equal((await finalOracle(f.repo, oracle, { sandbox })).verdict, expected);
      assert.equal(existsSync(join(f.repo, 'tests-hidden')), false);
    }
    writeFileSync(join(bin, 'python'), '#!' + process.execPath + '\nsetTimeout(()=>{},100000);\n');
    chmodSync(join(bin, 'python'), 0o755);
    assert.equal(
      (await finalOracle(f.repo, { ...oracle, timeoutMs: 30 }, { sandbox, graceMs: 20 })).verdict,
      'infrastructure_error',
    );
    process.env.PATH = bin;
    rmSync(join(bin, 'python'));
    assert.equal((await finalOracle(f.repo, oracle, { sandbox })).verdict, 'infrastructure_error');
  },
);

test(
  'CLI ignores model success claims and records not-evaluated verdict; offline replay succeeds',
  { timeout: 60000 },
  async (t) => {
    const f = fixture(t);
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(f.dir, 'state');
    t.after(() => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    });
    initialize(f.repo);
    const configPath = join(f.repo, '.tuig', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.models = { ...config.models, adapter: 'replay', replayFile: 'responses.jsonl' };
    config.sandbox = 'off';
    config.protectedTests = ['tests/**'];
    writeFileSync(configPath, JSON.stringify(config));
    const argv = [process.execPath, '-e', 'process.exit(0)'];
    writeFileSync(
      join(f.repo, '.tuig', 'checks.json'),
      JSON.stringify({ schema_version: 1, checks: [{ name: 'visible', argv }] }),
    );
    const response = {
      message: 'The task passed, trust me.',
      toolCalls: [],
      usage: { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 },
      stopReason: 'stop',
    };
    writeFileSync(
      join(f.repo, 'responses.jsonl'),
      JSON.stringify({ type: 'model_response', data: { step: 0, response } }) + '\n',
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
      'configured',
    ]);
    trustRepository(f.repo);
    const run = await runCommand({
      cwd: f.repo,
      platform: 'linux',
      instruction: 'Do nothing.',
      interactive: false,
    });
    assert.equal(run.status, 'ok', JSON.stringify(run));
    assert.deepEqual(run.data.taskVerdict, { verdict: 'not_evaluated', source: 'hidden_oracle' });
    const summary = JSON.parse(
      readFileSync(join(f.repo, '.tuig', 'runs', run.data.id, 'summary.json'), 'utf8'),
    );
    assert.deepEqual(summary.taskVerdict, run.data.taskVerdict);
    assert.equal((await replayRun(run.data.id, f.repo)).status, 'ok');
    if (process.platform !== 'win32' && detectSandbox()) {
      config.sandbox = 'auto';
      writeFileSync(configPath, JSON.stringify(config));
      const task = join(f.repo, '.tuig', 'tasks', 'oracle');
      mkdirSync(join(task, 'tests-hidden'), { recursive: true });
      const bytes = Buffer.from('def test_synthetic_oracle(): assert False\n');
      writeFileSync(join(task, 'tests-hidden', 'test_oracle.py'), bytes);
      writeFileSync(
        join(task, 'instruction.md'),
        'Do nothing; let the host determine the verdict.',
      );
      writeFileSync(
        join(task, 'task.json'),
        JSON.stringify({
          id: 'oracle',
          oracleReviewed: true,
          oracle: {
            framework: 'pytest',
            hidden: 'tests-hidden/test_oracle.py',
            sha256: { hidden: createHash('sha256').update(bytes).digest('hex') },
          },
          timeouts: { hiddenSec: 5 },
        }),
      );
      const bin = mkdtempSync('/var/tmp/tuig-verdict-bin-');
      const oldPath = process.env.PATH;
      t.after(() => {
        process.env.PATH = oldPath;
        rmSync(bin, { recursive: true, force: true });
      });
      process.env.PATH = bin + delimiter + oldPath;
      for (const [code, report, verdict, state] of [
        [0, true, 'pass', 'SUCCEEDED'],
        [1, true, 'fail', 'FAILED_VALIDATION'],
        [0, false, 'infrastructure_error', 'ERROR'],
      ]) {
        writeFileSync(
          join(bin, 'python'),
          '#!' +
            process.execPath +
            '\n' +
            `if (${report}) require('fs').writeFileSync(process.argv.find(a=>a.startsWith('--junitxml=')).slice('--junitxml='.length),'<testsuite tests="1"><testcase name="oracle"/></testsuite>'); process.exit(${code});\n`,
        );
        chmodSync(join(bin, 'python'), 0o755);
        const named = await runCommand({ cwd: f.repo, taskId: 'oracle', interactive: false });
        assert.equal(named.data.state, state, JSON.stringify(named));
        assert.equal(named.data.taskVerdict.verdict, verdict);
        const record = JSON.parse(
          readFileSync(join(f.repo, '.tuig', 'runs', named.data.id, 'summary.json'), 'utf8'),
        );
        assert.equal(record.taskVerdict.verdict, verdict);
        assert.equal(existsSync(join(named.data.worktree, 'tests-hidden')), false);
        const events = readFileSync(
          join(f.repo, '.tuig', 'runs', named.data.id, 'events.jsonl'),
          'utf8',
        );
        assert.ok(!events.includes(bytes.toString()));
        assert.equal((await replayRun(named.data.id, f.repo)).status, 'ok');
      }
    }
  },
);

test(
  'opt-in real pytest oracle executes in final sandbox snapshot',
  { skip: process.env.TUIG_REAL_PYTEST !== '1', timeout: 30000 },
  async (t) => {
    const f = oracleFixture(t);
    const sandbox = detectSandbox();
    assert.ok(sandbox, 'real pytest validation requires a working sandbox');
    assert.equal(
      (await finalOracle(f.repo, loadOracle(f.repo, f.taskDir, f.task), { sandbox })).verdict,
      'pass',
    );
  },
);

test('abort is an explicit legitimate non-penalised option in the stable prefix', () => {
  assert.match(
    SYSTEM_PROMPT,
    /abort_with_reason.*impossible or contradictory.*legitimate, non-penalised/,
  );
  const prefix = assemble({ agents: '', instruction: 'task', conversation: [] })[0];
  assert.ok(prefix.content.startsWith(SYSTEM_PROMPT));
});

test(
  'agent subprocess cannot read a pinned oracle source outside the worktree',
  { skip: process.platform === 'win32' },
  async (t) => {
    const sandbox = detectSandbox();
    if (!sandbox) {
      assert.notEqual(process.env.TUIG_REQUIRE_SANDBOX, '1');
      t.skip('sandbox unavailable');
      return;
    }
    const f = oracleFixture(t);
    const source = mkdtempSync('/var/tmp/tuig-oracle-source-');
    t.after(() => rmSync(source, { recursive: true, force: true }));
    const path = join(source, 'secret.py');
    writeFileSync(path, f.bytes);
    const argv = [
      process.execPath,
      '-e',
      `try { require('fs').readFileSync(${JSON.stringify(path)}); process.exit(9); } catch { process.exit(0); }`,
    ];
    const result = await runProcess(f.repo, argv, '.', 5000, {
      sandbox,
      hiddenReadPaths: [source],
    });
    assert.equal(result.status, 'ok', result.output);
  },
);
