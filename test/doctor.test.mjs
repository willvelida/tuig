import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  realpathSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import Ajv from 'ajv';
import { doctor } from '../dist/cli/commands/doctor.js';
import { repositoryIdentity, validateConfig } from '../dist/engine/repository-state.js';
const validate = new Ajv({ strict: true }).compile(
  JSON.parse(readFileSync('schemas/envelope.schema.json', 'utf8')),
);
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'tuig-doctor-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(base, 'no-config'),
  };
  function git(args) {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repo,
      env,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  git(['init']);
  const trustPath = join(base, 'state', 'tuig', 'trusted.json');
  const options = {
    cwd: repo,
    platform: 'linux',
    nodeVersion: '24.0.0',
    trustPath,
    probe: () => ({ ok: true, detail: 'test tool 1.0' }),
  };
  function initialize() {
    git([
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
    ]);
    mkdirSync(join(repo, '.tuig'));
    writeFileSync(
      join(repo, '.tuig', 'config.json'),
      JSON.stringify({
        schema_version: 1,
        mode: 'ask',
        secretGate: 'required',
        models: { allowedEndpoints: [] },
      }),
    );
    const identity = repositoryIdentity(repo);
    mkdirSync(join(base, 'state', 'tuig'), { recursive: true });
    writeFileSync(
      trustPath,
      JSON.stringify({
        schema_version: 1,
        repositories: identity.rootCommits.map((rootCommit) => ({
          path: identity.path,
          rootCommit,
        })),
      }),
    );
  }
  return { base, repo, trustPath, options, initialize };
}
function valid(value) {
  assert.ok(validate(value), JSON.stringify(validate.errors));
  return value;
}
test('empty Git repository is unconfigured and points to init (actual CLI)', (t) => {
  const f = fixture(t);
  const r = spawnSync(process.execPath, [resolve('dist/main.js'), 'doctor'], {
    cwd: f.repo,
    env: { ...process.env, TUIG_OUTPUT: 'json', XDG_CONFIG_HOME: join(f.base, 'state') },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  const value = valid(JSON.parse(r.stdout));
  assert.equal(value.status, 'unconfigured');
  assert.equal(value.next_action, 'tuig init');
});
test('initialized trusted fixture is healthy when tooling is available', (t) => {
  const f = fixture(t);
  f.initialize();
  const value = valid(doctor(f.options));
  assert.equal(value.status, 'ok');
  assert.ok(value.data.checks.every((c) => c.ok));
});
for (const platform of ['linux', 'darwin'])
  test('missing sandbox degrades with fix: ' + platform, (t) => {
    const f = fixture(t);
    f.initialize();
    const value = valid(
      doctor({
        ...f.options,
        platform,
        probe: (tool) => ({ ok: !['bwrap', 'sandbox-exec'].includes(tool), detail: 'test' }),
      }),
    );
    assert.equal(value.status, 'degraded');
    assert.match(value.next_action, platform === 'linux' ? /bwrap/ : /sandbox-exec/);
    assert.ok(value.error.fix);
    assert.ok(value.data.checks.find((c) => c.name === 'sandbox').fix);
  });
test('each missing prerequisite degrades; native Windows is unsupported', (t) => {
  const f = fixture(t);
  f.initialize();
  for (const tool of ['git', 'rg', 'bun'])
    assert.equal(
      valid(doctor({ ...f.options, probe: (n) => ({ ok: n !== tool, detail: 'test' }) })).status,
      'degraded',
    );
  assert.equal(valid(doctor({ ...f.options, nodeVersion: '22.0.0' })).status, 'degraded');
  assert.equal(valid(doctor({ ...f.options, platform: 'win32' })).status, 'degraded');
});
test('no matching user trust means config and repository commands are never loaded', (t) => {
  const f = fixture(t);
  f.initialize();
  rmSync(f.trustPath);
  writeFileSync(join(f.repo, '.tuig', 'config.json'), 'invalid JSON that must not be read');
  writeFileSync(join(f.repo, '.tuig', 'checks.json'), 'invalid checks that must not be loaded');
  const value = valid(doctor(f.options));
  assert.equal(value.status, 'unconfigured');
  assert.equal(value.next_action, 'tuig trust');
  assert.equal(
    value.data.checks.some((c) => c.name === 'config'),
    false,
  );
});
test('trust must match both canonical path and root commit', (t) => {
  const f = fixture(t);
  f.initialize();
  const id = repositoryIdentity(f.repo);
  for (const record of [
    { path: realpathSync(f.repo), rootCommit: 'wrong' },
    { path: f.base, rootCommit: id.rootCommits[0] },
  ]) {
    writeFileSync(f.trustPath, JSON.stringify({ schema_version: 1, repositories: [record] }));
    assert.equal(valid(doctor(f.options)).status, 'unconfigured');
  }
});
test('invalid configuration and corrupted trust state fail with actionable errors', (t) => {
  const f = fixture(t);
  f.initialize();
  for (const config of [
    '{',
    JSON.stringify({ schema_version: 2, mode: 'auto', models: { allowedEndpoints: [] } }),
    JSON.stringify({
      schema_version: 1,
      mode: 'ask',
      models: { allowedEndpoints: ['file:///tmp/a'] },
    }),
  ]) {
    writeFileSync(join(f.repo, '.tuig', 'config.json'), config);
    const value = valid(doctor(f.options));
    assert.equal(value.status, 'error');
    assert.equal(value.error.code, 'TUIG_E_CONFIG');
    assert.ok(value.next_action);
  }
  writeFileSync(f.trustPath, '{');
  assert.equal(valid(doctor(f.options)).error.code, 'TUIG_E_CONFIG');
});
test('all guide modes validate and credentials in endpoint URLs fail', () => {
  for (const mode of ['plan', 'ask', 'auto-edit', 'auto'])
    assert.deepEqual(
      validateConfig({ schema_version: 1, mode, models: { allowedEndpoints: [] } }),
      [],
    );
  assert.ok(
    validateConfig({
      schema_version: 1,
      mode: 'ask',
      models: { allowedEndpoints: ['https://user:secret@example.invalid'] },
    }).length,
  );
});
test('bundled Node docs work offline outside source checkout; invalid topics are actionable', (t) => {
  const f = fixture(t);
  const output = join(f.base, 'dist');
  cpSync('dist', output, { recursive: true });
  for (const args of [
    ['agents-start-here'],
    ...['commands', 'envelope', 'safety', 'configuration'].map((topic) => ['docs', 'get', topic]),
  ]) {
    const r = spawnSync(process.execPath, [join(output, 'main.js'), ...args], {
      cwd: f.repo,
      env: { ...process.env, TUIG_OUTPUT: 'json' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(valid(JSON.parse(r.stdout)).data.content, /# /);
  }
  for (const topic of ['missing', 'toString', '../../LICENSE']) {
    const r = spawnSync(process.execPath, [join(output, 'main.js'), 'docs', 'get', topic], {
      cwd: f.repo,
      encoding: 'utf8',
      env: { ...process.env, TUIG_OUTPUT: 'json' },
    });
    assert.equal(r.status, 1);
    assert.equal(valid(JSON.parse(r.stdout)).error.code, 'TUIG_E_DOC_TOPIC');
  }
});
