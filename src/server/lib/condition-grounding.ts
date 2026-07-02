/**
 * CONDITION GROUNDING (2026-06-30, operator/GPT) — Stage 2 of the semantic-grounding track + LEDGER F scaffold.
 *
 * Ledger E proved the engine interprets the compiled graph's STRUCTURE faithfully; conditions were abstract
 * booleans. The remaining frontier is grounding each condition OBJECT ("liquidity sweep", "ema cross") to a real
 * market-data evaluator. Per GPT's staging this module is the measurable AUDIT layer, not the evaluators:
 *
 *   classifyCondition(object)  — semantic family + groundability status + the ENGINE PRIMITIVE that grounds it
 *   groundabilityCoverage(...) — the Groundability Coverage metric over a condition set
 *   ledgerF(spec)              — the 6th ledger: every condition classified EXACTLY once (registry first-match +
 *                                mandatory fallback = structural guarantee), ungroundable EXPLICITLY reported,
 *                                framework leakage cross-checked. No condition is ever silently ignored.
 *
 * Statuses: "native" (an engine evaluator exists), "composite" (expressible by combining existing primitives),
 * "needs_new" (no current path — build or reject), "ambiguous" (object too vague to bind).
 * Registry entries cite the REAL primitive (verified against the codebase 2026-06-30):
 *   structure_engine.py (BOS/CHoCH/MSS/displacement) · liquidity-map-service.ts (17 LevelTypes + sweeps) ·
 *   kb/indicator-catalog.md DSL archetypes · killzone.ts (5 zones) · htf_narrative.py (AsianRange/DailyDealing
 *   premium-discount) · bias_engine.py · smt_divergence.py · engine DSL bar-comparison conditions.
 * NOTE: CCI is EXPLICITLY REJECTED by the indicator catalog ("fails diversity gate vs RSI") → needs_new by
 * policy, never silently mapped to RSI. Pure / deterministic / standalone.
 */
import type { EngineStrategySpec } from "./graph-to-engine.js";

export type SemanticFamily =
  | "market_structure" | "liquidity" | "ict_zone" | "indicator" | "session_time"
  | "price_action" | "bias_direction" | "entry_execution" | "risk_framework" | "unclassified";
export type Groundability = "native" | "composite" | "needs_new" | "ambiguous";

export interface GroundingClass { family: SemanticFamily; status: Groundability; evaluator: string }
interface RegistryEntry extends GroundingClass { pattern: RegExp }

