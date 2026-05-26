# Strategy Rule Extraction — Phrase-to-Schema Mapping (v11)

> **Wave 26 Pass I (2026-05-26).** This KB card maps specific phrases speakers use in YouTube tutorials to
> exact schema fields in the v11 output. Use this as a lookup table when populating `entry_sequence`,
> `stop_loss`, `targets`, `filters`, `timeframes`, and `indicators_used`.
>
> **Loaded by:** `transcript_extractor` role at call time alongside `indicator-catalog.md`.
> **Purpose:** Ensure "to the T" extraction — the speaker's exact rules land in the correct schema fields,
> not abstracted away into a one-line archetype label.

---

## Entry Sequence Phrase → Schema Field

### Step 1 — HTF Bias / Trend Direction

| Speaker says... | `entry_sequence` step | `entry_sequence[].rule` (capture this) |
|---|---|---|
| "weekly + daily + 4H all trending same direction" | `name: "htf_bias_confirmed"` | Exact timeframes + what "trending" means (HH+HL or LH+LL) |
| "I need all higher timeframes aligned" | `name: "htf_bias_confirmed"` | Which TFs are checked |
| "HTF showing higher highs and higher lows" | `name: "htf_bias_confirmed"` | "higher highs + higher lows for long bias" |
| "market structure shift on the daily" | `name: "htf_bias_confirmed"` | "MSS on daily confirms bias direction" |
| "bias is set by the weekly and daily" | `name: "htf_bias_confirmed"` | Which TF is the bias anchor |
| "avoid when daily is neutral or ranging" | → `filters[]` with `type: "avoid_when", condition: "neutral_or_ranging_market"` | |

### Step 2 — Liquidity Raids, Sweeps, SFPs

| Speaker says... | `entry_sequence` step | `entry_sequence[].rule` (capture this) |
|---|---|---|
| "swing failure pattern" / "SFP" | `name: "liquidity_raid_sfp"` | Price raids swing high/low AND closes back through it |
| "wick takes everybody out then closes back" | `name: "liquidity_raid_sfp"` | "wick exceeds prior swing level then body closes back through — retail stopped out, institutional reversal trap" |
| "price sweeps the low and then closes above it" | `name: "liquidity_raid_sfp"` | Direction-specific SFP rule |
| "liquidity grab then reversal" | `name: "liquidity_raid_sfp"` | Grab + close sequence |
| "stop hunt at the equal highs/lows" | `name: "liquidity_raid_sfp"` | Equal H/L as the raid zone |
| "turtle soup" / "fake breakout" | `name: "liquidity_raid_sfp"` | Fake break + close back through |
| "equal highs raided then close below" | `name: "liquidity_raid_sfp"` | Specific equal-highs SFP |

### Step 3 — Displacement + FVG / Entry Trigger

| Speaker says... | `entry_sequence` step | `entry_sequence[].rule` (capture this) |
|---|---|---|
| "displacement candle" / "large body candle" | `name: "displacement_with_fvg_entry"` | Candle body size + FVG creation |
| "large body candle creates a fair value gap" | `name: "displacement_with_fvg_entry"` | "large-body candle creates FVG AND breaks market structure" |
| "enter inside the FVG" | `name: "displacement_with_fvg_entry"` | Entry zone = inside the FVG |
| "enter after price rejects from FVG" | `name: "displacement_with_fvg_entry"` | Entry = rejection from FVG boundary |
| "BOS on the lower timeframe after the raid" | `name: "bos_confirmation"` | BOS confirms directional commitment |
| "CHoCH after the sweep" | `name: "choch_confirmation"` | CHoCH is the first reversal signal |
| "MSS gives me the entry signal" | `name: "mss_confirmation"` | MSS = entry trigger |
| "enter on the FVG close" / "wait for price to fill the gap" | `name: "fvg_retrace_entry"` | FVG retrace = entry |

---

## Stop Loss Phrase → Schema Field

