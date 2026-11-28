import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { codedError } from '../cli/errors.js';
import { git } from './repository-state.js';

export type SelfHost = { pinnedVersion: string; pinnedSha256: string };
export function selfHostConfig(value: unknown): SelfHost | undefined {
  if (value === undefined) return undefined;
  const v = value as SelfHost;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    typeof v.pinnedVersion !== 'string' ||
    typeof v.pinnedSha256 !== 'string'
  )
    throw codedError('TUIG_E_CONFIG');
  return { pinnedVersion: v.pinnedVersion, pinnedSha256: v.pinnedSha256 };
}
export function binaryHash(file: string): string {
  const fd = openSync(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const initial = fstatSync(fd);
    const limit = 256 * 1024 * 1024;
    if (!initial.isFile() || initial.size > limit) throw new Error('Not a bounded regular binary');
    const hash = createHash('sha256'),
      buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      total += count;
      if (total > limit) throw new Error('Binary exceeds size limit');
      hash.update(buffer.subarray(0, count));
    }
    const final = fstatSync(fd);
    if (
      total !== initial.size ||
      final.size !== initial.size ||
      final.mtimeMs !== initial.mtimeMs ||
      final.ctimeMs !== initial.ctimeMs
    )
      throw new Error('Binary changed while hashing');
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}
/** Resolve and verify before executing any pinned code. Hash pin is the trust anchor. */
export function verifySelfHost(root: string, pin: SelfHost, invoking = false): string {
  try {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(pin.pinnedVersion) ||
      !/^[a-f0-9]{64}$/.test(pin.pinnedSha256)
    )
      throw new Error('Unset pin');
    const file = realpathSync(
      join(
        process.env.XDG_DATA_HOME || join(homedir(), '.local/share'),
        'tuig/pinned',
        pin.pinnedVersion,
        process.platform === 'win32' ? 'tuig.exe' : 'tuig',
      ),
    );
    const rel = relative(realpathSync(root), file);
    if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
      throw new Error('Pin resolves inside repository');
    if (binaryHash(file) !== pin.pinnedSha256) throw new Error('Pin hash mismatch');
    const commit = git(
      ['rev-parse', '--verify', 'refs/tags/' + pin.pinnedVersion + '^{commit}'],
      root,
    );
    const tree = git(['rev-parse', commit + '^{tree}'], root);
    const result = spawnSync(file, ['--build-identity'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 16384,
      shell: false,
    });
    if (result.error || result.status !== 0) throw new Error('Identity probe failed');
    const identity = JSON.parse(result.stdout) as {
      commit?: unknown;
      tree?: unknown;
      dirty?: unknown;
      candidate?: unknown;
    };
    if (
      identity.candidate === true ||
      identity.dirty !== false ||
      identity.commit !== commit ||
      identity.tree !== tree
    )
      throw new Error('Unknown, dirty or untagged identity');
    if (invoking && binaryHash(process.execPath) !== pin.pinnedSha256)
      throw new Error('Invoking executable is not the pin');
    return file;
  } catch {
    throw codedError('TUIG_E_SELFHOST_UNPINNED');
  }
}
export function inspectBinaryUnderTest(
  path: string,
  root: string,
): { path: string; sha256: string } {
  try {
    const file = realpathSync(resolve(root, path));
    accessSync(file, constants.X_OK);
    if (process.platform === 'win32' && !/\.(exe|com)$/i.test(file))
      throw new Error('Not a native executable');
    return { path: file, sha256: binaryHash(file) };
  } catch {
    throw codedError('TUIG_E_BINARY_UNDER_TEST');
  }
}
/** Static inspection only: candidate code must execute solely through confined checks. */
export function binaryUnderTest(path: string, root: string): string {
  return inspectBinaryUnderTest(path, root).path;
}
