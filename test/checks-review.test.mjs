import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseChecks } from '../dist/checks/config.js';
import { executeCheck } from '../dist/checks/execute.js';
import { parseDiagnostics } from '../dist/checks/parsers.js';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'tuig-checks-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function check(extra = {}) {
  return parseChecks({
    schema_version: 1,
    checks: [{ name: 'review', argv: [process.execPath, '-e', '// no output'], ...extra }],
  })[0];
}

test(
  'JUnit rejects an in-workspace report symlink without deleting its target',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = temporary(t),
      target = join(root, 'src/main.ts');
    mkdirSync(join(root, 'src'));
    const original = 'export const original = true;\n';
    writeFileSync(target, original);
    symlinkSync(target, join(root, 'report.xml'));
    const result = await executeCheck(root, check({ parser: 'junit', reportPath: 'report.xml' }));
    assert.equal(existsSync(target), true, 'report preparation must not unlink the symlink target');
    assert.equal(readFileSync(target, 'utf8'), original);
    assert.equal(result.passed, false);
  },
);

test('parser input cap rejects otherwise valid oversized JSON and fails the check closed', async (t) => {
  const input = '[]' + ' '.repeat(1024 * 1024);
  assert.deepEqual(JSON.parse(input), [], 'the input must be valid JSON without the size cap');
  assert.throws(() => parseDiagnostics('eslint-json', 'eslint', input), /exceeds 1 MiB/);
  const result = await executeCheck(
    temporary(t),
    check({
      parser: 'eslint-json',
      argv: [process.execPath, '-e', 'process.stdout.write("[]" + " ".repeat(1024 * 1024))'],
    }),
  );
  assert.equal(result.passed, false);
  assert.equal(result.status, 'invalid_report');
});

test('structured parser failures preserve timeout, cancellation and nonzero process status', async (t) => {
  const root = temporary(t);
  const hanging = check({
    parser: 'eslint-json',
    timeoutSec: 0.05,
    argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'],
  });
  const timedOut = await executeCheck(root, hanging, { graceMs: 10 });
  assert.equal(timedOut.passed, false);
  assert.equal(timedOut.status, 'timeout');
  assert.match(timedOut.diagnostics[0].message, /timeout/);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await executeCheck(root, hanging, { signal: controller.signal, graceMs: 10 });
  assert.equal(cancelled.passed, false);
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.diagnostics[0].message, /cancelled/);
  const unavailable = await executeCheck(root, {
    ...hanging,
    argv: ['tuig-review-command-does-not-exist'],
  });
  assert.equal(unavailable.passed, false);
  assert.equal(unavailable.status, 'nonzero_exit');
  assert.match(unavailable.diagnostics[0].message, /nonzero_exit/);
});

for (const missing of ['config.json', 'checks.json']) {
  test('checks reports unconfigured when trusted repository lacks ' + missing, (t) => {
    const root = temporary(t),
      repo = join(root, 'repo');
    mkdirSync(repo);
    const git = (argv) => {
      const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...argv], {
        cwd: repo,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    };
    git(['init']);
    initialize(repo);
    if (missing === 'checks.json') {
      const file = join(repo, '.tuig/config.json');
      const config = JSON.parse(readFileSync(file, 'utf8'));
      config.mode = 'auto';
      writeFileSync(file, JSON.stringify(config));
    }
    git(['add', '.']);
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'review fixture',
    ]);
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(root, 'state');
    t.after(() => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    });
    trustRepository(repo);
    rmSync(join(repo, '.tuig', missing));
    const result = spawnSync(process.execPath, [resolve('dist/main.js'), 'checks', '--json'], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.status, 'unconfigured');
    assert.equal(envelope.error.code, 'TUIG_E_UNCONFIGURED');
    assert.equal(envelope.next_action, 'Run tuig init.');
  });
}
