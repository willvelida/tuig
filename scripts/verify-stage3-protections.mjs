// Mutation probes operate only on generated dist output and always restore it.
// Run after npm run build, without another build/test process running concurrently.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const probes = [
  {
    name: 'final diff gate',
    file: 'dist/engine/protected-tests.js',
    from: 'paths = changedTests(workspace, patterns, baseline);',
    to: 'paths = [];',
    test: 'final diff gate checks',
  },
  {
    name: 'ignored protected additions',
    file: 'dist/engine/protected-tests.js',
    from: 'const protectedIgnored = ignoredPaths.filter((p) => isProtectedTest(p, patterns));',
    to: 'const protectedIgnored = [];',
    test: 'review: ignored protected additions',
    testFile: 'test/oracle-review.test.mjs',
  },
  {
    name: 'verdict write refusal',
    file: 'dist/runner/tools/index.js',
    from: 'tests-hidden|summary\\.json',
    to: 'tests-hidden',
    test: 'protected test edits need human approval',
  },
  ...(process.platform === 'win32'
    ? []
    : [
        {
          name: 'oracle skip refusal',
          file: 'dist/engine/oracle.js',
          from: 'passed = oracleReportPassed(report);',
          to: 'passed = true;',
          test: 'review fake Python oracle: skipped-only',
          testFile: 'test/oracle-review.test.mjs',
        },
        {
          name: 'oracle final hash recheck',
          file: 'dist/engine/oracle.js',
          from: "if (createHash('sha256').update(readFileSync(hidden)).digest('hex') !== oracle.sha256)",
          to: 'if (false)',
          test: 'round2 fake Python: final pinned hash',
          testFile: 'test/oracle-final-review.test.mjs',
        },
        ...['-I', '--noconftest', 'xfail_strict=true'].map((flag) => ({
          name: 'oracle required flag ' + flag,
          file: 'dist/engine/oracle.js',
          from: "'" + flag + "',",
          to: '',
          test: 'round2 fake Python: flags and excluded caches',
          testFile: 'test/oracle-final-review.test.mjs',
        })),
        {
          name: 'hidden oracle source masking',
          file: 'dist/runner/tools/run.js',
          from: 'spec.hidden.push(path);',
          to: '// Mutation: source masking removed.',
          test: 'agent subprocess cannot read a pinned oracle source',
        },
      ]),
];
for (const probe of probes) {
  const original = readFileSync(probe.file, 'utf8');
  assert.ok(original.includes(probe.from), 'mutation target missing: ' + probe.name);
  try {
    writeFileSync(probe.file, original.replace(probe.from, probe.to));
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-name-pattern',
        probe.test,
        probe.testFile ?? 'test/protected-oracle.test.mjs',
      ],
      {
        encoding: 'utf8',
        timeout: 60000,
        env: {
          ...process.env,
          ...(process.platform === 'win32' ? {} : { TUIG_REQUIRE_SANDBOX: '1' }),
        },
      },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(
      result.status,
      0,
      'protection removed but test passed: ' + probe.name + '\n' + result.stdout,
    );
    assert.match(
      result.stdout + result.stderr,
      /AssertionError/,
      'probe must fail an assertion, not crash',
    );
    process.stdout.write(probe.name + ': regression test failed as required\n');
  } finally {
    writeFileSync(probe.file, original);
  }
}
