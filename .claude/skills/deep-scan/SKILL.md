---
name: deep-scan
description: >-
  Use when running a deep-scan, audit wave, fix wave, or certification cycle
  on Trading Forge — "scan the system", "find bugs", "audit subsystem X",
  "deep-scan #N", "re-certify" — BEFORE dispatching any finder or fixer
  agents. Also use when triaging findings from a scan or deciding what
  carries forward.
---

# Deep-Scan Protocol — find → verify → fix → certify → land → record

## Overview

21+ deep-scans have run on this repo. Every phase below exists because
skipping it produced a documented failure: unverified findings turned out
false (W25P2 cross-audit: "journal idx collision" — no collision; "zero
callers" — had callers), doers graded their own fixes 10/10 (grading-
integrity's origin), fix waves on shared trees reverted concurrent work
(846-line incident), and "carry-forwards" silently rotted. Follow the phases.

## Phase 0 — Scope & pin

- Pin the base: `git rev-parse <branch>` → record the SHA; all findings and
  bands cite it. Fix waves fork from THIS SHA (skill `worktree-session`).
- Declare scope per the result-claim rule: corpus version + battery + engine
  + data snapshot. A scan with no scope line produces UNVERIFIED bands only.
- Pick subsystems + adversarial dimensions (capital-safety, false-greens,
  parity, autonomy, isolation…). Baseline = the LAST scan's carry-forwards:
  they are round-1 findings, not history.

## Phase 1 — Find (parallel, read-only)

- Dispatch finder agents per subsystem/dimension (§11 subagent charters);
  read-only, adversarial framing ("disprove that X is safe"), one dimension
  each.
- A finding is admissible only with `file:line` + a concrete failure scenario
  (inputs/state → wrong output). "Smells wrong" is not a finding.
- Findings from an agent that also proposes fixes are still CLAIMS — no agent
  triages its own findings.

## Phase 2 — Verify findings BEFORE fixing (the false-positive gate)

- Adversarially verify each CRIT/HIGH finding — attempt to REFUTE it
  (independent agent or a direct repro you run). History demands this:
  scan waves have shipped false positives that would have burned fix-wave
  hours on non-bugs.
- Severity-band verified findings: CRIT (capital/corruption/fail-open) /
  HIGH (wrong numbers, silent drops) / MED / LOW. Dedupe across finders by
  file+behavior, not by title.

## Phase 3 — Fix wave

- Isolated worktree pinned to the Phase-0 SHA — full `worktree-session`
  protocol (junction node_modules, real tsc, diff-stat tripwire).
- **Instrument-touching fixes require a ratification packet FIRST** (skill
  `ratify-packet`) — a deep-scan finding is evidence FOR a packet, never
  authorization to edit engine/gate/measurement code.
- Fix-don't-skip: bugs discovered WHILE fixing join the current wave.
- Debug via skill `tf-debugging` (misdiagnosis firewall) before hypothesizing.

## Phase 4 — Certify (skill `grading-integrity`, mandatory)

- Doer reports CLAIMED bands + evidence bundle only. An independent
  accuracy-validator re-derives VERIFIED bands from artifacts, from zero —
  prior scans' scores are not evidence.
- Fixed rubric: 7–8 is the realistic ceiling; history sits 6.8–7.9; a >1-band
  jump in one wave without independent re-scan is implausible → UNVERIFIED.
- The independent verdict stands. Disagreement >1 band → written
  reconciliation, default assumption = claim inflated.

## Phase 5 — Land

- Diff-stat tripwire against reviewed delta → FF-only merge → explicit-path
  commits (`git commit -o`) → push per §11a.

## Phase 6 — Record (the scan isn't done until this is)

- AGENT-LOGS.md session entry (§10b format).
- CLAUDE.md §2 registry: ONE table row (never close-out prose in CLAUDE.md).
- Memory pin for the scan (band, closed items, carry-forwards).
- `system-map:sync` + MANUAL SSE-inventory/registry reconcile (sync doesn't
  do those) → all 3 CI gates green.
- **Carry-forward ledger: the default is ZERO.** Each carry-forward needs a
  written justification + owner + trigger condition, and it enters the next
  scan's Phase 0 baseline. Unjustified carry-forward = the wave is not done.

## Scaling note

For a comprehensive scan the operator may authorize a Workflow ("use a
workflow" / ultracode): Phase 1–2 map to a find → adversarial-verify
pipeline with loop-until-dry finders. Offer it; never assume the spend.

## Rationalizations — all invalid

| Excuse | Reality |
|---|---|
| "The finding is obviously real, skip verification" | W25P2 shipped 2 false positives that survived until cross-audit. Verify first. |
| "I fixed it, so band 9 now" | Doer ≠ grader; >1-band jumps are auto-UNVERIFIED. |
| "Log this bug for the next wave" | Fix-don't-skip. Current wave. |
| "Small fix, no worktree needed" | The 846-line revert was a "small" landing. |
| "Carry it forward, it's minor" | Zero-carry-forward default; justify in writing or fix it. |
| "The gate/engine fix is part of the wave, just do it" | Instrument code waits for its ratification packet regardless of wave momentum. |
