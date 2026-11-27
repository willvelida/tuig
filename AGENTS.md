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
- Planned: src/runner/, src/sandbox/, templates/ and fixtures/.

Use strict TypeScript and Node-compatible APIs. Keep dependencies minimal and permissively licensed. Record non-trivial choices in docs/decisions/.

Run npm run lint, npm run typecheck, npm test and npm run docs:check before committing. Verify npm run build:binary and the binary version for packaging changes.

PROGRESS.md, progress/ and TUIG_IMPLEMENTATION_GUIDE.md are local planning files. Update when present; do not commit them.