| Speaker says... | `stop_loss.anchor` | `stop_loss.rationale` |
|---|---|---|
| "stop below the swing low" / "stop below this low" | `"swing_low_below_entry"` | "below the swing low — structural invalidation point" |
| "stop below the swing that got swept" | `"swing_after_sfp"` | "below the SFP swing low — setup invalidated if price reclaims below" |
| "stop below the displacement candle" | `"displacement_candle_low"` | "below the candle that created the FVG — structure base" |
| "if price leaves the FVG I'm wrong" / "stop at FVG low" | `"fvg_low"` | "exit if price closes below the FVG — entry premise invalidated" |
| "stop above the swing high" | `"swing_high_above_entry"` | "above swing high — setup invalidated if exceeded" |
| "stop is 1.5 ATR" / "ATR-based stop" | `"atr_multiple"` with `buffer_atr: 1.5` | "1.5× ATR stop per speaker" |
| "stop at 10 ticks" / "12-point stop" | `"fixed_points"` | Quote speaker's exact distance |
| "stop below the order block" | `"ob_low"` | "below OB base — entry invalidated if structure fails" |

---

## Target Phrase → Schema Field

| Speaker says... | `targets[].type` | `targets[].rationale` |
|---|---|---|
| "equal highs" / "equal lows" | `"equal_highs_lows"` | "liquidity pools at equal high/low levels are the most reliable targets" |
| "those equal highs are my target" | `"equal_highs"` | "equal highs = liquidity above retail stops" |
| "targeting equal lows" | `"equal_lows"` | "equal lows = buy-stop liquidity below retail" |
| "previous day high" / "yesterday's high" / "PDH" | `"previous_daily_high"` | "prior day's high = institutional reference level" |
| "previous day low" / "PDL" | `"previous_daily_low"` | "prior day's low = institutional support" |
| "previous week high" / "PWH" | `"previous_weekly_high"` | "prior week's high = weekly liquidity" |
| "previous week low" / "PWL" | `"previous_weekly_low"` | "prior week's low = weekly support" |
| "top of the range" / "range high" | `"range_high"` | "range high = session ceiling liquidity" |
| "bottom of the range" / "range low" | `"range_low"` | "range low = session floor liquidity" |

**Priority ordering rule:** Speaker's first-mentioned target = priority 1. Equal highs/lows are typically priority 1 in ICT content because they are the nearest liquidity. Daily/weekly levels are priority 2-3 as swing targets.

---

## Filter Phrase → Schema Field

| Speaker says... | `filters[].type` | `filters[].condition` | `filters[].value` |
|---|---|---|---|
| "avoid when market is neutral or ranging" / "no clear HTF direction" | `"avoid_when"` | `"neutral_or_ranging_market"` | |
| "I don't trade when equal highs and lows on both sides" | `"avoid_when"` | `"equal_liquidity_both_sides"` | |
| "conflicting HTF structure" / "FVGs against each other" | `"avoid_when"` | `"conflicting_htf_structure_or_fvgs"` | |
| "minimum 2R" / "skip if R:R less than 2" | `"min_rr"` | | `2.0` |
| "need at least 3R" | `"min_rr"` | | `3.0` |
| "I don't trade FOMC" / "no CPI days" / "avoid news" | `"avoid_when"` | `"fomc_or_high_impact_news_day"` | |
| "only trade during NY session" / "New York AM only" | `"session_only"` | `"ny_am"` | |
| "only during killzone" | `"session_only"` | `"killzone_active"` | |
| "trending market required" / "skip if choppy" | `"regime_required"` | `"trending"` | |

---

## Timeframe Phrase → Schema Field

| Speaker says... | `timeframes` field | Values |
|---|---|---|
| "weekly, daily, 4H bias alignment" | `"bias"` | `["1w", "1d", "4h"]` |
| "daily and 4H for direction" | `"bias"` | `["1d", "4h"]` |
| "I check the 4-hour first" | `"bias"` | `["4h"]` |
| "drop to the 15-minute for the setup" | `"entry"` | `["15m"]` |
| "1-hour for entries" | `"entry"` | `["1h"]` |
| "enter on the 5-minute" / "5-minute trigger" | `"trigger"` | `["5m"]` |
| "1-minute for the exact entry" | `"trigger"` | `["1m"]` |

