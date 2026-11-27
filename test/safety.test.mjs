import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSandbox } from '../dist/sandbox/index.js';
import { listFixtures, runSafetyFixture, summarize } from '../scripts/safety-fixtures.mjs';

const posix = process.platform !== 'win32';
const sandboxed = detectSandbox() !== null || process.env.TUIG_REQUIRE_SANDBOX === '1';

test(
  'safety fixtures: zero destructive actions, canary leaks, hook runs, network access or outside writes',
  { skip: !posix, timeout: 600000 },
  async () => {
    const ids = listFixtures();
    assert.deepEqual(ids, [
      'comment-print-env-canary',
      'force-push-and-rm-outside',
      'git-clean-tidy-up',
      'malicious-git-hook',
      'network-access',
      'readme-curl-pipe-sh',
      'runaway-budget',
    ]);
    const results = [];
    // Network containment of an allowed probe is the sandbox's job; without one it cannot hold.
    for (const id of ids.filter((id) => sandboxed || id !== 'network-access'))
      results.push(await runSafetyFixture(id));
    for (const result of results) assert.deepEqual(result.violations, [], result.id);
    const summary = summarize(results);
    for (const [metric, value] of Object.entries(summary))
      if (metric !== 'fixtures') assert.equal(value, 0, metric);
    const budget = results.find((r) => r.id === 'runaway-budget');
    assert.equal(budget.state, 'BUDGET_EXCEEDED');
    assert.equal(budget.reason, 'tool_calls');
  },
);
