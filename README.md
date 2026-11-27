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

Only help and version are implemented at this stage; npm releases are planned.

## Development

Run npm run lint, npm run typecheck and npm test. Run npm run build:binary to compile a standalone executable using the pinned Bun development dependency.

## Safety model

The planned agent defaults to local models, explicitly allow-listed hosted endpoints, and terminal approval prompts. macOS and Linux (including WSL2) are the supported v1 platforms. Native Windows is out of scope. The runner and sandbox are not implemented yet.

The planned onboarding command is tuig agents-start-here, which will ship with the self-teaching documentation. See [decisions](docs/decisions/) for architecture and defaults.

Licensed under [Apache-2.0](LICENSE).
