import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectFixtureProposals } from './check-fixtures.mjs';
import { isolatedCommand, podmanImage } from './stage1-runtime.mjs';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { runCommand } from '../dist/cli/commands/run.js';
import { replayRun } from '../dist/cli/commands/replay.js';
import { existingRecord, readRun } from '../dist/engine/record.js';

// Explicit --measure prevents accidental hosted calls during inspection or linting.
if (!process.argv.includes('--measure')) throw Error('Use --measure only for the human-approved synthetic-fixture baseline.');
if (process.platform !== 'linux') throw Error('Run B0 inside the configured Linux/WSL shell.');
const root = resolve('.'), destination = join(root, 'eval/baselines/B0');
const settings = JSON.parse(readFileSync(join(destination, 'settings.json'), 'utf8'));
if (!process.env[settings.apiKeyEnv]) throw Error('Required credential environment variable is unavailable: ' + settings.apiKeyEnv);
const plan = JSON.parse(readFileSync(join(destination, 'plan.json'), 'utf8'));
if (plan.status === 'measured-and-frozen') throw Error('B0 is frozen; create a new baseline version instead of overwriting it.');
if (existsSync(join(destination, 'results.json')) || existsSync(join(destination, 'results.partial.json'))) throw Error('Existing baseline results must be reviewed before a new measurement attempt.');
const tasks = inspectFixtureProposals();
if (!tasks.every(task => task.reviewed)) throw Error('Human oracle approval is required.');
const verification = JSON.parse(readFileSync(join(destination, 'verification.json'), 'utf8'));
const image = podmanImage();
if (verification.image !== image || !verification.checks.every(check => check.agentContainerIsolationPassed && check.referenceHiddenPassed)) throw Error('Current image needs successful oracle/isolation verification.');
const scratch = join(root, '.tuig/temp/stage1/b0'); mkdirSync(scratch, { recursive: true });
process.env.XDG_CONFIG_HOME = join(root, '.tuig/temp/stage1/b0-user-state');
function command(argv, cwd) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw Error('Trusted fixture setup command failed: ' + argv[0]);
  return result.stdout.trim();
}
const git = (args, cwd) => command(['git', '-c', 'core.hooksPath=/dev/null', ...args], cwd);
if (git(['status', '--porcelain'], root)) throw Error('Commit and review the implementation/settings before freezing a model baseline.');
const results = [];
const context = { schema_version: 1, isModelBaseline: true, sourceCommit: git(['rev-parse', 'HEAD'], root), image, node: process.version, podman: command(['podman', '--version'], root), settings, results };
for (const task of tasks) for (let repetition = 1; repetition <= plan.repetitions; repetition++) {
  const workspace = mkdtempSync(join(scratch, task.id + '-' + repetition + '-'));
  cpSync(join(root, 'fixtures/repos/ledger-lite'), workspace, { recursive: true });
  const taskDir = join(root, 'fixtures/tasks', task.id);
  const metadata = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8'));
  const pinned = verification.checks.find(check => check.task === task.id);
  if (JSON.stringify(pinned?.approvedOracleHashes) !== JSON.stringify(metadata.oracle.sha256)) throw Error('Oracle pins changed since verification.');
  command(['sh', join(taskDir, 'setup.sh'), workspace], root);
  git(['init'], workspace);
  initialize(workspace);
  const visible = isolatedCommand(image, workspace, ['python', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'tests-visible']);
  const lint = isolatedCommand(image, workspace, ['ruff', 'check', '--no-cache', 'ledger_lite']);
  const checks = [{ name: 'visible acceptance', argv: visible, timeoutSec: 30 }, { name: 'fixture lint', argv: lint, timeoutSec: 30 }];
  const configPath = join(workspace, '.tuig/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  Object.assign(config, { syntheticFixture: true, tasksDir: join(root, 'fixtures/tasks'), models: settings, policy: { allowedCommands: [visible, lint] } });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(workspace, '.tuig/checks.json'), JSON.stringify({ schema_version: 1, checks }, null, 2) + '\n');
  writeFileSync(join(workspace, '.gitignore'), '.tuig/runs/\n.tuig/temp/\n__pycache__/\n.pytest_cache/\n.ruff_cache/\n');
  writeFileSync(join(workspace, 'AGENTS.md'), 'Synthetic ledger-lite fixture. Exact allowed run tool argv values (cwd is ".", timeoutMs is 30000):\n' + JSON.stringify([visible, lint], null, 2) + '\nHidden oracles and solutions are unavailable to agent containers. Use read_file, search and edit within this workspace.\n');
  git(['add', '.'], workspace);
  git(['-c', 'user.name=tuig fixture setup', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Synthetic fixture base'], workspace);
  trustRepository(workspace);
  const run = await runCommand({ cwd: workspace, taskId: task.id });
  if (!run.data.id) throw Error('Run failed before producing a record; inspect configuration and credential availability.');
  const journal = readRun(existingRecord(workspace, run.data.id));
  const replay = await replayRun(run.data.id, workspace);
  if (replay.status !== 'ok' || !replay.data.verified) throw Error('Run failed deterministic replay verification.');
  // Only after the controller is terminal, evaluate with a read-only workspace.
  // Hidden output is stored for humans and is never sent to a model or tool result.
  const hidden = isolatedCommand(image, workspace, ['python', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '/oracle'], join(taskDir, 'tests-hidden'));
  const verdict = spawnSync(hidden[0], hidden.slice(1), { encoding: 'utf8', timeout: metadata.timeouts.hiddenSec * 1000, maxBuffer: 4 * 1024 * 1024 });
  if (![0, 1].includes(verdict.status)) throw Error('Hidden oracle execution failed independently of task assertions.');
  const label = task.id + '-' + repetition, artifact = join(destination, 'runs', label);
  mkdirSync(artifact, { recursive: true });
  cpSync(existingRecord(workspace, run.data.id).directory, join(artifact, 'record'), { recursive: true });
  writeFileSync(join(artifact, 'hidden.log'), (verdict.stdout ?? '') + (verdict.stderr ?? ''));
  const totals = run.data.totals;
  results.push({ task: task.id, repetition, runId: run.data.id, state: run.data.state, hiddenPassed: verdict.status === 0, replayVerified: true, tokens: { input: totals.input, cached: totals.cached, cacheWrite5m: totals.cacheWrite5m ?? 0, cacheWrite1h: totals.cacheWrite1h ?? 0, output: totals.output, reasoning: totals.reasoningKnown === false ? null : totals.reasoning }, cost: totals.cost, latencyMs: journal.events.filter(event => event.type === 'model_response').reduce((sum, event) => sum + Number(event.data.latencyMs ?? 0), 0), toolCalls: totals.toolCalls, oracleHashes: metadata.oracle.sha256 });
  writeFileSync(join(destination, 'results.partial.json'), JSON.stringify(context, null, 2) + '\n');
  console.log(label + ': ' + run.data.state + ', hidden=' + (verdict.status === 0) + ', replay verified');
  if (run.data.state === 'CANCELLED' || run.data.state === 'ERROR') throw Error('Baseline interrupted or model transport failed; partial evidence retained for review.');
}
writeFileSync(join(destination, 'results.json'), JSON.stringify(context, null, 2) + '\n');
writeFileSync(join(destination, 'plan.json'), JSON.stringify({ ...plan, status: 'measured-and-frozen', model: settings.model, runtime: image, results: results.map(result => result.runId) }, null, 2) + '\n');
console.log('B0 recorded: ' + results.length + ' runs. Human Stage 1 checkpoint review is still required.');
