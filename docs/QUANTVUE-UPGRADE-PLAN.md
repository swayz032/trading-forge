# Trading Forge — QuantVue Upgrade & Cleanup Plan

**Status:** Waves 1, 2, 3 (partial), 4.1, 4.2, 4.3 SHIPPED 2026-04-29 · Waves 4.4, 4.5 DEFERRED
**Date:** 2026-04-29
**Author:** Cofounder engineering session (Claude + tonio)

---

## Execution Log — 2026-04-29

| Wave | Status | Files Touched |
|---|---|---|
| 1 — Total Data Wipe | ✅ DONE | `scripts/wipe-all-data.mjs` (new), 37,500+ rows deleted, backup at `backups/db/railway_pre_wipe_20260429_171221.sql.gz` (6.2MB) |
| 2 — Strategy card upgrade | ✅ DONE | `src/components/forge/EquityCurveSparkline.tsx` (new), `src/pages/Strategies.tsx` (refactor) |
| 3.1 — Overview Day×Hour heatmap | ✅ DONE | `src/components/strategy/DayHourHeatmap.tsx` (new), wired into `StrategyDetail.tsx` |
| 3.4 — Trades Long/Short breakdown | ✅ DONE | `src/components/strategy/LongShortBreakdown.tsx` (new), wired into Trades tab |
| 3.5 — Code tab (DSL/Pine/Python) | ✅ DONE | `src/components/strategy/CodeTabs.tsx` (new), API routes `GET /api/strategies/:id/{dsl,pine,python}` |
| 3.6 — Config Prop Firm panel | ✅ DONE | `src/components/strategy/PropFirmModePanel.tsx` (new), 7-firm template selector, EOD/Intraday dropdown |
| 4.1 — Pine compiler fix | ✅ DONE | `src/engine/pine_compiler.py` — `use_bar_magnifier=true`, `fill_orders_on_standard_ohlc=true` added to both strategy declarations |
| 4.2 — Anti-Heikin gate, opt-in Renko | ✅ DONE | `src/engine/compiler/strategy_schema.py` — `ChartConstruction` enum, HA rejection, Renko brick_size_atr requirement |
| 4.3 — Bidirectional WR check | ✅ DONE | `src/engine/backtester.py:_compute_long_short_split` — added `directional_asymmetry_pp` and `asymmetry_flag` (BALANCED / SLIGHT_TILT / BIASED / INSUFFICIENT_DATA) |
| 4.4 — Composite Portfolio Reporting | ⏸ DEFERRED | New tables, routes, page; bigger scope, ship in next session |
| 4.5 — Stack Composition Templates | ⏸ DEFERRED | New tables, routes; depends on 4.4 |

**Type checks:** Frontend `tsc --noEmit` clean. Backend `tsc --noEmit` clean (2 pre-existing errors in unrelated `critic-optimizer-service.evidence.test.ts` not introduced by this work).

**Deferred work scope:**
- 4.4 Composites: new `compositePortfolios` table + `POST /api/composites` + `pages/Composites.tsx` rendering QuantVue-style multi-strategy summary (equal capital, additive P&L, daily Sharpe, drawdown, monthly bars).
- 4.5 Stacks: `stackTemplates` table for sleeve patterns (directional / anchor / smoother) — Atlas/Hydra/Sentinel/Hydra X/Titan equivalents. Optional weighted contract allocation (Hydra X 2:6:4) as v2.

---

---

## Context

We benchmarked Trading Forge against QuantVue (PDFs, Discord screenshots, public toolkit pages). QuantVue is a paid commercial competitor running 5–9 named strategies on MNQ/NQ/GC/CL with $453,692 P&L over 3.2 years on a published composite portfolio. The deep-scan revealed:

1. **Trading Forge has 99 strategies in DB but 0 active** — almost all are Silver Bullet pipeline test variants (`v2`, `v3`, `E2E`, `Live`, `E2E Full Flow`, `Full Pipeline`). The whole system is polluted with test artifacts.
2. **All data is stale** — empty metrics, no recent backtests, "No OHLCV data available" on detail pages. The user wants a complete reset.
3. **Strategy detail UI is good-enough but incomplete** — Code tab missing, Config tab shows raw JSON instead of human-readable DSL, no equity curve overlay, no Day × Hour heatmap, no Long/Short WR breakdown, no MFE/MAE scatter.
4. **Strategy list cards lack visual pride** — no mini equity curve sparkline, empty cards look broken, variable heights.
5. **Pine compiler missing 2 critical TradingView settings** — `use_bar_magnifier` and `fill_orders_on_standard_ohlc` (per QuantVue Discord image 16). Causes phantom fills on Heikin/Renko charts today.
6. **Prop firm config UI missing 5 fields** vs QuantVue parity — Daily Loss Limit, Consistency Rule %, Contract Limit, Drawdown Type (EOD/Intraday), Enable toggle.

