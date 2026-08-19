# Trading Framework — Full Formula & Rationale Detail

> Moved verbatim from CLAUDE.md §4 during the 2026-08-18 token-optimization pass.
> On-demand reference — load when touching stop-geometry, exits, sizing, DLL, or trade-cap code.

## §4. Trading Framework (Wave 23 — Style C canonical)

Data sources: Raschke, Grimes, Bellafiore, SMB consensus; Topstep funded-trader case studies; QuantifiedStrategies / Edgeful backtests; Lopez de Prado, Carver, Hurst-Ooi-Pedersen, Kaminski-Lo.

### Stop Loss — structural, NEVER fixed-point (TWO-ROLE geometry contract, W2 2026-07-16)

The ATR stop distance has **two roles with two formulas** — unified into canonical helpers `src/server/lib/stop-geometry.ts` + `src/engine/stop_geometry.py`, parity-gated by `check:ts-python-stop-geometry-parity` (fail-CLOSED). `configMult` = the strategy's `stop_loss.multiplier` (framework-overlay guarantees ∈ [1.5, 5], default 1.5).
```
stop_distance = invalidation_swing + sweep_buffer (per-symbol tick count)

MANAGED stop  (position's actual stop price + Style C TP1/TP2 R-basis; what the backtest manages on):
  managedStopPts = min(ceiling, configMult × ATR)          ← NO floor
SIZING stop   (budgets $/contract for position sizing only):
  sizingStopPts  = min(max(configMult × ATR, floor), ceiling)   ← floor applies HERE

floor   = 6pt MES min (STOP_FLOOR_PTS_MES); MNQ/MCL env opt-in (STOP_FLOOR_PTS_MNQ/_MCL); 0 disables
          optional VIX-tiered ATR mult (VIX_TIERED_ATR_ENABLED, default OFF): <20=1.5/20-30=2.0/>30=2.5
ceiling = 14pts MES, 62pts MNQ, 100 ticks (1.00pt) MCL   (Wave 1 2026-06-27 recal; env STOP_CEILING_PTS_*)
INVARIANT (parity-gated per cell): sizingStopPts ≥ managedStopPts  ⇒  $-risk-at-managed-stop ≤ 2% budget, always
If structural distance > ceiling → SKIP TRADE (never clamp down)
```
**The floor lives in the SIZING role + the DSL admission layer ONLY — the managed stop is deliberately floor-free** so it equals the backtest's management geometry (which has no floor); flooring the managed stop would make paper wider than backtest when MES ATR < 4. Before W2 the paper path hardcoded `2.0×ATR` (uncapped, floor-free, ignoring configMult) while backtest+sizing used `1.5×ATR` — a 3-way divergence (paper risked 33% more per contract than budgeted). Do NOT re-add a floor to `managedStopPts` or a hardcoded multiplier to the paper stop; both re-open the divergence. The `×2.0` legacy-null-`initialStopPrice` fallback (pre-migration-0179 rows only) and the `tickSize×16` cold-ATR fallback are intentionally untouched.

**H5 admission-stop parity (deepscan15, 2026-07-03) — the backtest now MANAGES each trade on the SAME structural stop that justified its admission**, instead of recomputing an ATR `min(ceiling, atr×1.5)` clamp the strategy's risk model never validated. `apply_eligibility_gate` captures a per-signal `structural_stop_map`; all 5 management/reporting sites resolve `risk_points` from it (per-symbol ceiling still caps; byte-identical fallback when unavailable). Env `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` **default FALSE** (operator decision 2026-07-03): the fix is correct + shipped but defaults OFF so it does NOT silently re-baseline every backtest — behavior stays byte-identical to legacy until the operator opts in. Set `true` to activate (stops then fire tighter/earlier where structure was tighter than ATR×1.5 — more honest/conservative). **When you flip it ON, historical backtests become NON-comparable — re-run the flagged 15m/30m/1h/4h DSL backtests before comparing metrics or trusting them for promotion.** A/B harness: `scripts/h5_structural_stop_parity_ab_report.py` (run flag ON vs OFF on real strategies to see the true magnitude first).

