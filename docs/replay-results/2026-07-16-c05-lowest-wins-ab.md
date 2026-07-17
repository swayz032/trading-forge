# C-05 "Lowest Wins" A/B Receipt — the D9 reversal evidence (2026-07-16)

**Change:** Wave 2b / C-05 / operator decision **D9** — remove the healthy-account pyramid-floor
override in `src/server/lib/risk-sizing.ts` + `src/engine/sizing.py` so `finalContracts` is a PURE
`max(0, min(pyramidTier, riskDerivedCap, firmCap, liquidityCap, drawdownRoomCap))` on **every** account.
When the minimum is `< 1` the honest result is **reject/skip (0)** — never a fabricated base floor.

**How this table was produced:** the REAL `compute_risk_derived_contracts()` (Python, byte-parity with the
TS helper) was called on a fixed grid — once against the **BEFORE** code (floor override, base SHA `cfe3e45f`)
and once against the **AFTER** code (this change). Script: `scratchpad/c05_ab.py`.

**Fixed inputs:** MES base config — `base_contracts=9`, `tier_increment=3`, `max_risk_pct=0.02`,
`liquidity_comfort_cap=100`, `point_dollar_value=$5`, `stop_multiplier=1.5`, `cumulativeProfit=0`,
`firmContractCap=50`. ATR swept `{2, 4, 6, 8, 12}` MES points → `stopDollars = 1.5 × ATR × $5`.

Three paths:
- **(a) Fresh Topstep 50K combine** — `firm=topstep`, balance `$52K`, buffer `$2K`, `currentDrawdownRoom=$2K` (dd-room cap PRESENT).
- **(b) MFFU 50K** — `firm=mffu`, balance `$50K`, no dd-room cap (risk = 2% of balance).
- **(c) Backtest path** — `firm=topstep`, balance `$52K`, buffer `$2K`, **no** `currentDrawdownRoom` (the UNBOUNDED-floor case the packet flagged).

## Contracts: BEFORE (floor override) → AFTER (lowest-wins)

| Path | ATR | stop$/ct | riskCap | BEFORE | AFTER | Δ | AFTER skips? |
|---|---|---|---|---|---|---|---|
| (a) Topstep combine | 2 | 15 | 2 | **9** (floor) | **2** | −7 | no |
| (a) Topstep combine | 4 | 30 | 1 | **5** (dd-room floor) | **1** | −4 | no |
| (a) Topstep combine | 6 | 45 | 0 | **3** (dd-room floor) | **0** | −3 | **SKIP** |
| (a) Topstep combine | 8 | 60 | 0 | **2** (dd-room floor) | **0** | −2 | **SKIP** |
| (a) Topstep combine | 12 | 90 | 0 | **1** (dd-room floor) | **0** | −1 | **SKIP** |
| (b) MFFU 50K | 2 | 15 | 66 | 9 | 9 | 0 | no |
| (b) MFFU 50K | 4 | 30 | 33 | 9 | 9 | 0 | no |
| (b) MFFU 50K | 6 | 45 | 22 | 9 | 9 | 0 | no |
| (b) MFFU 50K | 8 | 60 | 16 | 9 | 9 | 0 | no |
| (b) MFFU 50K | 12 | 90 | 11 | 9 | 9 | 0 | no |
| (c) Backtest (no dd-room) | 2 | 15 | 2 | **9** (UNBOUNDED floor) | **2** | −7 | no |
| (c) Backtest (no dd-room) | 4 | 30 | 1 | **9** (UNBOUNDED floor) | **1** | −8 | no |
| (c) Backtest (no dd-room) | 6 | 45 | 0 | **9** (UNBOUNDED floor) | **0** | −9 | **SKIP** |
| (c) Backtest (no dd-room) | 8 | 60 | 0 | **9** (UNBOUNDED floor) | **0** | −9 | **SKIP** |
| (c) Backtest (no dd-room) | 12 | 90 | 0 | **9** (UNBOUNDED floor) | **0** | −9 | **SKIP** |

## How often the reversal bites

- **Cases now sizing to 0 (skip):** **6 of 15** — all where the 2% risk cap collapsed to 0 (wide stops on a $2K-buffer combine): path (a) ATR {6,8,12}, path (c) ATR {6,8,12}.
- **Path (a) Topstep combine (dd-room cap present):** every cell shrinks (−1 to −7); the change is *bounded* by the dd-room cap that already limited the floor to ≤5. 3/5 now skip.
- **Path (b) MFFU 50K:** **ZERO change** across all cells — the floor never fired here because the 2% risk cap (11–66) always exceeded base 9, so the pyramid tier already bound. Healthy accounts with adequate risk room are unaffected.
- **Path (c) Backtest path (no dd-room):** the **largest** change — BEFORE the floor was **unbounded** (always 9 regardless of what the risk math said, Δ up to −9); AFTER it collapses to the risk cap or skips. This is the exact "UNBOUNDED in backtests" hazard the packet flagged; re-run flagged backtests before trusting $ metrics.

## Operator note (accepted tradeoff)

