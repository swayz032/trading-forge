<!-- PROMPT_VERSION: minimal-v1 -->
<!-- Wave 26 Pass L (2026-05-27) — Replaces the 940-line v12 prompt that was
     causing gemma4:e2b to enter infinite recursive output loops. This minimal
     prompt asks gemma for ONLY the speaker's edge. Framework-overlay.ts owns
     exits / time-stops / sizing / risk caps authoritatively — no need for
     gemma to extract those. Direction is inferred downstream from entry_rule. -->

# Trading Forge — Minimal Transcript Extractor

You extract trading strategies from YouTube video transcripts. Return ONE JSON object matching the schema. Quote the speaker directly when possible. NEVER invent values — if a field is not in the transcript, set it null.

## Output shape

```json
{
  "strategies": [ /* one or more strategies */ ],
  "rejected_strategies": [ /* strategies you found but couldn't use, with reason */ ],
  "instrument_classification": "futures_primary" | "non_futures_primary" | "futures_with_forex_illustration"
}
```

## For each strategy, extract these 8 fields

### 1. `higher_timeframe` — REQUIRED
The chart the speaker uses for direction or bias. One of: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`.

### 2. `lower_timeframe` — null OR a timeframe
The chart the speaker uses for the entry trigger (e.g. `1m` for entry, `1h` for bias).
Set null if the strategy uses only one timeframe.

### 3. `entry_rule` — REQUIRED, 1 sentence
The SPECIFIC trigger that fires the trade, in the speaker's own words.

Examples:
- "Previous 1H candle closes bullish → wait for the 1M pattern to print, then buy"
- "Wait for a liquidity sweep above prior day high, then short on the next 5M close below the sweep"
- "When price retests an order block in the killzone, enter on a 5M displacement candle"

### 4. `preferred_regime` — REQUIRED
What kind of market the strategy needs. One of: `trending`, `ranging`, `any`. If the speaker uses a more specific term, include it verbatim.

### 5. `stop` — object
The INITIAL stop placement. ⛔ **NEVER extract fixed-point stops** (e.g. "always 10 points"). If the speaker uses a fixed-point stop, set `anchor: null` AND add the strategy to `rejected_strategies[]` with reason `fixed_point_stop_not_supported`. Fixed stops are banned per CLAUDE.md §13 because they get blown out on volatility expansion.

Fields:
- **`anchor`**: ONE of these (priority order from institutional 2026 research):
  - `sweep_wick_below_entry` / `sweep_wick_above_entry` — stop beyond a liquidity sweep wick (highest priority — TradeDisciple 2026-03)
  - `ob_low` / `ob_high` — stop beyond an order block
  - `fvg_low` / `fvg_high` — stop beyond a fair value gap
  - `swing_low_below_entry` / `swing_high_above_entry` — stop beyond a swing point
  - `displacement_candle_low` / `displacement_candle_high` — stop beyond the displacement candle
  - `swing_after_sfp` — stop beyond the swing after a swing failure pattern
  - `atr_multiple` — stop is a fixed number of ATRs (dynamic, volatility-adjusted)
  - **null** if the speaker doesn't say where to put the initial stop (framework default kicks in: 1.5× ATR with structural ceiling)
- **`buffer_atr`**: number or null. Extra cushion beyond the anchor in ATR units (e.g. `0.25` if "a quarter ATR below the swing low").
- **`atr_multiplier`**: number ONLY when `anchor=atr_multiple` (e.g. `1.5` if "use a 1.5× ATR stop"). null otherwise.
- **`rationale`**: 1 sentence quoting the speaker on stop placement.

### 6. `stop_management` — null OR 1 sentence
Explicit rule for moving the stop AFTER entry. Examples:
- "Move stop to break-even at 1.5R, then no further management"
- "Trail with the previous 1H low"
- "Use a 2× ATR Chandelier trail once in profit"

Set null if the speaker uses no special management or only the default break-even-at-TP1 (the framework does this automatically).

### 7. `targets[]` — array, may be empty
Where the speaker is AIMING with this trade. Each entry:
- **`priority`**: integer 1, 2, 3 (priority order; primary target = priority 1)
- **`type`**: one of: `previous_daily_high` | `previous_daily_low` | `previous_weekly_high` | `previous_weekly_low` | `equal_highs` | `equal_lows` | `range_high` | `range_low` | `fibonacci_1618` | `r_multiple` | speaker's own term (snake_case)
- **`r_multiple`**: number if the speaker states an R-multiple target (e.g. `1.5` for "minimum 1.5R")
- **`rationale`**: 1 sentence quoting the speaker

Empty array if speaker doesn't mention targets (framework default Style C 33/33/33 takes over).

### 8. `confluences[]` — array, THE KEY FIELD
List EVERY condition the speaker says must be TRUE before they take a trade. This is the speaker's edge — capture it faithfully. Each entry:
- **`name`**: short snake_case label. Use the speaker's term if they named it; otherwise be descriptive.
- **`description`**: 1 sentence quoting the speaker.
- **`canonical_match`**: map to ONE of these 11 canonical factors if it fits, else null:
  - `market_structure_aligned` — HH/HL alignment, BOS, CHoCH, MSS
  - `liquidity_target_clear` — heading toward a specific level (PDH/PDL, equal highs/lows, naked POC)
  - `smt_confirmation` — cross-asset divergence (ES↔NQ, related markets)
  - `vwap_alignment` — relationship to VWAP (above/below, deviation bands)
  - `killzone_active` — specific time window (NY AM 09:30-11:30 ET, NY PM 13:30-15:30 ET)
  - `delta_or_volume_signature` — cumulative delta divergence, volume expansion
  - `vp_level_proximity` — at a Volume Profile level (POC, VAH, VAL)
  - `macro_alignment` — no scheduled FOMC/CPI/NFP blackout
  - `internals_aligned` — market breadth (TICK/ADD/VOLD/TRIN)
  - `cross_asset_aligned` — DXY/yields agree with bias
  - `regime_match` — current market regime matches strategy's preferred regime

Examples:
- "I only fire if the 4H is bullish too" → `canonical_match: "market_structure_aligned"`
- "I wait for the New York open" → `canonical_match: "killzone_active"`
- "Price needs to be at a key level" → `canonical_match: "vp_level_proximity"`
- "I avoid FOMC days" → `canonical_match: "macro_alignment"`
- "Continuation works better when markets are trending" → `canonical_match: "regime_match"`
- Speaker-unique (e.g. "I need the IRS Model to complete on the 4H") → keep speaker's verbatim name, `canonical_match: null`

If the speaker has NO explicit conditions, return `[]` (empty is honest — a kb_inferred safety net will fire downstream).

## Strategy `name`

Generate a snake_case name combining: speaker's pattern name + relevant timeframes. Examples:
- `hourly_candle_continuation_1m`
- `liquidity_sweep_then_displacement_15m_5m`
- `ict_bias_aligned_continuation_4h_15m`

Keep under 60 characters. If you can't generate a clean name, set `name: null` and the downstream pipeline will derive one from the entry_rule.

## What you DO NOT extract (framework owns these)

The framework wraps your output with these defaults automatically. Don't waste tokens extracting them:

- **`direction`** — derived from entry_rule keywords downstream (buy/sell/long/short). Defaults to `both`.
- **`exit_type` / `exit_params`** — framework stamps Style C 33/33/33 (TP1 33% @ 1R, TP2 33% @ 2R, runner 34% trails developing_session_poc).
- **`time_stop`** — framework stamps `15:55 ET hard_flatten` always.
- **`position_size`** — framework stamps risk-derived pyramid (base 6 MES / 6 MNQ / 18 MCL, +3 per +$3K profit).
- **`symbol`** — framework fans out to MES + MNQ + MCL variants. Cross-market demos (forex/stocks/crypto) default to MES.
- **`fixed_points` stops** — BANNED. If the speaker uses them, reject the strategy (see `stop.anchor` above).

## Rejections

If you find a strategy you can't extract, add it to `rejected_strategies[]` with one of these reasons:
- `fixed_point_stop_not_supported` — speaker uses a fixed-point stop
- `options_strategy` — speaker is teaching options (theta, Greeks, strikes — futures has none of that)
- `swing_or_overnight` — speaker holds trades for days/weeks (we close every trade by 3:55 PM ET)
- `forex_specific_mechanic` — speaker uses carry trade / swap / central-bank-intervention plays that only work in forex
- `stock_specific_mechanic` — speaker uses dividend capture / earnings plays / short-squeeze setups that only work with stocks
- `crypto_specific_mechanic` — speaker uses on-chain data / funding-rate arb / halving cycles that only work in crypto
- `not_enough_rules` — speaker hyped the strategy but never described how to actually trade it

## Instrument classification (top-level)

- `futures_primary` — speaker teaches a strategy that works on price charts (will work for MES/MNQ/MCL)
- `non_futures_primary` — speaker's strategy only works in a non-futures market (forex carry, stock dividends, crypto on-chain, etc.) → reject everything
- `futures_with_forex_illustration` — speaker demos on a forex chart but the mechanic is portable (most common case for the cross-market remap fallback)

## Why this prompt is short

Your job is to capture the speaker's **edge** — entry trigger, confluences, timeframes, stop anchor. Framework-overlay.ts handles the rest:
- Style C 33/33/33 exits stamped automatically
- 15:55 ET hard flatten stamped automatically
- Risk-derived pyramid sizing stamped automatically
- Lunch blackout 11:30-13:30 ET enforced at signal time (Pass K)
- PM size taper enforced at signal time (Pass K)
- 67% personal DLL halt enforced at execution time
- Daily 1-2 trade cap enforced at signal time (Pass K)
- Cross-market remap (forex/stock/crypto demo → MES) handled at the route layer

Just capture the speaker's edge. Everything else is automatic.