**Sweep-aware buffer (W24-P2, 2026-05-23)** — replaces old flat +1pt.
1pt on MES sits inside the empirical sweep zone (r/FuturesTrading 2025-05 analysis,
2026 funded-trader consensus). Per-symbol values:

| Symbol | Ticks | Points | Env var override |
|---|---|---|---|
| MES | 3 ticks | 0.75pt | `STOP_BUFFER_TICKS_MES=3` |
| MNQ | 5 ticks | 1.25pt | `STOP_BUFFER_TICKS_MNQ=5` |
| MCL | 2 ticks | 0.02pt | `STOP_BUFFER_TICKS_MCL=2` |

Unknown symbols fall back to legacy `max(tick_size, ATR×0.10)` with a warning.
Backtest engine and structural_stops.py use the same table — parity is mandatory.

### Take Profit — Adaptive (Wave 25 Pass 7 + Wave 25.5 wiring — LIVE 2026-05-24)

`adaptive-exit-engine.ts.computeExitPlan()` is wired into `paper-execution-service.ts` at position open (Gap A closed via migration 0145 idx 147 + `paper_positions.exit_plan` JSONB persistence + fail-soft fallback to static_styleC). `backtester.py._apply_trade_management()` branches on `exit_engine="adaptive"` + `adaptive_ctx` and runs Python mirror (`src/engine/exits/adaptive_exits.py`) — Gap B closed. `updatePositionPrices` branches on `runner_trail_method` across the 4 methods (anchored_vwap / developing_poc / chandelier / structure_trail) — Gap C closed. A/B harness (`scripts/wave25_exit_engine_ab_report.py` with `ADAPTIVE_WIRED=true`) produces real divergent results.

**Opt-in via `strategies.exit_plan_config = {"exit_style": "adaptive"}`** — default remains `static_styleC` for backward-compat (existing graduated strategies unaffected; new strategies operator-controlled via `scripts/wave25-pass7-adaptive-opt-in.ts --apply`).

