import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadChecks } from '../../checks/config.js';
import { executeChecks } from '../../checks/execute.js';
import { codedError } from '../errors.js';
import { envelope, type Envelope } from '../envelope.js';
import {
  isTrusted,
  repositoryIdentity,
  trustFile,
  validateConfig,
} from '../../engine/repository-state.js';
import { detectSandbox } from '../../sandbox/index.js';
import { commandFailure, rootAt } from './run.js';
import { inspectBinaryUnderTest, selfHostConfig, verifySelfHost } from '../../engine/self-host.js';

function configured<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw codedError('TUIG_E_UNCONFIGURED');
    throw error;
  }
}

export async function checksCommand(cwd = process.cwd(), candidate?: string): Promise<Envelope> {
  try {
    const root = rootAt(cwd);
    if (!isTrusted(repositoryIdentity(root), trustFile())) throw codedError('TUIG_E_UNTRUSTED');
    const config: unknown = configured(() =>
      JSON.parse(readFileSync(join(root, '.tuig/config.json'), 'utf8')),
    );
    if (validateConfig(config).length) throw codedError('TUIG_E_CONFIG');
    const pin = selfHostConfig((config as Record<string, unknown>).selfHost);
    if (pin) verifySelfHost(root, pin, true);
    const candidateInfo =
      candidate === undefined ? undefined : inspectBinaryUnderTest(candidate, root);
    const binary = candidateInfo?.path;
    const checks = configured(() => loadChecks(root));
    for (const check of checks) {
      if (check.argv.includes('{binary-under-test}')) {
        const selected =
          binary ?? join(root, process.platform === 'win32' ? 'bin/tuig.exe' : 'bin/tuig');
        check.argv = check.argv.map((arg) => (arg === '{binary-under-test}' ? selected : arg));
      }
    }
    const settings = config as { mode: string; sandbox?: string; policy?: { passEnv?: string[] } };
    const sandbox = settings.sandbox === 'off' ? null : detectSandbox();
    if (['auto-edit', 'auto'].includes(settings.mode) && !sandbox)
      throw codedError('TUIG_E_SANDBOX');
    const data = await executeChecks(root, checks, {
      passEnv: settings.policy?.passEnv ?? [],
      ...(sandbox ? { sandbox } : {}),
    });
    const finalCandidateInfo = candidateInfo
      ? inspectBinaryUnderTest(candidateInfo.path, root)
      : undefined;
    return data.verdict === 'ok'
      ? envelope(
          'checks',
          { ...data, ...(finalCandidateInfo ? { binaryUnderTest: finalCandidateInfo } : {}) },
          { status: 'ok' },
        )
      : envelope(
          'checks',
          { ...data, ...(finalCandidateInfo ? { binaryUnderTest: finalCandidateInfo } : {}) },
          {
            status: data.verdict,
            next_action: 'Fix the reported diagnostics, then run tuig checks again.',
          },
        );
  } catch (error) {
    return commandFailure('checks', error);
  }
}
