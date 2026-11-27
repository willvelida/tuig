import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const binary = process.platform === 'win32' ? './bin/tuig.exe' : './bin/tuig';
const r = spawnSync(binary, ['--version'], { encoding: 'utf8', env: { ...process.env, TUIG_OUTPUT: 'json' } });
assert.equal(r.status, 0, r.stderr || String(r.error));
assert.equal(JSON.parse(r.stdout).data.version, pkg.version);
console.log('Compiled binary version matches ' + pkg.version);
