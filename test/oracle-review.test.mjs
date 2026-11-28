import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { changedTests, isProtectedTest } from '../dist/engine/protected-tests.js';
import { finalOracle } from '../dist/engine/oracle.js';
import { detectSandbox } from '../dist/sandbox/index.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tuig-review-'));
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
  mkdirSync(join(repo, 'tests'));
  writeFileSync(join(repo, 'tests', 'visible.py'), 'assert True\n');
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
  return {
    repo,
    git,
    workspace: {
      path: repo,
      root: repo,
      id: 'review',
      branch: 'review',
      base: git(['rev-parse', 'HEAD']),
    },
  };
}

test('review: ignored protected additions cannot bypass final gating', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, '.gitignore'), '.tuig/\ntests/conftest.py\n');
  writeFileSync(
    join(f.repo, 'tests', 'conftest.py'),
    'def pytest_collection_modifyitems(items): items.clear()\n',
  );
  assert.ok(changedTests(f.workspace, ['tests/**']).includes('tests/conftest.py'));
});

test('review: ignore edits hiding modified protected additions are recorded as tampering', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'tests', 'generated.py'), 'assert False\n');
  assert.ok(changedTests(f.workspace, ['tests/**']).includes('tests/generated.py'));
  writeFileSync(join(f.repo, 'tests', 'generated.py'), 'assert True\n');
  writeFileSync(join(f.repo, '.gitignore'), '.tuig/\ntests/generated.py\n');
  const paths = changedTests(f.workspace, ['tests/**']);
  assert.ok(paths.includes('tests/generated.py'));
  assert.ok(paths.includes('.gitignore'));
});

test('review: test-directory globs include dot paths', () => {
  for (const path of ['tests/.x.py', 'tests/.hidden/conftest.py', 'tests/.hidden/.test.py'])
    assert.equal(isProtectedTest(path, ['tests/**']), true, path);
});
test('review: init protects pytest steering files', () => {
  const config = JSON.parse(readFileSync('templates/init/v1/config.json', 'utf8'));
  for (const path of ['conftest.py', 'nested/conftest.py', 'pytest.ini', '.pytest.ini'])
    assert.equal(isProtectedTest(path, config.protectedTests), true, path);
});

test('review: info exclude changes hiding protected paths are recorded', (t) => {
  const f = fixture(t);
  const exclude = join(f.repo, '.git', 'info', 'exclude');
  const baseline = {
    exclude,
    excludeHash: createHash('sha256').update(readFileSync(exclude)).digest('hex'),
  };
  writeFileSync(exclude, 'tests/conftest.py\n');
  writeFileSync(
    join(f.repo, 'tests', 'conftest.py'),
    'def pytest_collection_modifyitems(items): items.clear()\n',
  );
  const paths = changedTests(f.workspace, ['tests/**'], baseline);
  assert.ok(paths.includes('tests/conftest.py'));
  assert.ok(paths.includes('.git/info/exclude'));
});

const reports = [
  [
    'skipped-only',
    '<testsuite tests="1" skipped="1"><testcase name="s"><skipped/></testcase></testsuite>',
    'fail',
  ],
  [
    'mixed-pass-skip',
    '<testsuite tests="2" skipped="1"><testcase name="p"/><testcase name="s"><skipped/></testcase></testsuite>',
    'fail',
  ],
  [
    'xfail',
    '<testsuite tests="1" skipped="1"><testcase name="x"><skipped type="pytest.xfail"/></testcase></testsuite>',
    'fail',
  ],
  ['xpass', '<testsuite tests="1"><testcase name="x" status="xpass"/></testsuite>', 'fail'],
  [
    'suite-skipped-counter',
    '<testsuite tests="1" skipped="1"><testcase name="s"/></testsuite>',
    'fail',
  ],
  [
    'all-passed',
    '<testsuite tests="2" skipped="0"><testcase name="a"/><testcase name="b"/></testsuite>',
    'pass',
  ],
  [
    'invalid-count',
    '<testsuite tests="2"><testcase name="a"/></testsuite>',
    'infrastructure_error',
  ],
  ['empty-valid', '<testsuite tests="0"/>', 'fail'],
  [
    'skipped-exit-five',
    '<testsuite tests="1" skipped="1"><testcase name="s"><skipped/></testcase></testsuite>',
    'fail',
    5,
  ],
  ['empty-exit-five', '<testsuite tests="0"/>', 'fail', 5],
  [
    'forged-predictable',
    '<testsuite tests="1"><testcase name="forged"/></testsuite>',
    'infrastructure_error',
  ],
];
for (const [name, report, verdict, exitCode = 0] of reports)
  test(
    'review fake Python oracle: ' + name,
    { skip: process.platform === 'win32', timeout: 15000 },
    async (t) => {
      const sandbox = detectSandbox();
      if (!sandbox) {
        assert.notEqual(process.env.TUIG_REQUIRE_SANDBOX, '1');
        t.skip('sandbox unavailable');
        return;
      }
      const f = fixture(t);
      const bin = mkdtempSync('/var/tmp/tuig-review-bin-');
      const old = process.env.PATH;
      t.after(() => {
        process.env.PATH = old;
        rmSync(bin, { recursive: true, force: true });
      });
      process.env.PATH = bin + delimiter + old;
      const bytes = Buffer.from('def test_review_oracle(): assert True\n');
      const oracle = {
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        timeoutMs: 5000,
        sourceDirectory: f.repo,
      };
      writeFileSync(
        join(bin, 'python'),
        '#!' +
          process.execPath +
          '\n' +
          `const p=${name === 'forged-predictable' ? "'tests-hidden/result.xml'" : "process.argv.find(a=>a.startsWith('--junitxml=')).slice('--junitxml='.length)"};require('fs').writeFileSync(p,${JSON.stringify(report)});process.exit(${exitCode});\n`,
      );
      chmodSync(join(bin, 'python'), 0o755);
      assert.equal((await finalOracle(f.repo, oracle, { sandbox })).verdict, verdict);
    },
  );

test(
  'review fake Python oracle: report is random and outside snapshot; XPASS is strict',
  { skip: process.platform === 'win32', timeout: 15000 },
  async (t) => {
    const sandbox = detectSandbox();
    if (!sandbox) {
      assert.notEqual(process.env.TUIG_REQUIRE_SANDBOX, '1');
      t.skip('sandbox unavailable');
      return;
    }
    const f = fixture(t);
    const bin = mkdtempSync('/var/tmp/tuig-report-bin-');
    const old = process.env.PATH;
    t.after(() => {
      process.env.PATH = old;
      rmSync(bin, { recursive: true, force: true });
    });
    process.env.PATH = bin + delimiter + old;
    const bytes = Buffer.from('def test_report_oracle(): assert True\n');
    const oracle = {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      timeoutMs: 5000,
      sourceDirectory: f.repo,
    };
    writeFileSync(
      join(bin, 'python'),
      '#!' +
        process.execPath +
        '\n' +
        `const fs=require('fs'),path=require('path');const p=process.argv.find(a=>a.startsWith('--junitxml=')).slice('--junitxml='.length);if(path.isAbsolute(p)&&!p.startsWith(process.cwd()+path.sep)&&process.argv.includes('xfail_strict=true'))fs.writeFileSync(p,'<testsuite tests="1"><testcase name="a"/></testsuite>');process.exit(0);\n`,
    );
    chmodSync(join(bin, 'python'), 0o755);
    assert.equal((await finalOracle(f.repo, oracle, { sandbox })).verdict, 'pass');
  },
);
