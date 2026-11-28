# Self-hosting setup and owner pinning

Step 3.5a installs no pin and runs no agent on this repository. The checked-in
OWNER_PIN_PENDING / OWNER_SHA256_PENDING values deliberately fail doctor with
TUIG_E_SELFHOST_UNPINNED after trust. Init's proposed AGENTS.md section was left
unwritten. ADRs 0042 and 0043 define provenance and the one-off later demo scope.

Only the owner performs the following in WSL, after reviewing and committing the
implementation. Choose a unique tag; creating it is a human release action.
Do not use a working-tree development binary as the pin. The tag must remain
available in every checkout in which the pin is used.

```sh
cd /mnt/c/Users/willv/orca/tuig
version=v0.1.0-selfhost.1
git -c core.hooksPath=/dev/null tag "$version" <reviewed-commit>
pinbuild=$(mktemp -d /var/tmp/tuig-pin.XXXXXX)
git -c core.hooksPath=/dev/null clone --no-hardlinks . "$pinbuild/repo"
cd "$pinbuild/repo"
git -c core.hooksPath=/dev/null checkout --detach "$version"
npm ci
npm run build:binary
./bin/tuig --build-identity
sha256sum ./bin/tuig
install -d "$HOME/.local/share/tuig/pinned/$version"
install -m 0755 ./bin/tuig "$HOME/.local/share/tuig/pinned/$version/tuig"
pinned="$HOME/.local/share/tuig/pinned/$version/tuig"
sha256sum "$pinned"
cd /mnt/c/Users/willv/orca/tuig
node --input-type=module - "$version" "$pinned" <<'NODE'
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const config = JSON.parse(readFileSync('.tuig/config.json', 'utf8'));
config.selfHost = {pinnedVersion: process.argv[2], pinnedSha256: createHash('sha256').update(readFileSync(process.argv[3])).digest('hex')};
writeFileSync('.tuig/config.json', JSON.stringify(config, null, 2) + '\n');
NODE
"$pinned" trust
"$pinned" doctor
```

If XDG_DATA_HOME is set, install beneath "$XDG_DATA_HOME/tuig/pinned/$version"
instead. Review and commit the configured pin before a run: run bases must be
clean. Doctor always reports all other diagnostics and reports a self-host error
when invoked from source or an executable whose hash differs from the pin. Run
and checks refuse execution unless the invoking executable has the pinned hash.

Prepare offline dependencies before the owner launches a run. Keep the seed
outside the real home, /tmp, and /mnt, which are hidden in Linux isolation:

```sh
export TUIG_NPM_CACHE_SEED="/var/tmp/tuig-offline-npm-cache-$(id -u)"
npm ci --cache "$TUIG_NPM_CACHE_SEED"
export npm_config_cache=.tuig/temp/offline-npm-cache
```

Use the same Linux npm, Node, lockfile and architecture when populating the seed.
Trusted setup copies the seed into each worktree, then npm ci --offline
--ignore-scripts installs dependencies with no network before protection baselines.
Build uses the already-installed optional Bun platform package directly, avoiding
Bun's download-capable postinstall. Missing tarballs fail offline. No credential
variable is passed through to setup or checks. Standalone checks do not run setup.

After an owner-run demo, accept a change only after the pinned harness runs:

```sh
npm run build:binary
"$pinned" checks --binary-under-test "$PWD/bin/tuig"
```

The safety-fixture check selects that candidate; the pinned executable remains
the harness. Review protected diffs and summary.selfHost.protectedPathsTouched.
Unit/integration tests use four sorted-file shards of the same complete npm-test
set, exposed by `node scripts/self-host-tests.mjs --list`, after a build check.
The configured checks fail closed if the 60-second per-check limit is exceeded;
split/optimize a slow suite under human review rather than weakening that limit.
The one-off hosted Anthropic permission is solely the owner's later Step 3.5b
demo, launched from WSL with its credential only in the process environment.
This document does not execute that demo or alter endpoint policy gates.
