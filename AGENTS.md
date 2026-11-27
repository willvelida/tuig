# Repository map

- src/main.ts: entry point; src/cli/name.ts: CLI name and version.
- docs/decisions/: MADR architecture and dependency decisions.
- test/: Node test runner integration tests and schema validation.
- schemas/: published result schema; src/cli/errors.ts: error registry.
- scripts/error-docs.mjs: generates error reference and schema error codes.
- .github/workflows/ci.yml: Node checks and Bun binary smoke tests.
- src/engine/repository-state.ts: read-only Git identity, trust and config checks.
- src/cli/commands/doctor.ts: diagnostic checks; src/docs/: offline Markdown and generated bundle.
- scripts/bundle-docs.mjs: embed docs before Node and Bun builds.
- src/runner/: adapters, validated tools, context and bounded controller.
- src/cli/commands/run.ts and replay.ts: trusted branch runs and offline verified replay.
- templates/init/v1/: versioned consumer scaffolding; src/engine/: trust, records and redaction.
- fixtures/: human-approved Python benchmark tasks; oracle/reference hashes must match metadata.
- scripts/check-fixtures.mjs: structural metadata/hash checks only, no oracle execution.
- Planned: src/sandbox/ and Stage 2 isolation.

Use strict TypeScript and Node-compatible APIs. Keep dependencies minimal and permissively licensed. Record non-trivial choices in docs/decisions/.

Run npm run lint, npm run typecheck, npm test and npm run docs:check before committing. Verify npm run build:binary and the binary version for packaging changes.

PROGRESS.md, progress/ and TUIG_IMPLEMENTATION_GUIDE.md are local planning files. Update when present; do not commit them.

Do not use unreviewed benchmark tasks. Podman oracle isolation is verified. Actual hosted B0 measurement remains pending; passing Node or local-stub workflow tests is not model baseline evidence.

Native Anthropic support extends decision 3 (ADR 0027). Preserve signed thinking and append-only native history. Podman fixture setup/verification/measurement scripts are in scripts/stage1* and scripts/*stage1*.mjs; credential values must never enter files or command arguments.
