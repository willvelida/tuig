// Run under WSL/Linux with the existing Stage 1 Podman image; never pulls images.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isolatedCommand, podmanImage } from './stage1-runtime.mjs';

const root = resolve('.');
const data = join(root, 'test/data/checks');
const workspace = mkdtempSync(join(tmpdir(), 'tuig-parser-recording-'));
function command(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.signal) throw result.error ?? Error(result.signal);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
try {
  const image = podmanImage();
  copyFileSync(join(data, 'sample.py.txt'), join(workspace, 'test_sample.py'));
  copyFileSync(join(data, 'sample.ts.txt'), join(workspace, 'sample.ts'));
  const python = (args) => command(isolatedCommand(image, workspace, args));
  const pytest = python([
    'python',
    '-m',
    'pytest',
    '-q',
    '--junitxml=pytest.xml',
    'test_sample.py',
  ]);
  if (pytest.status !== 1) throw Error(JSON.stringify(pytest));
  copyFileSync(join(workspace, 'pytest.xml'), join(data, 'pytest.xml'));
  const ruff = python(['ruff', 'check', '--no-cache', '--output-format', 'json', 'test_sample.py']);
  if (ruff.status !== 1) throw Error(JSON.stringify(ruff));
  writeFileSync(join(data, 'ruff.json'), ruff.stdout);
  const eslint = command(
    [
      process.execPath,
      join(root, 'node_modules/eslint/bin/eslint.js'),
      '--config',
      join(root, 'eslint.config.js'),
      '--stdin',
      '--stdin-filename',
      'sample.js',
      '-f',
      'json',
    ],
    { input: readFileSync(join(data, 'sample.js.txt'), 'utf8') },
  );
  if (eslint.status !== 1) throw Error(JSON.stringify(eslint));
  writeFileSync(join(data, 'eslint.json'), eslint.stdout);
  const tscArgv = [process.execPath, join(root, 'node_modules/typescript/bin/tsc')];
  const tsc = command([...tscArgv, '--ignoreConfig', '--noEmit', '--pretty', 'false', 'sample.ts']);
  if (tsc.status !== 2) throw Error(JSON.stringify(tsc));
  writeFileSync(join(data, 'tsc.txt'), tsc.stdout);
  const help = command([...tscArgv, '--help', '--all']);
  const json = command([...tscArgv, '--json']);
  writeFileSync(join(data, 'tsc-json-probe.txt'), json.stdout + json.stderr);
  if (
    /^\s*--json\b/m.test(help.stdout) ||
    !json.stdout.includes("Unknown compiler option '--json'")
  )
    throw Error('Reassess tsc JSON mode');
  writeFileSync(
    join(data, 'versions.json'),
    JSON.stringify(
      {
        image,
        node: process.version,
        pytest: python(['python', '-m', 'pytest', '--version']).stdout.trim(),
        ruff: python(['ruff', '--version']).stdout.trim(),
        eslint: command([
          process.execPath,
          join(root, 'node_modules/eslint/bin/eslint.js'),
          '--version',
        ]).stdout.trim(),
        tsc: command([...tscArgv, '--version']).stdout.trim(),
        commands: {
          pytest: ['python', '-m', 'pytest', '-q', '--junitxml=pytest.xml', 'test_sample.py'],
          ruff: ['ruff', 'check', '--no-cache', '--output-format', 'json', 'test_sample.py'],
          eslint: ['eslint', '--stdin', '--stdin-filename', 'sample.js', '-f', 'json'],
          tsc: ['tsc', '--ignoreConfig', '--noEmit', '--pretty', 'false', 'sample.ts'],
          tscJson: ['tsc', '--json'],
        },
        tscJsonMode: 'No --json in --help --all; --json rejected as TS5023.',
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
