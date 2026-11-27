# tuig progress

Hand-off file for the implementing agent. **Read this first at the start of every session**, then open the current step's file in `progress/`. Update both before you finish a session.

Guide: `TUIG_IMPLEMENTATION_GUIDE.md` · Repository: https://github.com/willvelida/tuig

## Current position

- **Current step:** Step 1.1 — [progress/1-01-project-skeleton-and-decision-records.md](progress/1-01-project-skeleton-and-decision-records.md)
- **Status:** Not started
- **Last updated:** 2026-11-27
- **Next action:** Step 0 complete. Step 1.1 is unstarted; await the next user session.

## Repository state

<!-- Filled in by Step 0. Known at guide-writing time (27 Nov 2026): initial commit 4341c62 with README.md, LICENSE (Apache-2.0), .gitignore (Go template). -->

- Verified 2026-11-27: HEAD and origin/main are initial commit `4341c627d1dee6efc60bab6bd1679b0c695fdd62`; fetch and fast-forward check reported already up to date.
- Branch: `chore/step-0-orientation`.
- Starting tracked files: README.md with tagline "A starter kit for coding harnesses.", LICENSE (Apache-2.0), .gitignore (Go template). Preserve tagline and licence; replace ignore rules in Step 1.1, retaining .env protection.
- Guide and progress files were supplied untracked; include them in the orientation commit. No substantial code or conflicts with the guide exist.
- Proposed layout follows guide section 3: root Node/TypeScript configuration and AGENTS.md; src/ for implementation, docs/decisions/ for MADR records, docs/reference/ for generated references, and templates/, schemas/, fixtures/, test/ at root.
- No build or tests exist yet. Step 1.1 remains unstarted.

## Step tracker

Status values: Not started · In progress · Blocked · Done

| Step | Title | Status | File |
|---|---|---|---|
| 0 | Orient in the existing repository | Done | [0-00-orient-in-repository.md](progress/0-00-orient-in-repository.md) |
| 1.1 | Project skeleton and decision records | Not started | [1-01-project-skeleton-and-decision-records.md](progress/1-01-project-skeleton-and-decision-records.md) |
| 1.2 | Envelope, error registry and output modes | Not started | [1-02-envelope-error-registry-and-output-modes.md](progress/1-02-envelope-error-registry-and-output-modes.md) |
| 1.3 | Self-teaching docs and `tuig doctor` | Not started | [1-03-self-teaching-docs-and-tuig-doctor.md](progress/1-03-self-teaching-docs-and-tuig-doctor.md) |
| 1.4 | `tuig init` and `tuig trust` | Not started | [1-04-tuig-init-and-tuig-trust.md](progress/1-04-tuig-init-and-tuig-trust.md) |
| 1.5 | Run record and redaction | Not started | [1-05-run-record-and-redaction.md](progress/1-05-run-record-and-redaction.md) |
| 1.6 | Model adapter | Not started | [1-06-model-adapter.md](progress/1-06-model-adapter.md) |
| 1.7 | Tools (stage 1 set) | Not started | [1-07-tools-stage-1-set.md](progress/1-07-tools-stage-1-set.md) |
| 1.8 | Run controller and budgets | Not started | [1-08-run-controller-and-budgets.md](progress/1-08-run-controller-and-budgets.md) |
| 1.9 | Context manager | Not started | [1-09-context-manager.md](progress/1-09-context-manager.md) |
| 1.10 | `tuig run`, `tuig runs show`, `tuig runs replay` | Not started | [1-10-tuig-run-tuig-runs-show-tuig-runs-replay.md](progress/1-10-tuig-run-tuig-runs-show-tuig-runs-replay.md) |
| 1.11 | Fixture `ledger-lite` and the first three tasks | Not started | [1-11-fixture-ledger-lite-and-the-first-three-tasks.md](progress/1-11-fixture-ledger-lite-and-the-first-three-tasks.md) |
| 1 ✓ | Stage 1 checkpoint | Not started | [1-99-stage-1-checkpoint.md](progress/1-99-stage-1-checkpoint.md) |
| 2.1 | Workspace manager | Not started | [2-01-workspace-manager.md](progress/2-01-workspace-manager.md) |
| 2.2 | Policy engine and modes | Not started | [2-02-policy-engine-and-modes.md](progress/2-02-policy-engine-and-modes.md) |
| 2.3 | Approval prompt | Not started | [2-03-approval-prompt.md](progress/2-03-approval-prompt.md) |
| 2.4 | Safe subprocess execution | Not started | [2-04-safe-subprocess-execution.md](progress/2-04-safe-subprocess-execution.md) |
| 2.5 | OS sandbox | Not started | [2-05-os-sandbox.md](progress/2-05-os-sandbox.md) |
| 2.6 | Stuck detection, cancellation and resume | Not started | [2-06-stuck-detection-cancellation-and-resume.md](progress/2-06-stuck-detection-cancellation-and-resume.md) |
| 2.7 | Safety fixtures | Not started | [2-07-safety-fixtures.md](progress/2-07-safety-fixtures.md) |
| 2 ✓ | Stage 2 checkpoint | Not started | [2-99-stage-2-checkpoint.md](progress/2-99-stage-2-checkpoint.md) |
| 3.1 | `checks.json` and parsers | Not started | [3-01-checks-json-and-parsers.md](progress/3-01-checks-json-and-parsers.md) |
| 3.2 | Lint on edit and the repair loop | Not started | [3-02-lint-on-edit-and-the-repair-loop.md](progress/3-02-lint-on-edit-and-the-repair-loop.md) |
| 3.3 | Protected tests, hidden oracle and the abort option | Not started | [3-03-protected-tests-hidden-oracle-and-the-abort-option.md](progress/3-03-protected-tests-hidden-oracle-and-the-abort-option.md) |
| 3.4 | Secret gate | Not started | [3-04-secret-gate.md](progress/3-04-secret-gate.md) |
| 3 ✓ | Stage 3 checkpoint | Not started | [3-99-stage-3-checkpoint.md](progress/3-99-stage-3-checkpoint.md) |
| 4 | Persistent context (outline) | Not started | [4-00-stage-4-persistent-context-outline.md](progress/4-00-stage-4-persistent-context-outline.md) |
| 5 | Measurement (outline) | Not started | [5-00-stage-5-measurement-outline.md](progress/5-00-stage-5-measurement-outline.md) |
| 6 | Optional extensions (only with Stage 5 evidence) | Not started | [6-00-stage-6-optional-extensions-only-with-stage-5-evidence.md](progress/6-00-stage-6-optional-extensions-only-with-stage-5-evidence.md) |

## Open questions for the human

<!-- One line each: date, step, question, and what you're doing meanwhile. Move to "Resolved" when answered. -->

- (none yet)

### Resolved

- (none yet)

## Session log

| Date | Session summary | Steps touched | Commits |
|---|---|---|---|
| 2026-11-27 | Completed repository orientation and latest-main verification on new branch. | 0 | See Step 0 commit reference |

## Baselines and measurements

- **B0 (Stage 1):** — <!-- link to eval/baselines/B0/ once recorded -->
