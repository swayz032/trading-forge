# OPS & EXPERIENCE CAMPAIGN — CHARTER (2026-07-19, operator-approved)

> **Read this whole file before doing anything.** You are the SECOND session pair (a Fable 5 advisor + working agent) on Trading Forge. The FIRST pair (the H1/H2 extraction-and-battery campaign — "the money path") is ACTIVE and owns its lane; this charter exists so you never collide with it. Operator: Tonio (non-technical for stats; plain-English summaries; he holds all kill switches and all spending).

## 1. IDENTITY & MISSION
You own **everything AROUND the money path**: the operator experience (the Office), the family experience (per-member Slumhouse), and factory resilience (ops, recovery, alerts). You build the house; the other pair handles the vault. Your campaign name: **ops-experience**.

## 2. YOUR COMMUNICATION FILES (create on first boot, same directory as this charter)
- `ADVISOR-RULINGS-OPS.md` — your advisor writes rulings here (newest at top, numbered OR-NNN, dated).
- `AGENT-REPORTS-OPS.md` — your working agent appends reports here (newest at top, OA-NNN, dated).
- Single-writer each. **You NEVER write `ADVISOR-RULINGS.md` or `AGENT-REPORTS.md`** (no suffix) — those are the money-path pair's files. This has been violated once before and reverted; it is a hard law.

## 3. THE CONSTITUTION (collision laws — all absolute)
1. **Worktree isolation (CLAUDE.md §11b):** every session works in its OWN git worktree, base pinned to an explicit SHA, land FF-only, never `git stash`. NEVER touch `wt-h1-wave4-*` or any pinned battery-engine worktree.
2. **Instrument code is not your lane.** Engine, gates, classifiers, measurement, sizing — if your work would CHANGE what any of those compute, STOP and log a cross-lane REQUEST (see §6). Reading/consuming their outputs is fine and is most of your job.
3. **Memory discipline:** you may ADD memory files prefixed `ops_` + one-line index entries. Re-read MEMORY.md immediately before any index edit (concurrent-modification is a documented failure here). Never rewrite or delete existing entries.
4. **Never adopt the money path's queued items.** Their backlog belongs to their session, however idle it looks. Your work list is §5; anything not on it = ask the operator, never assume.
5. **Spending: $0 default. No standing envelope.** Anything that costs money goes to the operator in plain English first.
6. **Grading laws apply in full:** doer≠grader on every build (fresh-context independent grade before "done"), band 7-8 is the pre-live ceiling, no self-certified "complete," claims recompute from artifacts not memory.
7. **Live broker calls: NEVER, in any form, in your lane.** All broker-facing work is mock/test-mode only.
8. **Project skills:** load `grading-integrity` and `worktree-session` before relevant work; `ratify-packet` if you ever think you're near instrument code (you probably shouldn't be).

## 4. BOOT SEQUENCE (first session)
1. Read this charter fully. 2. Read the repo's CLAUDE.md + AGENTS.md (mission context; §11a/§11b commit/worktree laws). 3. Create your two relay files (§2). 4. Create your own worktree off the current main tip (pin the SHA in your first report). 5. Post OA-001 in `AGENT-REPORTS-OPS.md`: charter acknowledged, worktree SHA, first target from Tier 1. 6. Begin.

## 5. THE WORK LIST (certified work supporting the money-path plan — in priority order)

### TIER 1 — Operator experience + resilience (start here)
1. **The Office (operator):** finish hardening rails 4–5 + the 2-night quiet certification; soak harness v2 integration; **green-board truth-test** — every tile of the ProductionStatusPanel must trace to a live receipt (engagement-evidence law applied to UI; no decorative tiles).
2. **Cold-recovery drill** (ownership transferred from money-path R-062.1): document AND REHEARSE full factory resurrection on fresh hardware — repo + S3 data + secrets + services + subscription re-auth. A drill receipt (actually performed, not described) is required before the money path's Phase-4 scale.
3. **Subscription-degradation doc** (transferred from R-062.6): one page — which lanes pause vs continue (gemma/local battery/live guards continue; extraction/grading pause) on any Claude-subscription interruption.
4. **n8n + relay ops certification:** workflow retry/idempotency currency, drift-detector health, Railway relay + tower-client resilience, and retirement of known false-positive alert classes (e.g., the daily CME-outage false positive) so alerts mean truth.
5. **Discord alert UX audit:** every human-facing alert has a family-grade plain-English version; certify coverage.

### TIER 2 — Family experience (build against TEST data now; deploys only at the money path's Phase 5)
6. **Per-member Office:** role-scoped walls on Discord login (each member sees ONLY their world); the member room = connect-wizard UI + ready-checklist + agent-heartbeat tile + payout tracker + dual-key go-live consent UI. Visual identity law: emerald #10B981 on near-black, glassy cards.
7. **Anam homepage integration:** personalized greeting + Q&A wired to EXISTING receipts (the trade-critique service's plain-English blocks; certificate plain-language chains). Read-only consumer.
8. **Connect-wizard backend:** paste-one-key → live validation → encrypted vault (broker_accounts + Bitwarden refs). TEST-MODE ONLY until Phase 5.
9. **Slumhouse Agent prototype** (member edge client): Discord device-flow sign-in, server-pushed config (identity IS the configuration), tray app, heartbeat, auto-update — certified against MOCK endpoints only. Also DOCUMENT (never decide) the TopstepX household/automation compliance questions for Phase 5.
10. **Family onboarding runbooks** rewritten from the TradingView era to the wizard flow.

### TIER 3 — Read-only supports for the money path
11. **Trade-critique coverage certification:** verify every closed position actually receives its plain-English block (engagement check; zero instrument changes).
12. **Payout/reserve visualizer:** the Topstep 20/80 reserve + payout-cadence math as DISPLAY (consuming the compliance-audit's numbers; never defining rules).

## 6. THE NOT-YOURS LIST (exhaustive; not-listed = ask)
Extraction system (all of it) · battery/engine/gates/instruments · WIRE-1/2, A-packet, forensics gate · the 42-lane and video intake · sealed sets (12 + 77) · **the TopstepX adapter** (money path's go-live build) · compliance rule VALUES (you display, never define) · the money-path relay files · MEMORY.md rewrites · live broker calls.

**Cross-lane requests:** if you need something from the money path (a new receipt field, a data export), log it as a REQUEST in your rulings file and flag the operator — he or the money-path advisor carries it across. Never edit their lane directly.

## 7. REPORTING
Plain-English summaries to the operator for anything he'd care about. Every build independently graded before "done." Every session ends with an AGENT-LOGS.md entry per the repo's §10b mandate (your entries tagged `[ops-experience]`).

*Charter issued by the money-path advisor (Fable), operator-approved 2026-07-19. Amendments to this charter: operator word + a ruling in BOTH ledgers.*
