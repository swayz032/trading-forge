# GRADE — GREEN-BOARD TRUTH-TEST + HONESTY-SWEEP FIXES — GRADER CHARTER

**Issued by:** ops-experience advisor. **Status:** READY — fires when the working agent finishes the OR-027 §4 / OR-029 §3 class sweep and requests the truth-test unit grade. This is charter Tier-1 item 1's green-board deliverable (OR-005 §2 re-target: the Slumhouse Office, `ProductionStatusPanel` having been deleted).
**Dispatch:** FRESH-CONTEXT independent grader (accuracy-validator type; doer≠grader). Grade FROM ZERO. This is ONE grade over the whole sweep — NOT one per finding (OR-029 §4).

## What the unit claims

The truth-test enumerated every Office status surface, classified each **LIVE-RECEIPT / DECORATIVE / DEAD-FEED**, and fixed every tile whose FAILURE path was indistinguishable from health. Confirmed findings at charter time (the sweep may add more from `of-risk`'s kill-switch/autopilot tiles — grade whatever landed):
- **#1 `AlertingStatus`** (`production-status.ts`, `8248b911`): was severity-less AND structurally absent from the `worstOf` roll-up; now `severity` red=webhook-unconfigured / yellow=unreadable / green, wired into `worstOf`.
- **#2 Reporting Room** (`reports.ts`): bare `catch {}` returning 200+empty, indistinguishable from a quiet night; now `degraded:true`+`error`+logged.
- **Sweep sub-rule:** every bare `catch {` in the swept surfaces bound+logged or justified.

## The proofs that MUST hold (re-execute the STARVE-proofs, do not re-read)

1. **The defining test of the whole unit — starve, don't read.** For each fixed tile: with its underlying read FAILING, the tile's severity/marker must NOT render as green/healthy, and the overall roll-up must reflect it. A source read alone is insufficient — drive the failure path.
2. **No false alarm on genuine emptiness.** The load-bearing distinction: a tile whose query SUCCEEDS but legitimately returns empty (a quiet night, no alerts fired, no trades) must read HEALTHY, not degraded. A truth-test fix that makes a quiet system cry wolf has rebuilt the ignorable-noise problem by the other door. Verify explicitly for #2 (empty-success ≠ failure) and #1 (no-alerts-on-record ≠ alerting-broken).
3. **Roll-up is strictly-more-honest.** `worstOf` is worst-wins; confirm every added severity source can only raise severity, never mask. Confirm `alertingStatus.severity` is genuinely IN the `worstOf` args (it was absent pre-fix — verify the diff, not just the final state).
4. **Additive shape.** New fields (`severity` on AlertingStatus; `degraded`/`error` on the reports response) are additive — existing consumers unaffected; no consumer branches on their absence. #2 matters most (it changes a response shape).
5. **Errors leave a trace.** Every previously-swallowed error now logs. Grep the swept files: no bare `catch {` survives without a bound+logged error or a written justification.
6. **Regression.** All pre-existing production-status/office tests green (was 21/21 on #1). tsc clean (`NODE_OPTIONS=--max-old-space-size=8192`).

## Governance / scope

- `production-status.ts` + the office status routes are STATUS/REPORTING surfaces (they compute no gate, size, or measurement) — NON-INSTRUMENT, in ops lane. If any swept surface turns out to compute an instrument value, that fix is OUT of scope → cross-lane REQUEST, and the grader flags it.
- Band 7–8 pre-live ceiling; 10 unreachable; no bare numbers, every point cited `file:line`.
- This surface is the operator's go/no-go board — a fix that makes it LESS honest (masks a real red, or cries wolf on calm) is an automatic NOT-SAFE regardless of test counts.

## Traps

Clock-read timestamps only. Worktree has its own real `node_modules` (never `npm ci`). Comments-stripped grep for the `catch {` sweep (the comment-vs-code check has caught the doer repeatedly). The live backend is UP — probing it read-only is fine, but starve feeds via test doubles/local reads, NEVER by degrading the running service.

## Deliverable

Banded verdict + per-tile LIVE-RECEIPT/DECORATIVE/DEAD-FEED classification re-derived independently + starve-proof execution evidence + the no-false-alarm-on-empty proof for each fix + out-of-scope findings logged-not-adopted. Agent files it as an OA; advisor rules; FF-only landing after.
