import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { envelope, type Envelope } from '../envelope.js';
import { cliError } from '../errors.js';
import { CLI_NAME } from '../name.js';
import { detectSandbox } from '../../sandbox/index.js';
import {
  git,
  repositoryIdentity,
  isTrusted,
  trustFile,
  validateConfig,
} from '../../engine/repository-state.js';

export type Check = { name: string; ok: boolean; detail: string; fix?: string };
export function probe(name: string, argv: string[], cwd: string): { ok: boolean; detail: string } {
  const r = spawnSync(name, argv, { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  const ok = !r.error && (r.status === 0 || (name === 'sandbox-exec' && r.status === 1));
  return {
    ok,
    detail: ok
      ? (r.stdout || r.stderr).trim().split(/\r?\n/)[0] || 'Available'
      : 'Unavailable or failed version check',
  };
}
export function doctor(
  options: {
    cwd?: string;
    platform?: NodeJS.Platform;
    nodeVersion?: string;
    trustPath?: string;
    probe?: typeof probe;
  } = {},
): Envelope {
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const checkTool = options.probe ?? probe;
  const checks: Check[] = [];
  function add(name: string, ok: boolean, detail: string, fix: string): void {
    checks.push(ok ? { name, ok, detail } : { name, ok, detail, fix });
  }
  const node = options.nodeVersion ?? process.versions.node;
  add('node', Number(node.split('.')[0]) >= 24, node, 'Install Node.js 24 or newer.');
  add(
    'platform',
    platform === 'linux' || platform === 'darwin',
    platform,
    'Use macOS or Linux (including WSL2).',
  );
  for (const [name, argv, fix] of [
    ['bun', ['--version'], 'Install Bun to compile standalone executables.'],
    ['git', ['--version'], 'Install Git.'],
    ['rg', ['--version'], 'Install ripgrep.'],
  ] as const) {
    const r = checkTool(name, [...argv], cwd);
    add(name, r.ok, r.detail, fix);
  }
  if (platform === 'darwin' || platform === 'linux') {
    const name = platform === 'darwin' ? 'sandbox-exec' : 'bwrap';
    // Without an injected probe, check that the sandbox actually confines a command, not just that it exists.
    const working = options.probe ? null : detectSandbox(platform);
    const r = options.probe
      ? checkTool(name, platform === 'darwin' ? ['-h'] : ['--version'], cwd)
      : {
          ok: working !== null,
          detail: working
            ? working.kind + ' at ' + working.executable
            : 'Unavailable or not working',
        };
    add(
      'sandbox',
      r.ok,
      r.detail,
      'Install or enable ' +
        name +
        ' before auto-edit or auto runs (they refuse to run without it).',
    );
  }
  let root: string;
  try {
    root = realpathSync(git(['rev-parse', '--show-toplevel'], cwd));
  } catch {
    return envelope('doctor', { checks }, { status: 'unconfigured', next_action: 'git init' });
  }
  const configPath = join(root, '.' + CLI_NAME, 'config.json');
  add(
    'initialized',
    existsSync(configPath),
    existsSync(configPath) ? 'Configuration file exists.' : 'Configuration is missing.',
    CLI_NAME + ' init',
  );
  if (!existsSync(configPath))
    return envelope(
      'doctor',
      { checks },
      { status: 'unconfigured', next_action: CLI_NAME + ' init' },
    );
  try {
    const trusted = isTrusted(repositoryIdentity(root), options.trustPath ?? trustFile());
    add(
      'trusted',
      trusted,
      trusted ? 'User trust matches path and root commit.' : 'Repository is not trusted.',
      CLI_NAME + ' trust',
    );
    if (!trusted) {
      const error = cliError('TUIG_E_UNTRUSTED');
      return envelope(
        'doctor',
        { checks },
        { status: 'unconfigured', error, next_action: CLI_NAME + ' trust' },
      );
    }
    const errors = validateConfig(JSON.parse(readFileSync(configPath, 'utf8')) as unknown);
    add(
      'config',
      errors.length === 0,
      errors.length ? errors.join(' ') : 'Configuration is valid.',
      'Repair ' + configPath,
    );
    if (errors.length) throw new Error(errors.join(' '));
  } catch (cause) {
    const error = cliError('TUIG_E_CONFIG', cause instanceof Error ? cause.message : String(cause));
    return envelope('doctor', { checks }, { status: 'error', error, next_action: error.fix });
  }
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) {
    const error = cliError('TUIG_E_PREREQUISITE');
    return envelope(
      'doctor',
      { checks },
      { status: 'degraded', error, next_action: failed[0]?.fix ?? error.fix },
    );
  }
  return envelope('doctor', { checks }, { status: 'ok' });
}
