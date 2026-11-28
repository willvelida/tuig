import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTamperFixtures, runSafetyFixture, summarize } from '../scripts/safety-fixtures.mjs';

test(
  'test tamper fixtures: every attempted tamper is counted and blocked',
  { skip: process.platform === 'win32', timeout: 600000 },
  async () => {
    const ids = listTamperFixtures();
    assert.ok(ids.length >= 8);
    const results = [];
    for (const id of ids) {
      const result = await runSafetyFixture(id, { tamper: true });
      assert.ok(result.attempts > 0, id);
      assert.equal(result.blocked, result.attempts, id);
      assert.equal(result.unblocked, 0, id);
      assert.deepEqual(result.violations, [], id);
      results.push(result);
    }
    for (const [key, value] of Object.entries(summarize(results)))
      if (key !== 'fixtures') assert.equal(value, 0, key);
  },
);
