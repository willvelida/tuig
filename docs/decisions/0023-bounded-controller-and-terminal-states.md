# Bounded controller and terminal states

- Status: Accepted
- Date: 2026-11-27

## Context

The minimal runner must separate model claims, tool outcomes, validation sensors and host-owned terminal verdicts. It must stop predictably without frameworks.

## Decision

Use an explicit transition table and a plain async loop. Every state/event pair is covered by a test table. Journal state changes and model requests/responses; emit terminal run_end and a summary from host code only. Never treat model completion text as success: executable acceptance checks must pass, and an empty check list fails.

Apply request and whole-tool-batch budgets before action, token/cost limits after responses and wall/cancellation checks at boundaries. Preserve decision 6 defaults. Optional independent token and tool-call caps have no invented default; they activate when configured. Count input plus output tokens without double-counting cached/reasoning subtotals. Repair at most three times per failing check and six total. Three consecutive malformed responses/calls produce ERROR. Four identical action/observation pairs produce STUCK; broader detectors and resumability remain Stage 2 work.

Install a scoped SIGINT listener and yield to the event loop at boundaries so pending interrupts are serviced even under immediate replay. Cancellation prevents the next batch, writes CANCELLED and removes its listener. POSIX tests send a real SIGINT; Windows tests deliver the same Node SIGINT event because native Windows is out of scope.

## Consequences

No dependencies or new model calls. The controller requires an injected visible-check function; hidden oracle verdicts do not enter model messages. Approval and pause states have transitions, while interactive approval and resume orchestration are built in Stage 2.