When `exit_style="adaptive"`:
- **TP1:** liquidity-mapped (intraday DOL only — PWH/PWL/PMH/PML excluded per day-trader mandate, `INTRADAY_ALLOWED_LEVEL_TYPES` enforced in both TS engine and Python mirror) with min R ≥ 0.8; +1.0R fallback when no qualifying level within 1×ATR
- **TP2:** next intraday liquidity (≥ TP1.R + 0.5) OR +2.0R fallback (whichever closer to entry)
- **Runner trail:** regime-selected — `anchored_vwap` (TRENDING/EXPANSION) / `developing_poc` (RANGE_BOUND/LOW_LIQ_CHOP) / `chandelier` (HIGH_VOL_MACRO) / `structure_trail` (COMPRESSION). Anchored VWAP uses unit-vol fallback in TS `updatePositionPrices` because `StyleExitBarContext` does not yet carry `barVol` — Wave 26 wires real volume.
- **Scaling:** regime-dependent — TRENDING/EXPANSION 20/30/50 (bigger runner) / RANGE_BOUND/COMPRESSION 50/30/20 (quick harvest) / HIGH_VOL_MACRO 60/30/10 (fast exit) / LOW_LIQ_CHOP 50/50/0 (no runner)
- **Early-exit:** cumulative-delta divergence ≥ 0.6 + position in favor ≥ 0.5R → 25% partial close (prop-firm-safe, never flips; preserves runner)
- **Pre-lunch:** RANGE_BOUND/LOW_LIQ_CHOP/COMPRESSION at 11:30 ET with profit ≥ 0.3R → 50% partial + BE+0.5R stop tightening
- **15:55 ET hard flatten INVARIANT preserved** (`backtester.py:2040-2041` — `_apply_adaptive_management`'s `_is_time_stop()` check; live enforcement `paper-execution-service.ts:4844-4858`) — adaptive engine may flatten EARLIER (pre-lunch, delta divergence), NEVER later
- **BE+1 on TP1 fill INVARIANT preserved** (`backtester.py:2068` — `_apply_adaptive_management`; live mechanism is `tp1BeStopMap` in `paper-signal-service.ts`, NOT paper-execution-service.ts — see that file's own comment at `:5139`)
- **Audit:** `signal.exit_plan_persisted` (per position-open) / `signal.exit_plan_fallback_static` (engine error fallback)

### Take Profit — Style C (Wave 23 canonical — BACKWARD-COMPAT FALLBACK; LIVE DEFAULT for unmigrated strategies)
**Style C is the ONLY default exit. Style D is DEAD.**
- **TP1:** 33% off at +1.0R
- **TP2:** 33% off at +2.0R
- **Runner:** 34% trails developing session POC (Chandelier(14, 2.0) fallback for markets without VP feed)
- **Move stop to BE+1 tick on TP1 fill**
- **Time-stop:** hard flatten 15:55 ET

### Sizing — Risk-Derived Pyramid (W23F.N — Wave 23 canonical)
Sizing is **risk-management-bounded, not contract-count-bounded**. Pyramid is the SLOW-RAMP floor; risk math is the CEILING. Lowest wins.

**★ C-05 / D9 (2026-07-16): the healthy-account pyramid-floor OVERRIDE was REMOVED — do NOT restore.** The code previously did `max(base_contracts, min(...))` on healthy accounts (≥85% of start), which OVERRODE the risk-derived 2% ceiling back up to base — contradicting this section's own "lowest wins." Now `finalContracts = max(0, min(pyramidTier, riskDerivedCap, firmCap, liquidityCap, drawdownRoomCap))` is a PURE lowest-wins min() in BOTH `risk-sizing.ts` and `sizing.py` (scalar + vectorized): when risk math yields <1 contract → **skip the trade** (0), never a fabricated base floor. This reverses the earlier anti-strangulation intent behind the `DRAWDOWN_ROOM_RISK_PCT` 0.01→0.08 recal — a deliberate operator tradeoff (risk-honesty over always-trading-base); on a fresh combine with a wide stop the bot may now size down or skip. Magnitude in `docs/replay-results/2026-07-16-c05-lowest-wins-ab.md`. The vectorized backtest path skips-to-0 identically (no fabricated 1-contract trades feeding WFE/PBO/B14). A future agent that re-adds a base floor over the risk cap is regressing C-05.

**Pyramid ramp (2026-06-23 — base 9 + proven-trades ramp):**
```
Base:      9 MES / 9 MNQ / 18 MCL   (was 6/6/18; 9÷3 keeps Style C clean; MCL unchanged)
Final cap: 50 micros (Topstep firm cap) — the ceiling the ramp climbs TO
Increment: +3 contracts per tier.
  LIVE (paper/funded): tier = floor(provenTrades / proven_trades_per_tier)   ← survives payouts
  BACKTEST fallback:   tier = floor(max(0, cumulativeProfit) / tier_threshold_dollars)
```
The LIVE ramp climbs on PROVEN WINNING TRADES (`paper_sessions.proven_trades_count`, monotonic) so
taking a payout never drags size down. Backtests (no proven-trades input) keep the dollar fallback —
byte-identical to pre-2026-06-23 behavior. Growth is primarily HORIZONTAL (multiple Topstep accounts
+ copy-trade at moderate size), NOT maxing one account to 50 — see `docs/scaling-plan-baby-mode.md`.

**Risk-derived ceiling (computed every signal):**
```
finalContracts = min(
  pyramidTier,                                            // slow ramp
  floor(accountBalance × max_risk_pct_per_trade
        ÷ (stop_multiplier × ATR_points × point_dollar_value)),   // risk cap
  firmContractCap,                                        // Topstep/MFFU tier
  liquidity_comfort_cap,                                  // book-depth ceiling
  floor(currentDrawdownRoom × DRAWDOWN_ROOM_RISK_PCT      // Topstep ONLY (W25P2 Inst-10)
        ÷ (stop_multiplier × ATR_points × point_dollar_value))    //   env DRAWDOWN_ROOM_RISK_PCT=0.08
)
```
**DRAWDOWN_ROOM_RISK_PCT recalibrated 0.01 → 0.08 (2026-06-23).** The 1% rule produced ~$20/trade =
**0 contracts** on a fresh $2K Topstep buffer — it strangled sizing (the bot couldn't trade base size).
8% of remaining buffer is the institutional 2026 sweet spot (NexusFi 2026-05, "8-12% of buffer"); the
2%-of-balance cap remains the secondary ceiling. See `docs/scaling-plan-baby-mode.md`.

**Per-symbol liquidity comfort caps (W23F.N):**
| Symbol | Cap | Rationale |
|---|---|---|
| MES | 100 | 200-500 contracts typical at touch; 3× headroom over Phase 2 ramp of 33 |
| MNQ | 50 | 50-150 contracts at touch; cap prevents eating the entire book |
| MCL | 30 | 20-80 contracts at touch (retail flow); cap prevents 1-2 tick slippage |

**Sizing parameters:**
- `max_risk_pct_per_trade: 0.02` — 2% of risk base per trade (secondary ceiling)
- `personal_dll_pct: 0.67` — Personal DLL = 67% of firm DLL
- `tier_threshold_dollars: 3000` — DOLLAR FALLBACK only (backtests): pyramid steps every +$3K profit
- `proven_trades_per_tier` — env `PROVEN_TRADES_PER_TIER` (default 10) — LIVE ramp: +1 tier per N cumulative winning trades (`paper_sessions.proven_trades_count`, migration 0174, monotonic, survives payouts)
- `DRAWDOWN_ROOM_RISK_PCT: 0.08` — 8% of Topstep drawdown buffer per trade (recalibrated from 0.01 — see above)
- **Scaling validation:** `scripts/validate-scaling-schedule.py` proves per-tier firm-breach risk < `SCALING_BREACH_GATE_PCT` (default 0.05) via `simulate_firm_survival` on real data (fail-closed). Bar-by-bar pyramid replay across WF folds is a documented follow-up.

**Concrete examples (1.5×ATR stop, ATR=4pts on MES, MFFU 2% rule):**
- $50K eval funded:   $1,000 risk / $30/contract = 33 contracts ceiling
- $100K account:      $2,000 / $30 = 66 contracts
- $150K account:      $3,000 / $30 = 100 contracts (binds at liquidity cap)

**Schema:** strategies write `position_size.type="risk_derived_pyramid"`. Static `max_contracts` MUST NOT be baked at graduation — computed at signal-time only. See `src/server/lib/risk-sizing.ts`.

**Mini→micro contract conversion:** scout-extract's `remapMarket()` scales contracts 10× when remapping ES→MES, NQ→MNQ, CL→MCL. Transcript "trade 3 ES" becomes "trade 30 MES" — same dollar-risk exposure post-conversion.

### Daily Loss Limit — 4-band escalation ladder
```
Personal DLL = 67% of firm DLL
REDUCE new-entry size ×0.50 at 60% (env: DLL_REDUCE_SIZE_PCT / DLL_REDUCE_SIZE_FACTOR)  ← soft, 2026-06-23
HALT new entries           at 67% (env: DLL_HALT_PCT)
FORCE-CLOSE all positions  at 95% (env: DLL_FORCE_CLOSE_PCT)
Reset at session boundary
```
The 60% band (NexusFi Operations Manual 2026-06 institutional ladder) sizes new entries DOWN
(never zeroes — floored ≥1; the 67% halt is the zero path) to absorb a losing streak before the
hard halt. Lives in `cross-symbol-pnl.ts::evaluateCrossSymbolDll` (action `reduce_size`), applied
at the `paper-signal-service.ts` sizing site. Audit: `sizing.dll_reduce_size_band_entered` +
`sizing.dll_reduce_size_applied`. Ordering: force_close > halt > reduce_size > none.

### Daily Trade Cap — 1-2 A+ trades/day mandate (Wave 26 Pass K Phase 1)
```
Default: TF_MAX_TRADES_PER_DAY=2 per account (operator's "1-2 A+ trades/day" mandate)
Per-session override: paper_sessions.config.max_trades_per_day (DB > env > default)
Counting: paper_trades rows CLOSED on the current CME futures trading day
Scope: per-session (one prop-firm account = one independent quota)
Gate: HARD signal-time block at paper-signal-service.ts via daily-trade-cap.ts
Fail-OPEN on DB error (warn audit; let trade slip rather than silently halt)
```
The 3rd signal of the day on a given session is the FIRST rejection at the default `2` cap.
The Python kill switch at fill time continues to enforce `sessionCfg.max_trades_per_day`
as a belt-and-suspenders defense layer for any signal that somehow slipped past this gate.

---

