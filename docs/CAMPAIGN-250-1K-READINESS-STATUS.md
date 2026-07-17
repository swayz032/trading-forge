# Campaign Status — "$250–$1K/day Readiness" (Make the Measurement/Execution Chain True)

> **Durable handoff doc — updated in place at each stopping point.** Full plan: `~/.claude/plans/i-want-you-to-luminous-parnas.md`. Session journal: `AGENT-LOGS.md`. This file = the scannable current state.

**Last updated:** 2026-07-16 · **Branch:** `hardening/phase-0` · **Tip:** `320c03ea` (after W1) · **Campaign base:** `61bb20a3`

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
| **W2** Stop-geometry contract | 🔄 **IN FLIGHT** | worktree `wt-stop-geometry` @ `320c03ea`; packet authored; two-role helpers TS+Python + fail-closed parity gate; subagent implementing under TDD |
| **W2b** Sizing lowest-wins (C-05) | ⏳ next | pin to W2 SHA; remove healthy-account floor override (D9) |
| **M1a** Massive adapter | ⏸ BLOCKED on operator | needs REAL Massive docs (don't build against a guessed protocol) — flag when subscribed |
| **M1b** feed-silence + multi-TF | ⏳ | pin to W1 SHA |
| **M2** determinism + durability | ⏳ | pin to W2 SHA; persist pendingEntryQueue + deterministic fills + evidence labels |
| **M3** PAPER authority + 5-10d gate | ⏳ | after M2; enforcement-site sweep (~8 sites incl. the stopStream inversion) |
| **W3A** execution hardening | ⏳ | pin to W2 SHA |
| **W3B** prop-firm hygiene | ⏳ disjoint/parallel | firm_profiles packet (feeds C4 gate), payout-cap wiring, comment sweep |
| **W4** evidence artifacts | ⏳ read-only | h5 A/B report ×3, exit-style inventory |
| **W5** doc-rot + daily-uncapped | ⏳ | parent-session docs sweep |
| **W6** shadow profit governor | ⏳ | pin to M2 SHA; observability-only |
| **W7** close-out + wiring audit | ⏳ | campaign-wide end-to-end integration + Go-Live Register doc |

## Execution model (proven on W1)
parent authors/amends ratify packet + SHA-pinned worktree (junctioned node_modules, real tsc) → subagent implements under TDD (RED before GREEN) → parent catches class siblings (zero-carry-forward) → **independent accuracy-validator grade (doer≠grader)** → parent hardens grader findings IN-wave → parent final-verify → FF-only land → packet CLOSED + AGENT-LOGS + memory + this doc updated.

## Known tooling facts
- `tsc` needs `NODE_OPTIONS=--max-old-space-size=8192` (default heap OOMs SIGABRT 134 — NOT a type error).
- `system-map:check` is DRIFTED at baseline (pre-existing "Generated topology stale" + n8n health staleness = audit H-11) — waves verify "no NEW drift", don't attribute it.
- Housekeeping: leftover `wt-f3-bartime` dir (Windows file-lock on removal; git deregistered it) — prune later.
