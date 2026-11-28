import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as protection from '../dist/engine/protected-tests.js';
import { executeCheck } from '../dist/checks/execute.js';
import { executeTool } from '../dist/runner/tools/index.js';
import { createRecord } from '../dist/engine/record.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tuig-hardening-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(['init', '-q']);
  writeFileSync(join(root, '.gitignore'), '.tuig/\nnode_modules/\ntests/ignored/\n');
  writeFileSync(join(root, 'a.txt'), 'old\n');
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
    git,
    workspace: {
      root,
      path: root,
      base: git(['rev-parse', 'HEAD']),
      branch: git(['symbolic-ref', '--short', 'HEAD']),
      id: 'hardening',
    },
  };
}

test('hardening: ignored dependency tests use the run-start content baseline', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'node_modules/dependency/test'), { recursive: true });
  const file = join(f.root, 'node_modules/dependency/test/a.test.js');
  writeFileSync(file, 'original');
  const patterns = ['**/*.test.js', 'tests/**'];
  const baseline = protection.protectionState(f.workspace, patterns);
  assert.deepEqual(protection.changedTests(f.workspace, patterns, baseline), []);
  writeFileSync(file, 'modified');
  assert.deepEqual(protection.changedTests(f.workspace, patterns, baseline), [
    'node_modules/dependency/test/a.test.js',
  ]);
  rmSync(file);
  assert.deepEqual(protection.changedTests(f.workspace, patterns, baseline), [
    'node_modules/dependency/test/a.test.js',
  ]);
  writeFileSync(file, 'original');
  mkdirSync(join(f.root, 'tests/ignored'), { recursive: true });
  writeFileSync(join(f.root, 'tests/ignored/conftest.py'), 'assert False');
  assert.deepEqual(protection.changedTests(f.workspace, patterns, baseline), [
    'tests/ignored/conftest.py',
  ]);
});

test('hardening: visible and edit checks ignore forged workspace Python bytecode', async (t) => {
  const f = fixture(t);
  const python = process.platform === 'win32' ? 'python' : 'python3';
  writeFileSync(join(f.root, 'helper.py'), "VALUE = 'source'\n");
  const plant = spawnSync(
    python,
    [
      '-c',
      "import importlib.util, importlib._bootstrap_external as b, pathlib, os; p=pathlib.Path('helper.py'); c=pathlib.Path(importlib.util.cache_from_source(str(p))); c.parent.mkdir(exist_ok=True); s=p.stat(); c.write_bytes(b._code_to_timestamp_pyc(compile(\"VALUE='forged'\",str(p),'exec'),int(s.st_mtime),s.st_size))",
    ],
    { cwd: f.root, encoding: 'utf8' },
  );
  assert.equal(plant.status, 0, plant.stderr);
  const exposed = spawnSync(python, ['-c', 'import helper; print(helper.VALUE)'], {
    cwd: f.root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPYCACHEPREFIX: '', PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(exposed.status, 0, exposed.stderr);
  assert.equal(
    exposed.stdout.trim(),
    'forged',
    'the forged cache must be usable without harness isolation',
  );
  const check = {
    name: 'python',
    kind: 'repair',
    parser: 'ruff-json',
    paths: ['*.py'],
    timeoutSec: 10,
    argv: [
      python,
      '-c',
      "import helper; assert helper.VALUE == 'source', helper.VALUE; print('[]')",
    ],
  };
  const visible = await executeCheck(f.root, check);
  assert.equal(visible.passed, true, JSON.stringify(visible));
  writeFileSync(join(f.root, 'a.py'), 'old\n');
  const store = createRecord(f.root, 'python');
  const edited = await executeTool(
    { id: 'edit', name: 'edit', arguments: { path: 'a.py', search: 'old', replace: 'new' } },
    { root: f.root, store, mode: 'auto', checks: [check] },
  );
  assert.equal(edited.status, 'ok', edited.output);
  assert.equal(readFileSync(join(f.root, 'a.py'), 'utf8'), 'new\n');
});

test('hardening: resume restores original baseline and refuses missing baseline', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'tests/ignored'), { recursive: true });
  const file = join(f.root, 'tests/ignored/conftest.py');
  writeFileSync(file, 'old');
  const baseline = protection.protectionState(f.workspace, ['tests/**']);
  writeFileSync(file, 'new');
  const restored = protection.restoreProtectionState(JSON.parse(JSON.stringify(baseline)));
  assert.deepEqual(protection.changedTests(f.workspace, ['tests/**'], restored), [
    'tests/ignored/conftest.py',
  ]);
  for (const value of [undefined, {}, { ...baseline, ignored: undefined }])
    assert.throws(() => protection.restoreProtectionState(value), { code: 'TUIG_E_WORKSPACE' });
});
