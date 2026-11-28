import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
const { values } = parseArgs({
  options: { candidate: { type: 'boolean' }, outfile: { type: 'string' } },
});
function git(args) {
  const result = spawnSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
    {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) throw new Error('Cannot establish build identity');
  return result.stdout.trim();
}
const identity = values.candidate
  ? { commit: null, tree: null, dirty: true, candidate: true }
  : {
      commit: git(['rev-parse', 'HEAD']),
      tree: git(['rev-parse', 'HEAD^{tree}']),
      dirty: git(['status', '--porcelain', '--untracked-files=normal']).length > 0,
    };
mkdirSync('bin', { recursive: true });
const require = createRequire(import.meta.url);
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
const musl =
  process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
    ? '-musl'
    : '';
let bun;
try {
  bun = require.resolve(
    '@oven/bun-' +
      platform +
      '-' +
      arch +
      musl +
      '/bin/bun' +
      (process.platform === 'win32' ? '.exe' : ''),
  );
} catch {
  // A previously completed postinstall may have moved the platform executable here.
  bun = require.resolve('bun/bin/bun.exe');
}
const result = spawnSync(
  bun,
  [
    'build',
    '--compile',
    'src/main.ts',
    '--outfile',
    values.outfile ?? 'bin/tuig',
    '--define',
    'TUIG_BUILD_IDENTITY=' + JSON.stringify(identity),
  ],
  { stdio: 'inherit', shell: false },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