D9 is a deliberate **prior-intent reversal**: the floor existed to stop a fresh combine with a tight stop
being strangled to 0–1 contracts (the same problem the `DRAWDOWN_ROOM_RISK_PCT 0.01→0.08` recal fought).
On a fresh combine with a wide stop the bot may now trade smaller **or skip** rather than trade base size —
risk-honesty over always-trading-base. This receipt is the record; a single `git revert` restores the floor.

## Vectorized backtest path — HIGH #1 + HIGH #2 (independent-grader ruling, closed THIS wave)

The scalar table above is the decision paper/live uses. The **vectorized backtest** path
(`compute_position_sizes`, `risk_derived_pyramid` mode) — which feeds WFE/PBO/B14 promotion gates — had
**two remaining fabrication sites** the independent grader ruled must close as C-05 siblings (initial submission
had PRESERVED them as out-of-scope; the grader's ruling supersedes). Both fabricated a 1-contract trade on
exactly the bars/runs where lowest-wins collapsed to 0 — recreating the backtest/live divergence D9 closes.

- **HIGH #1** — per-bar `min-1` fallback (`np.where((bar_sizes<=0)&(pyramid_tier_per_bar>0), 1.0, ...)`): a lowest-wins-0 bar was floored to 1. **REMOVED** → stays 0 (skip). vectorbt `from_signals` treats `size=0` as a no-op (no order). It was SILENT (`over_risk` all-False, unlike the `dynamic_atr` mode's flagged min-1, which is untouched).
- **HIGH #2** — wholesale `sizes = np.full(n, 1.0)` when the PRELIM scalar (SESSION-MEAN ATR) rejected: post-D9 a healthy narrow-buffer account whose MEAN ATR collapses the cap rejects unconditionally (`negative_cap`), silently degrading the whole run to flat-1/bar. **SPLIT**: structural reject (`zero_balance`/`zero_atr`/`zero_buffer`) → `np.zeros` (honest whole-run skip); `negative_cap` → PROCEED to the per-bar computation (per-bar ATR still varies; skips-to-0 the collapsed bars, sizes the rest).

**Reachability of HIGH #2 confirmed** (`test_c05_vectorized_lowest_wins.py::TestHigh2Reachability`): the prelim scalar returns `negative_cap` on D9's own motivating scenario — healthy account (52K/50K=1.04), fresh $2K Topstep buffer, mean ATR 6.0 (`stop $45 > risk $40`).

Vectorized before/after (real `compute_position_sizes`, base 9 MES, Topstep $2K buffer, `stop_mult`=1.5, `symbol`=None; per-bar ATR list in points):

| Scenario (ATR points) | prelim scalar | BEFORE (fabricated) | AFTER (lowest-wins) |
|---|---|---|---|
| `[2,10]×5` (mean 6 → cap 0) | negative_cap | `[1,1,1,1,1,1,1,1,1,1]` | `[2,0,2,0,2,0,2,0,2,0]` |
| `[2×9, 10]` (mean 2.8 → cap 1) | none (sizable) | `[2,2,2,2,2,2,2,2,2,1]` | `[2,2,2,2,2,2,2,2,2,0]` |
| `[4×5]`, balance $0 | zero_balance | `[1,1,1,1,1]` | `[0,0,0,0,0]` |
| `[4×5]`, below trailing floor | zero_buffer | `[1,1,1,1,1]` | `[0,0,0,0,0]` |
| `[2×5]` healthy narrow (control) | none | `[2,2,2,2,2]` | `[2,2,2,2,2]` (**unchanged**) |

Each row is RED-proofed (`test_c05_vectorized_lowest_wins.py`): reverting the fix re-introduces the BEFORE column. **`npm run test:metrics` held at 144-pass / 1-preexisting** (the two golden cross-engine parity value tests PASSED — no fixture VALUE shifted, so NOT a reserved-class HOLD; the golden fixtures use healthy accounts / normal ATR that never hit the collapsed-bar or mean-ATR-reject paths). The vectorized backtest now agrees with the scalar/live skip-to-0 instead of manufacturing phantom P&L.

### NEW-HIGH sibling (regression the HIGH #2 fix introduced — closed same wave)

Activating the `negative_cap` per-bar path surfaced that the scalar `negative_cap` early-return
hardcoded `firm_cap=None` (`sizing.py:553`), discarding the resolved `effective_firm_cap` that honors
`topstep_account_cap_override`. The per-bar consumer (`sizing.py:1142-1147`) then fell back to the
unrelated `max_contracts` param (or `1e9`), so `topstep_account_cap_override` was silently dropped on
exactly the fresh-narrow-buffer Topstep combine this wave targets. **Fixed** — the `negative_cap` return
(and its evidence) now exposes `effective_firm_cap`; TS `risk-sizing.ts` mirrors the shape for parity
(telemetry-only there — TS has no vectorized consumer). Repro/RED-proof
(`TestNewHighFirmCapOverrideOnNegativeCapPath`): `topstep_account_cap_override=1`, `firm_contract_cap=50`,
`max_contracts=50`, ATR `[2,10]×5` (mean 6 → negative_cap) → AFTER `sizes.max()==1` (override honored);
reverting the fix → `sizes.max()==2` (override exceeded). Additive-safe for scalar/live (`final_contracts=0`
regardless of `firm_cap`); the only non-test caller of the scalar fn is `compute_position_sizes` itself.