This plan executes a clean reset, ships the QuantVue-derived insights, and lifts the strategy detail UI to a proud, premium feel — without rewriting anything that already works.

---

## Architectural Map (single source of truth for this plan)

| Layer | Path |
|---|---|
| Backend | `C:\Users\tonio\Projects\trading-forge\trading-forge\` |
| Frontend (real) | `C:\Users\tonio\Projects\trading-forge\tf-deep-scan\Trading_forge_frontend\amber-vision-main\src\` |
| DSL Pydantic | `trading-forge/src/engine/compiler/strategy_schema.py` (lines 43–121) |
| DSL JSON Schema | `trading-forge/src/engine/compiler/schema_versions/v1.json` |
| DSL Translator | `trading-forge/src/server/services/dsl-translator.ts` (lines 9–151) |
| Pine Compiler | `trading-forge/src/engine/pine_compiler.py` (settings at lines 1257–1259) |
| Strategy Detail | `tf-deep-scan/.../src/pages/StrategyDetail.tsx` (lines 1–625) |
| Strategy List | `tf-deep-scan/.../src/pages/Strategies.tsx` (lines 1–287) |
| Prop Firm UI | `tf-deep-scan/.../src/pages/PropFirmSimulator.tsx` |
| DB Schema | `trading-forge/src/server/db/schema.ts` |
| Lifecycle Service | `trading-forge/src/server/services/lifecycle-service.ts` |

> **CLAUDE.md correction:** says dashboard is at `src/dashboard/` but it's actually at `tf-deep-scan/Trading_forge_frontend/amber-vision-main/src/`. Update CLAUDE.md as part of Wave 4.

---

## Wave 1 — Total Data Wipe (foundational, must be first)

### Goal
Reset Trading Forge to a clean slate: zero strategies, zero backtests, zero MC runs, zero paper trades. Preserve seeded reference data (prop firm rules, prompts, calendar). Preserve historical OHLCV in S3 (cost $125 to refetch).

### Deletion Scope

**DELETE (cascade order, leaves first → root last):**
1. `backtest_trades`, `backtestMatrix`, `monte_carlo_runs`, `stress_test_runs`, `walk_forward_windows`
2. `quantum_mc_runs`, `quantum_mc_benchmarks`, `sqa_optimization_runs`, `qubo_timing_runs`, `tensor_predictions`, `rl_training_runs`
3. `critic_optimization_runs`, `critic_candidates`
4. `deepar_forecasts`, `deepar_training_runs`
5. `strategy_export_artifacts`, `paper_positions`, `paper_trades`, `paper_signal_logs`, `shadow_signals`, `paper_session_feedback`
6. `tournament_results`
7. `paper_sessions`, `strategy_exports`, `backtests`
8. `strategy_graveyard`, `system_journal`, `audit_log`, `alerts`, `compliance_reviews`, `compliance_drift_log`, `skip_decisions`, `mutation_outcomes`, `strategy_names`, `dead_letter_queue`, `n8n_execution_log`
9. `strategies` (root)

**PRESERVE:**
- `compliance_rulesets` (8 prop firms — MFFU/Topstep/TPT/Apex/FFN/Alpha/Tradeify/Earn2Trade)
- `system_parameters`, `system_parameter_history`
- `prompt_versions`, `prompt_ab_tests`
- `subsystem_metrics`, `agent_health_reports`
- `__drizzle_migrations` (NEVER TOUCH)

**S3 cleanup** (`s3://trading-forge-data/`):
- Delete: strategy-specific UUID folders, backtest result parquets, daily trade logs, equity curve snapshots
- **Keep:** ratio-adjusted continuous contract data (`ratio_adj/` prefix) — costs $125 to refetch

**Local cleanup:**
- Delete: `models/deepar/` (will retrain), `data_cache/`, any DuckDB caches
- Keep: source code, configs, migrations

### Implementation

Create two scripts:

