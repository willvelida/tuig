import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { secretGate } from '../dist/engine/secret-gate.js';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { runCommand } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';
import { doctor } from '../dist/cli/commands/doctor.js';
import { validateConfig } from '../dist/engine/repository-state.js';
import { detectSandbox } from '../dist/sandbox/index.js';

// Invented AWS-shaped test value, never a real credential. Split construction
// avoids committing a token-shaped literal while exercising the real detector.
const token = 'AKIA' + '7Q2W9E4R6T8Y3U5I';

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tuig-secret-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
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
  writeFileSync(join(repo, '.gitignore'), '.tuig/\nignored.txt\n');
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
  return {
    dir,
    repo,
    git,
    workspace: {
      root: repo,
      path: repo,
      base: git(['rev-parse', 'HEAD']),
      id: 'secret',
      branch: 'secret',
    },
  };
}

function environment(t, changes) {
  const old = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]));
  Object.assign(process.env, changes);
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/** Real executable on each platform; no shell wrappers or production overrides. */
function fake(t, dir, mode = 'scan') {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  if (process.platform === 'win32') {
    const source = join(dir, 'Fake.cs');
    writeFileSync(
      source,
      `using System; using System.IO; using System.Threading;
class Fake { static int Main(string[] a) {
if(a.Length==1 && a[0]=="version") { Console.WriteLine("version is set by build process"); return 0; }
string mode="${mode}";
if(mode=="timeout") { Thread.Sleep(30000); return 0; }
if(mode=="crash") return 9;
string src=a[Array.IndexOf(a,"--source")+1], report=a[Array.IndexOf(a,"--report-path")+1];
if(mode=="missing-report") return 0;
if(mode=="bad-report") { File.WriteAllText(report,"{"); return 0; }
if(mode=="oversized") { File.WriteAllText(report,new string(' ',1048577)); return 0; }
string found=null;
foreach(string f in Directory.GetFiles(src,"*.txt")) if(File.ReadAllText(f).Contains("AKIA")) { found=Path.GetFileName(f); break; }
string rows=found==null?"[]":"[{\\"RuleID\\":\\"aws-access-token\\",\\"File\\":\\""+found+"\\",\\"StartLine\\":1,\\"Secret\\":\\"REDACTED\\"}]";
if(mode=="inconsistent") { File.WriteAllText(report,"[]"); return 42; }
File.WriteAllText(report,rows); return found==null?0:42;
} }`,
    );
    const csc = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    const result = spawnSync(csc, ['/nologo', '/out:' + join(bin, 'gitleaks.exe'), source], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } else {
    const file = join(bin, 'gitleaks');
    writeFileSync(
      file,
      `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path');
const a=process.argv.slice(2), mode=${JSON.stringify(mode)};
if(a[0]==='version'){console.log('version is set by build process');process.exit(0)}
if(mode==='timeout'){setTimeout(()=>{},30000)} else {
if(mode==='crash')process.exit(9);
const source=a[a.indexOf('--source')+1], report=a[a.indexOf('--report-path')+1];
if(mode==='missing-report')process.exit(0);
if(mode==='bad-report'){fs.writeFileSync(report,'{');process.exit(0)}
if(mode==='oversized'){fs.writeFileSync(report,' '.repeat(1048577));process.exit(0)}
const file=fs.readdirSync(source).find(f=>fs.readFileSync(path.join(source,f),'utf8').includes('AKIA'));
const rows=file?[{RuleID:'aws-access-token',File:file,StartLine:1,Secret:'REDACTED'}]:[];
fs.writeFileSync(report,JSON.stringify(mode==='inconsistent'?[]:rows));
process.exit(file||mode==='inconsistent'?42:0);
}
`,
    );
    chmodSync(file, 0o755);
  }
  environment(t, { PATH: bin + delimiter + process.env.PATH });
  return bin;
}

function configRun(t, f, tool, setting) {
  if (arguments.length < 4) setting = 'required';
  environment(t, { XDG_CONFIG_HOME: join(f.dir, 'state') });
  initialize(f.repo);
  const configPath = join(f.repo, '.tuig/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.secretGate, 'required', 'init must default to a required secret gate');
  config.secretGate = setting;
  if (setting === undefined) delete config.secretGate;
  config.protectedTests = [];
  config.sandbox = 'off';
  config.models = { adapter: 'replay', allowedEndpoints: [], replayFile: 'responses.jsonl' };
  writeFileSync(configPath, JSON.stringify(config));
  const usage = { input: 1, cached: 0, output: 1, reasoning: 0, cost: 0 };
  const responses = [
    ...(tool ? [{ message: null, toolCalls: [tool], usage, stopReason: 'tool_calls' }] : []),
    { message: 'done', toolCalls: [], usage, stopReason: 'stop' },
  ];
  writeFileSync(
    join(f.repo, 'responses.jsonl'),
    responses
      .map((response, step) => JSON.stringify({ type: 'model_response', data: { step, response } }))
      .join('\n') + '\n',
  );
  writeFileSync(
    join(f.repo, '.tuig/checks.json'),
    JSON.stringify({
      schema_version: 1,
      checks: [{ name: 'clean', argv: [process.execPath, '-e', '0'] }],
    }),
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
}

const edit = {
  id: 'plant',
  name: 'edit',
  arguments: { path: 'a.txt', search: 'old', replace: 'aws_access_key_id = ' + token },
};
const run = (f) =>
  runCommand({
    cwd: f.repo,
    platform: 'linux',
    instruction: 'Perform the scripted edit.',
    interactive: false,
    approver: () => 'allow_once',
  });
function noSecret(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) noSecret(file);
    else assert.equal(readFileSync(file, 'utf8').includes(token), false, file);
  }
}

test('required gate catches agent edit, records only safe finding metadata, and replays offline', async (t) => {
  const f = fixture(t);
  fake(t, f.dir);
  configRun(t, f, edit);
  const result = await run(f);
  assert.equal(result.data.state, 'FAILED_VALIDATION', JSON.stringify(result));
  assert.equal(result.data.secretGate.status, 'fail');
  assert.deepEqual(result.data.secretGate.findings, [
    { rule: 'aws-access-token', file: 'a.txt', line: 1, marker: '[REDACTED]' },
  ]);
  assert.equal(JSON.stringify(result).includes(token), false);
  noSecret(join(f.repo, '.tuig/runs', result.data.id));
  assert.equal((await replayRun(result.data.id, f.repo)).data.verified, true);
});

test('required gate catches secrets written through the run subprocess', async (t) => {
  const f = fixture(t);
  fake(t, f.dir);
  configRun(t, f, {
    id: 'subprocess',
    name: 'run',
    arguments: {
      cwd: '.',
      timeoutMs: 5000,
      argv: [
        process.execPath,
        '-e',
        `require('fs').writeFileSync('new.txt',${JSON.stringify('aws_access_key_id = ' + token)})`,
      ],
    },
  });
  const result = await run(f);
  assert.equal(result.data.state, 'FAILED_VALIDATION', JSON.stringify(result));
  assert.equal(result.data.secretGate.findings[0].file, 'new.txt');
  noSecret(join(f.repo, '.tuig/runs', result.data.id));
});

for (const mode of [
  'timeout',
  'crash',
  'missing-report',
  'bad-report',
  'oversized',
  'inconsistent',
])
  test('required run fails closed: ' + mode, async (t) => {
    const f = fixture(t);
    fake(t, f.dir, mode);
    configRun(t, f);
    const result = await run(f);
    assert.equal(result.data.state, 'ERROR', JSON.stringify(result));
    assert.equal(result.error.code, 'TUIG_E_PREREQUISITE');
    assert.match(result.next_action, /Install gitleaks/);
    assert.equal((await replayRun(result.data.id, f.repo)).data.verified, true);
  });

test('scanner timeout cannot pass', async (t) => {
  const f = fixture(t);
  fake(t, f.dir, 'timeout');
  assert.equal((await secretGate(f.workspace, { graceMs: 20 }, 50)).status, 'infrastructure_error');
});

test('missing scanner cannot succeed, even with an empty diff', async (t) => {
  const f = fixture(t);
  configRun(t, f);
  // Keep Git and Node available without exposing any installed gitleaks.
  const bin = join(f.dir, 'only-tools');
  mkdirSync(bin);
  const gitProbe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'], {
    encoding: 'utf8',
  });
  assert.equal(gitProbe.status, 0);
  const { copyFileSync, symlinkSync } = await import('node:fs');
  if (process.platform === 'win32') {
    // Git for Windows needs its neighbouring runtime files; its cmd directory
    // has git.exe and no gitleaks. Node is invoked through its absolute path.
    const { dirname } = await import('node:path');
    const path = dirname(gitProbe.stdout.trim().split(/\r?\n/)[0]);
    assert.equal(existsSync(join(path, 'gitleaks.exe')), false);
    environment(t, { PATH: path });
  } else {
    symlinkSync(gitProbe.stdout.trim(), join(bin, 'git'));
    // copyFileSync import is shared with Windows to keep no shell execution.
    void copyFileSync;
    environment(t, { PATH: bin });
  }
  const result = await run(f);
  assert.equal(result.data.state, 'ERROR', JSON.stringify(result));
  assert.equal(result.error.code, 'TUIG_E_PREREQUISITE');
  assert.match(result.next_action, /Install gitleaks/);
});

