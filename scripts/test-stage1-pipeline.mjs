import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
if (process.platform !== 'linux') throw Error('Run this Podman workflow test in Linux/WSL.');
const source = resolve('.'),
  scratch = join(source, '.tuig/temp/stage1');
mkdirSync(scratch, { recursive: true });
const root = mkdtempSync(join(scratch, 'pipeline-stub-'));
cpSync('fixtures', join(root, 'fixtures'), { recursive: true });
mkdirSync(join(root, 'eval/baselines/B0'), { recursive: true });
for (const file of ['plan.json', 'verification.json'])
  cpSync(join(source, 'eval/baselines/B0', file), join(root, 'eval/baselines/B0', file));
const planPath = join(root, 'eval/baselines/B0/plan.json');
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
plan.status = 'local-stub-workflow-test';
writeFileSync(planPath, JSON.stringify(plan));
let requests = 0;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (part) => (body += part));
  req.on('end', () => {
    requests++;
    const payload = JSON.parse(body),
      serialized = JSON.stringify(payload.messages);
    const id = plan.tasks.find((id) => serialized.includes('# ' + id));
    assert.ok(id);
    const taskDir = join(source, 'fixtures/tasks', id),
      task = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8'));
    const target = basename(task.oracle.reference);
    const edited = payload.messages.some((message) => message.role === 'assistant');
    res.end(
      JSON.stringify({
        content: edited
          ? [{ type: 'text', text: 'Local stub finished.' }]
          : [
              { type: 'thinking', thinking: '', signature: 'local-stub-only' },
              {
                type: 'tool_use',
                id: 'stub-edit',
                name: 'edit',
                input: {
                  path: 'ledger_lite/' + target,
                  search: readFileSync(join(taskDir, 'bug', target), 'utf8'),
                  replace: readFileSync(join(taskDir, task.oracle.reference), 'utf8'),
                },
              },
            ],
        stop_reason: edited ? 'end_turn' : 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const url = 'http://127.0.0.1:' + server.address().port + '/v1/messages';
  const settings = {
    adapter: 'anthropic',
    baseURL: url,
    model: 'local-workflow-stub',
    apiKeyEnv: 'TUIG_PIPELINE_STUB_KEY',
    allowedEndpoints: [],
    prices: {
      'local-workflow-stub': { input: 0, cached: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    },
  };
  writeFileSync(join(root, 'eval/baselines/B0/settings.json'), JSON.stringify(settings));
  for (const args of [
    ['init'],
    ['add', '.'],
    [
      '-c',
      'user.name=tuig workflow test',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Local synthetic workflow test',
    ],
  ]) {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const child = spawn(
    process.execPath,
    [join(source, 'scripts/measure-stage1-b0.mjs'), '--measure'],
    {
      cwd: root,
      env: { ...process.env, TUIG_PIPELINE_STUB_KEY: 'local-only-not-a-real-key' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (part) => process.stdout.write(part));
  let stderr = '';
  child.stderr.on('data', (part) => (stderr += part));
  const [status] = await once(child, 'exit');
  assert.equal(status, 0, stderr);
  const result = JSON.parse(readFileSync(join(root, 'eval/baselines/B0/results.json'), 'utf8'));
  assert.equal(result.results.length, 15);
  assert.equal(requests, 30);
  assert.ok(
    result.results.every(
      (run) => run.hiddenPassed && run.replayVerified && run.state === 'SUCCEEDED',
    ),
  );
  const report = {
    schema_version: 1,
    kind: 'local-stub-workflow-verification',
    isModelBaseline: false,
    runtimeImage: result.image,
    tasks: 3,
    repetitionsPerTask: 5,
    completedWorkflowRuns: 15,
    localStubRequests: requests,
    allHiddenPassed: true,
    allReplayVerified: true,
    note: 'Deterministic reference edits from a local mock server. These are not hosted-model or B0 measurements.',
  };
  writeFileSync(
    join(source, 'eval/baselines/B0/pipeline-verification.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log('Local-only 15-run workflow test passed; no real B0 results were written.');
} finally {
  server.closeAllConnections();
  server.close();
}
