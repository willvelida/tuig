// Same complete file set and concurrency as npm test, partitioned for 60-second checks.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const files = readdirSync('test')
  .filter((file) => file.endsWith('.test.mjs'))
  .sort();
const groups = Array.from({ length: 4 }, (_, shard) =>
  files.filter((_, index) => index % 4 === shard),
);
assert.ok(
  groups.every((group) => group.length > 0),
  'Every test shard must contain files',
);
assert.deepEqual(
  groups.flat().sort(),
  files,
  'Shards must cover every test/*.test.mjs exactly once',
);
const arg = process.argv[2];
if (arg === '--list') {
  process.stdout.write(JSON.stringify(groups, null, 2) + '\n');
} else {
  if (!/^[0-3]$/.test(arg ?? '') || process.argv.length !== 3)
    throw new Error('Use a shard index 0..3 or --list');
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=4', ...groups[Number(arg)].map((file) => 'test/' + file)],
    { stdio: 'inherit', shell: false },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