test('clean changed files pass; committed and untracked result files are scanned; ignored files and deleted secrets are excluded', async (t) => {
  const f = fixture(t);
  fake(t, f.dir);
  writeFileSync(join(f.repo, 'a.txt'), 'clean\n');
  writeFileSync(join(f.repo, 'ignored.txt'), token);
  assert.equal((await secretGate(f.workspace)).status, 'pass');
  writeFileSync(join(f.repo, 'untracked.txt'), token);
  assert.equal((await secretGate(f.workspace)).status, 'fail');
  f.git(['add', 'untracked.txt']);
  f.git([
    '-c',
    'user.name=T',
    '-c',
    'user.email=t@e.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'agent commit',
  ]);
  assert.equal((await secretGate(f.workspace)).status, 'fail');
  rmSync(join(f.repo, 'untracked.txt'));
  assert.equal((await secretGate(f.workspace)).status, 'pass');
});

for (const setting of ['required', 'off', undefined])
  test('clean run and explicit secret-gate summary: ' + setting, async (t) => {
    const f = fixture(t);
    fake(t, f.dir);
    configRun(t, f, undefined, setting);
    const result = await run(f);
    assert.equal(result.data.state, 'SUCCEEDED', JSON.stringify(result));
    const summary = JSON.parse(
      readFileSync(join(f.repo, '.tuig/runs', result.data.id, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.secretGate.enabled, setting === 'required');
    assert.equal(summary.secretGate.status, setting === 'required' ? 'pass' : 'disabled');
    assert.equal((await replayRun(result.data.id, f.repo)).data.verified, true);
  });

for (const setting of ['required', 'off', undefined])
  test('doctor secret gate degraded cases: ' + setting, (t) => {
    const f = fixture(t);
    configRun(t, f, undefined, setting);
    const value = doctor({
      cwd: f.repo,
      platform: 'linux',
      probe: (name) => ({ ok: name !== 'gitleaks' || setting !== 'required', detail: 'test' }),
    });
    assert.equal(value.status, 'degraded');
    const check = value.data.checks.find(
      (c) => c.name === (setting === 'required' ? 'gitleaks' : 'secret gate'),
    );
    assert.equal(check.ok, false);
    assert.match(check.fix, /gitleaks/);
  });

test('doctor accepts unknown gitleaks version; config validates exact gate values; init requires it', (t) => {
  const f = fixture(t);
  configRun(t, f);
  const value = doctor({
    cwd: f.repo,
    platform: 'linux',
    probe: () => ({ ok: true, detail: 'version is set by build process' }),
  });
  assert.equal(value.status, 'ok');
  assert.equal(
    value.data.checks.find((c) => c.name === 'gitleaks').detail,
    'Available (version unknown)',
  );
  assert.ok(
    validateConfig({
      schema_version: 1,
      mode: 'ask',
      models: { allowedEndpoints: [] },
      secretGate: false,
    }).length,
  );
  assert.equal(
    JSON.parse(readFileSync(join(f.repo, '.tuig/config.json'), 'utf8')).secretGate,
    'required',
  );
});

test('real gitleaks blocks a synthetic agent edit through run', { timeout: 60000 }, async (t) => {
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8', timeout: 5000 });
  if (probe.status !== 0) {
    assert.notEqual(
      process.env.TUIG_REQUIRE_GITLEAKS,
      '1',
      'TUIG_REQUIRE_GITLEAKS=1 requires installed gitleaks',
    );
    t.skip('gitleaks is not installed');
    return;
  }
  const f = fixture(t);
  configRun(t, f, edit);
  const sandbox = detectSandbox();
  if (process.env.TUIG_REQUIRE_SANDBOX === '1') assert.ok(sandbox);
  if (sandbox) {
    const file = join(f.repo, '.tuig/config.json');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    config.sandbox = 'auto';
    writeFileSync(file, JSON.stringify(config));
    f.git(['add', '-f', '.tuig/config.json']);
    f.git([
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@e.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'sandbox config',
    ]);
  }
  const cli = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../dist/main.js', import.meta.url)),
      'run',
      '--instruction',
      'Perform the scripted edit.',
    ],
    { cwd: f.repo, env: { ...process.env, TUIG_OUTPUT: 'json' }, encoding: 'utf8', timeout: 45000 },
  );
  assert.equal(cli.status, 1, cli.stderr + cli.stdout);
  assert.equal((cli.stdout + cli.stderr).includes(token), false);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.data.state, 'FAILED_VALIDATION', JSON.stringify(result));
  assert.equal(result.data.secretGate.status, 'fail');
  assert.ok(result.data.secretGate.findings.some((finding) => finding.rule === 'aws-access-token'));
  assert.equal(JSON.stringify(result).includes(token), false);
  noSecret(join(f.repo, '.tuig/runs', result.data.id));
});
