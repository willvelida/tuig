# Rootless Podman isolation for Stage 1 fixtures

- Status: Accepted (human selected Podman and approved WSL/tool/image setup)
- Date: 2026-11-27

## Context

Stage 1 permits trusted test execution before the general Stage 2 OS sandbox exists. Edited Python code must not reach host oracle files through that tool.

## Decision

Use existing rootless Podman in Ubuntu WSL. Keep Node 24 and ripgrep tooling under ignored .tuig/temp/stage1; verify the official Node archive checksum. Extract ripgrep locally rather than repair the host's pre-existing interrupted dpkg state. Build a fixture-only Python image with pinned pytest/Ruff and record its content-addressed image ID.

Agent/check commands mount only the synthetic workspace, disable networking, use an unprivileged mapped user, drop all capabilities, enable no-new-privileges, bound memory/PIDs and keep the root filesystem read-only with tmpfs scratch. Exact trusted argv prevents the model from adding mounts or flags. No credentials are passed into containers.

Only after the controller terminates, run hidden oracles in a separate container with read-only workspace and read-only oracle mount. Hidden output is human evidence, never a model observation. Verify each buggy task fails visible/hidden tests and each approved reference passes them and lint. Probe isolation through the same subprocess path as the agent tools.

## Consequences

External tooling, not a bundled product dependency. This optional fixture boundary does not implement or replace Stage 2's general workspace/sandbox/approval features. B0 measurement requires explicit invocation, available credentials and matching image/oracle verification; it refuses to overwrite existing results or partial evidence.
