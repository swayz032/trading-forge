# AR-1150 — GPT STATIC AUDIT — CUSTOM PAPER QUALIFICATION RECEIPT REUSE MAP

Date: 2026-08-13
Repo: `swayz032/trading-forge`
Runtime/PAPER authority inspected: current `main`
Compiler authority remains: `h1-wave4-sealed12-driver` for AR-1138 only

## Verdict

**DO NOT BUILD A SECOND PAPER TELEMETRY SYSTEM.**

The current runtime already contains most of the data needed for a qualification-grade nightly receipt. The fast/robust path is to reconcile existing authoritative surfaces into one deterministic per-day receipt and add only the genuinely missing integrity joins.

The largest remaining gap is **not performance analytics**. It is proving that every counted PAPER day exercised the **same complete executable candidate** and was not silently corrupted by restart/feed/signal-execution problems.

## Existing sources to REUSE

### 1. Session identity / equity / daily P&L — `paper_sessions`
Existing read-only Carter tool:
`src/server/lib/carter/carter-reads.ts::reportPaperSession`

Already returns active custom PAPER session fields including:
- session ID
- strategy ID
- mode
- firm ID
- started time
- starting/current equity
- realized peak/high-water balance
- total/proven trades
- daily P&L breakdown
- current P&L / drawdown

This is an existing read model and should be extended/reused rather than replaced.

### 2. Signal decision evidence — `paper_signal_logs`
Schema + live writer already carry:
- session ID
- symbol
- direction
- signal type
- confidence
- price
- indicator snapshot
- acted boolean
- non-action reason

The signal service also writes explicit rows for important no-trade/block states such as pipeline paused, skip-engine/classifier blocks, outside-window skips, calendar blocks, bridge failures, and fill misses.

**Known limitation:** successful deferred fills do not always create the generic `paper_signal_logs` fill row. This was explicitly documented in commit `bf31167ef9254b334476f76bfce1c0891e8af733`. Therefore a receipt MUST NOT infer execution truth from `paper_signal_logs` alone.

### 3. Actual open/closed execution — `paper_positions` + `paper_trades`
These are the execution truth surfaces for the custom engine.

Existing hardening includes:
- duplicate session-start serialization (`e15f59818572eb3...`)
- per-session price-update serialization (`4f6d071c8430...`)
- atomic double-close/idempotency claim (`9000f20b44a1...`)
- execution/equity audit enrichment (`84490aa5d157...`, `8db9ff19778b...`)

Receipt logic should reconcile signal intent against actual positions/trades instead of trusting one producer.

### 4. Session performance learning — `paper_session_feedback`
Existing service:
`src/server/services/paper-session-feedback-service.ts`

Already computes/persists:
- total trades / P&L
- win rate
- profit factor
- MAE/MFE
- realized R:R
- MFE capture
- session-window performance
- side performance
- best/worst windows
- structured notes for the critic

Therefore the 3AM system does not need a new performance-learning subsystem.

### 5. Feed integrity — existing feed-gap audit
Existing pure classifier:
`src/server/lib/feed-gap-classifier.ts`

Already classifies gaps as:
- `MARKET_CLOSED`
- `PROVIDER_GAP`
- `EXPECTED_NO_TRADE`

It is wired to the custom Massive stream and emits audit evidence. Reuse those events in the nightly receipt. Do not create a second gap detector.

### 6. Restart/deferred-entry durability
Commit `c4a730d0fd0cadfae1dcd7f45fba62d2146cb4a7` already persists the pending-entry queue and rehydrates it after process restart. This is existing state-recovery infrastructure; receipt logic should report whether recovery happened and whether warm-up/feed continuity was valid, not rebuild deferred-entry persistence.

### 7. PAPER evidence-scope labels
Existing:
`src/server/lib/paper-evidence-labels.ts`

Session config already stamps:
- feed mode
- nominal delay when configured
- certified claims: logic, timeframes, risk wiring, state recovery
- explicitly NOT certified: realtime latency, bid/ask, queue, liquidity, broker execution

Preserve this claim-scoping. A delayed custom PAPER run must never be presented as proof of real broker execution quality.

### 8. 3AM custom-PAPER learning organs
AR-1149 proved static joins:
- `paper_trades -> paper_sessions.strategyId -> /api/decay/dashboard -> 14A`
- custom PAPER execution/P&L -> leak detection -> 14A

Existing 14A must be reused. The nightly receipt is an integrity input/addition, not a replacement brain.

