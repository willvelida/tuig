// Same complete file set and concurrency as npm test, partitioned for 60-second checks.
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { CONFINED_EXCLUSIONS } from './self-host-test-policy.mjs';
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
  const sandboxed = process.argv[3] === '--sandboxed';
  if (!/^[0-3]$/.test(arg ?? '') || process.argv.length !== (sandboxed ? 4 : 3))
    throw new Error('Use a shard index 0..3 [--sandboxed] or --list');
  let temp;
  const env = { ...process.env };
  if (sandboxed) {
    const root = realpathSync(process.cwd()),
      parent = join(root, '.tuig/temp/test-tmp');
    mkdirSync(parent, { recursive: true });
    const rel = relative(root, realpathSync(parent));
    assert.ok(
      rel &&
        !isAbsolute(rel) &&
        rel !== '..' &&
        !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')),
      'Temporary parent must stay inside worktree',
    );
    temp = mkdtempSync(join(parent, arg + '-'));
    // Match ordinary /tmp: stop inheriting type:module, while retaining Node's
    // syntax detection for copied ESM .js files and CommonJS extensionless tools.
    writeFileSync(join(temp, 'package.json'), '{}');
    env.TMPDIR = temp;
    env.TMP = temp;
    env.TEMP = temp;
    env.TUIG_REQUIRE_SANDBOX = '1';
    env.TUIG_REQUIRE_GITLEAKS = '1';
    // The fixture controls deliberately exercise plain Git/Python. Actual harness
    // subprocesses reapply these protections through minimalEnv on every call.
    for (const key of Object.keys(env))
      if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete env[key];
    delete env.PYTHONPYCACHEPREFIX;
    delete env.PYTHONDONTWRITEBYTECODE;
  }
  const exclusions = sandboxed ? CONFINED_EXCLUSIONS : [];
  console.log('Named test exclusions: ' + JSON.stringify(exclusions));
  for (const item of exclusions)
    assert.ok(files.includes(item.file), 'Excluded file must remain in the complete file set');
  try {
    const selected = groups[Number(arg)];
    const special = selected.filter((file) => exclusions.some((item) => item.file === file));
    const ordinary = selected.filter((file) => !special.includes(file));
    let status = 0;
    const run = (args) => {
      const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...args], {
        stdio: 'inherit',
        shell: false,
        env,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) status = result.status ?? 1;
    };
    if (ordinary.length) run(ordinary.map((file) => 'test/' + file));
    for (const file of special) {
      const escaped = exclusions
        .filter((item) => item.file === file)
        .map((item) => item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      run(['--test-skip-pattern', '^(?:' + escaped.join('|') + ')$', 'test/' + file]);
    }
    process.exitCode = status;
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}
