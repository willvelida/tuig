# Step 1.1: Project skeleton and decision records

- **Stage:** 1 — Baseline
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 1 → Step 1.1
- **Depends on:** Step 0
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Build

- [ ] `package.json` with `type: module`, `bin: { tuig: dist/main.js }` and an `engines.node` floor.
- [ ] Strict `tsconfig` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- [ ] ESLint with typescript-eslint, `node:test` tests and a build script.
- [ ] CI workflow: lint, typecheck, tests on Node, and a Bun compile with a smoke test of the binary.
- [ ] `package.json` `license: "Apache-2.0"`, plus `repository`/`bugs`/`homepage` fields pointing at `github.com/willvelida/tuig`. Check whether the npm name `tuig` is free; if it isn't, stop and ask.
- [ ] Replace the Go `.gitignore` with a Node/TypeScript one (see Step 0), and expand `README.md`.
- [ ] `AGENTS.md` (short map) and `PROGRESS.md`. Add a `CLAUDE.md` symlink to `AGENTS.md` only if the human asks for it.
- [ ] `docs/decisions/0001…0010` recording the ten decisions in §1, plus one record per dependency added.

## Acceptance criteria

Tick only when verified by a command or test, and log the evidence below.

- [ ] `npm run lint`, `npm run typecheck` and `npm test` all pass.
- [ ] `bun build --compile` produces a binary that prints `--version`.
- [ ] Ten decision records exist.

## How to verify (from the guide)

run those commands and paste a summary into `PROGRESS.md`.

## Verification log

| Date | Command / test | Result (summary) |
|---|---|---|
| | | |

## Decision records created

- (none yet) <!-- e.g. docs/decisions/0011-json-schema-validator.md -->

## Notes and deviations from the guide

- (none yet)

## Open questions for the human

- (none yet) <!-- also copy each one into PROGRESS.md → Open questions -->
