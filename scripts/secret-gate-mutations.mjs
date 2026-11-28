import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Mutate isolated generated output, never source or the shared dist directory.
const directory = mkdtempSync(join(resolve('node_modules'), '.tuig-secret-mutation-'));
try {
  cpSync('dist', join(directory, 'dist'), { recursive: true });
  mkdirSync(join(directory, 'test'));
  cpSync('test/secret-gate.test.mjs', join(directory, 'test/secret-gate.test.mjs'));
  const probes = [
    {
      file: 'cli/commands/run.js',
      search: "if (eligible && config.secretGate === 'required')",
      replace: 'if (false)',
      test: '^required gate catches agent edit,',
      name: 'remove final gate',
    },
    {
      file: 'cli/commands/run.js',
      search: "if (secretResult.status === 'infrastructure_error')",
      replace: 'if (false)',
      test: '^required run fails closed: crash$',
      name: 'remove infrastructure failure classification',
    },
    {
      file: 'engine/secret-gate.js',
      search: "status: 'infrastructure_error',",
      replace: "status: 'pass',",
      test: '^scanner timeout cannot pass$',
      name: 'turn scanner infrastructure failure into a pass',
    },
  ];
  for (const probe of probes) {
    const file = join(directory, 'dist', probe.file);
    const original = readFileSync(file, 'utf8');
    assert.ok(original.includes(probe.search), probe.name + ': mutation target missing');
    writeFileSync(file, original.replace(probe.search, probe.replace));
    try {
      const result = spawnSync(
        process.execPath,
        ['--test', '--test-name-pattern', probe.test, join(directory, 'test/secret-gate.test.mjs')],
        { encoding: 'utf8', timeout: 60000 },
      );
      assert.equal(result.error, undefined, result.error?.message);
      assert.notEqual(result.status, 0, probe.name + ': regression survived removed protection');
      assert.match(result.stdout + result.stderr, /AssertionError/);
      console.log('Detected mutation: ' + probe.name);
    } finally {
      writeFileSync(file, original);
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