## P0 missing join #1 — complete executable candidate identity

Current frozen-policy contract is NOT sufficient as the sole official PAPER candidate identity.

`src/server/lib/frozen-policy-hash.ts` hashes five fields inside `strategy.config`:
- entry_quality
- position_size
- stop_loss
- take_profit
- exit_plan_config

But current schema/execution also carries a dedicated top-level `strategies.exitPlanConfig` column, and the signal path reads that dedicated column for live exit routing.

The repo already contains a confirmed HIGH ratify packet:
`docs/ratify-packets/frozen-policy-exit-config-dual-column-2026-07-17.md`

Status remains:
**HELD — not implemented.**

The packet proves the hash can describe the JSONB copy while live PAPER uses the dedicated column. Therefore the old frozen-policy hash alone cannot certify "same complete executable candidate across all 3–5 PAPER days."

Fast/robust requirement:
- do not silently reinterpret/re-baseline historical frozen hashes
- establish a versioned complete candidate identity for official PAPER
- cover the actual execution inputs used by custom PAPER (including the authoritative exit-plan column, symbol/timeframe and any other behavior-changing top-level strategy fields)
- stamp/persist that identity at PAPER start
- compare it on every restart/day before evidence is counted
- fail qualification closed on mismatch or missing identity

This can reuse SHA-256/canonicalization patterns already present. It does NOT require a new strategy object model.

## P0 missing join #2 — deterministic per-day reconciliation

The nightly qualification receipt should be a READ/RECONCILIATION product over existing sources, roughly:

```text
paper_sessions
    + paper_signal_logs
    + paper_positions
    + paper_trades
    + paper_session_feedback
    + feed_gap / restart / risk audit events
    + complete candidate version identity
    + n8n execution/correlation evidence
        ↓
ONE PAPER-DAY QUALIFICATION RECEIPT
```

It must distinguish at minimum:
- no signal expected / no trade
- signal expected and acted
- signal blocked, with reason
- fill miss
- signal led to a real position even if generic fill-log row is absent
- duplicate/extra position or trade
- feed gap / provider gap
- restart / recovery event
- candidate identity same vs changed
- nightly report persisted vs incomplete

Silence is never proof of correctness.

## Suggested deterministic receipt invariant

For each counted official PAPER trading day:

```text
candidate_version_same == true
session_identity_present == true
custom_massive_authority == true
provider_gap_unresolved == false
restart_recovery_incomplete == false
unreconciled_signal_execution_count == 0
duplicate_execution_count == 0
critical_risk_control_failure_count == 0
nightly_required_evidence_complete == true
unauthorized_candidate_mutation_count == 0
```

Exact field names may reuse current schemas. The invariant is the contract.

## What NOT to do

- Do not create another signal table.
- Do not create another trade journal.
- Do not replace Carter `report_paper_session`.
- Do not replace `paper_session_feedback`.
- Do not replace feed-gap classification.
- Do not rebuild 14A.
- Do not let 14A silently modify the official PAPER candidate.
- Do not treat `paper_signal_logs` alone as execution truth.
- Do not treat the current frozen-policy hash alone as complete candidate identity while the dual-column defect remains.
- Do not interrupt Claude AR-1138/compiler work with this parallel runtime audit.

## Fast engineering priority

After AR-1138/compiler breakthrough, the smallest runtime work is:

1. Resolve/version the complete PAPER candidate identity.
2. Reuse current read/audit surfaces to produce one deterministic PAPER-day receipt.
3. Make the 3–5-day promotion clock count only receipt-valid days.
4. Prove the receipt + 14A nightly chain on the live deployed runtime.
5. Run the no-Claude restart/autonomy drill.

This is a **join-and-certify** job, not a rebuild.

## Status

- Session summary source: **PROVEN / REUSE**
- Signal decision source: **PROVEN / REUSE**
- Actual execution source: **PROVEN / REUSE**
- Session learning feedback: **PROVEN / REUSE**
- Feed-gap observability: **PROVEN / REUSE**
- Pending-entry restart durability: **PROVEN FOUNDATION / REUSE**
- 14A PAPER decay/leak learning: **PROVEN STATIC / REUSE**
- Complete executable PAPER candidate identity: **NOT PROVEN — P0**
- Deterministic per-day qualification reconciliation: **NOT PROVEN — P0**
- Fresh live deployed runtime evidence: **NOT PROVEN BY STATIC GITHUB AUDIT**
