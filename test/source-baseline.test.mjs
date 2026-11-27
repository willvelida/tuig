import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
function git(args) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
test('unchanged license bytes match HEAD without platform-specific line-ending filters', () => {
  assert.equal(
    git(['hash-object', '--no-filters', 'LICENSE']),
    git(['rev-parse', 'HEAD:LICENSE']),
    'LICENSE byte differences would make the WSL source-baseline guard fail even when Windows Git reports clean',
  );
});