**`trading-forge/scripts/wipe-data-dry-run.ts`** (read-only):
- Connects to DB, counts rows per table, lists all UUIDs to be deleted
- Lists S3 prefixes that would be deleted (via aws-sdk listObjects, no delete)
- Outputs a summary: `99 strategies, 234 backtests, 1,847 backtest_trades, 47 paper_sessions, 12.3 GB S3 data`
- **No mutations**

**`trading-forge/scripts/wipe-data-execute.ts`** (live):
- Confirms dry-run was run within last 5 minutes
- Begins single transaction with cascade DELETEs in correct order
- Calls S3 delete with explicit prefix safelist (only `strategies/`, `backtests/`, `paper/` — never `ratio_adj/`)
- Writes a single immutable `system_journal` entry with `event_type='wipe_executed'`, count of deleted rows, S3 bytes freed
- Refuses to run if `NODE_ENV=production` without explicit `--i-know-what-im-doing` flag

**Verification:**
```sh
npm run db:studio  # confirm 0 rows in strategies, backtests, paper_sessions
aws s3 ls s3://trading-forge-data/strategies/  # empty
curl localhost:4000/api/strategies | jq length  # returns 0
```

---

## Wave 2 — Strategy Card Visual Upgrade

### Goal
Match QuantVue's "premium hero" feel without losing our information density. Specifically: empty states don't look broken, sparkline equity curves on cards, consistent card heights.

### Changes to `Strategies.tsx` (lines 184–267)

**1. Add equity curve sparkline** (60px tall, full card width, under metric row):
- New component: `<EquityCurveSparkline strategyId={s.id} height={60} />`
- Fetches last 30 days of equity from `/api/strategies/:id/equity?days=30`
- Renders as smooth SVG line, gradient fill, color-coded by P&L direction (green if up, red if down)
- Empty state: dashed line + "Run a backtest →" inline CTA linking to detail page
- Implementation: use existing `LightweightChart` component in sparkline mode, OR Recharts `<AreaChart>`

**2. Empty-state polish for metric row:**
- Current: shows `--` or `0` when no data → looks broken
- New: when `s.totalTrades === 0`, replace metric row with single inline CTA: `[ Run a backtest to see metrics ]` button
- Detect "never run" state via `lastBacktestAt === null` (already in API)

**3. Fixed card heights (eliminate layout jitter):**
- Add `min-h-[260px]` to card root + `line-clamp-2` on description (already exists per audit)
- Use CSS grid with explicit row heights instead of flex

**4. Subtle gradient border (QuantVue parity):**
- Replace `border border/20` with `border border-transparent bg-gradient-to-br from-surface-2 to-surface-3 ring-1 ring-white/5`
- Add `hover:ring-amber-400/30 transition` for hover state
- Forge Score ring color modulates the glow tint (high-score = amber glow, decaying = red glow)

**5. Per-card mini action toolbar (top-right corner, replaces just-the-symbol-tag):**
- 3 micro buttons: `[Backtest]` `[Paper]` `[Code]` (icon-only, tooltips on hover)
- Wires to existing endpoints

### Files modified
- `tf-deep-scan/.../src/pages/Strategies.tsx` (lines 184–267)
- `tf-deep-scan/.../src/components/forge/EquityCurveSparkline.tsx` (NEW)
- `trading-forge/src/server/routes/strategies.ts` — add `GET /api/strategies/:id/equity?days=30`

---

## Wave 3 — Strategy Detail Page Upgrade

### Goal
Make the detail page a proud quant workbench. Every tab should answer a specific question a real trader would ask. DSL is shown alongside Pine/Python in the Code tab.

### Tab-by-tab plan (`StrategyDetail.tsx` lines 1–625)

