import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
test('package entry reports matching version', () => {
 const r = spawnSync(process.execPath, [pkg.bin.tuig, '--version'], {encoding:'utf8'});
 assert.equal(r.status, 0);
 assert.equal(r.stdout.trim(), pkg.version);
 assert.equal(r.stderr, '');
});
test('unknown arguments fail', () => {
 const r = spawnSync(process.execPath, [pkg.bin.tuig, '--unknown'], {encoding:'utf8'});
 assert.equal(r.status, 1);
 assert.match(r.stderr, /Unknown option/);
});
