# Campaign Status — "$250–$1K/day Readiness" (Make the Measurement/Execution Chain True)

> **Durable handoff doc — updated in place at each stopping point.** Full plan: `~/.claude/plans/i-want-you-to-luminous-parnas.md`. Session journal: `AGENT-LOGS.md`. This file = the scannable current state.

**Last updated:** 2026-07-16 (after W2b) · **Branch:** `hardening/phase-0` · **Tip:** `bd47b8a8`+ (goalscan advances it continuously) · **Campaign base:** `61bb20a3` · **Landed: W0, W1, W2, W2b**
**★ Concurrent session active:** a "goalscan-authpine" session is landing the Go-Live-Register auth/pine/obs audit fixes to the SAME branch (deconflicted — it treats the campaign's instrument surface as hand-off). Shared `node_modules` got partially wiped once (junction rm-rf); `npm install` restores it. Each wave: rebase onto current origin tip → verify COMBINED tree → then FF-push.

## What this campaign is
Make the internal paper engine's evidence TRUE (bar-time exits, unified stop geometry, deterministic durable fills) so it can OWN the PAPER stage on a $29 Massive Starter delayed feed (D5), qualify strategy cohorts in 5–10 days (D7), and let a genuine 2R+ strategy prove itself and scale — without retail gate bloat. Prop firms (Topstep) stay DOWNSTREAM of the lifecycle; a separate **Go-Live Gate Register** (Appendix C of the plan) certifies live execution later (D8-gated on proven edge + combine purchase).

Derived from 4 batches of external GPT review, each verified claim-by-claim against live code (~half stale/wrong). Two adversarial plan-reviews applied. Mandatory **Wiring-Verification Protocol** (producer→consumer→DB→gate→audit proven on REAL data, never mocked; doer≠grader every wave; zero-carry-forward).

## Operator decisions (D1–D10)
D1 profit governor shadow-only · D2 parity flag = A/B report only · D3 no 9-micro cap · D4 DLL bands stay 60/67/95 · D5 Massive Starter $29 delayed feed · D6 internal engine owns PAPER · D7 PAPER window 5–10 qualifying days · D8 Topstep after proven edge → account twin staged · D9 C-05 sizing = risk math always wins (remove healthy-account floor override) · D10 pre-live audit findings → staged Go-Live Gate Register.
Plus: daily upside is UNCAPPED (no fixed TP) → §5 doc $250-500 → $250-1000+.

## Wave status (DAG)
| Wave | State | Notes |
|---|---|---|
| **W0** Pre-flight | ✅ DONE | base `61bb20a3`; tsc green (needs 8GB heap); 2 CI gates green; system-map drift = pre-existing baseline (audit H-11) |
| **W1** F-3 bar-time exits | ✅ **LANDED `78f3475a`** | class-complete (closePosition + bookPartialClose day-key); independent grade band 7 SAFE; 223/223; 2 regression guards hardened; packet CLOSED |
| **W2** Stop-geometry contract | ✅ **LANDED `d694c61a`** | two-role helpers TS+Python + fail-closed parity gate (216 cells); backtest byte-identity FORMALLY PROVEN; grade band 7 SAFE; F-1 gate_block sibling + F-2 docs closed in-wave; test:metrics 144/144 unchanged |
| **W2b** Sizing lowest-wins (C-05) | ✅ **LANDED `bd47b8a8`** | pure `max(0,min(...))` lowest-wins both languages, scalar+vectorized; <1→skip. Band 7 after **3 grade rounds** (core + 2 HIGH vectorized fabrications + 1 firm-cap sibling, all closed in-wave). A/B receipt quantifies the reversal. test:metrics HELD. |
| **M1a** Massive adapter | ⏸ BLOCKED on operator | needs REAL Massive docs (don't build against a guessed protocol) — flag when subscribed |
| **M1b** feed-silence + multi-TF | ⏳ | pin to W1 SHA |
| **M2** determinism + durability | ⏳ | pin to W2 SHA; persist pendingEntryQueue + deterministic fills + evidence labels |
| **M3** PAPER authority + 5-10d gate | ⏳ **RE-SCOPE** | goalscan (op-auth `0896aaca`) ALREADY did the manual `_promoteStrategyInner` gate parity + SHADOW→PAPER enforcement. M3 shrinks to the UN-done parts: PAPER-authority `stopStream` inversion (lifecycle :2912-2968) + `paper.start_refused_paper_state` removal (routes/paper.ts) + the 5-10-qualifying-day gate + §8 doctrine docs. Re-read goalscan's lifecycle-service.ts diff before dispatching to avoid duplication/conflict. |
| **W3A** execution hardening | ⏳ | pin to W2 SHA |
| **W3B** prop-firm hygiene | ⏳ disjoint/parallel | firm_profiles packet (feeds C4 gate), payout-cap wiring, comment sweep |
| **W4** evidence artifacts | ✅ **LANDED `cef0402d`** | h5 A/B ×3 (MES/MCL re-baseline heavily, MNQ ~unchanged — D2 evidence, flag stays OFF); exit-style inventory: **adaptive cohort EMPTY**, 120 strategies all static_styleC |
| **W5** doc-rot + daily-uncapped | ✅ **LANDED `713d8f88`** (indep. items) | §12 consistency un-staled; §2b 9/9/18; **§5 → $250–$1,000+/day, figures = observed outcomes never quotas/ceilings**; AGENTS ceilings/base fixed. §8 rewrite = M3-gated |
| **W6** shadow profit governor | ⏳ | pin to M2 SHA; observability-only |
| **W7** close-out + wiring audit | ⏳ | campaign-wide end-to-end integration + Go-Live Register doc |

## Execution model (proven on W1)
parent authors/amends ratify packet + SHA-pinned worktree (junctioned node_modules, real tsc) → subagent implements under TDD (RED before GREEN) → parent catches class siblings (zero-carry-forward) → **independent accuracy-validator grade (doer≠grader)** → parent hardens grader findings IN-wave → parent final-verify → FF-only land → packet CLOSED + AGENT-LOGS + memory + this doc updated.

## Known tooling facts
- `tsc` needs `NODE_OPTIONS=--max-old-space-size=8192` (default heap OOMs SIGABRT 134 — NOT a type error).
- `system-map:check` is DRIFTED at baseline (pre-existing "Generated topology stale" + n8n health staleness = audit H-11) — waves verify "no NEW drift", don't attribute it.
- Housekeeping: leftover `wt-f3-bartime` dir (Windows file-lock on removal; git deregistered it) — prune later.
