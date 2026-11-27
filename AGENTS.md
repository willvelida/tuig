# Repository map

- src/main.ts: entry point; src/cli/name.ts: CLI name and version.
- docs/decisions/: MADR architecture and dependency decisions.
- test/: Node test runner integration tests.
- .github/workflows/ci.yml: Node checks and Bun binary smoke tests.
- Planned: src/engine/, src/runner/, src/sandbox/, schemas/, templates/ and fixtures/.

Use strict TypeScript and Node-compatible APIs. Keep dependencies minimal and permissively licensed. Record non-trivial choices in docs/decisions/.

Run npm run lint, npm run typecheck and npm test before committing. Verify npm run build:binary and the binary version for packaging changes.

PROGRESS.md, progress/ and TUIG_IMPLEMENTATION_GUIDE.md are local planning files. Update when present; do not commit them.
