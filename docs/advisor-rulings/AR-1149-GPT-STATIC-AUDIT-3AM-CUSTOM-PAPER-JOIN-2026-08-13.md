# AR-1149 — GPT STATIC AUDIT — 3AM ↔ CUSTOM PAPER JOIN

Date: 2026-08-13
Repo: `swayz032/trading-forge`
Authority split used for this audit:
- runtime/PAPER evidence: current `main`
- compiler AR-1138 evidence: `h1-wave4-sealed12-driver` only
- this report DOES NOT modify Claude's unfinished compiler work

## Verdict

**PARTIAL JOIN PROVEN. FULL PAPER-NIGHT RECEIPT NOT PROVEN.**

The existing 14A nightly architecture must be **reused, not redesigned**. Two meaningful 14A organs are already wired to the custom PAPER ledger on current `main`:

1. **Decay Dashboard** reads `paper_trades` joined through `paper_sessions.strategyId`, derives per-strategy daily P&L, and feeds real PAPER evidence into decay analysis.
2. **Leak Detection** reads custom PAPER evidence for execution slippage, allocation/contracts, and realized P&L, including a frozen-promotion Monte-Carlo distribution breach check.

Therefore it is incorrect to describe 14A as merely generic market intelligence. It already consumes custom PAPER evidence.

However, the committed 14A report assembly currently proves only these top-level inputs:
- market regime
- leak-detection output
- edge-decay dashboard
- composite-health ranking

It does **not** prove an explicit qualification-grade receipt for the just-completed custom PAPER day containing all of:
- frozen candidate/version identity
- PAPER session/day identity
- expected signals vs signals actually fired
- missed signals
- duplicate signals/orders
- restart/feed-gap events
- warm-up/backfill status after restart
- execution/reconciliation mismatches
- daily trade/P&L summary tied to that immutable candidate
- run/correlation identity joining the PAPER evidence to the nightly report

That missing receipt is a **P0 qualification-integrity gap**, not a reason to rebuild 14A.

## Evidence — custom PAPER connection is real

### A. Decay Dashboard
Current `main` file:
`src/server/routes/decay.ts`

The file explicitly imports `paperTrades` and `paperSessions` and defines `fetchStrategyPaperPnl(strategyId)` by joining:

`paper_trades -> paper_sessions -> strategyId`

It groups realized net P&L by trading day and passes that evidence into the decay routes/dashboard. The dashboard covers active lifecycle stages and skips strategies with no PAPER evidence rather than fabricating a healthy result.

Historical wiring fix that established this path:
`1c602f00744a7b9e283f593ebfa5a20923bf82dd`

### B. Leak Detection
Current `main` file:
`src/server/services/leak-detection-service.ts`

Its declared PAPER-backed categories include:
- `EXECUTION_SLIPPAGE` from `paper_trades.slippage`
- `ALLOCATION_DRIFT` from `paper_trades.contracts`
- `MC_DISTRIBUTION_BREACH` from realized `paper_trades.pnl` compared with the frozen promotion-time Monte Carlo distribution

The service scope explicitly includes `PAPER` and `DEPLOYED` strategies and is advisory-only.

Historical MC/PAPER join commit:
`615aa0201b9438f6fd220d9239614ad04ffc1a10`

### C. 14A nightly composition
Repo DR copy:
`workflows/n8n/14A-master-nightly-intelligence_Nk4pmHP6c0VOEOaT.json`

DR commit:
`398d14c6465fbe57189453c764c44544fdc6b238`

The committed workflow is the 28-node nightly GPT orchestrator and calls:
- `/api/agent/analyze-market`
- `/api/leak-detection/run`
- `/api/decay/dashboard`
- `/api/composite-health/summary`

`Assemble Report` then synthesizes regime, leak detection, edge decay, and composite ranking.

## Critical limitation: repo copy is not live-execution proof

The committed 14A file is a disaster-recovery snapshot of the live workflow from late June. Earlier engineering notes also state some n8n fixes were applied directly to Railway separately from repo commits.

Therefore:

**Static repo inspection proves architecture, not current live Railway execution health or exact current live workflow bytes.**

Before PAPER Day 1, require fresh live evidence for the exact deployed 14A workflow and every required nightly step. Do not accept a top-level n8n `success` alone because `continueOnFail` exists on multiple HTTP/reporting nodes.

This is consistent with AR-1145.

## Fast/robust engineering decision

DO NOT:
- rebuild 14A
- create a second nightly brain
- add speculative autonomous mutations during the 3–5 day PAPER window
- let this work interrupt AR-1138/compiler critical path

DO:
- preserve existing regime/leak/decay/composite organs
- add or prove one narrow qualification evidence join for the custom PAPER day
- bind it to the frozen candidate identity
- make absence/incompleteness visible and fail qualification closed
- validate on the real custom PAPER path

## Required qualification receipt contract

For each official custom-PAPER day, the nightly evidence should be able to reconstruct at minimum:

```text
paper_candidate_id
paper_candidate_version_hash
paper_session_id
paper_trading_date
strategy_id
symbol
timeframe
signals_expected
signals_fired
signals_missed
signals_duplicated
trades_closed
realized_pnl
restart_events
feed_gap_events
warmup_recovery_status
execution_mismatch_count
risk_or_control_failures
nightly_correlation_id
nightly_run_id
report_persisted
unauthorized_mutation_count
```

Exact field names may reuse existing schema/audit fields. **Do not create parallel state when authoritative data already exists.** The invariant matters more than the names.

## Acceptance gates

### Gate 1 — candidate identity
Every official PAPER day must be attributable to the same frozen executable candidate/version. Missing or changed identity invalidates continuity until explicitly restarted as a new candidate run.

### Gate 2 — custom PAPER evidence
Nightly analysis must read the custom Massive PAPER authority, not TradersPost/TradingView shadow data.

### Gate 3 — signal/execution integrity
The nightly receipt must distinguish:
- no signal expected
- signal expected and fired
- expected but missed
- duplicate/extra firing

Silence must never be interpreted as correctness.

### Gate 4 — restart/feed integrity
A restart or feed gap must be visible in the night's evidence. Qualification cannot silently count a cold/partial-data session as an ordinary clean day.

### Gate 5 — nightly completion
A PAPER night is healthy only when required advisory evidence is generated and durably persisted/posted with traceable run/correlation identity. Top-level n8n success is insufficient.

### Gate 6 — no mutation during official PAPER
14A may analyze, flag, report, rank, and propose future challenger work. It must not silently alter the frozen official candidate during the 3–5 day qualification.

## Status

- Custom PAPER → decay: **PROVEN STATIC**
- Custom PAPER → leak detection: **PROVEN STATIC**
- 14A → decay/leak organs: **PROVEN STATIC**
- Complete per-day PAPER qualification receipt: **NOT PROVEN**
- Fresh live Railway 14A execution health: **NOT PROVEN BY THIS STATIC AUDIT**
- No-Claude nightly autonomy: **PROMISING FOUNDATION, NOT YET CERTIFIED**

## Smallest next action

Continue parallel audit by locating whether an existing audit/journal/health endpoint already exposes the missing PAPER-day fields. Reuse it if present. Only if the evidence is genuinely absent should a narrow join be added.

This remains parallel to Claude's AR-1138 compiler work and must not modify the compiler branch.