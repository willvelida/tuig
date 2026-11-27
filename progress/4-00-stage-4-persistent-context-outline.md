# Stage 4: Persistent context (outline)

- **Stage:** 4 — Persistent context
- **Guide section:** `TUIG_IMPLEMENTATION_GUIDE.md` → Stage 4: Persistent context (outline)
- **Depends on:** Stage 3 checkpoint
- **Status:** Not started  <!-- Not started | In progress | Blocked | Done -->
- **Started:** —
- **Completed:** —
- **Commits:** —

## Human sign-off

- **Plan approved by:** —  **Date:** —
- **Stage result approved by:** —  **Date:** —

## Checklist

- [ ] Re-read `PROGRESS.md` and the Stage 1–3 measurements
- [ ] Break this stage into numbered steps (add them below and in `PROGRESS.md`)
- [ ] Plan for this stage confirmed with the human

### Outline from the guide

- [ ] **Contract files** in `.tuig/contract/`:
  - `brief.md`;
  - `requirements.yaml` with IDs `REQ-001…`, EARS text for features, and a status (`proposed | accepted | rejected`, where **only a human sets `accepted`**);
  - `acceptance.json`: criteria mapped to requirement IDs and check names; the agent may only flip `passes`;
  - `assumptions.yaml`;
  - `open-questions.yaml`;
  - `progress.log`;
  - MADR `decisions/`.
- [ ] **`tuig contract check`** is the traceability gate. Every accepted requirement has at least one acceptance criterion, and every criterion has at least one executable check. Broken links fail.
- [ ] **Human gates:** G1 scope, G2 ambiguity resolved, G3 plan approved, G4 result review. Discovery output is always *proposed*, never accepted automatically.
- [ ] **Three Agent Skills** (`tuig-research`, `tuig-plan`, `tuig-validate`) in the agentskills.io `SKILL.md` format:
  - kept short, loading only metadata until activated;
  - pinned by sha256 in `skills.lock.json`;
  - updates shown as diffs;
  - agent edits to skills or AGENTS.md need approval.
- [ ] **A small Markdown knowledge base** searched with ripgrep. SQLite FTS5 is optional and only if needed. Retrieved text always goes inside untrusted delimiters.
- [ ] **Demo:** an ambiguous-feature task (e.g. the spec says local time, an acceptance criterion says UTC). The agent writes proposed requirements and open questions, stops at G2, then implements once a human has answered.
- [ ] **Exit:**
  - An ablation shows context files don't raise cost without raising success.
  - Ambiguous fixtures produce questions or recorded assumptions, not silent choices.
  - The traceability gate catches every planted broken link.

## Stop conditions (from the guide)

This stage is only outlined in the guide. Do not start building until the plan above is confirmed by the human.

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