#### 3.1 — **Overview tab** (lines 375–416)
- **Add equity curve as primary chart** (replaces OHLCV-only view) — use `useBacktestEquity()` hook (already exists)
- **Add daily P&L bar chart underneath** equity curve (last 90 days)
- **Add drawdown underwater curve** as a third small chart (peak-to-trough %)
- **Add Day × Hour P&L heatmap** (per QuantVue V2 deck page 14) — Mon–Fri × 9am–4pm grid, color-graded by avg P&L per cell
- **OHLCV chart moves to Code tab** (it's reference, not primary insight)

#### 3.2 — **Backtests tab** (lines 419–428)
- Existing list table is fine — keep
- **Add walk-forward decomposition** below the list — render `walkForwardResults` field (already in schema, just not displayed)
- **Add parameter sensitivity heatmap** — for the latest backtest's Optuna trials, show a 2D heatmap of parameter pairs vs Sharpe

#### 3.3 — **Monte Carlo tab** (lines 431–592)
- Existing fan chart is fine — keep
- **Add drawdown distribution histogram** (already-computed values just not visualized)
- **Add survival probability by day curve** — % of MC paths still above starting equity at each day

#### 3.4 — **Trades tab** (lines 595–597)
- Existing trade table is fine — keep
- **Add P&L distribution histogram** (KDE overlay, mean marker — copy QuantVue V2 page 6 styling)
- **Add MFE/MAE scatter plot** (data already in `backtest_trades` schema as `mae`, `mfe` columns)
- **Add Long/Short WR breakdown** — two pie charts side by side (per QuantVue V2 page 10) — flag if asymmetry > 10pp
- **Add consecutive loss tracker** — bar chart of streak lengths

#### 3.5 — **Code tab** (CURRENTLY MISSING — implement from scratch)
Three sub-tabs inside the Code tab:

**(a) DSL** — render the `strategies.config` JSONB as the user's DSL format (per `strategy_schema.py`):
```yaml
name: silver_bullet
description: ICT Silver Bullet — FVG entries during NY AM and London killzones
symbol: ES
timeframe: 5m
direction: both

entry:
  type: ict_fvg_breakout
  indicator: silver_bullet_killzone
  params:
    nyam_window: ["09:50", "10:10"]
    london_window: ["02:00", "05:00"]
    fvg_min_size_atr: 0.3
  condition: "Price breaks FVG zone within killzone window with displacement"

exit:
  type: atr_multiple
  stop_loss_atr: 1.5
  take_profit_atr: 3.0

regime: TRENDING
session: NY_AM_AND_LONDON
```
- Render via `react-syntax-highlighter` with YAML mode + custom theme
- Show DSL → English translation panel below (using `dsl-translator.ts`)

**(b) Pine** — emit Pine v5 via `pine_compiler.py`, syntax-highlighted, "Copy to TradingView" button
**(c) Python** — emit vectorbt-compatible Python, syntax-highlighted, "Copy" button

#### 3.6 — **Config tab** (lines 600–620) — restructure
- **Strategy params** (current view) — keep but render via DSL-style yaml, not raw JSON
- **NEW: Prop Firm Mode panel** matching QuantVue (image 23):
  ```
  [ ] Enable Prop Firm Mode
  Profit Target ($)        [3500]   ⓘ
  Max Drawdown ($)         [2000]   ⓘ
  Daily Loss Limit ($)     [800]    ⓘ
  Consistency Rule (%)     [20]     ⓘ
  Contract Limit           [3]      ⓘ
  Drawdown Type           [EOD ▼]   ⓘ   (options: EOD / Intraday)
  ```
- Each field has a tooltip explaining the rule (e.g., "Topstep uses EOD drawdown — measured at end-of-day; intraday measures peak-to-trough during the session")
- "Apply firm template" dropdown: select MFFU/Topstep/Apex etc. → auto-fills the 6 fields
- Saves to `strategies.config.prop_firm_mode` JSONB
- **Sensitivity panel** — show parameter robustness from Optuna runs

### New files needed
- `tf-deep-scan/.../src/components/strategy/EquityCurveCard.tsx` (Overview hero)
- `tf-deep-scan/.../src/components/strategy/DayHourHeatmap.tsx` (NEW visualization)
- `tf-deep-scan/.../src/components/strategy/DrawdownUnderwater.tsx`
- `tf-deep-scan/.../src/components/strategy/PnLDistribution.tsx`
- `tf-deep-scan/.../src/components/strategy/MfeMaeScatter.tsx`
- `tf-deep-scan/.../src/components/strategy/LongShortBreakdown.tsx`
- `tf-deep-scan/.../src/components/strategy/CodeTabs.tsx` (DSL/Pine/Python)
- `tf-deep-scan/.../src/components/strategy/PropFirmModePanel.tsx`
- `tf-deep-scan/.../src/components/strategy/DSLRenderer.tsx`

### New API endpoints needed
- `GET /api/strategies/:id/dsl` — returns the strategy's DSL representation (YAML string)
- `GET /api/strategies/:id/pine` — returns compiled Pine v5
- `GET /api/strategies/:id/python` — returns vectorbt Python
- `GET /api/backtests/:id/day-hour-heatmap` — returns 2D matrix of avg P&L by day×hour
- `GET /api/backtests/:id/long-short-breakdown` — returns `{ longWR, longCount, shortWR, shortCount }`
- `GET /api/strategies/:id/equity?days=30` — returns sparkline data for cards

---

## Wave 4 — QuantVue Insight Integration

These tie into the architecture and rule engine, not just UI.

### 4.1 — Pine compiler bug fix (the obvious one)

**File:** `trading-forge/src/engine/pine_compiler.py` lines 1250–1259

**Current strategy declaration:**
```python
strategy("{strategy_name}", overlay=true,
         initial_capital=50000,
         default_qty_type=strategy.fixed,
         default_qty_value=1,
         commission_type=strategy.commission.cash_per_contract,
         commission_value={commission},
         slippage=0,
         process_orders_on_close=true,
         calc_on_every_tick=false,
         calc_on_order_fills=false)
```

**Add 2 lines:**
```python
         use_bar_magnifier=true,
         fill_orders_on_standard_ohlc=true)
```

**Why:** QuantVue Discord screenshot 16 documents these as required to prevent phantom fills on Heikin-Ashi or Renko charts. Without them, a user attaching our exported strategy to a non-standard chart gets double-fills.

### 4.2 — Anti-Heikin gate, opt-in Renko gate

**File:** `trading-forge/src/agents/openclaw/scout-validator.ts` (or equivalent)

Add validation:
- **Reject** any candidate strategy whose `entry_indicator` or signal source name contains: `heikin`, `ha_`, `heikin_ashi`
- **Allow Renko only with explicit opt-in:** `chart_construction: "renko"` in DSL, plus `brick_size_atr` parameter, plus exit logic must use `barstate.isconfirmed`
- Critic loop reads this and refuses to compile a Pine artifact that violates these rules

**Rationale:** Heikin Ashi is a synthetic price — backtests on HA candles validate a smoothed visualization, not real edge. Renko is legitimate for grid/scaling strategies (per QuantVue's Qgrid_Elite) but requires brick-close gating.

### 4.3 — Bidirectional WR symmetry check

**File:** `trading-forge/src/server/routes/tournament.ts`

Add metric to tournament gate output:
```typescript
{
  longWinRate: number,
  shortWinRate: number,
  directionalAsymmetry: Math.abs(longWR - shortWR), // pp
  asymmetryFlag: directionalAsymmetry > 0.10 ? 'BIASED' : 'BALANCED'
}
```

Strategies flagged BIASED don't auto-promote — surface in the dashboard with a warning chip.

### 4.4 — Composite Portfolio Reporting

New entity: a "composite" is an aggregation of N strategies whose P&L is summed time-ordered, per QuantVue methodology (V2 deck page 15):

**New table:** `compositePortfolios`
- `id`, `name`, `strategy_ids[]`, `created_at`, `methodology` (jsonb)

**Methodology default:**
- Equal capital per strategy (no leverage stacking)
- Additive P&L aggregation (time-ordered sum)
- Daily Sharpe = sum(daily P&L) / std(daily P&L) × √252, including zero-return business days
- Outlier-trimmed at 2.5/97.5 percentiles for chart display only

**New route:** `POST /api/composites` — create a composite from a list of strategy IDs
**New route:** `GET /api/composites/:id/report` — returns equity curve, KPIs, drawdown, monthly P&L

**New page:** `tf-deep-scan/.../src/pages/Composites.tsx` — list + create composites, view their report cards (mirroring QuantVue V2 deck format)

### 4.5 — Stack composition layer (sleeve templates)

QuantVue's PDF 1 introduces named "stacks" (Pulse → Atlas → Hydra → Sentinel → Hydra X → Titan) tied to capital tiers. Trading Forge can offer this as a portfolio-construction feature.

**New table:** `stackTemplates`
- `id`, `name` (e.g., "Atlas-style"), `tier` (small/mid/large), `composition` (jsonb: `[{ role: "directional", strategy_id }, { role: "anchor", strategy_id }, { role: "smoother", strategy_id }]`)

**New route:** `POST /api/stacks/from-strategies` — given a list of strategies, suggest sleeve templates by role (anchor = lowest DD, smoother = lowest vol contribution, directional = highest return)

**Defer:** Initial implementation is template-only; weighted contract allocation (Hydra X 2:6:4 pattern) is a stretch goal for v2.

### 4.6 — Multi-timeframe complementarity (deferred)

Document in `docs/composite-portfolio-design.md` as future work. Requires DeepAR vol forecasting maturity which is still in shadow mode (weight 0.0 → 0.10 graduation).

---

## Wave Order & Dependencies

```
Wave 1 (Data Wipe)              ← MUST be first; clean slate for everything else
   ↓
Wave 4.1 (Pine fix)             ← Tiny, can ship in parallel with Wave 1
   ↓
Wave 2 (Card upgrade)           ← Builds on clean DB so empty states work right
   ↓
Wave 3 (Detail page upgrade)    ← Bulk of UI work; depends on Wave 2 components
   ↓
Wave 4.2-4.4 (Insights)         ← Backend gates + Composite reporting
   ↓
Wave 4.5 (Stacks)               ← New schema, defer if scope blows up
```

**Estimated effort (rough):**
- Wave 1: 2 hours (script + run + verify)
- Wave 2: 4 hours
- Wave 3: 8–12 hours (largest scope)
- Wave 4.1: 5 minutes
- Wave 4.2: 1 hour
- Wave 4.3: 1 hour
- Wave 4.4: 4 hours (new table + route + page)
- Wave 4.5: 3 hours

**Total: ~24 hours** of implementation, parallelizable across sessions.

---

## Verification Strategy

### Wave 1
- DB row counts: 0 strategies, 0 backtests, 0 paper_sessions, 0 MC runs
- S3 list: `trading-forge-data/strategies/` empty, `ratio_adj/` intact
- API: `GET /api/strategies` returns `[]`
- UI: Strategies page shows "0 active · 0 total" with empty state CTA "Run Strategy Scout to generate candidates"

### Wave 2
- Visual diff vs current (screenshots before/after)
- Sparkline shows real equity for strategies with backtests, "Run a backtest" CTA for new ones
- All cards same height regardless of description length
- Hover state shows amber glow

### Wave 3
- Each tab shows non-empty content for a strategy with one completed backtest
- DSL output matches the canonical YAML format (round-trip test: parse → render → compare)
- Pine output passes TradingView's compiler (manual paste test)
- Day×Hour heatmap shows non-uniform color distribution (proves data is real, not random)
- Prop firm mode panel: select "Topstep" template, all 6 fields auto-populate, save persists to DB

### Wave 4
- Pine fix: paste exported strategy to a Heikin-Ashi chart in TradingView, verify no double-fill warnings
- Anti-Heikin gate: submit a candidate with `entry_indicator: "ha_close"` → critic rejects
- Bidirectional check: backtest a long-only strategy → tournament flags `BIASED`
- Composite: combine 3 strategies → report shows additive P&L matching manual spreadsheet
- Stacks: 3 strategies in roles (directional/anchor/smoother) → stack template renders correctly

---

## Open Questions Before We Start

1. **Wipe blast radius:** confirm we're wiping `audit_log` too (compliance trail) or preserving it? Current plan: preserve (it's compliance evidence). User to confirm.
2. **Composite naming:** keep QuantVue-style "Atlas/Hydra/Sentinel" or use Trading Forge naming convention (e.g., "Bias-Stack-1", "Trend-Stack-1")?
3. **Frontend brand:** keep "FORGE TRADING LAB" header or rebrand cards visually?
4. **DSL display format:** YAML (chosen above) or our existing JSON form? YAML reads better for humans; JSON round-trips cleaner. User preference?

---

## Files Touched (Summary)

| Wave | Files |
|---|---|
| 1 | `scripts/wipe-data-dry-run.ts` (new), `scripts/wipe-data-execute.ts` (new) |
| 2 | `Strategies.tsx`, `EquityCurveSparkline.tsx` (new), `routes/strategies.ts` |
| 3 | `StrategyDetail.tsx`, 9 new components in `components/strategy/`, 6 new API routes |
| 4.1 | `pine_compiler.py` (2 lines) |
| 4.2 | `agents/openclaw/scout-validator.ts` |
| 4.3 | `routes/tournament.ts` |
| 4.4 | `db/schema.ts`, `routes/composites.ts` (new), `pages/Composites.tsx` (new) |
| 4.5 | `db/schema.ts`, `routes/stacks.ts` (new) |
| Cleanup | `CLAUDE.md` (correct dashboard path) |

---

**Ready to execute when approved. Recommend starting with Wave 1 + Wave 4.1 in parallel.**
