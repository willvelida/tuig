import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  symlinkSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { doctor } from '../dist/cli/commands/doctor.js';
const entry = resolve('dist/main.js');
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'tuig-init-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  const env = {
    ...process.env,
    TUIG_OUTPUT: 'json',
    XDG_CONFIG_HOME: join(base, 'state'),
    TUIG_TRUST_CI: '0',
  };
  for (const args of [
    ['init'],
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    ],
  ])
    assert.equal(
      spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8' })
        .status,
      0,
    );
  const invoke = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [entry, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...env, ...extra },
    });
    assert.equal(r.stderr, '');
    return { ...r, value: JSON.parse(r.stdout) };
  };
  return { base, repo, env, invoke };
}
function snapshot(root) {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && !e.parentPath.includes(join(root, '.git')))
      .map((e) => {
        const p = join(e.parentPath, e.name);
        return [p, { content: readFileSync(p, 'utf8'), mtime: statSync(p).mtimeMs }];
      }),
  );
}
test('init twice is byte and mtime idempotent; lock hashes match generated files', (t) => {
  const f = fixture(t);
  assert.equal(f.invoke(['init']).status, 0);
  assert.equal(existsSync(join(f.repo, 'AGENTS.md')), false);
  const before = snapshot(f.repo);
  assert.equal(f.invoke(['init']).status, 0);
  assert.deepEqual(snapshot(f.repo), before);
  const lock = JSON.parse(readFileSync(join(f.repo, '.tuig/template.lock.json'), 'utf8'));
  for (const [p, value] of Object.entries(lock.files)) {
    assert.equal(value.templateVersion, 1);
    assert.equal(
      value.sha256,
      createHash('sha256')
        .update(readFileSync(join(f.repo, p)))
        .digest('hex'),
    );
  }
});
test('hand-edited files preserved, template diff reads without changes, AGENTS requires flag', (t) => {
  const f = fixture(t);
  f.invoke(['init']);
  writeFileSync(join(f.repo, '.tuig/config.json'), 'hand edit');
  writeFileSync(join(f.repo, 'AGENTS.md'), 'human instructions\n');
  const r = f.invoke(['init']);
  assert.equal(r.value.status, 'degraded');
  assert.equal(readFileSync(join(f.repo, '.tuig/config.json'), 'utf8'), 'hand edit');
  assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), 'human instructions\n');
  const before = snapshot(f.repo);
  const diff = f.invoke(['template', 'diff']);
  assert.ok(diff.value.data.files.find((x) => x.path === '.tuig/config.json').changed);
  assert.deepEqual(snapshot(f.repo), before);
  f.invoke(['init', '--write-agents-md']);
  const agents = readFileSync(join(f.repo, 'AGENTS.md'), 'utf8');
  assert.match(agents, /human instructions/);
  assert.equal(agents.split('<!-- tuig:start -->').length, 2);
  f.invoke(['init', '--write-agents-md']);
  assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), agents);
  writeFileSync(join(f.repo, 'AGENTS.md'), agents.replace('Use tuig', 'Use reviewed tuig'));
  f.invoke(['init', '--write-agents-md']);
  assert.match(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), /Use reviewed tuig/);
});
test('trust requires noninteractive opt-in, is user-level, and doctor observes real init/trust flow', (t) => {
  const f = fixture(t);
  f.invoke(['init']);
  assert.equal(f.invoke(['trust']).status, 2);
  assert.equal(existsSync(join(f.base, 'state/tuig/trusted.json')), false);
  assert.equal(f.invoke(['doctor']).value.next_action, 'tuig trust');
  assert.equal(f.invoke(['trust'], { TUIG_TRUST_CI: '1' }).status, 0);
  const file = join(f.base, 'state/tuig/trusted.json');
  const before = readFileSync(file, 'utf8');
  f.invoke(['trust'], { TUIG_TRUST_CI: '1' });
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(existsSync(join(f.repo, '.tuig/trusted.json')), false);
  const healthy = doctor({
    cwd: f.repo,
    platform: 'linux',
    nodeVersion: '24.0.0',
    trustPath: file,
    probe: () => ({ ok: true, detail: 'available' }),
  });
  assert.equal(healthy.status, 'ok');
  const actual = f.invoke(['doctor']);
  assert.ok(['ok', 'degraded'].includes(actual.value.status));
  assert.ok(actual.value.data.checks.find((c) => c.name === 'trusted').ok);
});
test('untrusted checks are not executed by init, doctor or template diff', (t) => {
  const f = fixture(t);
  f.invoke(['init']);
  const marker = join(f.repo, 'executed');
  writeFileSync(
    join(f.repo, '.tuig/checks.json'),
    JSON.stringify({
      schema_version: 1,
      checks: [
        {
          name: 'evil',
          argv: [
            process.execPath,
            '-e',
            'require("fs").writeFileSync(' + JSON.stringify(marker) + ',"bad")',
          ],
        },
      ],
    }),
  );
  for (const args of [['init'], ['doctor'], ['template', 'diff']]) f.invoke(args);
  assert.equal(existsSync(marker), false);
});
test('scaffold symlink escapes are refused before writes', (t) => {
  const f = fixture(t);
  const outside = join(f.base, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(f.repo, '.tuig'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(f.invoke(['init']).status, 1);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(existsSync(join(f.repo, '.gitignore')), false);
});
