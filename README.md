# tuig

A starter kit for coding harnesses.

A model-neutral coding-agent harness, under development. Node.js 24 or newer is required.

## Install from source

```sh
npm ci
npm run build
npm link
tuig --version
tuig --help
```

Help, version, built-in docs and read-only diagnostics are implemented; npm releases are planned.

## Development

Run npm run lint, npm run typecheck and npm test. Run npm run build:binary to compile a standalone executable using the pinned Bun development dependency.

## Safety model

The planned agent defaults to local models, explicitly allow-listed hosted endpoints, and terminal approval prompts. macOS and Linux (including WSL2) are the supported v1 platforms. Native Windows is out of scope. The Stage 1 runner is implemented for reviewed synthetic fixtures; OS sandbox isolation is still pending Stage 2.

Start with `tuig agents-start-here`, read an offline topic with `tuig docs get safety`, and inspect readiness with `tuig doctor`. Initialize a consumer repository with `tuig init`, review the proposed configuration, then grant trust with `tuig trust`. Use `--write-agents-md` only when you want the proposed AGENTS section written. Non-interactive trust requires `TUIG_TRUST_CI=1`. See [decisions](docs/decisions/) for architecture and defaults.

Licensed under [Apache-2.0](LICENSE).

## Output

Commands return a versioned result envelope. Piped output defaults to JSON; terminals display the same fields as text. Set TUIG_OUTPUT=json or TUIG_OUTPUT=text to override. Non-ok results include a next_action; exit codes are 0 for ok/degraded, 2 for unconfigured, and 1 for error.

See [error codes](docs/reference/error-codes.md) and the [envelope schema](schemas/envelope.schema.json). Regenerate error references with npm run docs:errors; CI verifies them with npm run docs:check.

Doctor reports Node/Bun versions, Git, ripgrep, platform sandbox availability, initialization, user trust and baseline config validity. Missing initialization returns unconfigured with `tuig init`; missing prerequisites on an initialized, trusted repository return degraded with fixes. A passing availability check does not prove sandbox isolation.

## Run and replay

On macOS or Linux/WSL2, initialize and trust a synthetic consumer repository, configure its model and visible checks, and commit the base. Run `tuig run --instruction "Fix the documented bug"` or a reviewed named task with `tuig run <task-id>`. Inspect the returned ID with `tuig runs show <id>`, then verify its decisions offline with `tuig runs replay <id> --adapter replay`. Replay does not execute recorded commands or edits.

Read `tuig docs get configuration` for local, hosted and offline model configuration. Hosted development calls require explicit approval and synthetic fixtures. B0 measurements are pending human oracle review and model selection.

The three benchmark task proposals are ready for [human oracle review](fixtures/ORACLE_REVIEW.md). `npm run fixtures:check` validates metadata and pinned hashes without running the Python oracles. Step 1.11 and the Stage 1 checkpoint remain incomplete until review, isolated execution and B0 measurements pass.

Native Anthropic Messages is supported alongside compatible endpoints and replay. The approved Stage 1 configuration is in `eval/baselines/B0/settings.json` and stores only the credential variable name. Rootless Podman setup is reproducible with `sh scripts/prepare-stage1-wsl.sh`; see the [B0 instructions](eval/baselines/B0/README.md) for verification and measurement. Signed native history is preserved without masking.
