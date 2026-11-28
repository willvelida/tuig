// Explicit operator verification only: exercise setup/checks without any agent or model.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? process.cwd());
const load = (file) => import(pathToFileURL(join(root, 'dist', file)).href);
const { createWorkspace } = await load('engine/workspace.js');
const { createRecord, writeArtifact } = await load('engine/record.js');
const { loadSetup, executeSetup } = await load('engine/setup.js');
const { loadChecks } = await load('checks/config.js');
const { executeCheck } = await load('checks/execute.js');
const { detectSandbox } = await load('sandbox/index.js');
const { protectionState, protectedTests } = await load('engine/protected-tests.js');
const sandbox = detectSandbox();
if (!sandbox) throw new Error('A real OS sandbox is required; verification never falls back');
const config = JSON.parse(readFileSync(join(root, '.tuig/config.json'), 'utf8'));
const id = 'self-host-checks-' + randomUUID();
const workspace = createWorkspace(root, id),
  store = createRecord(root, id);
console.log(
  JSON.stringify({ workspace: workspace.path, id, sandbox: sandbox.kind, modelRequests: 0 }),
);
const passEnv = config.policy?.passEnv ?? [];
let start = performance.now();
const setup = await executeSetup(workspace.path, loadSetup(root), store, { sandbox, passEnv });
console.log(
  JSON.stringify({
    step: 'setup',
    passed: setup.status === 'pass',
    durationMs: performance.now() - start,
    commands: setup.commands,
  }),
);
if (setup.status !== 'pass') process.exit(1);
start = performance.now();
const baseline = protectionState(workspace, [
  ...protectedTests(config.protectedTests),
  ...protectedTests(config.protectedPaths),
]);
console.log(
  JSON.stringify({
    step: 'baseline',
    passed: true,
    durationMs: performance.now() - start,
    ignoredFiles: Object.keys(baseline.ignored).length,
  }),
);
let passed = true;
for (const [index, check] of loadChecks(root).entries()) {
  check.argv = check.argv.map((arg) =>
    arg === '{binary-under-test}'
      ? join(workspace.path, process.platform === 'win32' ? 'bin/tuig.exe' : 'bin/tuig')
      : arg,
  );
  start = performance.now();
  const result = await executeCheck(workspace.path, check, { sandbox, passEnv }, (output) =>
    writeArtifact(store, 'tool-logs/verification-' + index + '.log', output),
  );
  const durationMs = performance.now() - start;
  console.log(
    JSON.stringify({
      step: check.name,
      passed: result.passed,
      durationMs,
      timeoutSec: check.timeoutSec,
      status: result.status,
      exitCode: result.exitCode,
      log: 'tool-logs/verification-' + index + '.log',
    }),
  );
  passed &&= result.passed && durationMs < check.timeoutSec * 1000;
}
console.log(JSON.stringify({ passed, modelRequests: 0, record: join(root, '.tuig/runs', id) }));
process.exitCode = passed ? 0 : 1;
