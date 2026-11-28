# Self-hosting and owner pinning

Step 3.5a installs no real pin and runs no agent on this repository. Placeholder
selfHost values deliberately produce TUIG_E_SELFHOST_UNPINNED after trust.
AGENTS.md is unchanged. ADRs 0042/0043 govern provenance and the later one-off demo.

Use a **WSL Linux-filesystem clone**, such as `$HOME/src/tuig`, never `/mnt/c`:
DrvFs is slow against the 60-second check caps, and confinement deliberately hides
/mnt and the real home except explicit tool mounts and the run worktree. Never
expose the main repository's .git to checks. Have Linux Node >=24, npm, Git,
ripgrep, gitleaks, Bun and working bubblewrap on PATH. The owner is arm64; Bun's
regular aarch64 package is selected. On x64 the resolver selects regular x64,
**not a -baseline variant**: CPUs needing Bun's baseline distribution require a
separately reviewed compatible compiler/resolver setup; no automatic fallback.

Only the owner performs these later commands, choosing a reviewed commit/tag:

```sh
mkdir -p "$HOME/src"
git -c core.hooksPath=/dev/null clone /mnt/c/Users/willv/orca/tuig "$HOME/src/tuig"
repo="$HOME/src/tuig"
cd "$repo"
git -c core.hooksPath=/dev/null checkout <reviewed-commit>
version=v0.1.0-selfhost.1
git -c core.hooksPath=/dev/null tag "$version" <reviewed-commit>
pinbuild=$(mktemp -d /var/tmp/tuig-pin.XXXXXX)
git -c core.hooksPath=/dev/null clone --no-hardlinks "$repo" "$pinbuild/repo"
cd "$pinbuild/repo"
git -c core.hooksPath=/dev/null checkout --detach "$version"
npm ci --ignore-scripts --no-audit --no-fund
npm run build:binary
./bin/tuig --build-identity
git -c core.hooksPath=/dev/null rev-parse "$version^{commit}"
git -c core.hooksPath=/dev/null rev-parse "$version^{tree}"
sha256sum ./bin/tuig
```

Compare the identity's commit/tree with both Git outputs; dirty must be false
and candidate absent. Stop on any mismatch. Then install outside the repository:

```sh
pindir="${XDG_DATA_HOME:-$HOME/.local/share}/tuig/pinned/$version"
install -d "$pindir"
install -m 0755 ./bin/tuig "$pindir/tuig"
pinned="$pindir/tuig"
sha256sum "$pinned"
cd "$repo"
node --input-type=module - "$version" "$pinned" <<'NODE'
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const config = JSON.parse(readFileSync('.tuig/config.json', 'utf8'));
config.selfHost = {pinnedVersion: process.argv[2], pinnedSha256: createHash('sha256').update(readFileSync(process.argv[3])).digest('hex')};
writeFileSync('.tuig/config.json', JSON.stringify(config, null, 2) + '\n');
NODE
"$pinned" trust
"$pinned" doctor --json
git -c core.hooksPath=/dev/null add .tuig/config.json
git -c core.hooksPath=/dev/null commit -s -m "chore(self-host): configure reviewed pin"
```

template.lock.json records **initial upstream template hashes**, not the current
customized config/checks. Customization intentionally appears in template diff;
do not rewrite the lock to claim custom bytes are upstream. Init preserves these
files. selfHost.pinnedSha256 is the actual binary integrity anchor, independent
of template lock. Doctor from dev code retains normal diagnostics after trust
and reports its self-host failure; untrusted repos refuse before config reads.
Docs/orientation/runs show remain available; run/checks require the pin.

Prepare a public cache with the same architecture, Node/npm and lockfile:

```sh
cd "$repo"
export TUIG_NPM_CACHE_SEED="/var/tmp/tuig-offline-npm-cache-$(id -u)"
npm ci --ignore-scripts --no-audit --no-fund --cache "$TUIG_NPM_CACHE_SEED"
export npm_config_cache=.tuig/temp/offline-npm-cache
```

