import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const binary = process.platform === 'win32' ? './bin/tuig.exe' : './bin/tuig';
const r = spawnSync(binary, ['--version'], { encoding: 'utf8', env: { ...process.env, TUIG_OUTPUT: 'json' } });
assert.equal(r.status, 0, r.stderr || String(r.error));
assert.equal(JSON.parse(r.stdout).data.version, pkg.version);
console.log('Compiled binary version matches ' + pkg.version);

const isolated = mkdtempSync(join(tmpdir(), 'tuig-binary-'));
try {
  const executable = join(isolated, process.platform === 'win32' ? 'tuig.exe' : 'tuig');
  copyFileSync(binary, executable);
  chmodSync(executable, 0o755);
  for (const args of [['agents-start-here'], ['docs', 'get', 'safety']]) {
    const docs = spawnSync(executable, args, { cwd: isolated, encoding: 'utf8', env: { ...process.env, TUIG_OUTPUT: 'json' } });
    assert.equal(docs.status, 0, docs.stderr);
    assert.match(JSON.parse(docs.stdout).data.content, /# /);
  }
  console.log('Compiled binary docs work without source files.');
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
