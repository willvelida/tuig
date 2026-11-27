import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectFixtureProposals } from './check-fixtures.mjs';
import { isolatedCommand } from './stage1-runtime.mjs';
import { runProcess } from '../dist/runner/tools/run.js';

if (process.platform !== 'linux')
  throw Error('Run this verification in Linux/WSL with rootless Podman.');
const root = resolve('.');
const imageTag = process.env.TUIG_STAGE1_IMAGE ?? 'localhost/tuig-stage1:ledger-lite-v1';
function command(argv, expected = 0) {
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, expected, result.stderr + result.stdout);
  return result.stdout.trim();
}
const image = command(['podman', 'image', 'inspect', imageTag, '--format', '{{.Id}}']);
const scratch = join(root, '.tuig/temp/stage1/verification');
mkdirSync(scratch, { recursive: true });
const checks = [];
const containerArgs = (workspace, args, oracle) => isolatedCommand(image, workspace, args, oracle);
for (const task of inspectFixtureProposals()) {
  assert.equal(task.reviewed, true, 'Human oracle approval is required.');
  const taskDir = join(root, 'fixtures/tasks', task.id);
  const metadata = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8'));
  const workspace = mkdtempSync(join(scratch, task.id + '-'));
  cpSync(join(root, 'fixtures/repos/ledger-lite'), workspace, { recursive: true });
  command(['sh', join(taskDir, 'setup.sh'), workspace]);
  // This probe runs through the same sanitized subprocess path used by the model tool.
  const probe = containerArgs(workspace, [
    'python',
    '-c',
    [
      'import os,pathlib',
      'assert not pathlib.Path("/oracle").exists()',
      'assert not pathlib.Path(' + JSON.stringify(taskDir) + ').exists()',
      'assert not pathlib.Path("/mnt/c/Users/willv").exists()',
      'assert "CLAUDE_ACCESS_TOKEN" not in os.environ',
      'assert set(os.listdir("/sys/class/net")) == {"lo"}',
      'assert "NoNewPrivs:\\t1" in pathlib.Path("/proc/self/status").read_text()',
      'pathlib.Path("/workspace/.isolation-probe").write_text("workspace writable")',
      'print("isolation probe passed")',
    ].join(';'),
  ]);
  const isolated = runProcess(workspace, probe, '.', 60000, [probe]);
  assert.equal(isolated.status, 'ok', isolated.output);
  assert.match(isolated.output, /isolation probe passed/);
  const visible = containerArgs(workspace, [
    'python',
    '-m',
    'pytest',
    '-q',
    '-p',
    'no:cacheprovider',
    'tests-visible',
  ]);
  const hidden = containerArgs(
    workspace,
    ['python', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '/oracle'],
    join(taskDir, 'tests-hidden'),
  );
  command(visible, 1);
  command(hidden, 1);
  const referencePath = metadata.oracle.reference.slice('solution/'.length);
  cpSync(join(taskDir, metadata.oracle.reference), join(workspace, referencePath));
  const visiblePass = command(visible);
  const hiddenPass = command(hidden);
  command(containerArgs(workspace, ['ruff', 'check', 'ledger_lite']));
  checks.push({
    task: task.id,
    approvedOracleHashes: metadata.oracle.sha256,
    buggyVisibleFailed: true,
    buggyHiddenFailed: true,
    referenceVisiblePassed: true,
    referenceHiddenPassed: true,
    lintPassed: true,
    agentContainerIsolationPassed: true,
    visibleResult: visiblePass,
    hiddenResult: hiddenPass,
  });
  console.log(task.id + ': bug rejected, reference passes visible/hidden, isolation passes');
}
const result = {
  schema_version: 1,
  kind: 'oracle-and-runtime-verification',
  isModelBaseline: false,
  node: process.version,
  podman: command(['podman', '--version']),
  image,
  platform: process.platform,
  arch: process.arch,
  checks,
};
mkdirSync('eval/baselines/B0', { recursive: true });
writeFileSync('eval/baselines/B0/verification.json', JSON.stringify(result, null, 2) + '\n');
console.log('All approved oracles and rootless Podman isolation verified; no model calls made.');