Setup can read the seed under /var/tmp; home, /tmp and /mnt are hidden. It copies
the cache and installs offline with scripts/audit/fund disabled, no network,
before the protection baseline. Missing tarballs fail closed. Build uses the
installed optional Bun platform executable, never its download-capable install
script. No credential variable is passed to setup/checks. Standalone checks do
not execute setup.

Every Linux check receives a private /var/tmp tmpfs, never writable host temp.
Confined shards create/clean worktree-local TMPDIR/TEMP/TMP with an untyped package boundary
for fixture tools (preserving Node's normal syntax detection), and print their named exclusions. The trusted
--sandboxed flag requires working nested sandbox/gitleaks and removes inherited Git/Python overrides
only from fixture-test processes, so plain-tool controls work. Every actual
harness subprocess still reapplies minimalEnv's protections. All test files are
discovered dynamically with complete/nonempty shard guards. Only two exact names
are skipped inside confined checks, pinned by count, SHA-256 and a guard test in
scripts/self-host-test-policy.mjs:

- source-baseline.test.mjs, `unchanged license bytes match HEAD without platform-specific line-ending filters`: needs the actual repository HEAD, deliberately unavailable without exposing main .git.
- sandbox.test.mjs, `under the sandbox, writing outside the worktree fails; the worktree and temporary home are writable`: its parent-temp probe lands in the outer writable mount inherited by nested bwrap; a fresh host boundary is tested outside confinement.

Both files are still loaded, so every other/new name in them runs. No whole file
is omitted. Host-mode shards retain the original host temp environment, so these
fresh-host controls exercise their original assumptions. Both cases run in full CI and outside-sandbox acceptance below; there
is no exception outside --sandboxed mode. The two-entry policy cannot silently grow.

An explicit operator can verify the entire phase without an agent/model, in a
**disposable clean Linux clone**, with the seed/environment above:

```sh
npm run build
node scripts/verify-self-host-checks.mjs
```

It uses real createWorkspace, sandboxed executeSetup, protectionState and every
committed check via executeCheck, printing step timings and log paths. It leaves
the ignored worktree/record for inspection; remove the disposable clone after.

The committed candidate build uses `npm run build:binary -- --candidate`: no Git
query or main .git exposure, and unknown commit/tree, dirty true, candidate true.
Doctor always rejects candidates as pins. The normal owner build without that
flag still requires real Git identity and never fabricates a clean commit.
checks candidate selection is **static only**: regular executable and bounded
SHA-256, recorded as path/hash. It never executes code with the host environment;
only the confined safety check executes the candidate.

Acceptance scripts and config are protected: scripts/**, package.json,
package-lock.json, eslint.config.*, tsconfig*.json, npm/Bun and formatter configuration,
in addition to §4. protectedTests includes test/** and test-file patterns, so
adding/editing tests needs human approval. Direct noninteractive edits are denied;
an unapproved resulting test diff ends FAILED_VALIDATION. Both policy lists appear in
summary.selfHost.protectedPathsTouched, including denied attempts and diffs when
an earlier gate fails.

After the owner-run demo, review the diff and accept **inside the returned change
worktree, not the main checkout**. Use the absolute path from the run result
(resume and workspace IDs may differ). Trust that canonical worktree path;
main-checkout trust does not cover it. Dependencies came from the run's setup.
Remove all demo credential variables before executing reviewed changed code
outside confinement (the command below shows the default variable name):

```sh
change=<absolute-worktree-path-from-run-result>
cd "$change"
unset ANTHROPIC_API_KEY
"$pinned" trust
npm run build:binary -- --candidate
"$pinned" checks --binary-under-test "$change/bin/tuig"
TUIG_REQUIRE_SANDBOX=1 TUIG_REQUIRE_GITLEAKS=1 npm test
```

The pinned checks command executes the committed checks in confinement with
the pin as harness; the final command is full outside-sandbox acceptance after
human review, with credentials removed. Review protected diffs and summary
evidence. Every check retains its 60-second cap; rebalance shards under review
instead of extending it or disabling sandbox/network isolation.

The hosted Anthropic permission is solely the later Step 3.5b demo, owner-launched
from WSL with the credential only in that process environment. This document
executes no demo and changes no adapter/egress gate.
