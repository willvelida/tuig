# Terminal approval prompt

- Status: Accepted
- Date: 2026-11-27

## Context

Steps 2.1 and 2.2 route consequential actions to an approver, with a non-interactive default of deny. Step 2.3 needs the human-facing prompt: raw argv, cwd, matching rule and diff stat; allow once, allow for this run or deny; run-scoped memory that never persists; recorded events; and no model prose presented as a description of the action.

## Decision

`src/cli/approval-prompt.ts` provides a pure `renderApproval`, `parseChoice` and `terminalApprover`, plus `openTerminal` for real use.

- **Content.** `ApprovalRequest` carries only harness-derived fields: tool, rule, cwd, raw argv, path, proposed change size for edits. The prompt adds the worktree's `git diff --shortstat` since the base. Assistant messages and other model text are never in a request, so they cannot appear. Argv is shown as a JSON array so argument boundaries are exact.
- **Escaping.** Every displayed value passes through `displaySafe`, which escapes C0/C1 controls (so no ANSI sequences, carriage returns or newlines), DEL, and bidi and zero-width characters. Model-chosen argv therefore cannot redraw, hide or add prompt lines.
- **Choices.** `o`/`once` allow once, `r`/`run` allow for this run, and anything else, including an empty line or end of input, denies.
- **Run memory.** "Allow for this run" is kept in the approver's closure, keyed by tool, rule, argv, path and cwd, so it covers only the identical action. A new run creates a new approver; nothing is written to disk. Remembered approvals still produce `approval_requested` and `approval_decided` events, so the record shows every use.
- **Terminal I/O.** The prompt reads and writes `/dev/tty` synchronously. The controller and tools stay synchronous, and stdout remains the JSON or text envelope. Runs are already limited to Linux and macOS.
- **Non-interactive.** With no TTY on stdin and stderr, with `CI` set, or with `interactive: false`, no approver exists and every ask becomes `policy_denied` (ADR 0031). Programmatic callers may pass their own approver.

## Consequences

Interactive runs block on the human at each ask. A remembered allow is exact-match, so a slightly different command asks again; this is deliberate. Replay reproduces recorded decisions without prompting. A real-terminal test drives the actual CLI under a util-linux `script` pseudo-terminal on Linux. macOS CI skips that one test, and the same code path is covered there by the fake-terminal tests.
