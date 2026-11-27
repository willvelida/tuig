import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, cpSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectFixtureProposals } from '../scripts/check-fixtures.mjs';
test('proposal metadata/schema and pinned oracle/reference bytes are consistent without executing tasks', () => {
  const result = inspectFixtureProposals();
  assert.deepEqual(
    result.map((t) => t.id),
    ['fix-currency-format', 'fix-minor-units', 'fix-rounding'],
  );
  assert.ok(result.every((t) => t.fixtureVersion === 'ledger-lite-v1'));
});
test('accidental oracle changes invalidate the pinned metadata', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tuig-oracle-pins-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync('fixtures', root, { recursive: true });
  appendFileSync(join(root, 'tasks/fix-rounding/tests-hidden/test_oracle.py'), '# altered\n');
  assert.throws(() => inspectFixtureProposals(root), /hash mismatch/);
});