// First match wins — ordered most-specific → most-generic. The final fallback guarantees EVERY object classifies.
const REGISTRY: RegistryEntry[] = [
  // ── risk / framework (excluded from the SPEC by Ledger D invariant 5; hits here are vocab-level only) ──
  { pattern: /\b(stop ?loss|take ?profit|target|risk|reward|r ?: ?r|sizing|position size|lot size|pips?)\b/i,
    family: "risk_framework", status: "needs_new", evaluator: "framework-overlay.ts (overlay-owned — must NOT be an entry condition)" },

  // ── market structure (structure_engine.py natives) ──
  { pattern: /\bmss\b|market structure shift/i, family: "market_structure", status: "native", evaluator: "structure_engine.detect_mss_with_context" },
  { pattern: /\bchoch\b|change of character/i, family: "market_structure", status: "native", evaluator: "structure_engine.detect_choch_with_context" },
  { pattern: /\bbos\b|break of structure|structure break|market structure break/i, family: "market_structure", status: "native", evaluator: "structure_engine.detect_bos" },
  { pattern: /\bdisplacement\b/i, family: "market_structure", status: "native", evaluator: "structure_engine displacement_active (≥1.5×ATR)" },
  { pattern: /\b(break|breakout|broke|breaks|breaking)\b/i, family: "market_structure", status: "native", evaluator: "donchian_breakout / session_open_breakout / detect_bos (route by context)" },
  { pattern: /\b(higher (high|low)|lower (high|low)|swing (high|low|point)|swing)\b/i, family: "market_structure", status: "composite", evaluator: "structure_engine swing detection + structural_stops swings" },
  { pattern: /\b(reclaim|close back (above|below|inside|through))\b/i, family: "market_structure", status: "composite", evaluator: "DSL bar-close comparison vs level (close > X safe per engine +1-bar shift)" },
  { pattern: /\bmarket structure\b/i, family: "market_structure", status: "composite", evaluator: "structure_engine StructureState (bos/choch/mss aggregate)" },

  // ── liquidity (liquidity-map-service.ts LevelTypes + sweep machinery) ──
  { pattern: /\b(sweep|swept|liquidity grab|stop (hunt|run)|taken out|raid)\b/i, family: "liquidity", status: "native", evaluator: "liquidity_sweep_breakout archetype + liquidity_levels sweep detection" },
  { pattern: /\b(equal (highs?|lows?)|eqh|eql)\b/i, family: "liquidity", status: "native", evaluator: "liquidity_levels LevelType EQH/EQL" },
  { pattern: /\b(liquidity|buy ?side|sell ?side|draw on liquidity|\bdol\b)\b/i, family: "liquidity", status: "native", evaluator: "liquidity-map-service.ts (17 LevelTypes + sweep_probability)" },
  { pattern: /\b(pd[hl]|pw[hl]|previous (day|week|month)('?s)? (high|low)|(hod|lod)\b|(high|low) of (the )?day)\b/i, family: "liquidity", status: "native", evaluator: "liquidity_levels PDH/PDL/PWH/PWL/PMH/PML/HOD/LOD" },

  // ── ICT zones (htf_narrative + liquidity untouched_fvg/untouched_ob) ──
  { pattern: /\b(fvg|fair ?value gap|imbalance)\b/i, family: "ict_zone", status: "composite", evaluator: "liquidity_levels untouched_fvg + retest-entry logic (adaptive exits already consume)" },
  { pattern: /\border ?block\b/i, family: "ict_zone", status: "composite", evaluator: "liquidity_levels untouched_ob (zone persistence yes; touch-entry trigger partial)" },
  { pattern: /\bmitigation\b/i, family: "ict_zone", status: "needs_new", evaluator: "none — mitigation-block detector not built" },
  { pattern: /\b(premium|discount|equilibrium|dealing range|fib\w*|retrace\w*|0\.5|fifty percent|half of the range)\b/i, family: "ict_zone", status: "composite", evaluator: "htf_narrative DailyDealing quadrants (premium/discount/equilibrium)" },
  { pattern: /\b(supply|demand) ?(zone)?\b/i, family: "ict_zone", status: "composite", evaluator: "liquidity_levels untouched_ob/zones as supply-demand proxy" },

  // ── indicators (kb/indicator-catalog.md DSL archetypes — the calibrated engine vocabulary) ──
  { pattern: /\bcci\b|commodity channel/i, family: "indicator", status: "needs_new", evaluator: "REJECTED by indicator-catalog policy ('fails diversity gate vs RSI') — never silently proxy" },
  { pattern: /\badx\b/i, family: "indicator", status: "needs_new", evaluator: "not in indicator catalog" },
  { pattern: /\b(ema|sma|dema|moving average|ma cross|golden cross|death cross|\d+ ?(ema|sma|ma)\b)/i, family: "indicator", status: "native", evaluator: "ema_crossover / dema_crossover / bounce_off_level DSL archetypes" },
  { pattern: /\bmacd\b/i, family: "indicator", status: "native", evaluator: "macd_crossover" },
  { pattern: /\brsi\b/i, family: "indicator", status: "native", evaluator: "rsi_reversal / rsi_divergence" },
  { pattern: /\bvwap\b/i, family: "indicator", status: "native", evaluator: "vwap_fade / compute_vwap_with_bands / anchored VWAP" },
  { pattern: /\b(bollinger|keltner|supertrend|donchian|ichimoku|atr)\b/i, family: "indicator", status: "native", evaluator: "bollinger_breakout / keltner_squeeze / supertrend / donchian_breakout / ichimoku_cloud / atr_*" },
  { pattern: /\b(volume profile|\bpoc\b|value area|profile shape|initial balance)\b/i, family: "indicator", status: "native", evaluator: "volume_profile / profile_shape / initial_balance" },
  { pattern: /\b(delta|order ?flow|cumulative)\b/i, family: "indicator", status: "native", evaluator: "cumulative_delta / vwap_order_flow" },
  { pattern: /\bsmt\b|divergence/i, family: "indicator", status: "native", evaluator: "smt_divergence.compute_smt_divergence / rsi_divergence" },
  { pattern: /\b(volume|volume spike)\b/i, family: "indicator", status: "composite", evaluator: "bar volume vs rolling average (DSL-expressible)" },
  { pattern: /\bmomentum\b/i, family: "indicator", status: "composite", evaluator: "structure_engine displacement_active (≥1.5×ATR) as momentum proxy" },

  // ── session / time (killzone.ts + session context + htf_narrative) ──
  { pattern: /\b(kill ?zone|silver bullet|macro window)\b/i, family: "session_time", status: "native", evaluator: "killzone.ts (london/ny_am/ny_pm/silver_bullet/macro_window)" },
  { pattern: /\b(asian?|london|new ?york|tokyo|sydney) ?(session|range|open|high|low|kill)?\b/i, family: "session_time", status: "native", evaluator: "killzone.ts + htf_narrative AsianRange/LondonBias/NYBias + liquidity_levels Asian/London" },
  { pattern: /\b(midnight|17:00|1[0-9] ?(am|pm)|\d{1,2}:\d{2}|open(ing)? (range|price|line)|session (open|start)|market open)\b/i, family: "session_time", status: "composite", evaluator: "session_open_breakout / initial_balance / fifo_session_open + DST-correct session context" },
  { pattern: /\b(session|time ?frame|timeframe|\d+ ?(minute|min|hour|h)\b|daily|weekly|htf|intraday)\b/i, family: "session_time", status: "native", evaluator: "5-TF MTF engine (load_n_timeframes + mtf_join)" },
  { pattern: /\b(trading hours|hours filter|time window|candle open time)\b/i, family: "session_time", status: "composite", evaluator: "DST-correct session context + entry-windows.ts" },

  // ── price action / candles ──
  { pattern: /\b(engulf|pin ?bar|doji|hammer|wick|rejection|strong candle|confirmation candle|candle (close|body|pattern|formation))\b/i,
    family: "price_action", status: "needs_new", evaluator: "no native candle-pattern evaluator (bounce_off_level embeds rejection internally; standalone detector unbuilt)" },
  { pattern: /\bweakness\b/i, family: "price_action", status: "needs_new", evaluator: "educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition" },
  { pattern: /\bclose[sd]? (above|below|over|under|through|lower|higher)\b/i, family: "price_action", status: "native", evaluator: "DSL bar-close comparison (close > X — engine +1-bar shift makes this safe)" },
  { pattern: /\b(retest|pull ?back|bounce|tap|touch)\b/i, family: "price_action", status: "composite", evaluator: "bounce_off_level archetype + level-proximity (proximity_atr_mult)" },
  { pattern: /\breversal\b/i, family: "price_action", status: "composite", evaluator: "structure_engine CHoCH (counter-trend break = reversal signal)" },
  { pattern: /\b(range|consolidat|accumulat)\b/i, family: "price_action", status: "composite", evaluator: "initial_balance / AsianRange + regime classifier RANGE_BOUND/COMPRESSION" },

  // ── entry execution (ENTER/ENABLE_ENTRY trigger objects — the ACTION, grounded by order placement itself) ──
  { pattern: /\b(enter(ing)?|entry|take (the )?trade|trade (entry|execution|opportunity)|limit order|market order|order placement|position)\b/i,
    family: "entry_execution", status: "native", evaluator: "engine order placement (the trigger action — DSL entry semantics, not a market condition)" },

  // ── bias / direction (bias_engine.py) ──
  { pattern: /\b(bias|bullish|bearish|direction|trend(ing)?|long|short|buy|sell|upside|downside)\b/i,
    family: "bias_direction", status: "native", evaluator: "bias_engine.compute_bias + htf_narrative directions" },

  // ── level generic (plural-safe) ──
  { pattern: /\b(levels?|lines?|zones?|areas?|support|resistance|key (level|area))\b/i, family: "liquidity", status: "composite", evaluator: "liquidity_levels named-level persistence + proximity checks" },
];

const FALLBACK: GroundingClass = { family: "unclassified", status: "ambiguous", evaluator: "none — object too vague to bind (compression/extraction refinement candidate)" };

/** Classify one condition object. Registry first-match; mandatory fallback ⇒ EVERY object gets exactly one class. */
export function classifyCondition(objectCanonical: string): GroundingClass {
  for (const e of REGISTRY) if (e.pattern.test(objectCanonical)) return { family: e.family, status: e.status, evaluator: e.evaluator };
  return FALLBACK;
}

export interface CoverageReport {
  total: number;
  by_status: Record<Groundability, number>;
  by_family: Record<string, Record<Groundability, number>>;
  coverage_pct: number;               // (native + composite) / total — the Groundability Coverage metric
  ungrounded: Array<{ object: string; status: Groundability; family: SemanticFamily }>;
}

/** The Groundability Coverage metric over a set of condition objects. */
export function groundabilityCoverage(objects: string[]): CoverageReport {
  const by_status: Record<Groundability, number> = { native: 0, composite: 0, needs_new: 0, ambiguous: 0 };
  const by_family: Record<string, Record<Groundability, number>> = {};
  const ungrounded: CoverageReport["ungrounded"] = [];
  for (const o of objects) {
    const c = classifyCondition(o);
    by_status[c.status]++;
    (by_family[c.family] ??= { native: 0, composite: 0, needs_new: 0, ambiguous: 0 })[c.status]++;
    if (c.status === "needs_new" || c.status === "ambiguous") ungrounded.push({ object: o, status: c.status, family: c.family });
  }
  const total = objects.length;
  return {
    total, by_status, by_family,
    coverage_pct: total ? Math.round(((by_status.native + by_status.composite) / total) * 1000) / 10 : 100,
    ungrounded,
  };
}

// ── LEDGER F — grounding conservation (the 6th ledger) ─────────────────────────────────────────────────────────
export interface LedgerFResult {
  ok: boolean;                        // every condition explicitly classified AND no framework leakage
  coverage: CoverageReport;           // the measurable metric (coverage_pct is the target to raise, not gate ok)
  framework_leaks: string[];          // entry conditions classifying risk_framework — Ledger D inv.5 cross-check
}

/** Every condition classified exactly once; ungroundable EXPLICITLY reported; framework leakage cross-checked. */
export function ledgerF(spec: EngineStrategySpec): LedgerFResult {
  const objects = [...spec.entry_conditions, ...spec.invalidations].map((c) => c.object);
  const coverage = groundabilityCoverage(objects);
  const framework_leaks = spec.entry_conditions
    .filter((c) => classifyCondition(c.object).family === "risk_framework")
    .map((c) => `${c.id}:${c.object}`);
  // classification totals must equal condition count (nothing silently dropped) — structural, but assert anyway
  const classified = (Object.values(coverage.by_status) as number[]).reduce((s, x) => s + x, 0);
  const ok = classified === objects.length && framework_leaks.length === 0;
  return { ok, coverage, framework_leaks };
}