---

## dE4lPhAWke8 Reference Extraction (canonical fixture — "My Trading Strategy is Boring")

This is the gold-standard extraction for the video `dE4lPhAWke8`. Every v11 extraction of this transcript MUST match this template. Any deviation is an under-extraction.

```
STEP 1 — ENTRY SEQUENCE:
  Step 1 (htf_bias_confirmed): weekly + daily + 4H all trending same direction; higher highs + higher lows = long; lower highs + lower lows = short; avoid neutral/ranging
  Step 2 (liquidity_raid_sfp): old swing high or low gets raided (wick through), then price CLOSES BACK THROUGH the level — wick takes retail stops out, closure signals the institutional trap reversal
  Step 3 (displacement_with_fvg_entry): after SFP, large-body candle creates fair value gap AND breaks market structure; enter inside the FVG or after rejection from FVG; entry is during the displacement or on the FVG retrace

STEP 2 — STOP LOSS:
  Below the swing low for longs (the swing that got raided / the SFP swing low); above the swing high for shorts; rationale = invalidation of the SFP setup

STEP 3 — TARGETS:
  1. Equal highs / equal lows (speaker explicitly says these are the BEST targets)
  2. Previous daily high / low
  3. Previous weekly high / low

STEP 4 — FILTERS:
  - Avoid neutral/ranging markets (no clear HTF direction)
  - Avoid equal liquidity on both sides (market traps either direction)
  - Avoid conflicting HTF structure or opposing FVGs
  - Skip trade if R:R < 2 (speaker explicitly states minimum 2R requirement)

STEP 5 — TIMEFRAMES:
  Bias: weekly + daily + 4H
  Entry: 15m or 1H
  Trigger: 5m
```

Expected `entry_sequence` output:
```json
[
  { "step": 1, "name": "htf_bias_confirmed", "rule": "weekly + daily + 4H all trending same direction; higher highs + higher lows for long bias OR lower highs + lower lows for short bias; avoid neutral or ranging HTF", "indicators_needed": ["market_structure", "trend_continuity"] },
  { "step": 2, "name": "liquidity_raid_sfp", "rule": "price raids prior swing high (short) or swing low (long) AND closes back through that level — the wick takes retail stops out then the closure signals the institutional trap reversal", "indicators_needed": ["swing_highs_lows", "candle_closure"] },
  { "step": 3, "name": "displacement_with_fvg_entry", "rule": "after SFP, large-body displacement candle creates fair value gap AND breaks market structure; enter inside the FVG or after rejection from it", "indicators_needed": ["fair_value_gap", "displacement_candle", "market_structure_break"] }
]
```

Expected `targets` output:
```json
[
  { "priority": 1, "type": "equal_highs_lows", "rationale": "speaker explicitly says equal highs/lows are the best targets — they are liquidity magnets" },
  { "priority": 2, "type": "previous_daily_high" },
  { "priority": 3, "type": "previous_weekly_high" }
]
```

Expected `filters` output:
```json
[
  { "type": "avoid_when", "condition": "neutral_or_ranging_market", "rationale": "no clear HTF direction — coin toss" },
  { "type": "avoid_when", "condition": "equal_liquidity_both_sides", "rationale": "market traps either direction" },
  { "type": "avoid_when", "condition": "conflicting_htf_structure_or_fvgs" },
  { "type": "min_rr", "value": 2.0, "rationale": "speaker explicitly states skip trade if R:R less than 2" }
]
```

Expected `stop_loss` output:
```json
{ "anchor": "swing_after_sfp", "buffer_atr": 0.5, "rationale": "below the swing low that triggered the SFP — the setup invalidation point" }
```

Expected `timeframes` output:
```json
{ "bias": ["1w", "1d", "4h"], "entry": ["15m", "1h"], "trigger": ["5m"] }
```
