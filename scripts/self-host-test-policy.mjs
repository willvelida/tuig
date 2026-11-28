import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Reviewed exceptions apply only inside a confined acceptance check. Files are
// still loaded; all other and newly added test names run normally.
export const CONFINED_EXCLUSIONS = [
  {
    file: 'source-baseline.test.mjs',
    name: 'unchanged license bytes match HEAD without platform-specific line-ending filters',
    reason:
      'Needs the real parent repository HEAD; main .git is intentionally hidden from run-worktree checks. Runs in full CI and outside acceptance.',
  },
  {
    file: 'sandbox.test.mjs',
    name: 'under the sandbox, writing outside the worktree fails; the worktree and temporary home are writable',
    reason:
      'Its parent-temp escape probe lands in the outer writable worktree mount inherited by nested bwrap; testing a fresh host boundary requires outside acceptance. No protected sandbox implementation is changed.',
  },
];
export const policyDigest = createHash('sha256')
  .update(JSON.stringify(CONFINED_EXCLUSIONS))
  .digest('hex');
assert.equal(CONFINED_EXCLUSIONS.length, 2, 'Confined exclusions require explicit review');
assert.equal(
  policyDigest,
  'c9443b235d2aa3ffc7d0198869110b5293dc7346a10313c1536ba2f74fad6188',
  'Confined exclusion policy changed without review',
);
