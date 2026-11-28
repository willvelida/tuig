// Generated-output mutations only; always restore the file before the next probe.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const probes = [
  [
    'independent final diff attribution',
    'dist/cli/commands/run.js',
    'const finalPaths = changedTests(workspace, testPatterns, protectionBaseline);',
    'const finalPaths = [];',
    'self host final diff',
  ],
  [
    'pin hash',
    'dist/engine/self-host.js',
    'binaryHash(file) !== pin.pinnedSha256',
    'false',
    'self host doctor',
  ],
  [
    'clean build identity',
    'dist/engine/self-host.js',
    'identity.dirty !== false',
    'false',
    'self host doctor',
  ],
  [
    'invoking executable',
    'dist/engine/self-host.js',
    'if (invoking &&',
    'if (false &&',
    'self host doctor',
  ],
  [
    'protected self-host paths',
    'dist/cli/commands/run.js',
    '...selfPatterns];',
    '];',
    'self hosted replay run denies and records protected attempt src/engine/policy.ts',
  ],
  [
    'candidate argv substitution',
    'dist/cli/commands/checks.js',
    "arg === '{binary-under-test}' ? selected : arg",
    'arg',
    'checks binary under test',
  ],
];
for (const [name, file, from, to, pattern] of probes) {
  const original = readFileSync(file, 'utf8');
  assert.ok(original.includes(from), 'Missing mutation target: ' + name);
  try {
    writeFileSync(file, original.replace(from, to));
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-name-pattern', pattern, 'test/self-host.test.mjs'],
      {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0, 'Mutation survived: ' + name + '\n' + result.stdout);
    assert.match(
      result.stdout + result.stderr,
      /AssertionError/,
      'Expected assertion failure: ' + name,
    );
    process.stdout.write(name + ': regression failed as required\n');
  } finally {
    writeFileSync(file, original);
  }
}
