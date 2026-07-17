# Campaign Status — "$250–$1K/day Readiness" (Make the Measurement/Execution Chain True)

> **Durable handoff doc — updated in place at each stopping point.** Full plan: `~/.claude/plans/i-want-you-to-luminous-parnas.md`. Session journal: `AGENT-LOGS.md`. This file = the scannable current state.

**Last updated:** 2026-07-17 (after M2) · **Branch:** `hardening/phase-0` · **Tip:** `c4a730d0`+ (goalscan/other concurrent sessions advance it continuously) · **Campaign base:** `61bb20a3` · **Landed: W0, W1, W2, W2b, W3B, W4, W5-indep, W-testdebt, M2** (9 waves). Next: M3 re-scoped PAPER-authority → W3A → W6; M1a blocked on Massive docs; W7 close-out
**★ Concurrent session active:** a "goalscan" session (now on round-3+ scans) is landing its own audit fixes to the SAME branch (deconflicted — it treats the campaign's instrument surface as hand-off). Shared `node_modules` has been partially wiped twice by concurrent worktree cleanup (junction `rm -rf` once, `git worktree remove --force` on a junctioned scratch worktree once) — `npm install` restores it each time; M2's own worktree used a symlink (not junction) and was never affected. Each wave: rebase onto current origin tip → verify COMBINED tree → then FF-push.

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
| **M2** determinism + durability | ✅ **LANDED `c4a730d0`** | persisted pendingEntryQueue (new table `paper_pending_entries`, migration 0204, boot re-hydration) + deterministic hash-seeded fill RNG (math untouched, only randomness source) + evidence labels (feed_mode/delay/certified-claims). Grade round 1 = band 7 NOT-SAFE-TO-LAND (3 findings: a false "zero CORE_DDL drift" self-cert claim — real 5th drifted table `lifecycle_transitions.correlation_id` found and fixed; a real coverage gap on the boot-rehydration glue — closed with a RED-proofed behavioral test; an overscoped "same tape twice" replay claim — narrowed to "reconstructible from recorded identity", root cause is the pre-existing H2 per-bar `randomUUID()` correlationId mint). All 3 closed same-wave; re-grade band 8 SAFE-TO-LAND. 90/90 tests (65 new + 1 previously-broken 24-test file unblocked by the sibling CORE_DDL fix), 216/216 parity, 145/145 test:metrics unchanged, 3 CI gates + system-map green. |
| **M3** PAPER authority + 5-10d gate | ⏳ **RE-SCOPE**, pin to M2 SHA `c4a730d0` | goalscan (op-auth `0896aaca`) ALREADY did the manual `_promoteStrategyInner` gate parity + SHADOW→PAPER enforcement. M3 shrinks to the UN-done parts: PAPER-authority `stopStream` inversion (lifecycle :2912-2968) + `paper.start_refused_paper_state` removal (routes/paper.ts) + the 5-10-qualifying-day gate + §8 doctrine docs. Re-read goalscan's latest lifecycle-service.ts diff before dispatching to avoid duplication/conflict — this is the one wave the operator asked to see before it flips PAPER authority. |
| **W3A** execution hardening | ⏳ | pin to W2 SHA (unaffected by M2) |
| **W3B** prop-firm hygiene | ✅ **LANDED `6415dac5`** | firm_profiles = derived view (4 drifts incl. MFFU 50→40); payout caps wired (/payout + /rank); F-2 prop_compliance 2nd-duplicate synced + cross-dict agreement lock; grade band 7, receipt reproduced bit-for-bit; test:metrics now 145/0 |
| **W4** evidence artifacts | ✅ **LANDED `cef0402d`** | h5 A/B ×3 (MES/MCL re-baseline heavily, MNQ ~unchanged — D2 evidence, flag stays OFF); exit-style inventory: **adaptive cohort EMPTY**, 120 strategies all static_styleC |
| **W5** doc-rot + daily-uncapped | ✅ **LANDED `713d8f88`** (indep. items) | §12 consistency un-staled; §2b 9/9/18; **§5 → $250–$1,000+/day, figures = observed outcomes never quotas/ceilings**; AGENTS ceilings/base fixed. §8 rewrite = M3-gated |
| **W-testdebt** engine test-debt | ✅ **LANDED `55c6ff74`** | 6 grader-handed failures (18 in a_plus_gate) ALL stale tests not code bugs (0 engine source); BE+1-on-TP1 §4 invariant verified intact; 100/100, test:metrics 145/0. Honest gap surfaced: no Python↔TS volume-confirmation parity test |
| **W6** shadow profit governor | ⏳ | pin to M2 SHA `c4a730d0`; observability-only |
| **W7** close-out + wiring audit | ⏳ | campaign-wide end-to-end integration + Go-Live Register doc |

## Execution model (proven on W1)
parent authors/amends ratify packet + SHA-pinned worktree (junctioned node_modules, real tsc) → subagent implements under TDD (RED before GREEN) → parent catches class siblings (zero-carry-forward) → **independent accuracy-validator grade (doer≠grader)** → parent hardens grader findings IN-wave → parent final-verify → FF-only land → packet CLOSED + AGENT-LOGS + memory + this doc updated.

## Known tooling facts
- `tsc` needs `NODE_OPTIONS=--max-old-space-size=8192` (default heap OOMs SIGABRT 134 — NOT a type error).
- `system-map:check` is DRIFTED at baseline (pre-existing "Generated topology stale" + n8n health staleness = audit H-11) — waves verify "no NEW drift", don't attribute it.
- Housekeeping: leftover `wt-f3-bartime` dir (Windows file-lock on removal; git deregistered it) — prune later.
- **`git worktree remove --force` on a JUNCTIONED scratch worktree can wipe the shared target `node_modules` mid-command** (M2 grading session, 2026-07-17) — same underlying hazard as the known junction-`rm -rf` class, but triggered by a git built-in, not a raw shell command. Detected immediately via broken `vitest`/`tsc` repo-wide; fixed with `npm install` in the owning directory. Prefer symlinks over junctions for scratch worktrees where possible (M2's own worktree used a symlink and was unaffected); always re-verify the full test/build battery after ANY worktree teardown that touched a junctioned `node_modules`, not just the worktree you were grading.
