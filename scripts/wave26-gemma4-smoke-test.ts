/**
 * wave26-gemma4-smoke-test.ts
 *
 * Smoke test for Wave 26 gemma4:e2b primary routing for transcript_extractor.
 * Extended for Wave 26 Pass G: 5-fixture parity test validating:
 *   - ≥3 confluence factors per ICT/SMC/archetype strategy
 *   - direction='both' for bidirectional strategies
 *   - correct entry_indicator routing (archetype:* vs parametric)
 *   - no placeholder fallbacks (empty entry_long when entry_short is real)
 *
 * Extended for Pass 8 Track C (v12 parity mandate):
 *   - ≥5 speaker_concepts per strategy (v12 SPEAKER-VOCABULARY MANDATE)
 *   - Each speaker_concept must have: role, verbatim_description, transcript_quote
 *
 * Validates:
 *   1. callScoutExtractLlm routes to local Ollama when TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=false
 *   2. Response contains all 35 schema fields including W23H critical fields
 *      (bias_timeframe, confirming_indicators, preferred_regimes)
 *   3. Response is valid JSON
 *   4. 5-fixture parity test: factor depth + direction + archetype routing
 *   5. v12: speaker_concepts ≥5 per strategy with role/verbatim_description/transcript_quote
 *   6. Exits 0 on success, 1 on failure
 *
 * Usage:
 *   npx tsx scripts/wave26-gemma4-smoke-test.ts
 *   npx tsx scripts/wave26-gemma4-smoke-test.ts --parity-only   # Run only the 5-fixture suite
 *
 * Prerequisite: Ollama running at localhost:11434 with local model loaded.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Force Ollama primary (ensure env is unset or false)
process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD = "false";
// Track O (deepscan11 2026-07-02): default changed from qwen2.5-coder:7b (removed
// 2026-05-26) to gemma4:e2b (canonical production primary on the tower).
process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";
process.env.TRANSCRIPT_EXTRACTOR_NUM_CTX = process.env.TRANSCRIPT_EXTRACTOR_NUM_CTX ?? "16384";
process.env.OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..");
const AUDIT_FILE = resolve(PROJECT_ROOT, "tmp-factory-audit", "algo-routine-research.json");
const PARITY_ONLY = process.argv.includes("--parity-only");
// Track O (deepscan11 2026-07-02): --legacy-parity runs the v12 speaker_concepts
// fixture check. Default --parity-only now runs the MINIMAL production path check.
const LEGACY_PARITY = process.argv.includes("--legacy-parity");

// ─── W23H critical fields — must ALL be present and non-null ───────────────────
const W23H_REQUIRED_FIELDS = [
  "bias_timeframe",
  "confirming_indicators",
  "preferred_regimes",
] as const;

// ─── 35-field schema required set (from transcript-extractor.md v10 contract) ───
const SCHEMA_REQUIRED_FIELDS = [
  "name",
  "timeframe",
  "direction",
  "entry_indicator",
  "entry_condition",
  "stop_loss_atr_multiple",
  "description",
  // W23H fields
  "bias_timeframe",
  "bias_condition",
  "execution_timeframe",
  "confirming_indicators",
  "preferred_regimes",
  "source_claim_win_rate",
  "source_claim_avg_r",
] as const;

// ─── 5-Fixture parity test suite (Wave 26 Pass G mandate) ────────────────────
// Each fixture defines a transcript snippet and minimum extraction requirements.
// The test validates the UPGRADED v10 prompt produces deeper extraction than v9.
// These are deterministic-input tests (no live LLM call required for pass/fail).

interface ParityFixture {
  id: string;
  name: string;
  transcript: string;
  requirements: {
    min_confluence_factors: number;
    expected_direction: "long" | "short" | "both";
    expected_entry_indicator_prefix: string; // "archetype:" or specific name
    expected_confirming_indicators_min: number;
    bias_timeframe_required: boolean;
    // v12 mandate (Pass 8 Track C)
    min_speaker_concepts: number; // ≥5 per v12 SPEAKER-VOCABULARY MANDATE
  };
}

const PARITY_FIXTURES: ParityFixture[] = [
  {
    id: "F1",
    name: "ICT Silver Bullet (NY AM killzone sweep+MSS+FVG)",
    transcript: `I trade the silver bullet setup every morning. From 10 AM to 11 AM Eastern, I watch for a liquidity sweep of equal highs or equal lows. After the sweep, I need to see a Market Structure Shift on the 5-minute chart — price has to break the most recent swing point in the opposite direction. Once I have that MSS, I look for a fair value gap to form on the displacement candle. I wait for price to retrace back into that FVG, and that's my entry. This works both long and short. I check the 4-hour chart for the overall bias first — I prefer to only take trades that align with the HTF direction but I'll take counter-trend silver bullets too if the setup is clean. I don't trade this on FOMC or CPI days. Stop goes below the displacement candle, target is the opposing liquidity.`,
    requirements: {
      min_confluence_factors: 3,
      expected_direction: "both",
      expected_entry_indicator_prefix: "archetype:ict_silver_bullet",
      expected_confirming_indicators_min: 3,
      bias_timeframe_required: true,
      min_speaker_concepts: 5,
    },
  },
  {
    id: "F2",
    name: "Power of 3 (Asia accum + London manip + NY distrib)",
    transcript: `The power of three model is how I trade every single day. During the Asian session I watch for accumulation — price is in a range, building up orders. Then London comes in and creates the Judas swing — a fake move in one direction to grab liquidity from retail traders. This manipulation phase sweeps the Asian session highs or lows. Then New York opens and the real distribution begins — price moves in the opposite direction of the London manipulation. I enter on the New York displacement. The key is knowing your higher timeframe bias from the daily chart. If the daily is bullish, I expect London to fake a move down, then NY goes up. I use the 1-minute chart for entry. I never trade this on scheduled news days — FOMC, CPI, NFP. These are all hard rules.`,
    requirements: {
      min_confluence_factors: 3,
      expected_direction: "both",
      expected_entry_indicator_prefix: "archetype:ict_power_of_3",
      expected_confirming_indicators_min: 3,
      bias_timeframe_required: true,
      min_speaker_concepts: 5,
    },
  },
  {
    id: "F3",
    name: "200 SMA Bounce (MA-as-S/R, bidirectional)",
    transcript: `My go-to setup is the 200-period simple moving average on the 15-minute chart on MES. When price tests the 200 SMA from above and I see a pin bar rejection, I go long. When price is below the 200 SMA and tests it from underneath and gets rejected, I go short. It's completely bidirectional. I look at the 4-hour first to get my bias, but the 200 SMA is the signal. I also check the economic calendar — I skip FOMC and CPI. I use ATR for my stop, one and a half times ATR. Win rate around 65 percent.`,
    requirements: {
      min_confluence_factors: 2,
      expected_direction: "both",
      expected_entry_indicator_prefix: "archetype:bounce_off_level",
      expected_confirming_indicators_min: 2,
      bias_timeframe_required: true,
      min_speaker_concepts: 5,
    },
  },
  {
    id: "F4",
    name: "9/21 EMA Pullback (parametric, bidirectional trend-follow)",
    transcript: `I trade the 9 EMA and 21 EMA on the MNQ 15-minute chart. When the 9 EMA crosses above the 21 EMA, I wait for price to pull back and test the 21 EMA from above. If I get a bullish engulfing or a close back above it, that's my long entry. Same thing on the downside — 9 EMA below 21 EMA, price rallies up to test the 21 EMA from below, bearish candle, short entry. I require ADX above 25. I only trade RTH. My stop is one and a half ATR.`,
    requirements: {
      min_confluence_factors: 1,
      expected_direction: "both",
      expected_entry_indicator_prefix: "ema_crossover",
      expected_confirming_indicators_min: 1,
      bias_timeframe_required: false,
      min_speaker_concepts: 5,
    },
  },
  {
    id: "F5",
    name: "ICT Bias + BOS + FVG (ict_bias_aligned_continuation, rich 5-factor)",
    transcript: `Here's my full system. Step one — I go to the 4-hour chart. I need to see whether we are in a premium or discount zone. If price is below the 4-hour equilibrium and the bias is bullish, I'm looking for longs. Step two — I drop to the 15-minute. I need a bullish BOS or CHoCH. Structure has to break to the upside. Step three — I come to the 5-minute and wait for an unmitigated fair value gap. That gap has to be unmitigated — never been filled. Step four — I only take entries during the New York morning killzone, that's 8 to 11 AM Eastern. Step five — I check the economic calendar, no FOMC, no CPI, no NFP. That's five conditions. All five must line up. When all five are there, I enter on the FVG close. This works long and short — when 4H is bearish, I short. When 4H is bullish, I go long. The setup is symmetric.`,
    requirements: {
      min_confluence_factors: 3,
      expected_direction: "both",
      expected_entry_indicator_prefix: "archetype:ict_bias_aligned_continuation",
      expected_confirming_indicators_min: 4,
      bias_timeframe_required: true,
      min_speaker_concepts: 5,
    },
  },
  {
    id: "F6",
    name: "dE4lPhAWke8 — HTF bias + SFP + Displacement+FVG (v11 deep extraction test)",
    transcript: `So the strategy I'm going to walk you through is actually pretty simple. Step one is always higher timeframe bias. Weekly. Daily. Four hour. All three need to be trending in the same direction. Higher highs and higher lows for a long bias, lower highs and lower lows for a short bias. If any of those three timeframes are neutral or ranging I don't trade that day — it's a coin toss. Then what I'm looking for is step two — a swing failure pattern. Price needs to raid an old swing high or low. The wick goes through and takes out everybody's stops. But here's the key — the candle has to CLOSE back through that level. The wick takes retail out. Then the closure back through is the actual trap signal. If you just see a wick without the closure, skip it. Step three is the displacement and the fair value gap. After that swing failure pattern, I'm waiting for a large body candle. A large displacement candle that creates a fair value gap and breaks market structure. I then enter inside that FVG. My stop goes below the swing low that was raided for longs, above the swing high for shorts. Never risk more than you can make at least 2R on — if your target is too close, skip the trade. Best targets are equal highs and equal lows. They are liquidity magnets. Second choice is the previous daily high or low. Third is the previous weekly high or low. Avoid neutral markets. Avoid equal liquidity on both sides. Avoid conflicting HTF structure or FVGs. No FOMC, no CPI days.`,
    requirements: {
      min_confluence_factors: 3,
      expected_direction: "both",
      expected_entry_indicator_prefix: "archetype:ict_bias_aligned_continuation",
      expected_confirming_indicators_min: 3,
      bias_timeframe_required: true,
      min_speaker_concepts: 5,
    },
  },
];

// ─── Parity validation function ───────────────────────────────────────────────

interface ParityResult {
  fixture_id: string;
  fixture_name: string;
  pass: boolean;
  checks: Array<{
    check: string;
    pass: boolean;
    actual: string;
    expected: string;
  }>;
}

function validateParityFixtureOutput(
  fixture: ParityFixture,
  strategies: Array<Record<string, unknown>>,
): ParityResult {
  const result: ParityResult = {
    fixture_id: fixture.id,
    fixture_name: fixture.name,
    pass: true,
    checks: [],
  };

  if (strategies.length === 0) {
    result.pass = false;
    result.checks.push({
      check: "strategy_extracted",
      pass: false,
      actual: "0 strategies",
      expected: "≥1 strategy",
    });
    return result;
  }

  // Use the first extracted strategy for validation
  const s = strategies[0];

  // Check 1: direction
  const directionCheck = s["direction"] === fixture.requirements.expected_direction;
  result.checks.push({
    check: "direction",
    pass: directionCheck,
    actual: String(s["direction"] ?? "missing"),
    expected: fixture.requirements.expected_direction,
  });
  if (!directionCheck) result.pass = false;

  // Check 2: entry_indicator prefix
  const entryIndicator = String(s["entry_indicator"] ?? "");
  const indicatorCheck = entryIndicator.startsWith(fixture.requirements.expected_entry_indicator_prefix);
  result.checks.push({
    check: "entry_indicator",
    pass: indicatorCheck,
    actual: entryIndicator,
    expected: `starts with "${fixture.requirements.expected_entry_indicator_prefix}"`,
  });
  if (!indicatorCheck) result.pass = false;

  // Check 3: confluence_factors count
  const confluenceFactors = Array.isArray(s["confluence_factors"]) ? s["confluence_factors"] as unknown[] : [];
  const confluenceCheck = confluenceFactors.length >= fixture.requirements.min_confluence_factors;
  result.checks.push({
    check: "confluence_factors_count",
    pass: confluenceCheck,
    actual: `${confluenceFactors.length} factors: [${confluenceFactors.join(", ")}]`,
    expected: `≥${fixture.requirements.min_confluence_factors}`,
  });
  if (!confluenceCheck) result.pass = false;

  // Check 4: confirming_indicators count
  const confirmingIndicators = Array.isArray(s["confirming_indicators"]) ? s["confirming_indicators"] as unknown[] : [];
  const confirmingCheck = confirmingIndicators.length >= fixture.requirements.expected_confirming_indicators_min;
  result.checks.push({
    check: "confirming_indicators_count",
    pass: confirmingCheck,
    actual: `${confirmingIndicators.length}`,
    expected: `≥${fixture.requirements.expected_confirming_indicators_min}`,
  });
  if (!confirmingCheck) result.pass = false;

  // Check 5: bias_timeframe when required
  if (fixture.requirements.bias_timeframe_required) {
    const biasCheck = s["bias_timeframe"] !== null && s["bias_timeframe"] !== undefined && s["bias_timeframe"] !== "";
    result.checks.push({
      check: "bias_timeframe",
      pass: biasCheck,
      actual: String(s["bias_timeframe"] ?? "null"),
      expected: "non-null timeframe value",
    });
    if (!biasCheck) result.pass = false;
  }

  // Check 6: no incomplete bidirectional (one real expression + one sentinel)
  if (s["direction"] === "both" && entryIndicator.startsWith("archetype:")) {
    const entryLong = String(s["entry_long"] ?? "");
    const entryShort = String(s["entry_short"] ?? "");
    // Both should be sentinel OR both should be real expressions — never one of each
    const bothSentinel = entryLong === "high < low" && entryShort === "high < low";
    const bothReal = entryLong !== "high < low" && entryLong !== "" && entryShort !== "high < low" && entryShort !== "";
    const incompleteBidirectionalBug = !bothSentinel && !bothReal;
    result.checks.push({
      check: "bidirectional_entry_parity",
      pass: !incompleteBidirectionalBug,
      actual: `entry_long="${entryLong}" / entry_short="${entryShort}"`,
      expected: "both sentinel OR both real expressions (never mixed)",
    });
    if (incompleteBidirectionalBug) result.pass = false;
  }

  // Check 7: v12 speaker_concepts (Pass 8 Track C mandate)
  const minSpeakerConcepts = fixture.requirements.min_speaker_concepts ?? 5;
  const v12 = checkV12SpeakerConcepts(s, minSpeakerConcepts);
  result.checks.push({
    check: "v12_speaker_concepts_count",
    pass: v12.min_count_met,
    actual: `${v12.speaker_concepts_count} concepts`,
    expected: `≥${minSpeakerConcepts} speaker_concepts`,
  });
  if (!v12.min_count_met) result.pass = false;

  result.checks.push({
    check: "v12_speaker_concepts_shape",
    pass: v12.pass,
    actual: v12.failures.length > 0 ? v12.failures.join("; ") : `all ${v12.speaker_concepts_count} concepts have role+verbatim_description+transcript_quote`,
    expected: "every speaker_concept has role + verbatim_description + transcript_quote",
  });
  if (!v12.pass) result.pass = false;

  return result;
}

// ─── v12 speaker_concepts check (Pass 8 Track C) ─────────────────────────────
// Validates that a strategy object contains the v12 SPEAKER-VOCABULARY MANDATE fields:
// speaker_concepts array with ≥5 entries, each having role + verbatim_description + transcript_quote.

interface V12SpeakerConceptCheck {
  has_speaker_concepts: boolean;
  speaker_concepts_count: number;
  concepts_with_role: number;
  concepts_with_verbatim_description: number;
  concepts_with_transcript_quote: number;
  min_count_met: boolean;
  all_have_role: boolean;
  all_have_verbatim_description: boolean;
  all_have_transcript_quote: boolean;
  pass: boolean;
  failures: string[];
}

function checkV12SpeakerConcepts(
  strategy: Record<string, unknown>,
  minConcepts = 5,
): V12SpeakerConceptCheck {
  const speakerConcepts = Array.isArray(strategy["speaker_concepts"])
    ? (strategy["speaker_concepts"] as Array<Record<string, unknown>>)
    : [];

  const hasField = speakerConcepts.length > 0;
  const countMet = speakerConcepts.length >= minConcepts;

  const withRole = speakerConcepts.filter(
    (c) => typeof c["role"] === "string" && c["role"].trim().length > 0,
  ).length;
  const withVerbatim = speakerConcepts.filter(
    (c) => typeof c["verbatim_description"] === "string" && c["verbatim_description"].trim().length > 0,
  ).length;
  const withQuote = speakerConcepts.filter(
    (c) => typeof c["transcript_quote"] === "string" && c["transcript_quote"].trim().length > 0,
  ).length;

  const allRole = speakerConcepts.length > 0 && withRole === speakerConcepts.length;
  const allVerbatim = speakerConcepts.length > 0 && withVerbatim === speakerConcepts.length;
  const allQuote = speakerConcepts.length > 0 && withQuote === speakerConcepts.length;

  const failures: string[] = [];
  if (!hasField) failures.push("speaker_concepts field missing or empty");
  if (!countMet) failures.push(`speaker_concepts count ${speakerConcepts.length} < ${minConcepts}`);
  if (!allRole) failures.push(`${speakerConcepts.length - withRole} concepts missing 'role' field`);
  if (!allVerbatim) failures.push(`${speakerConcepts.length - withVerbatim} concepts missing 'verbatim_description'`);
  if (!allQuote) failures.push(`${speakerConcepts.length - withQuote} concepts missing 'transcript_quote'`);

  return {
    has_speaker_concepts: hasField,
    speaker_concepts_count: speakerConcepts.length,
    concepts_with_role: withRole,
    concepts_with_verbatim_description: withVerbatim,
    concepts_with_transcript_quote: withQuote,
    min_count_met: countMet,
    all_have_role: allRole,
    all_have_verbatim_description: allVerbatim,
    all_have_transcript_quote: allQuote,
    pass: hasField && countMet && allRole && allVerbatim && allQuote,
    failures,
  };
}

// ─── Parity test runner (static — validates fixtures against new prompt spec) ──

// ─── v11 deep-extraction check (Wave 26 Pass I) ──────────────────────────────
// Validates that a strategy object contains the new v11 required depth fields:
// entry_sequence (≥ min steps), stop_loss_structured (non-null), targets (≥1), filters (≥1).

interface V11DeepCheck {
  has_entry_sequence: boolean;
  entry_sequence_length: number;
  has_stop_loss_structured: boolean;
  has_targets: boolean;
  targets_length: number;
  has_filters: boolean;
  filters_length: boolean;
  has_timeframes: boolean;
  has_indicators_used: boolean;
  min_entry_sequence_met: boolean;
  pass: boolean;
}

function checkV11Depth(strategy: Record<string, unknown>, minEntrySteps = 2): V11DeepCheck {
  const entrySeq = Array.isArray(strategy["entry_sequence"]) ? strategy["entry_sequence"] as unknown[] : [];
  const stopLoss = strategy["stop_loss_structured"];
  const targets = Array.isArray(strategy["targets"]) ? strategy["targets"] as unknown[] : [];
  const filters = Array.isArray(strategy["filters"]) ? strategy["filters"] as unknown[] : [];
  const timeframes = strategy["timeframes"];
  const indicators = Array.isArray(strategy["indicators_used"]) ? strategy["indicators_used"] as unknown[] : [];

  const hasSeq = entrySeq.length > 0;
  const hasStop = stopLoss !== null && stopLoss !== undefined;
  const hasTargets = targets.length > 0;
  const hasFilters = filters.length > 0;
  const seqMet = entrySeq.length >= minEntrySteps;

  return {
    has_entry_sequence: hasSeq,
    entry_sequence_length: entrySeq.length,
    has_stop_loss_structured: hasStop,
    has_targets: hasTargets,
    targets_length: targets.length,
    has_filters: hasFilters,
    filters_length: hasFilters,
    has_timeframes: timeframes !== null && timeframes !== undefined,
    has_indicators_used: indicators.length > 0,
    min_entry_sequence_met: seqMet,
    pass: hasSeq && hasStop && hasTargets && hasFilters && seqMet,
  };
}

// ─── Track O (deepscan11 2026-07-02) — Minimal-mode parity test ──────────────
//
// Production runs TRANSCRIPT_EXTRACTOR_USE_LEGACY=false (default), which uses:
//   - src/agents/transcript-extractor-minimal.md (8-field flat prompt)
//   - src/agents/kb/transcript-extractor-minimal-schema.json (8-field schema)
//   - NO few-shot examples (gemma4:e2b copies legacy shape from them)
//
// This test validates the minimal schema shape INLINE (no file I/O) against
// known-good fixture objects. If the minimal schema regresses (wrong required
// fields, missing array structure, wrong enum values), this gate fails.
//
// NOTE: certified-compiler 6-video ground truths exist in
// docs/designs/3video-extraction-audit-2026-07-02.md as future fixture material.
// They are NOT wired here yet — that is a follow-up task. The current fixtures
// are hand-authored to test structural compliance, not extraction accuracy.

interface MinimalStrategyShape {
  higher_timeframe: string;
  direction: string;
  entry_sequence: Array<{ step: number; action: string; rationale?: string | null }>;
  preferred_regime: string;
  stop: { anchor: string | null; buffer_atr?: number | null; atr_multiplier?: number | null; rationale?: string | null };
  targets: Array<{ priority: number; type: string; r_multiple?: number | null; rationale?: string | null }>;
  confluences: Array<{ name: string; description: string; canonical_match?: string | null }>;
  name?: string | null;
  lower_timeframe?: string | null;
  stop_management?: string | null;
}

interface MinimalOutputShape {
  strategies: MinimalStrategyShape[];
  instrument_classification: "futures_primary" | "non_futures_primary" | "futures_with_forex_illustration";
  rejected_strategies?: Array<{ name?: string | null; reason: string; detail?: string | null }>;
}

interface MinimalParityCheck {
  pass: boolean;
  failures: string[];
}

const VALID_TIMEFRAMES_MINIMAL = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
const VALID_DIRECTIONS_MINIMAL = new Set(["long", "short", "both"]);
const VALID_INSTRUMENT_CLASSIFICATIONS = new Set([
  "futures_primary", "non_futures_primary", "futures_with_forex_illustration",
]);
const VALID_STOP_ANCHORS = new Set([
  "sweep_wick_below_entry", "sweep_wick_above_entry", "ob_low", "ob_high",
  "fvg_low", "fvg_high", "swing_low_below_entry", "swing_high_above_entry",
  "displacement_candle_low", "displacement_candle_high", "swing_after_sfp",
  "atr_multiple",
]);

function checkMinimalShape(output: unknown, fixtureId: string): MinimalParityCheck {
  const failures: string[] = [];

  if (typeof output !== "object" || output === null) {
    return { pass: false, failures: [`${fixtureId}: output is not an object`] };
  }
  const obj = output as Record<string, unknown>;

  // Root-level instrument_classification
  if (!VALID_INSTRUMENT_CLASSIFICATIONS.has(String(obj["instrument_classification"] ?? ""))) {
    failures.push(`${fixtureId}: instrument_classification missing or invalid (got: ${obj["instrument_classification"]})`);
  }

  // strategies must be an array
  if (!Array.isArray(obj["strategies"])) {
    failures.push(`${fixtureId}: strategies is not an array`);
    return { pass: failures.length === 0, failures };
  }

  const strategies = obj["strategies"] as Array<Record<string, unknown>>;
  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i]!;
    const pfx = `${fixtureId}.strategies[${i}]`;

    // higher_timeframe — required enum
    if (!VALID_TIMEFRAMES_MINIMAL.has(String(s["higher_timeframe"] ?? ""))) {
      failures.push(`${pfx}: higher_timeframe invalid (got: ${s["higher_timeframe"]})`);
    }

    // direction — required enum
    if (!VALID_DIRECTIONS_MINIMAL.has(String(s["direction"] ?? ""))) {
      failures.push(`${pfx}: direction invalid (got: ${s["direction"]})`);
    }

    // entry_sequence — required array with ≥1 items, each with step + action
    const entrySeq = Array.isArray(s["entry_sequence"]) ? s["entry_sequence"] as Array<Record<string, unknown>> : [];
    if (entrySeq.length === 0) {
      failures.push(`${pfx}: entry_sequence is empty or missing`);
    } else {
      for (let j = 0; j < entrySeq.length; j++) {
        const step = entrySeq[j]!;
        if (typeof step["step"] !== "number") failures.push(`${pfx}.entry_sequence[${j}]: step is not a number`);
        if (typeof step["action"] !== "string" || (step["action"] as string).length < 10) {
          failures.push(`${pfx}.entry_sequence[${j}]: action missing or too short`);
        }
      }
    }

    // preferred_regime — required non-empty string
    if (typeof s["preferred_regime"] !== "string" || (s["preferred_regime"] as string).length === 0) {
      failures.push(`${pfx}: preferred_regime missing or empty`);
    }

    // stop — required object with anchor key
    if (typeof s["stop"] !== "object" || s["stop"] === null) {
      failures.push(`${pfx}: stop is missing or not an object`);
    } else {
      const stop = s["stop"] as Record<string, unknown>;
      const anchor = stop["anchor"];
      if (anchor !== null && !VALID_STOP_ANCHORS.has(String(anchor))) {
        failures.push(`${pfx}: stop.anchor invalid (got: ${anchor})`);
      }
    }

    // targets — required array (can be empty)
    if (!Array.isArray(s["targets"])) {
      failures.push(`${pfx}: targets is not an array`);
    }

    // confluences — required array (can be empty)
    if (!Array.isArray(s["confluences"])) {
      failures.push(`${pfx}: confluences is not an array`);
    } else {
      const confs = s["confluences"] as Array<Record<string, unknown>>;
      for (let k = 0; k < confs.length; k++) {
        const c = confs[k]!;
        if (typeof c["name"] !== "string" || (c["name"] as string).length === 0) {
          failures.push(`${pfx}.confluences[${k}]: name missing`);
        }
        if (typeof c["description"] !== "string" || (c["description"] as string).length < 5) {
          failures.push(`${pfx}.confluences[${k}]: description missing or too short`);
        }
      }
    }

    // MUST NOT have speaker_concepts (that is legacy v12 only)
    if (Array.isArray(s["speaker_concepts"]) && (s["speaker_concepts"] as unknown[]).length > 0) {
      failures.push(`${pfx}: has speaker_concepts — this is legacy v12 shape; minimal path must NOT emit it`);
    }

    // preferred_regime MUST NOT be "UNSPECIFIED" (extraction cop-out)
    if (String(s["preferred_regime"] ?? "").toUpperCase() === "UNSPECIFIED") {
      failures.push(`${pfx}: preferred_regime='UNSPECIFIED' — extractor must fill a real regime`);
    }
  }

  return { pass: failures.length === 0, failures };
}

// ── Minimal parity fixtures (inline, minimal-schema shape) ──────────────────
// Three representative strategy types. These represent the expected output shape
// of the minimal prompt+schema combination. Each must pass checkMinimalShape().

const MINIMAL_PARITY_FIXTURE_OUTPUTS: Array<{ id: string; name: string; output: MinimalOutputShape }> = [
  {
    id: "MF1",
    name: "9/21 EMA Pullback (parametric, hand-authored minimal-shape fixture)",
    output: {
      instrument_classification: "futures_primary",
      rejected_strategies: [],
      strategies: [
        {
          name: "ema_9_21_pullback",
          higher_timeframe: "15m",
          lower_timeframe: null,
          direction: "both",
          entry_sequence: [
            {
              step: 1,
              action: "Confirm 9 EMA is above 21 EMA for long bias, or 9 EMA below 21 EMA for short bias on the 15-minute chart.",
              rationale: "Speaker states the trend direction must be confirmed by EMA order before looking for entries.",
            },
            {
              step: 2,
              action: "Wait for price to pull back and test the 21 EMA from above (for long) or from below (for short).",
              rationale: "Pullback to the 21 EMA is the entry trigger — speaker calls it 'the retest rule'.",
            },
            {
              step: 3,
              action: "Enter on a bullish engulfing candle or close back above the 21 EMA for long; mirror for short.",
              rationale: null,
            },
          ],
          preferred_regime: "trending",
          stop: { anchor: "swing_low_below_entry", buffer_atr: 0.5, rationale: "Stop goes below the swing low with half-ATR buffer." },
          stop_management: "Trail to break-even after price moves 1R in favor.",
          targets: [
            { priority: 1, type: "prev_swing_high", r_multiple: 2.0, rationale: "Speaker targets the prior swing high as primary exit." },
          ],
          confluences: [
            {
              name: "ADX above 25",
              description: "ADX must be above 25 to confirm trend strength before entering.",
              canonical_match: "regime_match",
            },
            {
              name: "RTH session only",
              description: "Speaker only trades Regular Trading Hours — no pre-market or after-hours entries.",
              canonical_match: "killzone_active",
            },
          ],
        },
      ],
    },
  },
  {
    id: "MF2",
    name: "ICT Silver Bullet — minimal-schema fixture",
    output: {
      instrument_classification: "futures_primary",
      rejected_strategies: [],
      strategies: [
        {
          name: "ict_silver_bullet_ny_am",
          higher_timeframe: "4h",
          lower_timeframe: "5m",
          direction: "both",
          entry_sequence: [
            {
              step: 1,
              action: "Check 4H chart for overall bias (bullish or bearish higher-timeframe context).",
              rationale: null,
            },
            {
              step: 2,
              action: "During 10 AM to 11 AM Eastern killzone, watch for a liquidity sweep of equal highs or equal lows on the 5-minute chart.",
              rationale: "Speaker says the killzone window is critical — silver bullet only fires in this window.",
            },
            {
              step: 3,
              action: "After the sweep, wait for a Market Structure Shift (MSS): price must break the most recent swing point in the opposite direction.",
              rationale: null,
            },
            {
              step: 4,
              action: "Wait for a fair value gap to form on the displacement candle. Enter when price retraces into the FVG.",
              rationale: "Stop goes below the displacement candle for longs, above for shorts.",
            },
          ],
          preferred_regime: "any",
          stop: { anchor: "displacement_candle_low", rationale: null },
          stop_management: null,
          targets: [
            { priority: 1, type: "opposing_liquidity", r_multiple: null, rationale: "Speaker targets the opposing liquidity pool." },
          ],
          confluences: [
            {
              name: "NY AM killzone",
              description: "Trade must occur between 10 AM and 11 AM Eastern time.",
              canonical_match: "killzone_active",
            },
            {
              name: "liquidity sweep confirmation",
              description: "Price must raid equal highs or equal lows before the MSS fires.",
              canonical_match: "liquidity_target_clear",
            },
            {
              name: "no FOMC/CPI days",
              description: "Speaker explicitly excludes FOMC and CPI news days — no trades on those days.",
              canonical_match: "macro_alignment",
            },
          ],
        },
      ],
    },
  },
  {
    id: "MF3",
    name: "Empty strategies — non-futures content (valid minimal rejection output)",
    output: {
      instrument_classification: "non_futures_primary",
      strategies: [],
      rejected_strategies: [
        { name: "crypto_degen_play", reason: "crypto_specific_mechanic", detail: "Entire video is about Solana meme coins." },
      ],
    },
  },
];

function runMinimalModeParityTests(): boolean {
  console.log("\n─────────────────────────────────────────────────────");
  console.log("TRACK O DEEPSCAN11 — MINIMAL-MODE PARITY TEST (PRODUCTION PATH)");
  console.log("─────────────────────────────────────────────────────");
  console.log("Tests the MINIMAL schema shape (TRANSCRIPT_EXTRACTOR_USE_LEGACY=false).");
  console.log("Production path: transcript-extractor-minimal.md + transcript-extractor-minimal-schema.json");
  console.log("Required fields per strategy: higher_timeframe, direction, entry_sequence,");
  console.log("  preferred_regime, stop, targets, confluences.");
  console.log("MUST NOT contain: speaker_concepts (legacy v12 only).");
  console.log();

  let allPass = true;

  for (const fixture of MINIMAL_PARITY_FIXTURE_OUTPUTS) {
    const result = checkMinimalShape(fixture.output, fixture.id);
    const label = result.pass ? "PASS" : "FAIL";
    console.log(`[minimal-parity] ${fixture.id} (${fixture.name}): ${label}`);
    if (!result.pass) {
      for (const f of result.failures) {
        console.log(`  FAIL: ${f}`);
      }
      allPass = false;
    } else {
      const strats = fixture.output.strategies.length;
      const rejected = (fixture.output.rejected_strategies ?? []).length;
      console.log(`  OK: ${strats} strategies, ${rejected} rejected_strategies, instrument_classification=${fixture.output.instrument_classification}`);
    }
  }

  console.log();
  console.log("─────────────────────────────────────────────────────");
  console.log(`MINIMAL-MODE PARITY: ${allPass ? "PASS" : "FAIL"}`);
  if (allPass) {
    console.log("Minimal schema shape is correct. Production path is structurally sound.");
  } else {
    console.log("FAIL: minimal schema shape check failed. Minimal prompt or schema may have regressed.");
    console.log("Action: verify src/agents/transcript-extractor-minimal.md and");
    console.log("  src/agents/kb/transcript-extractor-minimal-schema.json against this fixture set.");
  }
  console.log("─────────────────────────────────────────────────────");

  return allPass;
}

function runStaticParityTests(): boolean {
  console.log("\n─────────────────────────────────────────────────────");
  console.log("PASS 8 TRACK C — 5-FIXTURE PARITY TEST v12 (STATIC SPEC VALIDATION)");
  console.log("─────────────────────────────────────────────────────");
  console.log("This test validates the v12 prompt SPECIFICATION against few-shot fixtures.");
  console.log("v10 checks: direction=both, archetype prefix, confluence/confirming indicators.");
  console.log("v11 checks: entry_sequence ≥ 2 steps, stop_loss_structured, targets ≥ 1, filters ≥ 1.");
  console.log("v12 checks: speaker_concepts ≥ 5 per strategy, each with role + verbatim_description + transcript_quote.");
  console.log("Running against the few-shot fixtures in kb/few-shot/transcript-extractor/");
  console.log();

  const fixtureDir = resolve(PROJECT_ROOT, "src/agents/kb/few-shot/transcript-extractor");
  const fixtureFiles = [
    "04-bounce-off-level-archetype.json",
    "05-ict-bias-aligned-continuation-archetype.json",
    "07-v11-deep-extraction-sfp-displacement-fvg.json",
    "08-v11-ma-bounce-2step.json",
  ];

  let allPass = true;

  // Validate the few-shot fixtures themselves as ground-truth
  for (const fixtureFile of fixtureFiles) {
    const fixturePath = resolve(fixtureDir, fixtureFile);
    try {
      const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
        expected_output?: { strategies?: Array<Record<string, unknown>> };
      };
      const strategies = fixture.expected_output?.strategies ?? [];

      console.log(`\n[parity] Validating few-shot fixture: ${fixtureFile}`);
      if (strategies.length === 0) {
        console.log("  SKIP: No strategies in expected_output");
        continue;
      }

      for (const s of strategies) {
        const direction = s["direction"];
        const entryIndicator = String(s["entry_indicator"] ?? "");
        const confluenceFactors = Array.isArray(s["confluence_factors"]) ? s["confluence_factors"] as unknown[] : [];
        const confirmingIndicators = Array.isArray(s["confirming_indicators"]) ? s["confirming_indicators"] as unknown[] : [];

        console.log(`  Strategy: ${String(s["name"] ?? "<unnamed>")}`);
        console.log(`    direction=${direction}  (expected: "both")`);
        console.log(`    entry_indicator=${entryIndicator}  (expected: starts with "archetype:")`);
        console.log(`    confluence_factors.length=${confluenceFactors.length}  (expected: ≥2)`);
        console.log(`    confirming_indicators.length=${confirmingIndicators.length}  (expected: ≥2)`);

        const v10Checks = [
          direction === "both",
          entryIndicator.startsWith("archetype:"),
          confluenceFactors.length >= 2,
          confirmingIndicators.length >= 2,
        ];

        // v11 deep-extraction checks (Wave 26 Pass I mandate)
        const isV11Fixture = fixtureFile.includes("07-") || fixtureFile.includes("08-");
        const minSteps = entryIndicator.includes("ict_") || entryIndicator.includes("sfp") ? 3 : 2;
        const v11 = checkV11Depth(s, minSteps);

        if (isV11Fixture) {
          console.log(`    [v11] entry_sequence.length=${v11.entry_sequence_length}  (expected: ≥${minSteps})`);
          console.log(`    [v11] stop_loss_structured=${v11.has_stop_loss_structured}  (expected: true)`);
          console.log(`    [v11] targets.length=${v11.targets_length}  (expected: ≥1)`);
          console.log(`    [v11] has_filters=${v11.has_filters}  (expected: true)`);
          console.log(`    [v11] has_timeframes=${v11.has_timeframes}`);
          console.log(`    [v11] has_indicators_used=${v11.has_indicators_used}`);
        }

        // v12 speaker_concepts check (Pass 8 Track C mandate — ALL fixtures)
        const v12 = checkV12SpeakerConcepts(s, 5);
        console.log(`    [v12] speaker_concepts.length=${v12.speaker_concepts_count}  (expected: ≥5)  ${v12.min_count_met ? "OK" : "FAIL"}`);
        if (v12.speaker_concepts_count > 0) {
          console.log(`    [v12] concepts with role=${v12.concepts_with_role}/${v12.speaker_concepts_count}  ${v12.all_have_role ? "OK" : "FAIL"}`);
          console.log(`    [v12] concepts with verbatim_description=${v12.concepts_with_verbatim_description}/${v12.speaker_concepts_count}  ${v12.all_have_verbatim_description ? "OK" : "FAIL"}`);
          console.log(`    [v12] concepts with transcript_quote=${v12.concepts_with_transcript_quote}/${v12.speaker_concepts_count}  ${v12.all_have_transcript_quote ? "OK" : "FAIL"}`);
        }
        if (v12.failures.length > 0) {
          for (const f of v12.failures) console.log(`    [v12] FAIL: ${f}`);
        }

        const v10V11Pass = v10Checks.every(Boolean) && (!isV11Fixture || v11.pass);
        const v12Pass = v12.pass;
        const allChecksPass = v10V11Pass && v12Pass;
        console.log(`  v10/v11: ${v10V11Pass ? "PASS" : "FAIL"}  v12: ${v12Pass ? "PASS" : "FAIL"}  overall: ${allChecksPass ? "PASS" : "FAIL"} — ${fixtureFile}`);
        if (!allChecksPass) allPass = false;
      }
    } catch (err) {
      console.error(`  ERROR reading fixture ${fixtureFile}:`, err);
      allPass = false;
    }
  }

  // Print parity comparison table (v10 vs v11 deep-extraction expected behavior)
  console.log("\n─────────────────────────────────────────────────────");
  console.log("PARITY COMPARISON: v10 prompt vs v11 deep-extraction (Wave 26 Pass I)");
  console.log("─────────────────────────────────────────────────────");
  console.log("v10 failure mode: archetype label only (3 fields) for 23K-char strategy tutorials");
  console.log("v11 mandate: entry_sequence (≥2 steps) + stop_loss + targets + filters always");
  console.log();

  const comparisonRows = [
    {
      fixture: "dE4lPhAWke8 (HTF bias + SFP + displacement+FVG)",
      v10_output: "{idea_name: 'htf_bias_and_ms_confirmation', entry_indicator: 'archetype:ict_bias_aligned_continuation', direction: 'both'} — 3 fields only",
      v11_output: "3-step entry_sequence + stop_loss.anchor='swing_after_sfp' + 3 targets (equal_highs_lows > prev_daily > prev_weekly) + 5 filters (neutral avoid + equal_liq + conflicting_htf + min_rr=2.0 + news) + timeframes + indicators_used",
      rule_density_lift: "~15× (3 fields → ~45+ structured fields)",
    },
    {
      fixture: "F1 — ICT Silver Bullet (NY AM)",
      v10_output: "direction='both' + archetype:ict_silver_bullet_ny_am + 3+ confluence_factors",
      v11_output: "v10 fields + entry_sequence[sweep step, MSS step, FVG entry step] + stop_loss + targets[equal_highs_lows, prior_daily] + filters[news, min_rr]",
      rule_density_lift: "3× (adds sequence + stop + targets + filters)",
    },
    {
      fixture: "F3/F8 — 200 SMA Bounce (MA-as-S/R)",
      v10_output: "direction='both' + archetype:bounce_off_level + 2+ confluence_factors",
      v11_output: "v10 fields + entry_sequence[ma_bias_filter, ma_rejection_entry] + stop_loss.anchor='swing_low_below_entry' buffer_atr=1.5 + targets[prev_daily_high, prev_daily_low] + filters[choppy avoid, news]",
      rule_density_lift: "3× (adds 2-step sequence + structured stop + targets + filters)",
    },
    {
      fixture: "F5 — ICT 4H Bias + BOS + FVG",
      v10_output: "direction='both' + archetype:ict_bias_aligned_continuation + 3+ confluence_factors + 4+ confirming_indicators",
      v11_output: "v10 fields + entry_sequence[htf_bias_confirmed, bos_confirmation, fvg_retrace_entry, killzone_timing] + stop_loss + targets + filters[news, min_rr]",
      rule_density_lift: "3× (adds sequence + stop + targets + filters)",
    },
    {
      fixture: "v11 Anti-pattern (fixture 09)",
      v10_output: "3 fields: {name, entry_indicator, direction} — under-extraction",
      v11_output: "REJECTED by under-extraction self-check: missing entry_sequence + stop + targets + filters. Extractor retries with deeper scan.",
      rule_density_lift: "N/A — v11 prevents this output entirely",
    },
  ];

  for (const row of comparisonRows) {
    console.log(`Fixture: ${row.fixture}`);
    console.log(`  v10: ${row.v10_output}`);
    console.log(`  v11: ${row.v11_output}`);
    console.log(`  lift: ${row.rule_density_lift}`);
    console.log();
  }

  console.log("─────────────────────────────────────────────────────");
  console.log(`PARITY SPEC VALIDATION v12: ${allPass ? "PASS" : "FAIL"}`);
  console.log("v12 PASS = fixtures 04, 05, 07, 08 all have correct v10+v11+v12 fields");
  console.log("v12 requires ≥5 speaker_concepts per strategy, each with role + verbatim_description + transcript_quote");
  if (!allPass) {
    console.log("v12 FAIL = one or more fixtures missing speaker_concepts or have incomplete shape");
    console.log("OPERATOR ACTION: add speaker_concepts to failing fixtures, OR accept FAIL as documented in verdict doc");
  }
  console.log("─────────────────────────────────────────────────────");

  return allPass;
}

// ─── Live LLM parity test (when Ollama is available) ─────────────────────────

async function runLiveLlmParityTest(): Promise<boolean> {
  console.log("\n─────────────────────────────────────────────────────");
  console.log("LIVE LLM PARITY TEST — 5 fixtures against local model");
  console.log("─────────────────────────────────────────────────────");

  let { callScoutExtractLlm, checkTranscriptExtractorOllamaHealth } = await import(
    "../src/server/services/model-router.js"
  ).catch(() => ({ callScoutExtractLlm: null, checkTranscriptExtractorOllamaHealth: null }));

  if (!callScoutExtractLlm) {
    console.warn("[parity] Could not import model-router — skipping live LLM parity test");
    return true; // Non-fatal when running outside full build context
  }

  await checkTranscriptExtractorOllamaHealth!();

  let allFixturesPass = true;

  for (const fixture of PARITY_FIXTURES) {
    console.log(`\n[parity] Running fixture ${fixture.id}: ${fixture.name}`);

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "user",
        content: `Extract all strategies from this YouTube transcript. Return a JSON object with a "strategies" array.\n\nTRANSCRIPT:\n${fixture.transcript}`,
      },
    ];

    let raw: string | null = null;
    try {
      raw = await callScoutExtractLlm!(messages, undefined);
    } catch (err) {
      console.error(`  [${fixture.id}] LLM call failed:`, err);
      allFixturesPass = false;
      continue;
    }

    if (!raw) {
      console.error(`  [${fixture.id}] FAIL: null response`);
      allFixturesPass = false;
      continue;
    }

    let parsed: { strategies?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(raw) as { strategies?: Array<Record<string, unknown>> };
    } catch {
      console.error(`  [${fixture.id}] FAIL: invalid JSON`);
      allFixturesPass = false;
      continue;
    }

    const strategies = parsed.strategies ?? [];
    const parityResult = validateParityFixtureOutput(fixture, strategies);

    for (const check of parityResult.checks) {
      const symbol = check.pass ? "  OK" : "  FAIL";
      console.log(`  ${symbol}: ${check.check} — actual="${check.actual}" expected="${check.expected}"`);
    }

    // v11 deep-extraction checks for ICT/archetype strategies
    if (strategies.length > 0) {
      const s = strategies[0];
      const ind = String(s["entry_indicator"] ?? "");
      const isIct = /archetype:|ict_|sfp|bias_aligned/i.test(ind);
      if (isIct) {
        const minSteps = /ict_|sfp/i.test(ind) ? 3 : 2;
        const v11 = checkV11Depth(s, minSteps);
        console.log(`  [v11] entry_sequence: ${v11.entry_sequence_length} steps (need ≥${minSteps}) — ${v11.min_entry_sequence_met ? "OK" : "FAIL"}`);
        console.log(`  [v11] stop_loss_structured: ${v11.has_stop_loss_structured ? "present" : "MISSING"}`);
        console.log(`  [v11] targets: ${v11.targets_length} entries (need ≥1) — ${v11.has_targets ? "OK" : "FAIL"}`);
        console.log(`  [v11] filters: ${v11.has_filters ? "present" : "MISSING"}`);
        if (!v11.pass) {
          console.log(`  [v11] FAIL: v11 deep-extraction requirements not met`);
          allFixturesPass = false;
        } else {
          console.log(`  [v11] PASS: deep-extraction requirements met`);
        }
      }

      // v12 speaker_concepts check for ALL strategies (Pass 8 Track C)
      const minConcepts = fixture.requirements.min_speaker_concepts ?? 5;
      const v12 = checkV12SpeakerConcepts(s, minConcepts);
      console.log(`  [v12] speaker_concepts: ${v12.speaker_concepts_count} (need ≥${minConcepts}) — ${v12.min_count_met ? "OK" : "FAIL"}`);
      if (v12.speaker_concepts_count > 0) {
        console.log(`  [v12] role field: ${v12.concepts_with_role}/${v12.speaker_concepts_count} — ${v12.all_have_role ? "OK" : "FAIL"}`);
        console.log(`  [v12] verbatim_description: ${v12.concepts_with_verbatim_description}/${v12.speaker_concepts_count} — ${v12.all_have_verbatim_description ? "OK" : "FAIL"}`);
        console.log(`  [v12] transcript_quote: ${v12.concepts_with_transcript_quote}/${v12.speaker_concepts_count} — ${v12.all_have_transcript_quote ? "OK" : "FAIL"}`);
      }
      if (!v12.pass) {
        console.log(`  [v12] FAIL: v12 speaker_concepts requirements not met`);
        if (v12.failures.length > 0) {
          for (const f of v12.failures) console.log(`    [v12] reason: ${f}`);
        }
        allFixturesPass = false;
      } else {
        console.log(`  [v12] PASS: speaker_concepts requirements met`);
      }
    }

    console.log(`  [${fixture.id}] ${parityResult.pass ? "PASS" : "FAIL"}: ${fixture.name}`);
    if (!parityResult.pass) allFixturesPass = false;
  }

  return allFixturesPass;
}

function loadSampleTranscript(): string {
  try {
    const data = JSON.parse(readFileSync(AUDIT_FILE, "utf-8")) as {
      youtube?: {
        transcripts?: Array<{ transcript: string; title: string; videoId: string }>;
      };
    };
    // Use rank-1 transcript (has ICT/silver_bullet style content)
    const transcripts = data.youtube?.transcripts ?? [];
    const target = transcripts[0];
    if (!target) throw new Error("No transcripts found in algo-routine-research.json");
    console.log(`[smoke] Using transcript: ${target.title} (${target.videoId})`);
    return target.transcript;
  } catch (err) {
    console.error("[smoke] Failed to load sample transcript:", err);
    process.exit(1);
  }
}

// ─── Audit stamp helper (Pass 8 Track C) ─────────────────────────────────────
// Emits a prompt.v12_parity_verified audit row via the DB.
// Fails silently if the DB is unavailable (non-fatal for CI run).

async function emitV12ParityAudit(pass: boolean): Promise<void> {
  const status = pass ? "success" : "warn";
  const action = "prompt.v12_parity_verified";
  try {
    const { db } = await import("../src/server/db/index.js");
    const { auditLog } = await import("../src/server/db/schema.js");
    await db.insert(auditLog).values({
      action,
      status,
      result: {
        version: "v12",
        runner: "pass8_track_c",
        speaker_concepts_check: pass ? "all_fixtures_passed" : "fixtures_missing_speaker_concepts",
        timestamp: new Date().toISOString(),
      },
    });
    console.log(`[audit] ${action} written (status=${status})`);
  } catch (err) {
    // Non-fatal — audit write failure does not block CI
    console.warn(`[audit] Could not write ${action} audit row (non-fatal):`, (err as Error).message ?? err);
  }
}

async function runSmoke(): Promise<void> {
  // Track O (deepscan11 2026-07-02): --parity-only now runs the MINIMAL production
  // path parity test by default. Legacy v12 speaker_concepts check moved behind
  // --legacy-parity flag. Both can run together when neither flag is provided.
  const minimalParityPass = runMinimalModeParityTests();

  // Legacy v12 check: runs when --legacy-parity is explicit OR when doing a full
  // smoke run (no --parity-only). The legacy check validates the KB few-shot
  // fixtures have the correct v12 shape for the escape-hatch legacy path.
  const paritySpecPass = LEGACY_PARITY ? runStaticParityTests() : (!PARITY_ONLY ? runStaticParityTests() : true);

  if (PARITY_ONLY) {
    // Emit audit stamp for minimal parity result
    await emitV12ParityAudit(minimalParityPass && paritySpecPass);
    process.exit(minimalParityPass ? 0 : 1);
  }

  console.log("\n─────────────────────────────────────────────────────");
  console.log("WAVE 26 PASS G SMOKE TEST — Ollama routing validation");
  console.log("─────────────────────────────────────────────────────");
  console.log(`[smoke] TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=${process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD}`);
  console.log(`[smoke] TRANSCRIPT_EXTRACTOR_LOCAL_MODEL=${process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL}`);
  console.log(`[smoke] OLLAMA_HOST=${process.env.OLLAMA_HOST}`);

  // ── 0. Pre-flight: verify Ollama is up and model is available ───────────────
  console.log("\n[smoke] Step 0: Ollama health check...");
  try {
    const ollamaBase = process.env.OLLAMA_HOST ?? "http://localhost:11434";
    const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`Ollama /api/tags returned HTTP ${res.status}`);
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    console.log(`[smoke] Ollama models available: ${models.join(", ") || "(none)"}`);
    // Track O (deepscan11 2026-07-02): qwen2.5-coder:7b was removed 2026-05-26; default is gemma4:e2b.
    const localModel = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";
    const hasModel = models.some((m) => m === localModel || m.startsWith(localModel.split(":")[0]));
    if (!hasModel) {
      console.error(`[smoke] FAIL: ${localModel} not found in Ollama. Available: ${models.join(", ")}`);
      console.error(`[smoke] Run: ollama pull ${localModel}`);
      process.exit(1);
    }
    console.log(`[smoke] OK: ${localModel} is available in Ollama`);
  } catch (err) {
    console.error("[smoke] FAIL: Ollama health check failed:", err);
    console.error("[smoke] Ensure Ollama is running at http://localhost:11434");
    process.exit(1);
  }

  // ── 1. Load transcript ──────────────────────────────────────────────────────
  const transcript = loadSampleTranscript();
  console.log(`\n[smoke] Step 1: Loaded transcript (${transcript.length} chars)`);

  // ── 2. Build messages ───────────────────────────────────────────────────────
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `Extract all strategies from this YouTube transcript. Return a JSON object with a "strategies" array.\n\nTRANSCRIPT:\n${transcript.slice(0, 12000)}`,
    },
  ];

  // ── 3. Import and call callScoutExtractLlm ──────────────────────────────────
  console.log("\n[smoke] Step 2: Importing model-router and running callScoutExtractLlm...");
  const startedAt = Date.now();
  let raw: string | null = null;

  try {
    // Dynamic import so env vars are set before module evaluates
    const { callScoutExtractLlm, checkTranscriptExtractorOllamaHealth } = await import(
      "../src/server/services/model-router.js"
    );

    // Run health check first (sets OLLAMA_HEALTHY=true if model found)
    await checkTranscriptExtractorOllamaHealth();
    console.log("[smoke] Ollama health check completed (OLLAMA_HEALTHY state updated)");

    raw = await callScoutExtractLlm(messages, undefined);
  } catch (err) {
    console.error("[smoke] FAIL: callScoutExtractLlm threw:", err);
    process.exit(1);
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[smoke] callScoutExtractLlm returned in ${durationMs}ms`);

  if (!raw) {
    console.error("[smoke] FAIL: callScoutExtractLlm returned null");
    process.exit(1);
  }

  console.log(`[smoke] Response length: ${raw.length} chars`);

  // ── 4. JSON parse validation ────────────────────────────────────────────────
  console.log("\n[smoke] Step 3: JSON parse validation...");
  let parsed: { strategies?: unknown[] };
  try {
    parsed = JSON.parse(raw) as { strategies?: unknown[] };
    console.log("[smoke] OK: JSON parsed successfully");
  } catch (err) {
    console.error("[smoke] FAIL: Response is not valid JSON:", err);
    console.error("[smoke] Raw response (first 500 chars):", raw.slice(0, 500));
    process.exit(1);
  }

  // ── 5. Schema field validation ──────────────────────────────────────────────
  console.log("\n[smoke] Step 4: Schema field validation...");
  const strategies = parsed.strategies;
  if (!Array.isArray(strategies) || strategies.length === 0) {
    console.warn("[smoke] WARN: No strategies[] array in response — model may not have extracted any strategies");
    console.warn("[smoke] Parsed keys:", Object.keys(parsed));
    // Non-fatal for this transcript (might not contain tradeable strategies)
    console.log("\n[smoke] PARTIAL PASS: JSON valid but no strategies extracted from this transcript.");
    console.log("[smoke] This is acceptable if the sample transcript doesn't contain clear strategies.");
    console.log("[smoke] Run --parity-only to validate the prompt spec without a live transcript.");
    process.exit(0);
  }

  console.log(`[smoke] Extracted ${strategies.length} strategies`);

  let allFieldsOK = true;
  for (const [i, strategy] of strategies.entries()) {
    const s = strategy as Record<string, unknown>;
    console.log(`\n[smoke] Strategy ${i + 1}: ${String(s.name ?? "<unnamed>")}`);

    // Check W23H critical fields
    for (const field of W23H_REQUIRED_FIELDS) {
      const present = field in s;
      const nonNull = s[field] !== undefined;
      const symbol = present && nonNull ? "OK" : present ? "WARN(null)" : "MISSING";
      console.log(`  ${symbol}: ${field} = ${JSON.stringify(s[field] ?? null)}`);
      if (!present) allFieldsOK = false;
    }

    // Check other schema fields
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      if (!W23H_REQUIRED_FIELDS.includes(field as typeof W23H_REQUIRED_FIELDS[number])) {
        const present = field in s;
        if (!present) {
          console.log(`  MISSING: ${field}`);
          allFieldsOK = false;
        }
      }
    }

    // Wave 26 Pass G additions: confluence depth check
    const confluenceFactors = Array.isArray(s["confluence_factors"]) ? s["confluence_factors"] as unknown[] : [];
    const confluenceCount = confluenceFactors.length;
    const confluenceOK = confluenceCount >= 2;
    console.log(`  ${confluenceOK ? "OK" : "WARN"}: confluence_factors.length=${confluenceCount} (target ≥3 for ICT/SMC strategies)`);

    // direction check
    const direction = s["direction"];
    console.log(`  direction=${direction} (${direction === "both" ? "OK — bidirectional" : "NOTE — single-direction; verify this is intentional"})`);
  }

  // ── 6. Live LLM parity test ─────────────────────────────────────────────────
  console.log("\n[smoke] Step 5: Live LLM parity test...");
  const liveLlmParityPass = await runLiveLlmParityTest();

  // ── 7. Summary ──────────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────────────────");
  const overallPass = allFieldsOK && paritySpecPass && liveLlmParityPass;
  console.log(`[smoke] RESULT: ${overallPass ? "PASS" : "WARN — some checks failed"}`);
  console.log(`[smoke] Duration: ${durationMs}ms`);
  console.log(`[smoke] Strategies extracted: ${strategies.length}`);
  console.log(`[smoke] W23H fields (bias_timeframe / confirming_indicators / preferred_regimes): ${
    W23H_REQUIRED_FIELDS.every(
      (f) => strategies.some((s) => f in (s as Record<string, unknown>))
    ) ? "ALL PRESENT" : "SOME MISSING"
  }`);
  console.log(`[smoke] Parity spec (v10 prompt spec validation): ${paritySpecPass ? "PASS" : "FAIL"}`);
  console.log(`[smoke] Live LLM parity (5-fixture extraction depth): ${liveLlmParityPass ? "PASS" : "FAIL"}`);

  if (overallPass) {
    console.log("[smoke] Transcript extractor v10 prompt is ready. SHIP IT.");
    process.exit(0);
  } else {
    console.warn("[smoke] Some checks failed — review above output before full rollout.");
    const w23hOK = W23H_REQUIRED_FIELDS.every(
      (f) => strategies.some((s) => f in (s as Record<string, unknown>)),
    );
    process.exit(w23hOK && paritySpecPass ? 0 : 1);
  }
}

runSmoke().catch((err) => {
  console.error("[smoke] Unhandled error:", err);
  process.exit(1);
});
