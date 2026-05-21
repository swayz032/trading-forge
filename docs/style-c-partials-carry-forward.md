# Style C 33/33/33 Partial Fill Implementation — Carry-Forward Plan

**Status:** TP1 BE-move wired (C-3 fix, Pass 7 / Track C). TP2 + runner partial-close are carry-forward.

---

## What is implemented (C-3, migration 0130)

- `paper_positions.tp1_filled_at` and `tp2_filled_at` columns added (TIMESTAMPTZ, nullable).
- On each bar, `evaluateSignals()` checks if bar.high (long) or bar.low (short) has crossed the TP1 target price (`entry_price + 1.0R` for long, `entry_price - 1.0R` for short).
- When TP1 is first crossed:
  - `tp1_filled_at` is persisted to DB.
  - `tp1BeStopMap` in-memory map is set to `entry_price + 1 tick` (long) or `entry_price - 1 tick` (short).
  - All subsequent bars use the BE+1tick level as the effective stop floor (overrides the original ATR/fixed stop in `checkStopLoss`).
  - Logging: `style_c_tp1_crossed=true` on span.
- Cleanup: `tp1BeStopMap.delete(openPos.id)` on all close paths (stop, trail, time, signal, 15:55 ET time-stop).
- Restart recovery: if `tp1FilledAt != null` in DB but `tp1BeStopMap` has been cleared (server restart), the map is reconstructed from `entry_price + 1 tick` on the next bar evaluation.

**What is NOT implemented (partial contract reduction):**

The 33% contract reduction at TP1 is not yet implemented. Paper executes the full position count until the trailing stop, time-stop, or exit signal fires. This means:

- Paper P&L at TP1 crossing is NOT locked in for 33% of contracts.
- The effective stop is moved to BE+1 tick (risk guarantee honored).
- A winning run to TP2 earns more P&L in paper than in the real Style C model (no 33% reduction captured at TP1).
- This creates a systematic paper > backtest P&L bias for positions that cross TP1 then stop out between TP1 and TP2.

---

## Parity gap introduced

| Paper behavior | Backtest behavior | Delta |
|---|---|---|
| Full contracts held until trail/time stop | 33% closed at TP1, 33% at TP2, 34% on trail | Paper over-reports P&L on TP1-TP2 range |
| Stop moves to BE+1 tick at TP1 | Same | Aligned |
| No TP2 check | 33% closed at TP2 | Paper over-reports on TP2+ runners |

**Severity:** Medium. The BE-move is correct so catastrophic losses are guarded. The P&L distortion is systematic and upward — paper sessions look better than they will in live trading. Promotion gate A7/Sharpe comparisons should apply a correction factor until this is fully wired.

---

## Carry-forward: full implementation plan

### Step 1 — `closePartialPosition(positionId, contractsToClose, exitPrice, atr, context)`

Add a new exported function in `paper-execution-service.ts` that:
1. Reads the current position.
2. Validates `contractsToClose < position.contracts` (must be partial, not full).
3. Inserts a `paper_trades` row for `contractsToClose` contracts (same schema as `closePosition`).
4. Updates `paper_positions.contracts = contracts - contractsToClose` (atomically in transaction).
5. Does NOT set `closedAt` — position remains open with reduced size.
6. Updates equity, journal, SSE, audit_log (same as `closePosition`).

Schema change needed: `paper_positions.contracts` must be writable post-open (it is `integer().notNull().default(1)` — no constraint prevents update).

### Step 2 — TP1 partial close wiring

In `evaluateSignals()`, when TP1 is first crossed:
- Call `closePartialPosition(openPos.id, Math.floor(openPos.contracts * 0.33), tp1Price, currentAtr, ...)`.
- Set `tp1_filled_at`, move stop to BE+1 tick (already done in C-3).
- Log `style_c_tp1_partial_close` on span.

### Step 3 — TP2 partial close wiring

When TP2 (`entry_price + 2R`) is crossed and `tp1_filled_at` is set and `tp2_filled_at` is null:
- Call `closePartialPosition(openPos.id, Math.floor(openPos.contracts * 0.33), tp2Price, currentAtr, ...)`.
- Set `tp2_filled_at`.
- Log `style_c_tp2_partial_close` on span.
- Runner (remaining ~34%) continues on trailing stop (Chandelier(14,2) already wired as trail_stop in the strategy config).

### Step 4 — Migration

Add `0131_paper_position_partial_contracts.sql` if additional tracking columns are needed (e.g., `original_contracts INTEGER` to track starting size).

---

## References

- CLAUDE.md §4: Style C 33/33/33 canonical spec (W23F.N 2026-05-19)
- `src/server/services/framework-overlay.ts:91-117`: FRAMEWORK.styleC definition
- `src/server/services/paper-signal-service.ts`: TP1 check, tp1BeStopMap, 15:55 ET time-stop
- `src/server/db/migrations/0130_paper_position_partials.sql`: tp1_filled_at/tp2_filled_at columns
- Migration 0130 must be applied before running paper sessions (ALTER TABLE is non-destructive IF NOT EXISTS)
