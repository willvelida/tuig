# ledger-lite v1 oracle proposal

- Status: Proposed - pending human oracle review
- Date: 2026-11-27

## Context

The Stage 1 benchmark requires three invented bug-fix tasks with independent hidden acceptance tests. The guide requires human oracle review before use.

## Proposal

Use a correct minimal Decimal-based money package, injecting one bug per fresh task workspace. Proposed semantics are decimal ties-to-even at two places, integer cents after rounding, and negative signs before currency symbols with unsigned rounded zero. Cover separate rounding, conversion and formatting bugs. Keep visible/hidden/reference bytes pinned in task metadata and leave oracleReviewed false until approved.

Configure pytest 9.2.0 and Ruff 0.17.6 as pinned fixture development tools. PyPI registry metadata checked 2026-11-27: both MIT, released 2026-10-27 and 2026-11-19 respectively (within 12 months). No Python tools have been installed or task oracles executed yet.

## Consequences

This proposal is structurally reviewable but not benchmark evidence. Task runs, reference-oracle evaluation, isolation acceptance and B0 measurement remain pending. Use an isolated execution boundary that keeps host oracles out of agent-run subprocess filesystems; do not infer that path checks alone sandbox modified Python code. Optional container setup and model choice need human input before dependent work.
