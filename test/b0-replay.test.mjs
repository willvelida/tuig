import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { replayRun } from '../dist/cli/commands/replay.js';

// The frozen B0 records must keep replaying as the harness changes (AGENTS.md).
const B0_RUNS = resolve('eval/baselines/B0/runs');

test('every frozen B0 record still replays and verifies with the current harness', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tuig-b0-replay-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(root, 'state');
  t.after(() => {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = old;
  });
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  };
  git(['init']);
  writeFileSync(join(repo, 'README.md'), 'replay host\n');
  initialize(repo);
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
    'host',
  ]);
  trustRepository(repo);
  const runs = readdirSync(B0_RUNS).sort();
  assert.equal(runs.length, 15);
  for (const run of runs) {
    // Copy, never mutate, the frozen evidence.
    cpSync(join(B0_RUNS, run, 'record'), join(repo, '.tuig/runs', run), { recursive: true });
    const replay = await replayRun(run, repo);
    assert.equal(replay.status, 'ok', run + ': ' + JSON.stringify(replay.error));
    assert.equal(replay.data.verified, true, run);
    assert.equal(replay.data.state, 'SUCCEEDED', run);
  }
});
