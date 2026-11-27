# OS sandbox: bubblewrap and seatbelt

- Status: Accepted
- Date: 2026-11-28

## Context

Policy (ADR 0031) classifies argv, but a classified command can still misbehave internally: write outside the worktree, open a socket, read `~/.ssh` by a computed path, or signal the harness by pid (ADR 0033). Step 2.5 requires an OS sandbox that confines writes to the worktree and temporary directory, denies network access, blocks credential reads and fails closed, on macOS and Linux.

## Decision

`src/sandbox/index.ts` is the only boundary callers use (`detectSandbox`, `sandboxSpec`, `sandboxArgv`); `linux-bwrap.ts` and `macos-seatbelt.ts` are replaceable implementations. `@anthropic-ai/sandbox-runtime` was not adopted: it is pre-1.0, and both platforms need only a small argv or profile generator here, so no new dependency is added. It remains a drop-in candidate behind `sandbox/index.ts`.

**Spec.** Each command gets a canonical spec: cwd; writable = the worktree and the tool's temporary HOME/TMPDIR; hidden = the real home plus `/mnt`, `/media`, `/root` (Linux; WSL mounts Windows drives under `/mnt`) or `/Volumes` (macOS); read-only exceptions = parent directories of PATH entries and of the Node runtime that live under a hidden root. An exception is never a directory that directly contains `.ssh`, `.aws`, `.config`, `.gnupg`, `.netrc`, `.docker`, `.kube` or `.azure`, so a PATH entry of `~/bin` cannot re-expose `~`.

**Linux.** `bwrap --die-with-parent --new-session --unshare-all --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp`, then a tmpfs over each hidden root, then read-only binds of the exceptions, then read-write binds of the writable paths, then `--chdir`. Unsharing every namespace removes the network (loopback only), hides other PIDs (tools cannot signal the harness), and ties the sandbox's lifetime to bwrap, so killing the tool's process group also kills descendants that escaped the group (ADR 0033).

**macOS.** `sandbox-exec -p <profile>` with `(allow default)`, then `(deny network*)`, `(deny signal)` with `(allow signal (target same-sandbox))`, `(deny file-write*)` with an allow-list of the writable subpaths and a few devices, and `(deny file-read*)` of the hidden roots with read allows for the exceptions and writable paths. SBPL gives later rules precedence. Paths are canonical (`/private/var/...`) and quoted.

**Use and fail closed.** `detectSandbox` finds the executable and runs a confined probe; a missing or non-working sandbox is `null`. `tuig run` uses the sandbox for agent `run` commands and checks whenever it works (config `sandbox: auto`, the default). `auto-edit` and `auto` refuse with `TUIG_E_SANDBOX` when none works. `sandbox: off` is accepted only in `plan` and `ask`, for setups where trusted checks bring their own isolation (such as the Stage 1 Podman fixtures). `run_start` records the sandbox kind or `none`. `doctor` uses the same functional probe.

**Verification.** On Linux the acceptance tests run the real bubblewrap, with unsandboxed controls showing that the same write and read succeed without it, and mutation checks (dropping `--unshare-all`, dropping the home tmpfs, making `/` writable) each fail them. CI installs bubblewrap, lifts Ubuntu 24.04's AppArmor restriction on unprivileged user namespaces for the runner, and sets `TUIG_REQUIRE_SANDBOX=1` so the tests cannot silently skip. macOS runs the same acceptance tests against `sandbox-exec` on the GitHub macOS runner; it is not available locally.

## Consequences

Tools in a sandboxed run cannot use the network (package installs already ask), cannot see the user's home, and start with an empty `/tmp`. Tools installed under a hidden root are reachable only through PATH or the Node runtime. `sandbox-exec` is deprecated by Apple but still shipped; the boundary module keeps it replaceable. Hosts without unprivileged user namespaces get no sandbox, and autonomous modes refuse there.
