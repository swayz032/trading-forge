/**
 * Direct Bucket Graduator — Pass 21 (2026-05-12)
 *
 * Replaces the /scout-ideas/strict → system_journal → drain → runStrategyFromDSL
 * chain for graduated_bucket strategies. Constructs a production-grade DSL
 * directly from the bucket's best mention and inserts into the strategies table.
 *
 * Why this exists:
 *   - The legacy chain wrote scout candidates to system_journal (the BOT'S
 *     TRADE-JOURNAL table that the 3am GPT-5 self-critique reads). That polluted
 *     the journal with scout staging crud the agent had no business seeing.
 *   - The drain step expected strict DSL fields in the journal row, but
 *     /scout-ideas/strict stored a wrapper shape (url/title/description) instead.
 *     Result: every silver-path graduation marked the journal `failed` and
 *     never produced a strategy row.
 *
 * What this does:
 *   - Builds a minimal valid DSL from the mention's narrative + canonical fields
 *   - Runs the framework-overlay (CLAUDE.md §4 Style C 33/33/33 canonical defaults)
 *   - Inserts directly into `strategies` with cross-validation tags
 *   - Returns the new strategy.id
 *
 * No journal writes. No drain dependency. No 8A synthesizer needed for
 * graduated_bucket source — those guards exist for OPENCLAW/OLLAMA-generated
 * candidates that need post-extraction LLM enrichment.
 */
import { db } from "../db/index.js";
import { strategies, strategyPendingBuckets, auditLog, deadLetterQueue } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { applyFrameworkOverlay } from "./framework-overlay.js";
import { compileDslToEngine, compileDslWithConfluence } from "../lib/dsl-compiler.js";
import type { ConfirmingIndicator } from "../lib/dsl-compiler.js";
import { runDslQualityCritic } from "./agent-service.js";
// Track A F-6: insertAuditRowSafe migrated for select call sites. Remaining
// db.insert(auditLog) call sites retain raw pattern until incremental migration.
// TODO: correlation_id not threaded through all call sites in this file.
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { CANONICAL_PARAM_RANGES } from "../lib/param-ranges.js";

/**
 * Pass 21 v3 (2026-05-17) — STRUCTURAL ARCHETYPE REGISTRY.
 *
 * The engine has TWO entry paths for strategies:
 *   1. pattern_library — parametric indicators (ema_crossover, rsi_reversal,
 *      etc.) that need numeric params (fast_period, slow_period, etc.)
 *   2. engine/strategies/*.py — structural archetype implementations
 *      (silver_bullet, judas_swing, ote, breaker, etc.) that need detectors
 *      not numeric params. Each maps to src/engine/specs/<name>.yaml
 *
 * The graduator's old DSL Quality Critic gate ONLY knew path 1, so every
 * ICT/SMC/Wyckoff strategy got rejected as "no engine indicator". This
 * registry routes structural archetypes through a separate gate that
 * requires extraction_confidence + real entry-condition prose but NOT
 * numeric params (the engine's detectors handle structure detection).
 *
 * Keys MUST match prettifyConcept()'s output exactly. Add new archetypes
 * here AND in prettifyConcept() in lockstep.
 */
const ARCHETYPE_REGISTRY: Record<string, { engineSpec: string; strategyClass: string; description: string }> = {
  // ICT time-window archetypes
  // Pass 21 v3 corrected² (2026-05-17): `strategyClass` is the FULL dotted
  // Python path that backtest-service.ts passes to `--strategy-class` (see
  // src/server/routes/backtests.ts:113). Without it, the backtest engine
  // falls back to the DSL/pattern_library path which has no entry for these
  // archetypes and rejects compile as "Unknown entry_indicator". The
  // `engineSpec` field is kept for legacy/documentation but `strategyClass`
  // is the authoritative dispatch target.
  ict_silver_bullet_ny_am: { engineSpec: "silver_bullet", strategyClass: "src.engine.strategies.silver_bullet.SilverBulletStrategy", description: "10-11 AM ET Silver Bullet (London/NY overlap)" },
  ict_silver_bullet_london: { engineSpec: "silver_bullet", strategyClass: "src.engine.strategies.silver_bullet.SilverBulletStrategy", description: "3-4 AM ET London Open Silver Bullet" },
  ict_silver_bullet_ny_pm: { engineSpec: "silver_bullet", strategyClass: "src.engine.strategies.silver_bullet.SilverBulletStrategy", description: "2-3 PM ET NY PM Silver Bullet" },
  ict_judas_swing: { engineSpec: "judas_swing", strategyClass: "src.engine.strategies.judas_swing.JudasSwingStrategy", description: "Fade the fake opening move after MSS confirms reversal" },
  ict_ny_lunch_reversal: { engineSpec: "ny_lunch_reversal", strategyClass: "src.engine.strategies.ny_lunch_reversal.NYLunchReversalStrategy", description: "MSS during NY lunch fading AM direction" },
  ict_midnight_open: { engineSpec: "midnight_open", strategyClass: "src.engine.strategies.midnight_open.MidnightOpenStrategy", description: "Mean reversion to NDOG/NWOG midnight ET reference" },
  ict_london_raid: { engineSpec: "london_raid", strategyClass: "src.engine.strategies.london_raid.LondonRaidStrategy", description: "Asia range sweep + London MSS + FVG entry" },
  ict_turtle_soup: { engineSpec: "turtle_soup", strategyClass: "src.engine.strategies.turtle_soup.TurtleSoupStrategy", description: "Equal high/low sweep failure + MSS confirmation" },
  ict_ote: { engineSpec: "ote_strategy", strategyClass: "src.engine.strategies.ote_strategy.OTEStrategy", description: "BOS + 62-79% Fibonacci OTE retracement + FVG confluence" },
  ict_power_of_3: { engineSpec: "power_of_3", strategyClass: "src.engine.strategies.power_of_3.PowerOf3Strategy", description: "Asia accumulation → London manipulation → NY distribution cycle" },
  ict_unicorn: { engineSpec: "unicorn", strategyClass: "src.engine.strategies.unicorn.UnicornStrategy", description: "Breaker Block + FVG confluence (Unicorn Zone)" },
  ict_breaker: { engineSpec: "breaker", strategyClass: "src.engine.strategies.breaker.BreakerStrategy", description: "Failed order block flipped to S/R, retest entry" },
  ict_mitigation: { engineSpec: "mitigation", strategyClass: "src.engine.strategies.mitigation.MitigationStrategy", description: "Failed OB without sweep, MSS, re-entry in new direction" },
  ict_iofed: { engineSpec: "iofed", strategyClass: "src.engine.strategies.iofed.IOFEDStrategy", description: "Institutional Order Flow Entry — displacement + FVG + HTF flow" },
  smt_reversal: { engineSpec: "smt_reversal", strategyClass: "src.engine.strategies.smt_reversal.SMTReversalStrategy", description: "ES/NQ correlation divergence + MSS confirmation" },
  ict_quarterly_swing: { engineSpec: "quarterly_swing", strategyClass: "src.engine.strategies.quarterly_swing.QuarterlySwingStrategy", description: "Quarterly Theory — Q3 entry after Q2 manipulation" },
  ict_propulsion: { engineSpec: "propulsion", strategyClass: "src.engine.strategies.propulsion.PropulsionStrategy", description: "Displacement candle body inside FVG, retest entry" },
  ict_eqhl_raid: { engineSpec: "eqhl_raid", strategyClass: "src.engine.strategies.eqhl_raid.EqhlRaidStrategy", description: "Equal high/low liquidity raid + reversal" },
  ict_scalp: { engineSpec: "ict_scalp", strategyClass: "src.engine.strategies.ict_scalp.ICTScalpStrategy", description: "Killzone scalp: sweep→MSS→displacement→FVG retrace" },
  ict_swing: { engineSpec: "ict_swing", strategyClass: "src.engine.strategies.ict_swing.ICTSwingStrategy", description: "HTF bias + sweep + premium/discount + BOS + PD array entry" },
  ict_2022: { engineSpec: "ict_2022", strategyClass: "src.engine.strategies.ict_2022.ICT2022Strategy", description: "HTF bias + sweep + MSS + FVG entry at OTE zone" },
  // Structural primitives — map to closest engine spec
  break_of_structure: { engineSpec: "ict_swing", strategyClass: "src.engine.strategies.ict_swing.ICTSwingStrategy", description: "BOS continuation — uses HTF-bias swing detection" },
  change_of_character: { engineSpec: "ict_swing", strategyClass: "src.engine.strategies.ict_swing.ICTSwingStrategy", description: "CHoCH reversal — uses HTF-bias swing detection" },
  market_structure_shift: { engineSpec: "ict_2022", strategyClass: "src.engine.strategies.ict_2022.ICT2022Strategy", description: "MSS — wraps into ICT-2022 sweep+MSS+FVG flow" },
  cisd: { engineSpec: "ict_scalp", strategyClass: "src.engine.strategies.ict_scalp.ICTScalpStrategy", description: "Change in State of Delivery — earliest reversal signal, routes to scalp" },
  fvg_retrace: { engineSpec: "silver_bullet", strategyClass: "src.engine.strategies.silver_bullet.SilverBulletStrategy", description: "Generic FVG retrace — uses Silver Bullet displacement+FVG mechanics" },
  // W23G.3 (2026-05-19) — short-form aliases used by structural_recovery stub synthesis.
  // These map to the same engine handlers as their canonical equivalents. The recovery
  // branch in routes/agent.ts emits these exact names (no "ict_" prefix) because the
  // transcript keyword regex fires on prose terms, not canonical concept names.
  fvg: { engineSpec: "silver_bullet", strategyClass: "src.engine.strategies.silver_bullet.SilverBulletStrategy", description: "Fair value gap entry (alias for fvg_retrace) — structural recovery path" },
  judas_swing: { engineSpec: "judas_swing", strategyClass: "src.engine.strategies.judas_swing.JudasSwingStrategy", description: "Judas swing (alias for ict_judas_swing) — structural recovery path" },
  silver_bullet: { engineSpec: "silver_bullet", strategyClass: "src.engine.strategies.silver_bullet.SilverBulletStrategy", description: "ICT Silver Bullet 10-11 AM (alias for ict_silver_bullet_ny_am) — structural recovery path" },
  breaker_block: { engineSpec: "breaker", strategyClass: "src.engine.strategies.breaker.BreakerStrategy", description: "Breaker block entry (alias for ict_breaker) — structural recovery path" },
  order_block: { engineSpec: "breaker", strategyClass: "src.engine.strategies.breaker.BreakerStrategy", description: "Order block entry — uses breaker detector + retest" },
  liquidity_sweep: { engineSpec: "turtle_soup", strategyClass: "src.engine.strategies.turtle_soup.TurtleSoupStrategy", description: "Liquidity sweep + reversal — uses turtle-soup detector" },
  // Wyckoff — closest engine analog is sweep-based structural primitive
  wyckoff_spring: { engineSpec: "turtle_soup", strategyClass: "src.engine.strategies.turtle_soup.TurtleSoupStrategy", description: "Spring = sweep of accumulation low + quick reclaim" },
  wyckoff_upthrust: { engineSpec: "turtle_soup", strategyClass: "src.engine.strategies.turtle_soup.TurtleSoupStrategy", description: "Upthrust = sweep of distribution high + quick rejection" },
  wyckoff_accumulation: { engineSpec: "power_of_3", strategyClass: "src.engine.strategies.power_of_3.PowerOf3Strategy", description: "Accumulation phase — routes to PO3 accumulation tracking" },
  wyckoff_distribution: { engineSpec: "power_of_3", strategyClass: "src.engine.strategies.power_of_3.PowerOf3Strategy", description: "Distribution phase — routes to PO3 distribution leg" },
};

/**
 * Pass 21 v3 (2026-05-17) — KB-aligned indicator allowlist + canonical
 * required params (mirrors src/agents/kb/indicator-catalog.md exactly).
 *
 * Module-scope so the prettifier + gate share the same source of truth.
 */

// F-2 (2026-05-20): PARAM_RANGES is now the canonical source of truth from
// src/server/lib/param-ranges.ts. Both the graduator and the dsl-sanitizer
// import from that single module. Do NOT redefine ranges inline here.
// Keep in lockstep with src/engine/compiler/pattern_library.py.
const PARAM_RANGES = CANONICAL_PARAM_RANGES;

/** Returns [] if all params in range, else array of error messages. */
function validateParamRanges(indicator: string, params: Record<string, unknown>): string[] {
  const ranges = PARAM_RANGES[indicator];
  if (!ranges) return []; // archetype or unknown indicator — skip range check
  const errors: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const range = ranges[k];
    if (!range) continue; // optional/unknown key — skip (pattern_library does same)
    if (typeof v !== "number" || Number.isNaN(v)) {
      errors.push(`${indicator}.${k}: value '${v}' is not numeric`);
      continue;
    }
    if (v < range[0] || v > range[1]) {
      errors.push(`${indicator}.${k}: ${v} out of range [${range[0]}, ${range[1]}]`);
    }
  }
  return errors;
}

const REQUIRED_PARAMS_BY_INDICATOR_FULL: Record<string, string[]> = {
  // TREND
  sma_crossover: ["fast_period", "slow_period"],
  ema_crossover: ["fast_period", "slow_period"],
  macd_crossover: ["fast_period", "slow_period", "signal_period"],
  donchian_breakout: ["period"],
  supertrend: ["atr_period", "multiplier"],
  ichimoku_cloud: ["tenkan_period", "kijun_period", "senkou_b_period"],
  dema_crossover: ["fast_period", "slow_period"],
  alma_filter: ["period", "offset", "sigma"],
  // MEAN REVERSION
  rsi_reversal: ["period", "oversold", "overbought"],
  rsi_divergence: ["period", "divergence_lookback"],
  bollinger_breakout: ["period", "std_dev"],
  vwap_fade: ["atr_extension_threshold"],
  vwap_reversion: ["deviation_threshold"],
  keltner_squeeze: ["bb_period", "kc_period", "kc_multiplier"],
  // VOLATILITY
  atr_breakout: ["period", "multiplier"],
  atr_trailing_stop: ["atr_period", "multiplier"],
  // VOLUME / ORDER FLOW
  cumulative_delta: ["window", "divergence_threshold"],
  vwap_order_flow: ["volume_lookback", "bias_threshold"],
  volume_profile: ["profile_window", "node_threshold_pct"],
  liquidity_sweep_breakout: ["sweep_lookback", "volume_spike_multiplier"],
  // SESSION / TIME
  session_open_breakout: ["range_minutes"],
  overnight_drift: ["drift_atr_threshold", "asia_lookback_bars"],
  fifo_session_open: ["imbalance_window_seconds", "imbalance_threshold"],
  // EVENT-DRIVEN
  news_fade_mco: ["release_window_seconds", "fade_threshold_atr"],
  event_driven_fade: ["atr_move_threshold", "event_window_minutes"],
};
import { auditGraduatedConfig, formatAuditResult } from "./graduated-strategy-auditor.js";
import { computeWideConceptFingerprintHash } from "./strategy-fingerprint.js";
import { logger } from "../index.js";
import { broadcastSSE } from "../routes/sse.js";

// ─── Wave 23F Track D (2026-05-19): Entry quality provenance resolver ─────────
type ExtractionProvenance =
  | "youtube_transcript"
  | "reddit_thread"
  | "web_article"
  | "legacy_no_confluence";

function resolveProvenance(
  scoutLayer: string | undefined,
  sourceProvider: string | undefined
): ExtractionProvenance {
  if (scoutLayer === "youtube" || sourceProvider?.includes("youtube")) {
    return "youtube_transcript";
  }
  if (scoutLayer === "reddit" || sourceProvider?.includes("reddit")) {
    return "reddit_thread";
  }
  if (scoutLayer === "web" || ["exa", "brave", "parallel"].includes(sourceProvider ?? "")) {
    return "web_article";
  }
  // Defensive fallback — should not hit in practice
  return "web_article";
}

interface Mention {
  sourceUrl: string;
  sourceProvider: string;
  scoutLayer?: string | null;
  extractedIdea: Record<string, unknown> | null;
}

interface BucketMetadata {
  conceptName: string;
  market: "MES" | "MNQ" | "MCL";
  entryArchetype: string | null;
  exitType: string | null;
}

export interface DirectGraduationResult {
  strategyId: string | null;
  strategyName: string;
  skipped?: boolean;
  /** True when the strategy INSERT itself failed (constraint collision, DB error,
   *  etc.) rather than a gate rejection. The caller MUST revert the bucket to
   *  `pending` and fire a failure audit — not a success audit. */
  insertFailed?: boolean;
  reason?: string;
}

// Pass 21 (2026-05-16) — corrected indicator mapping.
// Authoritative source: src/server/services/dsl-sanitizer.ts ENTRY_PATTERN_ALLOWLIST
// (which mirrors src/engine/compiler/pattern_library.py). The engine compiles
// ONLY these 13 indicator types. Anything else fails at compile time.
//
//   sma_crossover, ema_crossover, rsi_reversal, bollinger_breakout,
//   atr_breakout, vwap_reversion, donchian_breakout, keltner_squeeze,
//   session_open_breakout, macd_crossover, vwap_fade, event_driven_fade,
//   overnight_drift
//
// Concepts that don't map to one of these (Supertrend, ICT/SMC, FVG, Volume
// Profile POC/VAH/VAL, Pivot Points, Liquidity Sweep) MUST be rejected at
// graduation — not shoehorned into a wrong indicator. The graduator returns
// null and audits the reason so we can later add engine support if needed.
const ENTRY_INDICATOR_MAP: Record<string, string> = {
  breakout: "session_open_breakout",
  trend_follow: "ema_crossover",
  mean_reversion: "rsi_reversal",
  volatility_expansion: "bollinger_breakout",
  session_pattern: "session_open_breakout",
  event_driven: "event_driven_fade",
};

/**
 * Map concept name to a valid engine-compatible indicator, or null if no
 * supported indicator matches. Order matters — more-specific patterns first.
 * Returning null causes the graduator to reject the bucket (audited as
 * 'no_engine_compatible_indicator').
 */
function deriveEntryIndicator(conceptName: string, fallback: string | null): string | null {
  const cn = conceptName.toLowerCase();

  // ─── Pass 21 v3 (2026-05-17) — STRUCTURAL ARCHETYPE ROUTING ──────────
  // Check ARCHETYPE_REGISTRY FIRST. ICT/SMC/Wyckoff strategies are
  // structural (detector-driven, not parameter-driven). The prettifier
  // recognizes them and emits a canonical archetype name; if that name
  // is registered, return an "archetype:<name>" sentinel so the DSL Quality
  // Critic gate routes it through the structural path instead of the
  // parametric pattern_library path. Engine compiles via engineSpec field.
  const prettyArchetype = prettifyConcept(conceptName);
  if (ARCHETYPE_REGISTRY[prettyArchetype]) {
    return `archetype:${prettyArchetype}`;
  }

  // ─── Specific indicator matches (engine-supported) ─────────────────────
  // MACD has its OWN pattern — must NOT collapse into ema_crossover.
  if (/(^|_)macd(_|$)/.test(cn)) return "macd_crossover";

  // Keltner squeeze is a distinct engine pattern from Bollinger.
  if (/keltner/.test(cn) || /squeeze.*keltner|keltner.*squeeze/.test(cn)) return "keltner_squeeze";
  if (/(^|_)squeeze(_|$)/.test(cn) && /(bollinger|bb_|keltner)/.test(cn)) return "keltner_squeeze";

  // Donchian channel breakout — its own engine pattern.
  if (/donchian/.test(cn)) return "donchian_breakout";

  // ATR breakout — volatility expansion via ATR. Catches inside-bar / NR4 / NR7
  // (compression patterns that resolve via volatility expansion).
  if (/atr.*breakout|nr4|nr7|inside.bar/.test(cn)) return "atr_breakout";

  // VWAP reversion vs fade (anchored VWAP / mean reversion to VWAP).
  if (/anchored.vwap|vwap.reversion|vwap.touch/.test(cn)) return "vwap_reversion";
  if (/vwap.fade|vwap.deviation/.test(cn)) return "vwap_fade";
  if (/(^|_)vwap(_|$)/.test(cn)) return "vwap_fade";  // generic VWAP defaults to fade

  // Event-driven (news, FOMC, CPI, inventories).
  if (/news|fomc|cpi|nfp|earnings|inventor/.test(cn)) return "event_driven_fade";

  // Overnight drift / Asian session range carry.
  if (/overnight.drift|asia.*range|asian.range|gap.fade|globex.drift/.test(cn)) return "overnight_drift";

  // Bollinger Bands (mean reversion + breakout).
  if (/bollinger/.test(cn)) return "bollinger_breakout";

  // F-3 (2026-05-20): Connors RSI-2 is a distinct family — must be checked BEFORE
  // the generic rsi_reversal line so period=2 is not rejected by the [7,21] range.
  if (/connors.*rsi.?2|rsi.?2.*connors|rsi2.*connors|connors_rsi2/.test(cn)) return "connors_rsi2";
  // Connors alone (without explicit RSI-2 qualifier) also maps to connors_rsi2 —
  // Connors's canonical method is RSI-2; no other Connors strategy uses rsi_reversal.
  if (/connors/.test(cn)) return "connors_rsi2";

  // RSI / Stochastic reversals (no dedicated stochastic pattern — uses RSI shape).
  if (/(^|_)rsi(_|$)|stochastic|oversold|overbought/.test(cn)) return "rsi_reversal";

  // SMA crossover (slower than EMA).
  if (/(^|_)sma_cross|simple_moving_average_cross/.test(cn)) return "sma_crossover";

  // EMA crossover / moving-average crossover / pullback.
  if (/ema.cross|exponential_moving_average_cross|moving_average_cross|ma_cross|ema.pullback|pullback.ema/.test(cn)) return "ema_crossover";
  // W23H-postmortem (2026-05-20): catch single-MA-pullback patterns without "cross" suffix.
  // Many Linda Raschke / Bellafiore-style strategies use "20 moving average pullback" (no MA-vs-MA cross).
  // Maps to ema_crossover archetype since engine compiles the same pattern.
  if (/moving.average.pullback|ma.pullback|(\d+).{0,4}(ma|ema|sma).{0,8}pullback|pullback.{0,8}\d+.{0,4}(ma|ema|sma)/.test(cn)) return "ema_crossover";
  if (/(^|_)ema(_|$)/.test(cn)) return "ema_crossover";  // generic EMA → crossover

  // Opening-range / session-open breakout (ORB family).
  if (/orb|opening.range|first.hour|session.open/.test(cn)) return "session_open_breakout";

  // Generic breakout fallback — only matches if no more-specific pattern hit.
  if (/breakout/.test(cn)) return "session_open_breakout";

  // ─── Pass 21 v3 corrected (2026-05-17) — engine-supported indicators ──
  // The KB catalog (src/agents/kb/indicator-catalog.md) supports more than
  // pattern_library. Add explicit routes for the newly-graduating archetypes.
  if (/supertrend/.test(cn)) return "supertrend";
  if (/cumulative.delta|cvd.divergence/.test(cn)) return "cumulative_delta";
  if (/volume.profile|market.profile|(^|_)poc(_|$)|(^|_)vah(_|$)|(^|_)val(_|$)/.test(cn)) return "volume_profile";
  if (/ichimoku/.test(cn)) return "ichimoku_cloud";
  if (/(^|_)dema(_|$)|double.exponential/.test(cn)) return "dema_crossover";
  if (/(^|_)alma(_|$)|arnaud.legoux/.test(cn)) return "alma_filter";
  if (/rsi.divergence/.test(cn)) return "rsi_divergence";
  if (/atr.trailing.stop|chandelier/.test(cn)) return "atr_trailing_stop";
  if (/fifo.session|opening.imbalance/.test(cn)) return "fifo_session_open";

  // Pure-pattern primitives without explicit archetype mapping fall back to
  // the closest engine-supported indicator. liquidity_sweep_breakout is the
  // engine's compile target for sweep/raid concepts (see KB catalog).
  if (/liquidity.sweep|liquidity.void|stop.hunt/.test(cn)) return "liquidity_sweep_breakout";

  // W23H-postmortem-3 (2026-05-20): broader Fibonacci catch.
  // Operator screenshots showed "4H & 15M Fibonacci Step by Step" (99K views) +
  // similar. Engine routes Fibonacci-based retraces through ict_ote (62-79% fib
  // entry zone is the canonical engine archetype).
  if (/fibonacci|(^|_)fib(_|$)|fib.retrace|fib.level|fib.zone|golden.ratio.entry/.test(cn)) return "archetype:ict_ote";

  // W23H-postmortem-3: Candle Range Theory (CRT) — popularized by ICT-adjacent
  // creators (The Soup Room, JackTrades). 4H CRT model = identify range candle,
  // wait for sweep + reversal on LTF. Engine analog is turtle_soup (range
  // breakout reversal).
  if (/candle.range.theory|(^|_)crt(_|$)|crt.model|candle.range.trading|range.candle.theory/.test(cn)) return "archetype:ict_turtle_soup";

  // W23H-postmortem-3: Supply & Demand zones — institutional zone trading.
  // Engine analog is order_block (same concept: institutional resting orders
  // at supply/demand zones; W23G.3 already registered).
  if (/supply.demand|supply.and.demand|institutional.supply|institutional.demand|demand.zone|supply.zone/.test(cn)) return "archetype:order_block";

  if (/holy.grail|raschke/.test(cn)) return "ema_crossover";  // Raschke's setup IS 20-EMA pullback — valid

  // W23H-postmortem (2026-05-20): multi-timeframe analysis WITHOUT a specific
  // primary indicator is too generic to engine-route. Prefer the W23F.B bucket's
  // entryArchetype (from confluence factor analysis) if available. Falls through
  // to fallback path below if entryArchetype not set.
  if (/multi.timeframe|multi.tf|mtf.analysis|htf.bias|higher.timeframe.bias/.test(cn)) {
    if (fallback && ENTRY_INDICATOR_MAP[fallback]) return ENTRY_INDICATOR_MAP[fallback];
    return "ema_crossover";  // sensible default — most MTF setups gate MA-based entries
  }

  // W23H-postmortem (2026-05-20): subreddit-name-as-concept indicates the LLM
  // failed to extract a real strategy from a Reddit-sourced transcript and
  // emitted the subreddit name. These should never graduate. Reject explicitly.
  if (/^r_(daytrading|futurestrading|algotrading|trading|stocks|options)(_|$)/.test(cn)) return null;

  // Pivot points genuinely have no engine spec — these stay rejected until
  // engine work is done. Pass 21 v3 keeps the reject narrow.
  if (/pivot.point|floor.pivot|camarilla|woodie/.test(cn)) return null;

  // Fallback to archetype mapping ONLY for ambiguous cases.
  if (fallback && ENTRY_INDICATOR_MAP[fallback]) return ENTRY_INDICATOR_MAP[fallback];

  // No mapping at all → reject. Logging this helps tune the mapping.
  return null;
}

/**
 * Pass 21 v2 (2026-05-17) — smart numeric extraction from concept names.
 * Concepts like "9_21_ema_pullback", "rsi_2_connors", "ema921_pullback",
 * "8_21_ema_swing" all carry periods inline but in different shapes.
 *
 * Smart parsing handles:
 *   1. Underscore-delimited: "9_21_ema" → [9, 21]
 *   2. Compressed digits: "ema921" → [9, 21] (greedy split at sensible boundary)
 *   3. Numbers attached to indicator name: "rsi2", "ema9" → [2], [9]
 *   4. Multiple periods: "9_21_ema_macd" or "macd_12_26_9" → [9, 21] or [12, 26, 9]
 *   5. Connors RSI-2 textbook special-case → {period:2, oversold:5, overbought:95}
 *   6. Raschke Holy Grail → {fast:20, slow:50} (his actual 14-ADX + 20-EMA setup)
 *
 * Returns {} only if no plausible periods AND no special-case match.
 * Engine sanitizer (dsl-sanitizer.ts) clamps any out-of-range values.
 */
function smartExtractPeriods(cn: string): number[] {
  // Pass 1: standard \b\d+\b match (catches "_9_21_" patterns)
  const standardNums = (cn.match(/\b\d+\b/g) || []).map((n) => parseInt(n, 10));

  // Pass 2: split compressed digit-runs attached to letters like "ema921"
  // For each token containing letters+digits, try splitting the digit run
  // into a sensible two-period pair (favor common indicator period ranges).
  const compressedNums: number[] = [];
  const tokenMatches = cn.match(/([a-z]+)(\d{2,4})|([a-z]+\d+)/g) || [];
  for (const tok of tokenMatches) {
    const digitMatch = tok.match(/\d+/);
    if (!digitMatch) continue;
    const digits = digitMatch[0];
    if (digits.length === 1) {
      compressedNums.push(parseInt(digits, 10));
    } else if (digits.length === 2) {
      // "rsi14" → period 14 OR "ema27" → period 27
      compressedNums.push(parseInt(digits, 10));
    } else if (digits.length === 3) {
      // "ema921" → try split at position 1 → "9", "21" (both plausible periods)
      // OR split at position 2 → "92", "1" (less plausible — period 92 + 1?)
      // Heuristic: split where both halves are in the indicator-period range (2..250)
      for (let i = 1; i < 3; i++) {
        const left = parseInt(digits.slice(0, i), 10);
        const right = parseInt(digits.slice(i), 10);
        if (left >= 2 && left <= 250 && right >= 2 && right <= 250) {
          compressedNums.push(left, right);
          break;
        }
      }
    } else if (digits.length === 4) {
      // "ema921" rare 4-digit case — try 2/2 split first ("12" "21"), else 1/3 or 3/1
      const split22 = [parseInt(digits.slice(0, 2), 10), parseInt(digits.slice(2), 10)];
      if (split22.every((n) => n >= 2 && n <= 250)) {
        compressedNums.push(...split22);
      }
    }
  }

  // Merge + dedupe + filter to plausible-period range
  const all = [...new Set([...standardNums, ...compressedNums])].filter((n) => n >= 2 && n <= 250);
  return all;
}

// Wave 14 (2026-05-18) — canonical-default params for textbook indicators.
// Used as last-resort fill when the concept name doesn't contain explicit
// numbers AND the LLM extraction returned empty entry_params. Same defaults
// table as the Wave 13 transcript-extractor prompt v6 — keep these two in sync.
// Setting these for graduation does NOT bypass the dsl_quality_critic LLM
// judge, which still evaluates coherence between indicator + entry_condition
// + regime. So fabricated junk still gets rejected — this just stops the
// gate from rejecting on emptiness alone when the indicator IS textbook.
const CANONICAL_DEFAULT_PARAMS: Record<string, Record<string, number>> = {
  rsi_reversal:        { period: 14, oversold: 30, overbought: 70 },
  rsi_divergence:      { period: 14, divergence_lookback: 5 },
  ema_crossover:       { fast_period: 9, slow_period: 21 },
  sma_crossover:       { fast_period: 50, slow_period: 200 },
  macd_crossover:      { fast_period: 12, slow_period: 26, signal_period: 9 },
  bollinger_breakout:  { period: 20, std_dev: 2.0 },
  keltner_squeeze:     { bb_period: 20, kc_period: 20, kc_multiplier: 1.5 },
  atr_breakout:        { period: 14, multiplier: 1.5 },
  atr_trailing_stop:   { atr_period: 14, multiplier: 1.5 },
  donchian_breakout:   { period: 20 },
  supertrend:          { atr_period: 10, multiplier: 3.0 },
  ichimoku_cloud:      { tenkan_period: 9, kijun_period: 26, senkou_b_period: 52 },
  vwap_fade:           { atr_extension_threshold: 1.0 },
  vwap_reversion:      { deviation_threshold: 1.0 },
  session_open_breakout: { range_minutes: 15 },
  cumulative_delta:    { window: 20, divergence_threshold: 0.3 },
  dema_crossover:      { fast_period: 9, slow_period: 21 },
  alma_filter:         { period: 21, offset: 0.85, sigma: 6 },
};

function deriveEntryParams(conceptName: string, indicator: string | null): Record<string, number> {
  if (!indicator) return {};
  const cn = conceptName.toLowerCase();
  const nums = smartExtractPeriods(cn);
  const params: Record<string, number> = {};

  if (indicator === "ema_crossover" || indicator === "sma_crossover" || indicator === "macd_crossover") {
    if (nums.length >= 2) {
      params["fast_period"] = nums[0];
      params["slow_period"] = nums[1];
      if (indicator === "macd_crossover" && nums.length >= 3) params["signal_period"] = nums[2];
    }
  } else if (indicator === "connors_rsi2") {
    // F-3 (2026-05-20): Connors RSI-2 is a distinct indicator family with its
    // own canonical ranges (period [2,5], oversold [3,10], overbought [90,97]).
    // Routing here preserves period=2 which rsi_reversal [7,21] would reject.
    params["period"] = 2;
    params["oversold"] = 5;
    params["overbought"] = 95;
    // Allow concept-name overrides for the rare RSI-3/RSI-4 Connors variants.
    if (nums.length >= 1 && nums[0] <= 5) params["period"] = nums[0];
  } else if (indicator === "rsi_reversal") {
    if (nums.length >= 1) params["period"] = nums[0];
  } else if (indicator === "bollinger_breakout") {
    if (nums.length >= 1) params["period"] = nums[0];
    if (nums.length >= 2) params["std_dev"] = nums[1] >= 10 ? 2.0 : nums[1];  // articles often write "20, 2" or "20, 2.0"
  } else if (indicator === "atr_breakout" || indicator === "donchian_breakout") {
    if (nums.length >= 1) params["period"] = nums[0];
  } else if (indicator === "session_open_breakout") {
    // ORB-style: number in concept often refers to range minutes
    if (/15.?min|opening_range_15/.test(cn)) params["range_minutes"] = 15;
    else if (/5.?min|opening_range_5/.test(cn)) params["range_minutes"] = 5;
    else if (/30.?min|opening_range_30/.test(cn)) params["range_minutes"] = 30;
  }

  // Wave 14 — canonical-default fill. Apply ONLY to keys that are still missing
  // after the concept-name extraction above. Speaker/concept-name values WIN
  // over canonical defaults; defaults only fill silence. Then the downstream
  // PARAM_RANGES check + dsl_quality_critic LLM judge still validate coherence.
  const canonical = CANONICAL_DEFAULT_PARAMS[indicator];
  if (canonical) {
    for (const [k, v] of Object.entries(canonical)) {
      if (params[k] === undefined) params[k] = v;
    }
  }
  return params;
}

export function deriveEntryType(conceptName: string, fallback: string | null): string {
  const cn = conceptName.toLowerCase();
  // Pass 21 (2026-05-12 audit fix) — expanded coverage for the families the
  // audit revealed were falling through to 'unknown' (volume profile, pivot,
  // vwap, ema-from-reddit, ict, fvg). Order matters: more-specific first.
  if (/orb|opening.range|first.hour|session.open/.test(cn)) return "session_pattern";
  if (/breakout|inside.bar|nr4|nr7|squeeze.*breakout|gap.*go/.test(cn)) return "breakout";
  if (/sweep|liquidity|fvg|fair.value.gap|smc|ict|smart.money/.test(cn)) return "breakout";
  if (/pullback|continuation|cross|trend.follow|trend.continuation|ema|sma|macd|supertrend/.test(cn)) return "trend_follow";
  if (/mean.reversion|fade|reversal|oversold|overbought|squeeze|bollinger|rsi|stochastic|williams/.test(cn)) return "mean_reversion";
  if (/volatility|expansion|atr.expansion|donchian|keltner/.test(cn)) return "volatility_expansion";
  if (/pivot|vwap|volume.profile|market.profile|vah|val|poc/.test(cn)) return "session_pattern";
  if (/news|inventory|fomc|cpi|nfp|earnings/.test(cn)) return "event_driven";
  // Fallback chain: respect bucket archetype if it's not 'unknown'/empty, else default to trend_follow
  if (fallback && fallback !== "unknown" && fallback.trim().length > 0) return fallback;
  return "trend_follow";
}

function deriveTimeframe(extractedIdea: Record<string, unknown> | null, conceptName: string): string {
  const tf = String((extractedIdea as any)?.timeframe ?? "");
  if (/^(1m|5m|15m|30m|1h|4h|1d)$/.test(tf)) return tf;
  // ORB-family defaults to 15m, EMA pullback to 5m, RSI/Stochastic to 5m
  const cn = conceptName.toLowerCase();
  if (/15.?min|opening.range|orb/.test(cn)) return "15m";
  if (/1h|hourly|swing/.test(cn)) return "1h";
  return "5m";
}

/**
 * Pass 21 v3 (2026-05-17) — produce a clean canonical strategy name instead of
 * a URL-slug / video-title slug. Two-stage approach:
 *   1. Detect canonical archetypes (Connors RSI-2, Raschke Holy Grail, NR7, ORB,
 *      9/21 EMA pullback) and short-name them.
 *   2. Otherwise, strip URL/site/forum/tutorial-style noise from the raw
 *      concept name before composing.
 */
function prettifyConcept(conceptName: string): string {
  const cn = conceptName.toLowerCase();

  // Canonical archetypes — exact short names
  if (/connors.*rsi.?2|rsi.?2.*connors|rsi2.*connors/.test(cn)) return "connors_rsi2";
  if (/raschke.*holy.grail|holy.grail.*raschke|linda.*holy.grail/.test(cn)) return "raschke_holy_grail";
  if (/(^|_)nr7(_|$)|narrow.range.7|narrow.range.seven/.test(cn)) return "nr7";
  if (/(^|_)nr4(_|$)|narrow.range.4|narrow.range.four/.test(cn)) return "nr4";
  if (/double.compression|nr7.id|narrow.range.inside.day/.test(cn)) return "nr7_inside_day";
  if (/9.{0,4}21.*ema|ema.*9.{0,4}21|ema921/.test(cn)) return "ema_9_21_pullback";
  if (/20.{0,4}50.*ema|ema.*20.{0,4}50/.test(cn)) return "ema_20_50_pullback";
  if (/failed.opening.range|failed.orb|orb.fail|orb.reversal/.test(cn)) return "orb_failure_reversal";
  if (/pre.market.range|premarket.range|asian.range.break|euro.range.break/.test(cn)) return "premarket_range_break";
  if (/opening.range.{0,8}15|orb.{0,8}15|15.{0,8}orb/.test(cn)) return "orb_15m";
  if (/opening.range.{0,8}5|orb.{0,8}5m|5.{0,8}orb/.test(cn)) return "orb_5m";
  if (/opening.range|(^|_)orb(_|$)/.test(cn)) return "orb";
  if (/inside.bar.breakout/.test(cn)) return "inside_bar_breakout";
  if (/bollinger.squeeze|bb.squeeze/.test(cn)) return "bollinger_squeeze";
  if (/keltner.squeeze|ttm.squeeze/.test(cn)) return "keltner_squeeze";
  if (/vwap.rejection.{0,4}hod|vwap.rejection.{0,4}lod|hod.lod.fade/.test(cn)) return "vwap_hod_lod_rejection";
  if (/anchored.vwap.pullback|avwap.pullback/.test(cn)) return "anchored_vwap_pullback";
  if (/vwap.{0,4}standard.deviation.{0,4}fade|vwap.{0,4}1.{0,4}sigma|vwap.{0,4}sd.{0,4}fade/.test(cn)) return "vwap_sigma_fade";
  if (/vwap.fade|vwap.reversion/.test(cn)) return "vwap_fade";
  if (/macd|moving.average.convergence/.test(cn)) return "macd_crossover";
  if (/stochastic.rsi|stoch.rsi/.test(cn)) return "stochastic_rsi";
  if (/asian.range.fade|asian.session.fade/.test(cn)) return "asian_range_fade";
  if (/keltner.channel/.test(cn)) return "keltner_channel";
  if (/overnight.gap.fade|gap.fade.{0,8}rth|gap.fade.{0,8}open/.test(cn)) return "overnight_gap_fade";
  if (/overnight.inventory|overnight.drift/.test(cn)) return "overnight_inventory_drift";
  if (/trend.day.continuation|bellafiore.add|add.trend.day|trend.day.add/.test(cn)) return "trend_day_continuation";
  if (/london.{0,8}ny.{0,8}overlap|ny.{0,8}london.{0,8}reversal/.test(cn)) return "london_ny_overlap_reversal";
  if (/power.hour.reversal|eod.{0,8}reversal|3pm.{0,8}reversal/.test(cn)) return "power_hour_reversal";
  if (/afternoon.doldrums|2pm.{0,8}chop.fade|midday.{0,8}fade/.test(cn)) return "afternoon_chop_fade";
  if (/crude.{0,8}inventory.fade|mcl.{0,8}inventory.fade|cl.{0,8}inventory.fade/.test(cn)) return "crude_inventory_fade";
  if (/topstep.{0,8}consistency|topstep.{0,8}session.window|topstep.{0,8}funded/.test(cn)) return "topstep_consistency_window";

  // ── ICT canonical archetypes (engine: src/engine/strategies/) ──
  if (/silver.bullet|ict.{0,6}sb(_|$)/.test(cn)) {
    if (/3.{0,4}am|london/.test(cn)) return "ict_silver_bullet_london";
    if (/2.{0,4}pm|14.{0,4}00|ny.{0,4}pm/.test(cn)) return "ict_silver_bullet_ny_pm";
    return "ict_silver_bullet_ny_am"; // default 10am window
  }
  if (/judas.swing|london.manipulation|am.session.judas/.test(cn)) return "ict_judas_swing";
  if (/ny.lunch.reversal|12.{0,4}pm.reversal|new.york.lunch/.test(cn)) return "ict_ny_lunch_reversal";
  if (/midnight.open|ndog|nwog/.test(cn)) return "ict_midnight_open";
  if (/london.raid|asia.range.raid/.test(cn)) return "ict_london_raid";
  if (/turtle.soup|swing.failure/.test(cn)) return "ict_turtle_soup";
  if (/optimal.trade.entry|(^|_)ote(_|$)|62.{0,4}79.{0,4}fib/.test(cn)) return "ict_ote";
  if (/power.of.3|power.of.three|amd.cycle|accumulation.manipulation.distribution/.test(cn)) return "ict_power_of_3";
  if (/(^|_)unicorn(_|$)|fvg.breaker|breaker.fvg.confluence/.test(cn)) return "ict_unicorn";
  // W23G.3 (2026-05-19) — short-form alias matches for structural recovery stubs.
  // These must come before the "ict_breaker" / "fvg_retrace" canonical matches so
  // that concepts named exactly "breaker_block", "judas_swing", "silver_bullet",
  // "fvg" resolve to the W23G.3 short aliases (which ARCHETYPE_REGISTRY has direct
  // entries for) rather than being rewritten to an "ict_" canonical key that the
  // recovery stub didn't use.
  if (/^fvg$|^fair_value_gap$/.test(cn)) return "fvg";
  if (/^judas_swing$|^judas\.swing$/.test(cn)) return "judas_swing";
  if (/^silver_bullet$|^silver\.bullet$/.test(cn)) return "silver_bullet";
  if (/^breaker_block$|^breaker\.block$/.test(cn)) return "breaker_block";
  if (/breaker.block|failed.swing.breaker/.test(cn)) return "ict_breaker";
  if (/mitigation.block|mitigation.entry/.test(cn)) return "ict_mitigation";
  if (/(^|_)iofed(_|$)|institutional.order.flow.entry/.test(cn)) return "ict_iofed";
  if (/smt.divergence|smt.reversal|smart.money.technique/.test(cn)) return "smt_reversal";
  if (/quarterly.swing|q1.q2.q3.q4.swing/.test(cn)) return "ict_quarterly_swing";
  if (/propulsion.block/.test(cn)) return "ict_propulsion";
  if (/eqhl.raid|equal.high.low.raid/.test(cn)) return "ict_eqhl_raid";
  if (/ict.{0,8}scalp/.test(cn)) return "ict_scalp";
  if (/ict.{0,8}swing/.test(cn)) return "ict_swing";
  if (/ict.{0,8}2022/.test(cn)) return "ict_2022";

  // ── Structural primitives (universal across ICT/SMC) ──
  if (/break.of.structure|(^|_)bos(_|$)/.test(cn)) return "break_of_structure";
  if (/change.of.character|(^|_)choch(_|$)|change.character/.test(cn)) return "change_of_character";
  if (/market.structure.shift|(^|_)mss(_|$)/.test(cn)) return "market_structure_shift";
  if (/change.in.state.of.delivery|(^|_)cisd(_|$)/.test(cn)) return "cisd";
  if (/fair.value.gap|(^|_)fvg(_|$)/.test(cn)) return "fvg_retrace";
  if (/order.block|(^|_)ob(_|$)/.test(cn)) return "order_block";
  if (/liquidity.sweep|liquidity_sweep_breakout|(^|_)bsl(_|$)|(^|_)ssl(_|$)|stop.hunt/.test(cn)) return "liquidity_sweep";

  // ── Wyckoff archetypes (W23F.Q 2026-05-19) — route to engine analogs ──
  if (/wyckoff.spring|spring.pattern|spring.wyckoff/.test(cn)) return "wyckoff_spring";
  if (/wyckoff.upthrust|upthrust.after.distribution|(^|_)utad(_|$)/.test(cn)) return "wyckoff_upthrust";
  if (/wyckoff.accumulation|accumulation.phase.wyckoff/.test(cn)) return "wyckoff_accumulation";
  if (/wyckoff.distribution|distribution.phase.wyckoff/.test(cn)) return "wyckoff_distribution";

  // ── Generic SMC umbrella — route to liquidity_sweep (most common SMC entry) ──
  // Note: granular SMC concepts (FVG, OB, BSL/SSL) match earlier — this is the fallback
  if (/smart.money.concept|(^|_)smc(_|$)|smart.money.technique/.test(cn)) return "liquidity_sweep";

  // ── Order flow / cumulative delta — route to cumulative_delta primitive ──
  // W23F.R (2026-05-19) — broaden CVD matching to catch cvd_pro / cumulative_volume_delta variants
  if (/order.flow|footprint.chart|absorption.rejection|delta.divergence|cvd.pro|cumulative.volume.delta|(^|_)cvd(_|$)|delta.imbalance/.test(cn)) return "cumulative_delta";

  // ── Wyckoff ──
  if (/wyckoff.spring|spring.{0,8}wyckoff/.test(cn)) return "wyckoff_spring";
  if (/wyckoff.upthrust|utad/.test(cn)) return "wyckoff_upthrust";
  if (/wyckoff.accumulation/.test(cn)) return "wyckoff_accumulation";
  if (/wyckoff.distribution/.test(cn)) return "wyckoff_distribution";

  // ── Volume / Market Profile ──
  if (/poc.rejection|point.of.control.fade/.test(cn)) return "poc_rejection";
  if (/value.area.rotation|va.rotation|vah.val.rotation/.test(cn)) return "value_area_rotation";
  if (/initial.balance.extension|ib.extension|ib.break/.test(cn)) return "ib_extension";
  if (/volume.profile.{0,8}hvn|hvn.rejection/.test(cn)) return "hvn_rejection";
  if (/volume.profile.{0,8}lvn|lvn.break/.test(cn)) return "lvn_break";

  // ── Order flow ──
  if (/cumulative.delta.divergence|cvd.divergence/.test(cn)) return "cvd_divergence";
  if (/stacked.imbalance|footprint.imbalance/.test(cn)) return "stacked_imbalance";
  if (/absorption.iceberg|iceberg.absorption/.test(cn)) return "absorption_iceberg";

  // ── Supertrend ──
  if (/supertrend/.test(cn)) return "supertrend";

  // Noise strip — remove URL/site/forum/tutorial/clickbait words before composing
  const NOISE = /\b(backtest|results|backtested|forums?|forum|uk|com|net|org|www|fr|de|setup|explained|guide|tutorial|the|a|an|how|to|trading|strategy|strategies|trade|trades|trader|traders|indicator|indicators|chartschool|stockcharts|litefinance|finveroo|thinkorswim|trade2win|reddit|youtube|brave|in|of|for|with|and|or|on|by|via|best|top|pro|free|new|understanding|mastering|introducing|short|term|long|that|work|works|your|global|big|small|tight|risk|reward|formula|settings|s)\b/gi;
  const cleaned = cn.replace(NOISE, "_").replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const tokens = cleaned.split("_").filter((t) => t.length > 0).slice(0, 4);
  return tokens.join("_") || conceptName;
}

function deriveStrategyName(conceptName: string, market: string, timeframe: string): string {
  const pretty = prettifyConcept(conceptName);
  // Already-symboled archetype (e.g. "orb_15m") — don't double-tag the timeframe.
  if (/_(\d+m|\d+h|\d+d)$/.test(pretty)) return `${pretty}_${market.toLowerCase()}`.replace(/_+/g, "_").slice(0, 80);
  return `${pretty}_${market.toLowerCase()}_${timeframe}`.replace(/_+/g, "_").slice(0, 80);
}

/**
 * Construct a production-grade strategy directly from a graduated bucket +
 * best mention. Returns null strategyId on hard failure (logged, never throws).
 */
export async function graduateBucketDirectly(opts: {
  bucketId: string;
  bestMention: Mention;
  bucketMeta: BucketMetadata;
  sourceCount: number;
  distinctProviders: number;
  layersCovered: number;
  layerTags: string[];
  webUrls: string[];
  youtubeUrls: string[];
  redditUrls: string[];
  correlationId?: string | null;
}): Promise<DirectGraduationResult> {
  const { bucketId, bestMention, bucketMeta, sourceCount, distinctProviders, layersCovered, layerTags, correlationId } = opts;
  const extractedIdea = bestMention.extractedIdea ?? {};
  const market = bucketMeta.market;

  // ─── Pass 21 v3 (2026-05-17): Source URL plausibility check ────────────
  // Cheapest gate first: reject if the source URL itself signals
  // non-strategy content (Reddit discussion thread, economic event page,
  // click-bait listicle). Saves all downstream LLM + DB cost.
  const srcUrl = String(bestMention.sourceUrl ?? "").toLowerCase();
  const URL_REJECT_PATTERNS = [
    /reddit\.com\/r\/.+\/comments\/.+\/(why_dont|why_doesn|is_making|anyone_else|who_else)/i,
    /reddit\.com\/r\/.+\/comments\/.+_realistic/i,
    /(crude_oil_inventories|jobless_claims|payrolls_report|cpi_release|retail_sales_report)/i,
    /(millionaires|secrets|dangerous_traps|5_min_rich|200_percent_returns)/i,
  ];
  for (const pat of URL_REJECT_PATTERNS) {
    if (pat.test(srcUrl)) {
      logger.warn(
        { bucketId, conceptName: bucketMeta.conceptName, srcUrl, pattern: String(pat) },
        `direct-graduator: REJECTED — source URL matches non-strategy pattern`,
      );
      // Track A F-6: migrated to insertAuditRowSafe
      await insertAuditRowSafe({
        action: "graduation.rejected_url_pattern",
        entityType: "strategy_pending_bucket",
        entityId: bucketId,
        input: { bucket_id: bucketId, concept_name: bucketMeta.conceptName, source_url: bestMention.sourceUrl } as Record<string, unknown>,
        result: { reason: "source_url_matches_non_strategy_pattern", matched_pattern: String(pat) } as Record<string, unknown>,
        status: "rejected",
        decisionAuthority: "system",
        correlationId: correlationId ?? null, // TODO: correlation_id not threaded here
      });
      return {
        strategyId: null,
        strategyName: bucketMeta.conceptName ?? "unknown",
        skipped: true,
        reason: "source_url_non_strategy_pattern",
      };
    }
  }

  // De-dup level 1: if a strategy with this name already exists, skip.
  const conceptName = bucketMeta.conceptName;
  const timeframe = deriveTimeframe(extractedIdea, conceptName);
  // W23F.L.2 (2026-05-19) — canonicalize name from symbols[0] when present.
  // The LLM may extract a name containing the source's example market (e.g.
  // "orb_mes_15m" from a YouTube tutorial that used MES as the example) while
  // symbols[] carries the actual routing market for this cycle (e.g. ["MNQ"]).
  // Source of truth: symbols[0]. Name must reflect routing market, not source-text market.
  const symbolsForName: string[] = Array.isArray((extractedIdea as any)?.symbols) && (extractedIdea as any).symbols.length > 0
    ? (extractedIdea as any).symbols
    : [market];
  const canonicalMarketForName = symbolsForName[0];
  let strategyName = deriveStrategyName(conceptName, canonicalMarketForName, timeframe);
  // Pass 21 v3 corrected³ (2026-05-17): exclude archived strategies from
  // name-dedup. Archived row with this name should not block re-graduation;
  // suffix-disambiguate instead so the new row coexists with the archived
  // history.
  // Wave 9 (migration 0109): archived state now lives in archived_at column —
  // SQL-level invariant — instead of tag-substring matching. Tag check kept
  // for back-compat against rows archived BEFORE 0109 was applied (the column
  // backfill in the migration sets archived_at for all such rows; the OR-tag
  // branch is dead once the migration is in but harmless and cheap).
  const existing = await db.execute<{ id: string; tags: string[] | null; archived_at: string | null }>(sql`
    SELECT id::text, tags, archived_at FROM strategies WHERE name = ${strategyName} LIMIT 1`);
  const existingRows = Array.isArray(existing) ? existing : (existing as any).rows ?? [];
  if (existingRows.length > 0) {
    const row = existingRows[0];
    const archived = row.archived_at !== null
      || (Array.isArray(row.tags) && row.tags.includes("archived_duplicate"));
    if (!archived) {
      return { strategyId: row.id, strategyName, skipped: true, reason: "name_already_exists" };
    }
    // Archived name collision — disambiguate with date suffix so re-graduation proceeds
    const dateSuffix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    strategyName = `${strategyName}_v${dateSuffix}`.slice(0, 80);
    logger.info({ strategyName, originalName: deriveStrategyName(conceptName, canonicalMarketForName, timeframe) }, "graduator: archived name collision, using suffixed name");
  }

  // De-dup level 2 (Pass 21 — 2026-05-16): variant-aware fingerprint check.
  // Two strategies with different display names but identical
  // (market, canonical_concept, timeframe, direction, entry_params) are TEXTUAL
  // duplicates — same edge, different article-title noise. Skip those.
  //
  // Two strategies with the same concept but different timeframe/direction/params
  // are VARIANTS — keep both because they represent different real edges.
  // (e.g. 5m-ORB vs 15m-ORB, 9-EMA-pullback vs 21-EMA-pullback)
  //
  // The hash uses ONLY distinguishing fields, NOT framework-overlay-enforced
  // ones (stop_loss / exit_params / time_stop / position_size are identical
  // across the entire library so they don't differentiate).
  const direction = String((extractedIdea as any)?.direction ?? "long").toLowerCase();

  // Pass 21 (2026-05-16) — derive entry_params from concept name BEFORE the
  // wide-fingerprint dedup, so two graduations with different periods extracted
  // from their concept names produce different wide hashes.
  // Prefer LLM-extracted params if present; otherwise pull numerics from name.
  const earlyIndicator = deriveEntryIndicator(conceptName, bucketMeta.entryArchetype);
  const entryParamsFromExtraction = (extractedIdea as any)?.entry_params;
  const llmParams = (entryParamsFromExtraction && typeof entryParamsFromExtraction === "object")
    ? (entryParamsFromExtraction as Record<string, unknown>)
    : {};
  const namedParams = earlyIndicator ? deriveEntryParams(conceptName, earlyIndicator) : {};
  // LLM-provided values take precedence over name-derived (LLM is authoritative
  // when present; name-derive is a fallback for empty extractions).
  const effectiveEntryParams: Record<string, unknown> = { ...namedParams, ...llmParams };

  const wideFingerprint = computeWideConceptFingerprintHash({
    market,
    concept_name: conceptName,
    timeframe,
    direction,
    entry_params: effectiveEntryParams,
  });

  // Pass 21 v3 corrected³ (2026-05-17): exclude archived strategies from
  // wide-fingerprint dedup. Otherwise an archived BAD strategy permanently
  // blocks re-graduation of the same concept after the gate is fixed and
  // legitimate sources surface. Archive should not be a tombstone for the
  // strategy SPACE, only for that specific row.
  // Wave 9 (migration 0109): wide-fingerprint dedup filters via archived_at IS
  // NULL (SQL-level invariant) AND lifecycle_state NOT IN ('GRAVEYARD','RETIRED').
  // Tag check kept for back-compat against pre-0109 archived rows.
  const wideDupe = await db.execute<{ id: string; name: string }>(sql`
    SELECT s.id::text, s.name
      FROM strategies s
      JOIN strategy_pending_buckets b ON b.graduated_strategy_id = s.id
     WHERE s.config->'metadata'->>'source' = 'graduated_bucket'
       AND b.wide_fingerprint_hash = ${wideFingerprint}
       AND s.archived_at IS NULL
       AND s.lifecycle_state NOT IN ('GRAVEYARD','RETIRED')
       AND NOT ('archived_duplicate' = ANY(COALESCE(s.tags, ARRAY[]::text[])))
     LIMIT 1
  `);
  const wideRows = Array.isArray(wideDupe) ? wideDupe : (wideDupe as any).rows;
  if (wideRows && wideRows.length > 0) {
    const dup = wideRows[0];
    logger.info(
      { bucketId, strategyName, conceptName, timeframe, direction, wideFingerprint, dupStrategyId: dup.id, dupName: dup.name },
      `direct-graduator: wide-fingerprint collision — textual duplicate of '${dup.name}', skipping`,
    );
    await db.insert(auditLog).values({
      action: "graduation.skipped_textual_duplicate",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: { bucket_id: bucketId, concept_name: conceptName, timeframe, direction } as Record<string, unknown>,
      result: { wide_fingerprint: wideFingerprint, existing_strategy_id: dup.id, existing_strategy_name: dup.name } as Record<string, unknown>,
      status: "skipped",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "audit_log write failed (non-blocking)"));
    return {
      strategyId: dup.id,
      strategyName,
      skipped: true,
      reason: `textual_duplicate_of: ${dup.name}`,
    };
  }

  // ─── Pass 21 (2026-05-12): Daily graduation cap ──────────────────────────
  // 63 graduations in a 24h window on 2026-05-12 caused ~3,500 GPT-5-mini calls
  // + ~52M tokens of cross-validation work + filled the strategies table with
  // un-tested candidates. Target: 5-6/day per CLAUDE.md operator-workflow §3.
  // Hard cap: GRADUATION_DAILY_CAP (default 8). Excess buckets stay in
  // 'pending' status — they'll re-evaluate next cycle once today's slots free.
  const DAILY_CAP = Math.max(1, Number(process.env.GRADUATION_DAILY_CAP) || 8);
  const todayCount = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM strategies
        WHERE config->'metadata'->>'source' = 'graduated_bucket'
        AND created_at >= NOW()::date`
  );
  const todayGraduated = Number((Array.isArray(todayCount) ? todayCount[0] : (todayCount as any).rows?.[0])?.count ?? 0);
  if (todayGraduated >= DAILY_CAP) {
    logger.warn(
      { bucketId, conceptName, strategyName, todayGraduated, dailyCap: DAILY_CAP },
      `direct-graduator: daily graduation cap reached (${todayGraduated}/${DAILY_CAP}) — bucket stays pending, will re-evaluate next cycle`,
    );
    return {
      strategyId: null,
      strategyName,
      skipped: true,
      reason: `daily_cap_reached: ${todayGraduated}/${DAILY_CAP}`,
    };
  }

  const entryType = deriveEntryType(conceptName, bucketMeta.entryArchetype);
  const entryIndicator = deriveEntryIndicator(conceptName, bucketMeta.entryArchetype);

  // Pass 21 (2026-05-16) — REJECT graduation if no engine-compatible indicator.
  // Concepts like Supertrend, ICT/SMC, FVG, Volume Profile, Pivot Points have
  // no entry in the engine's pattern_library, so a strategy with these would
  // fail at compile time anyway. Better to reject here, log the concept for
  // future engine work, and free up the daily-cap slot.
  if (entryIndicator === null) {
    logger.warn(
      { bucketId, conceptName, strategyName, archetype: bucketMeta.entryArchetype },
      `direct-graduator: REJECTED — concept '${conceptName}' has no engine-compatible indicator. Add to pattern_library.py to enable.`,
    );
    await db.insert(auditLog).values({
      action: "graduation.rejected_no_engine_indicator",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: { bucket_id: bucketId, concept_name: conceptName, archetype: bucketMeta.entryArchetype } as Record<string, unknown>,
      result: { reason: "no_engine_compatible_indicator", strategy_name: strategyName } as Record<string, unknown>,
      status: "rejected",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "audit_log write failed (non-blocking)"));
    return {
      strategyId: null,
      strategyName,
      skipped: true,
      reason: "no_engine_compatible_indicator",
    };
  }

  // Pass 21 — entry_params already computed up-top (effectiveEntryParams)
  // as LLM-provided ∪ name-derived. Sanitizer will clamp/fill missing required.
  const derivedEntryParams = effectiveEntryParams;

  // ─── Pass 21 v3 corrected (2026-05-17): DSL Quality Critic gate ────────
  // Before INSERT, verify the strategy isn't THIN. Two routing modes:
  //
  //   PARAMETRIC: entryIndicator is in REQUIRED_PARAMS_BY_INDICATOR_FULL.
  //     Reject if BOTH:
  //       1. entry_params missing required keys for the indicator
  //       2. extractedIdea has no real entry_condition prose
  //
  //   STRUCTURAL (archetype): entryIndicator starts with "archetype:".
  //     ICT/SMC/Wyckoff strategies are detector-driven, not parameter-driven.
  //     Skip numeric-param requirement. Require real entry_condition prose
  //     describing the structural setup (sweep, MSS, FVG, displacement, etc.)
  //
  // Both modes still require extraction_confidence >= 0.5.
  const isArchetype = entryIndicator.startsWith("archetype:");
  const archetypeName = isArchetype ? entryIndicator.slice("archetype:".length) : null;
  const archetypeMeta = archetypeName ? ARCHETYPE_REGISTRY[archetypeName] : null;
  const requiredKeys = isArchetype ? [] : (REQUIRED_PARAMS_BY_INDICATOR_FULL[entryIndicator] ?? []);

  // Pass 21 v3 bug-fix (2026-05-17): require ALL keys, not ANY. NR7 leaked through
  // with {period:7} because .some() returned true on period alone, skipping the
  // missing multiplier check.
  const paramsHasRequired = isArchetype || requiredKeys.length === 0 ||
    requiredKeys.every((k) => k in derivedEntryParams);

  const extractedEntry = String((extractedIdea as any)?.entry_condition ?? (extractedIdea as any)?.entry_rules ?? "").toLowerCase();
  // Pass 21 v3 corrected (2026-05-17): extend trigger-keyword regex to cover
  // ICT/SMC/Wyckoff structural language. Without this, archetype strategies
  // would fail hasRealRules even when prose is correct ("sweep then MSS then
  // enter on FVG retrace" has no close/cross/break literals).
  const hasRealRules = extractedEntry.length > 40 &&
    /(close|cross|break|above|below|enter|trigger|when|rsi\s*[<>]|ema\(|sma\(|sweep|displacement|mss|(^|\W)fvg(\W|$)|retrace|(^|\W)ote(\W|$)|breaker|choch|(^|\W)bos(\W|$)|cisd|killzone|manipulation|order.block|fair.value.gap|liquidity|raid|accumulation|distribution|spring|upthrust|poc|vah|val|imbalance|absorption)/.test(extractedEntry);

  // Pass 21 v3 corrected³ (2026-05-17): NULL handling for extraction_confidence.
  //
  // Layer 1 (web/reddit) discovery mentions don't emit extraction_confidence
  // because they're discovery leads, not LLM-extracted rules. Layer 2 (youtube
  // transcript extraction) DOES emit it. Original Pass 21 v3 used null→0
  // (fail-closed) which killed every Layer-1-only graduation. Original Pass 21
  // used null→1.0 (full trust) which let everything through.
  //
  // Middle ground: null→0.5 (just passes the >=0.5 threshold). Other gates
  // (param range, prose quality, dsl_quality_critic LLM judge) still apply.
  // Explicit low extraction_confidence values from the transcript extractor
  // (< 0.5) still fail-closed at the LLM level where it was set.
  const rawConfidence = (extractedIdea as any)?.extraction_confidence;
  const extractionConfidence = (rawConfidence === undefined || rawConfidence === null)
    ? 0.5
    : Number(rawConfidence);

  // Pass 21 v3 corrected³ (2026-05-17): ARCHETYPE-MECHANIC keyword check.
  // For known archetypes, the entry_long must mention the SPECIFIC mechanics
  // that DEFINE that archetype. A "Silver Bullet" strategy without time-window
  // + sweep + FVG language is NOT really a Silver Bullet; it's a different
  // strategy that happened to land in a bucket named "silver_bullet". Reject
  // these to keep the library honest about what each strategy actually is.
  // Wave 13 (2026-05-18) — archetype gate redesign. The previous N-of-N rule
  // (ALL regexes must match) was over-aggressive — many legitimate transcripts
  // describe the archetype event without using context words like "continuation"
  // or "trend." We split into:
  //   1. `identifier` — REQUIRED archetype-identifying regex (the term that
  //      defines the archetype: "BOS", "spring", "MSS", "sweep+FVG").
  //   2. `context` — OPTIONAL supporting keywords that raise confidence but
  //      do NOT block on miss. Logged as advisory.
  // Net effect: real-world tutorial DSL passes the gate as long as the
  // archetype identifier appears. Hallucination-defense lives elsewhere:
  // the dsl_quality_critic LLM judge (anti-pattern catalog) + source-fidelity
  // check + thin_dsl prose-length floor.
  const ARCHETYPE_MECHANIC_KEYWORDS: Record<string, { identifier: RegExp; context: RegExp[] }> = {
    ict_silver_bullet_ny_am: { identifier: /silver.bullet|(10|11)[:\s]?am|10[:.]00|ny am|new york am/i, context: [/sweep|liquidity/i, /fvg|fair.value.gap/i] },
    ict_silver_bullet_london: { identifier: /silver.bullet|(3|4)[:\s]?am|03[:.]00|london open/i, context: [/sweep|liquidity/i, /fvg|fair.value.gap/i] },
    ict_silver_bullet_ny_pm: { identifier: /silver.bullet|(2|3)[:\s]?pm|14[:.]00|ny pm|new york pm/i, context: [/sweep|liquidity/i, /fvg|fair.value.gap/i] },
    ict_judas_swing: { identifier: /judas|manipulation|fake.move|fake.breakout/i, context: [/mss|market.structure.shift|reversal/i] },
    ict_ny_lunch_reversal: { identifier: /lunch|12[:\s]?pm|12[:.]00|1[:\s]?pm/i, context: [/mss|reversal|reverse/i] },
    ict_ote: { identifier: /ote|optimal.trade.entry|optimal.entry/i, context: [/bos|break.of.structure/i, /62|70|79|fib|fibonacci/i] },
    ict_power_of_3: { identifier: /power.of.3|power.of.three|accumulation.*manipulation|po3/i, context: [/asia/i, /london/i, /ny/i] },
    ict_unicorn: { identifier: /unicorn/i, context: [/breaker|breaker.block/i, /fvg|fair.value.gap/i] },
    ict_breaker: { identifier: /breaker|failed.swing|flipped/i, context: [/retest|return/i] },
    ict_mitigation: { identifier: /mitigation/i, context: [/retest|return|reentry/i] },
    ict_iofed: { identifier: /iofed|displacement.*fvg|fvg.*displacement/i, context: [/order.flow/i, /htf|higher.timeframe/i] },
    smt_reversal: { identifier: /smt|smart.money.divergence|correlation.divergence/i, context: [/mss|reversal/i, /nq.*es|es.*nq/i] },
    ict_turtle_soup: { identifier: /turtle.soup|equal.high|equal.low|eqh|eql/i, context: [/sweep|failure|reversal/i] },
    ict_midnight_open: { identifier: /midnight|00[:.]00|ndog|nwog|new.day.opening.gap/i, context: [/mean.reversion|return/i] },
    fvg_retrace: { identifier: /fvg|fair.value.gap/i, context: [/retrace|return|fill/i] },
    order_block: { identifier: /order.block|ob|last.opposite/i, context: [/retest|return/i] },
    liquidity_sweep: { identifier: /sweep|stop.hunt|bsl|ssl|liquidity.grab|liquidity.raid/i, context: [/reversal|reclaim|reject/i] },
    wyckoff_spring: { identifier: /spring|false.breakdown|reclaim/i, context: [/accumulation|support|secondary.test/i] },
    wyckoff_upthrust: { identifier: /upthrust|utad|false.breakout/i, context: [/distribution|resistance|secondary.test/i] },
    break_of_structure: { identifier: /bos|break.of.structure/i, context: [/continuation|trend|momentum|retrace/i] },
    change_of_character: { identifier: /choch|change.of.character|character.shift/i, context: [/reversal|reverse|flip/i] },
    market_structure_shift: { identifier: /mss|market.structure.shift|structure.shift/i, context: [/sweep|reversal/i] },
    cisd: { identifier: /cisd|change.in.state.of.delivery/i, context: [/delivery|reversal|earliest/i] },
    ict_london_raid: { identifier: /london.raid|london.sweep|asia.*sweep|asian.range.sweep/i, context: [/sweep|raid/i, /mss/i] },
    ict_quarterly_swing: { identifier: /quarterly|q1|q2|q3|q4|quarterly.theory/i, context: [/cycle|weekly|daily/i] },
    ict_propulsion: { identifier: /propulsion/i, context: [/breaker|continuation|mitigation/i] },
    ict_eqhl_raid: { identifier: /equal.high|equal.low|eqh|eql/i, context: [/raid|sweep|liquidity/i] },
    ict_scalp: { identifier: /killzone|kill.zone|scalp/i, context: [/sweep|mss|displacement/i, /fvg/i] },
    ict_swing: { identifier: /ict.swing|htf.bias|higher.timeframe.bias/i, context: [/sweep|premium|discount/i, /bos/i] },
    ict_2022: { identifier: /ict.2022|mentorship|2022.model/i, context: [/sweep|mss/i, /fvg/i] },
    wyckoff_accumulation: { identifier: /accumulation|spring/i, context: [/secondary.test|sign.of.strength|sos/i] },
    wyckoff_distribution: { identifier: /distribution|upthrust/i, context: [/secondary.test|sign.of.weakness|sow/i] },
  };

  let mechanicKeywordErrors: string[] = [];
  let mechanicKeywordContextWarnings: string[] = [];
  if (isArchetype && archetypeName && ARCHETYPE_MECHANIC_KEYWORDS[archetypeName]) {
    const spec = ARCHETYPE_MECHANIC_KEYWORDS[archetypeName];
    // HARD-FAIL only if archetype identifier is missing — that means the
    // extracted DSL doesn't actually describe this archetype.
    if (!spec.identifier.test(extractedEntry)) {
      mechanicKeywordErrors = [spec.identifier.source];
    } else {
      // Identifier present → archetype is real. Log context misses as advisory.
      const contextMissing = spec.context.filter((re) => !re.test(extractedEntry));
      if (contextMissing.length > 0) {
        mechanicKeywordContextWarnings = contextMissing.map((re) => re.source);
      }
    }
  }

  // Pass 21 v3 corrected³ (2026-05-17): TIGHTENED gate. Previous logic used
  // `!paramsHasRequired && !hasRealRules` (passes if EITHER one is OK). That
  // let strategies with valid params + Reddit-thread-title entry_long sneak
  // through. New rule: parametric path requires BOTH valid params AND real
  // prose; archetype path requires real prose (structural detectors fill
  // the param gap).
  //
  // Plus: hard range-check via PARAM_RANGES — mirrors pattern_library.py so
  // Connors RSI-2 with period=2 (canonical range 7-21) is rejected pre-INSERT
  // instead of failing at engine compile time.
  const paramRangeErrors = isArchetype ? [] : validateParamRanges(entryIndicator, derivedEntryParams as Record<string, unknown>);
  const paramsInRange = paramRangeErrors.length === 0;

  let rejectForGate = false;
  let gateRejectReason = "";
  if (extractionConfidence < 0.5) {
    rejectForGate = true;
    gateRejectReason = `low_extraction_confidence: ${extractionConfidence}`;
  } else if (!paramsInRange) {
    rejectForGate = true;
    gateRejectReason = `param_range_violation: ${paramRangeErrors.join("; ")}`;
  } else if (isArchetype && !hasRealRules) {
    rejectForGate = true;
    gateRejectReason = `thin_archetype_dsl: archetype ${archetypeName} requires real entry_condition prose describing the structural setup`;
  } else if (isArchetype && mechanicKeywordErrors.length > 0) {
    rejectForGate = true;
    gateRejectReason = `archetype_mechanic_mismatch: ${archetypeName} entry_long missing required mechanic keywords matching [${mechanicKeywordErrors.join("; ")}]`;
  } else if (!isArchetype && (!paramsHasRequired || !hasRealRules)) {
    // BOTH required for parametric path
    const missing = [];
    if (!paramsHasRequired) missing.push(`missing required ${entryIndicator} params [${requiredKeys.join(", ")}]`);
    if (!hasRealRules) missing.push("placeholder/missing entry_condition prose");
    rejectForGate = true;
    gateRejectReason = `thin_dsl: ${missing.join(" AND ")}`;
  }

  if (rejectForGate) {
    const rejectReason = gateRejectReason;
    logger.warn(
      { bucketId, strategyName, conceptName, entryIndicator, isArchetype, archetypeName, extractionConfidence, paramsHasRequired, paramsInRange, paramRangeErrors, hasRealRules, rejectReason },
      `direct-graduator: REJECTED by DSL Quality Critic — ${rejectReason}`,
    );
    await db.insert(auditLog).values({
      action: "graduation.rejected_thin_dsl",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: { bucket_id: bucketId, concept_name: conceptName, indicator: entryIndicator, archetype: archetypeName } as Record<string, unknown>,
      result: {
        reason: rejectReason,
        is_archetype: isArchetype,
        archetype_name: archetypeName,
        engine_spec: archetypeMeta?.engineSpec ?? null,
        extraction_confidence: extractionConfidence,
        derived_params: derivedEntryParams,
        required_params: requiredKeys,
        param_range_errors: paramRangeErrors,
        archetype_mechanic_errors: mechanicKeywordErrors,
        entry_condition_chars: extractedEntry.length,
        has_real_rules: hasRealRules,
        params_in_range: paramsInRange,
      } as Record<string, unknown>,
      status: "rejected",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "audit_log write failed (non-blocking)"));
    return {
      strategyId: null,
      strategyName,
      skipped: true,
      reason: `dsl_quality_reject: ${rejectReason}`,
    };
  }

  // Pass 21 v3 corrected (2026-05-17): use engine spec name (not sentinel) for
  // compile output. For archetypes the engine routes via indicator.type =
  // <engineSpec> to load engine/strategies/<engineSpec>.py.
  const compiledIndicator = isArchetype && archetypeMeta ? archetypeMeta.engineSpec : entryIndicator;
  const entryRules = String((extractedIdea as any)?.entry_rules ?? `Entry on ${compiledIndicator} signal per ${conceptName} setup; framework overlay applies risk management.`).slice(0, 2000);
  // F-4 (2026-05-20): Style D is DEAD (W23F.N). Default is Style C 33/33/33.
  const exitRules = String((extractedIdea as any)?.exit_rules ?? "Style C 33/33/33: TP1 33% @ 1R / TP2 33% @ 2R / runner 34% trails developing_session_poc (Chandelier(14,2) fallback). BE+1tick stop on TP1 fill. 15:55 ET hard flat.").slice(0, 2000);
  const riskRules = String((extractedIdea as any)?.risk_rules ?? "ATR 1.5x stop, structural 14pt ceiling MES, 67% personal DLL.").slice(0, 1000);
  const thesis = String((extractedIdea as any)?.thesis ?? `${conceptName} on ${market} ${timeframe} — cross-validated across ${distinctProviders} independent sources.`).slice(0, 500);
  // P2C (Wave 9, 2026-05-17): derive preferred_regime from indicator/archetype
  // BEFORE falling back to extractedIdea.regime, which defaults to TRENDING_UP
  // for everything — mean-reversion, ICT, Wyckoff — producing incorrect gates.
  //
  // Priority:
  //   1. Indicator/archetype mapping (most authoritative — based on strategy type)
  //   2. extractedIdea.regime field (if valid and not a generic default)
  //   3. TRENDING_UP (true default — only if nothing above resolves)
  //
  // UNSPECIFIED = regime-agnostic (ICT/SMC, Wyckoff, volume profile).
  // When preferred_regime is UNSPECIFIED, regime_gate.enabled must be false
  // (these strategies work across regimes — gating them silently drops signals).

  // Trend-following / breakout indicators
  const TREND_INDICATORS = new Set([
    "ema_crossover", "sma_crossover", "macd_crossover", "dema_crossover",
    "session_open_breakout", "supertrend", "donchian_breakout",
    "bollinger_breakout", "keltner_breakout", "ichimoku_cloud",
    "parabolic_sar", "atr_trailing_stop", "nr7_breakout",
    "keltner_squeeze", "overnight_drift",
  ]);
  // Mean-reversion indicators
  const MEAN_REVERSION_INDICATORS = new Set([
    "rsi_reversal", "rsi_divergence", "stochastic_oscillator", "vwap_fade",
    "vwap_reversion", "bollinger_fade", "cci_fade", "williams_r",
    "event_driven_fade",
  ]);
  // Volatility-conditional indicators
  const VOLATILITY_INDICATORS = new Set([
    "atr_breakout", "volatility_expansion",
  ]);
  // Regime-agnostic archetypes (ICT/SMC, Wyckoff, volume profile)
  // These keys correspond to ARCHETYPE_REGISTRY entries.
  const UNSPECIFIED_ARCHETYPES = new Set([
    "ict_silver_bullet_ny_am", "ict_silver_bullet_london", "ict_silver_bullet_ny_pm",
    "ict_judas_swing", "ict_ny_lunch_reversal", "ict_midnight_open",
    "ict_london_raid", "ict_turtle_soup", "ict_ote", "ict_power_of_3",
    "ict_unicorn", "ict_breaker", "ict_mitigation", "ict_iofed",
    "smt_reversal", "ict_quarterly_swing", "ict_propulsion", "ict_eqhl_raid",
    "ict_scalp", "ict_swing", "ict_2022",
    "break_of_structure", "change_of_character", "market_structure_shift",
    "cisd", "fvg_retrace", "order_block", "liquidity_sweep",
    "wyckoff_accumulation", "wyckoff_distribution", "wyckoff_spring", "wyckoff_upthrust",
    "volume_profile", "cumulative_delta", "vwap_order_flow",
  ]);

  // Determine regime from indicator/archetype mapping
  const cleanIndicator = isArchetype ? (archetypeName ?? "") : entryIndicator;
  let derivedRegime: string | null = null;
  if (isArchetype && archetypeName && UNSPECIFIED_ARCHETYPES.has(archetypeName)) {
    derivedRegime = "UNSPECIFIED";
  } else if (!isArchetype && TREND_INDICATORS.has(cleanIndicator)) {
    derivedRegime = "TRENDING_UP";
  } else if (!isArchetype && MEAN_REVERSION_INDICATORS.has(cleanIndicator)) {
    derivedRegime = "RANGE_BOUND";
  } else if (!isArchetype && VOLATILITY_INDICATORS.has(cleanIndicator)) {
    derivedRegime = "HIGH_VOL";
  }

  // Fall back to extractedIdea.regime if indicator mapping yielded nothing
  const rawExtractedRegime = String((extractedIdea as any)?.regime ?? "").toUpperCase();
  const extractedRegimeValid = /^(TRENDING_UP|TRENDING_DOWN|RANGE_BOUND|HIGH_VOL|LOW_VOL)$/.test(rawExtractedRegime);

  // Resolve final preferred_regime and whether regime_gate should be enabled
  let preferredRegime: string;
  let regimeGateEnabled: boolean;
  if (derivedRegime !== null) {
    if (derivedRegime === "UNSPECIFIED") {
      // Regime-agnostic archetype — disable the gate so it doesn't filter valid signals
      preferredRegime = "TRENDING_UP"; // sentinel value (gate is disabled)
      regimeGateEnabled = false;
    } else {
      preferredRegime = derivedRegime;
      regimeGateEnabled = true;
    }
  } else if (extractedRegimeValid) {
    preferredRegime = rawExtractedRegime;
    regimeGateEnabled = true;
  } else {
    // True fallback — unknown indicator, no valid extracted regime
    preferredRegime = "TRENDING_UP";
    regimeGateEnabled = true;
  }

  // Wave 15 (2026-05-18) — compile pattern indicator → engine primitives + grammar.
  // The previous code wrote `indicators: [{type: "ema_crossover"}]` into config,
  // but the Python engine's compute_indicators() only handles primitive types
  // (sma/ema/rsi/atr/macd/bbands/vwap/adx). Result: NO indicator columns ever
  // computed → signals.py couldn't parse the prose entry_long → 0 graduated
  // strategies have ever backtested. Caught by parallel agent.
  //
  // Now: for parametric indicators, compileDslToEngine() translates
  //   {indicator: "ema_crossover", params: {fast:9,slow:21}, direction: "long"}
  // into
  //   indicators: [{ema, period:9}, {ema, period:21}]
  //   entry_long: "ema_9 crosses_above ema_21"
  //   entry_short: "" (long-only)
  //
  // For archetypes, the engine class-based handler does its own structural
  // detection — we emit the archetype indicator config + ATR for sizing, and
  // entry_long/short stay empty (signals.py would error on prose anyway).
  //
  // Wave 20 (2026-05-18) — bidirectional direction resolution.
  // Bug fix: previously hardcoded `direction: "long"` here, ignoring both the
  // LLM-emitted direction AND the natural bidirectionality of indicators like
  // ema_crossover, rsi_reversal, bollinger_breakout, etc. Result: strategies
  // fired ONLY in bullish markets even when the underlying indicator works
  // both ways. User's other agent confirmed via backtest: every graduated
  // strategy was long-only, no shorts.
  //
  // 2026-05-19 policy (W23F.W revision 2): default ALL strategies to "both".
  //
  // Operator research-verified: virtually every published trading strategy
  // has a bidirectional formulation, even archetypes that look one-sided:
  //   - ICT Silver Bullet: SSL sweep → long, BSL sweep → short (fluxcharts,
  //     innercircletrader, fxopen — all confirm both directions)
  //   - Wyckoff: Spring (accumulation) → long, UTAD (distribution) → short.
  //     The mirror patterns are part of the same strategic framework.
  //   - Bollinger Band breakout: long > upper, short < lower (StoneX,
  //     Admiral Markets 2026 strategy guides)
  //   - Cumulative Volume Delta: long on aggressive buy delta, short on
  //     aggressive sell delta (Bookmap, QuantVPS, ATAS)
  //   - All crossover / breakout / reversal / divergence patterns mirror.
  //
  // Policy: default direction is "both". Only honor LLM emit when explicit
  // "short" (rare intentional one-sided call). LLM "long" is treated as
  // under-extraction — the source video happened to demo a long setup but
  // the underlying mechanic works both ways.
  //
  // The prior BIDIRECTIONAL_INDICATORS whitelist was removed because it
  // required ongoing maintenance and was missing archetype names — better
  // to default-bidirectional and let the LLM explicit-override be the
  // escape hatch for genuinely one-sided strategies.
  let resolvedDirection: "long" | "short" | "both";
  const llmDirection = String((extractedIdea as any)?.direction ?? "").toLowerCase();
  if (llmDirection === "short") {
    // Rare explicit short-only call — honor it
    resolvedDirection = "short";
  } else if (llmDirection === "both" || llmDirection === "long" || llmDirection === "") {
    // Default to bidirectional. If LLM said "long", treat as under-extraction
    // and upgrade; emit audit log so we can track frequency.
    if (llmDirection === "long") {
      logger.info(
        { bucketId, strategyName, entryIndicator, llmDirection },
        "direct-graduator W23F.W: upgrading LLM 'long' emit to 'both' (default-bidirectional policy)",
      );
    }
    resolvedDirection = "both";
  } else {
    // Unknown value — default to both
    resolvedDirection = "both";
  }
  // ─── W23G.11 (2026-05-19): Extract confluence + MTF fields from extractedIdea ─
  // These are NEW optional fields — null/undefined on all 74 existing strategies
  // (backward compat preserved). Only populated by LLM extractor v8+ (W23G.11).
  const rawConfirmingIndicators = (extractedIdea as any)?.confirming_indicators;
  const confirmingIndicators: ConfirmingIndicator[] | undefined =
    Array.isArray(rawConfirmingIndicators) && rawConfirmingIndicators.length > 0
      ? (rawConfirmingIndicators as ConfirmingIndicator[])
      : undefined;

  const rawMinFactors = (extractedIdea as any)?.min_factors_satisfied;
  const minFactorsSatisfied: number | undefined =
    typeof rawMinFactors === "number" ? rawMinFactors : undefined;

  const biasTimeframe: string | null =
    typeof (extractedIdea as any)?.bias_timeframe === "string"
      ? (extractedIdea as any).bias_timeframe
      : null;

  const biasCondition: string | null =
    typeof (extractedIdea as any)?.bias_condition === "string"
      ? (extractedIdea as any).bias_condition
      : null;

  const isConfluenceStrategy = confirmingIndicators !== undefined && confirmingIndicators.length > 0;
  const isMtfStrategy = biasTimeframe !== null;

  const compileInput = {
    entry_indicator: isArchetype && archetypeName ? `archetype:${archetypeName}` : entryIndicator,
    entry_params: derivedEntryParams,
    direction: resolvedDirection,
    confirming_indicators: confirmingIndicators,
    min_factors_satisfied: minFactorsSatisfied,
    bias_timeframe: biasTimeframe,
    bias_condition: biasCondition,
  };
  // W23G.11: use compileDslWithConfluence for all paths (backward compat — if no confluence fields,
  // compileDslWithConfluence delegates to compileDslToEngine and returns unchanged base result).
  const compiledEngine = compileDslWithConfluence(compileInput);
  if (!compiledEngine && !isArchetype) {
    logger.warn(
      { bucketId, strategyName, conceptName, entryIndicator, params: derivedEntryParams },
      "direct-graduator: unsupported pattern indicator — graduator skipping (Wave 15)",
    );
    return {
      strategyId: null,
      strategyName,
      skipped: true,
      reason: `unsupported_pattern_indicator: ${entryIndicator}`,
    };
  }

  // Indicator list: pattern-compiled primitives (if available) OR archetype-routed.
  // ATR_14 is always appended for sizing/stop calculations regardless.
  const indicatorsList = compiledEngine
    ? compiledEngine.indicators
    : [{ type: "atr", period: 14 }];
  if (!indicatorsList.some((i) => i.type === "atr")) {
    indicatorsList.push({ type: "atr", period: 14 });
  }
  const engineEntryLong  = compiledEngine?.entry_long  ?? "";
  const engineEntryShort = compiledEngine?.entry_short ?? "";

  const compiled = {
    valid: true,
    metadata: {
      tags: [],
      source: "openclaw",
      schema_version: "v1",
      ...(isArchetype && archetypeMeta ? {
        entry_archetype: archetypeName,
        engine_spec: archetypeMeta.engineSpec,
        routing_mode: "structural_archetype",
      } : { routing_mode: "parametric_indicator" }),
      ...(compiledEngine ? { compile_notes: compiledEngine.compileNotes } : {}),
      // W23G.11 — MTF unsupported flag (fail-CLOSED: bias not in grammar)
      ...(compiledEngine?.mtfUnsupported ? { mtf_compile_status: "bias_omitted_engine_unsupported" } : {}),
    },
    ...(isArchetype && archetypeMeta ? { strategy_class: archetypeMeta.strategyClass } : {}),
    strategy: {
      name: strategyName,
      symbol: market,
      timeframe,
      stop_loss: { type: "atr", multiplier: 1.5 },
      // Wave 15 — entry_long is now in engine grammar (e.g. "ema_9 crosses_above ema_21")
      // The prose-form entry_long stays in `description` for human readability.
      entry_long:  engineEntryLong,
      entry_short: engineEntryShort,
      indicators: indicatorsList,
      position_size: { type: "dynamic_atr", max_contracts: 6, target_risk_dollars: 500 },
    },
    direction: resolvedDirection,  // Wave 20 - honor LLM direction + bidirectional indicators
    entry_type: entryType,
    exit_type: "trailing_stop",
    entry_indicator: entryIndicator,
    // W23G.11 — primary_indicator alias (equals entry_indicator; explicit for confluence strategies)
    primary_indicator: entryIndicator,
    entry_params: derivedEntryParams,
    exit_params: {},
    regime_gate: { enabled: regimeGateEnabled, preferred_regime: preferredRegime },
    take_profit: { type: "atr_multiple", multiplier: 3 },
    session_filter: { enabled: true, session: "RTH_ONLY" },
    description: thesis,
    // Wave 15 — preserve original prose for human-readability and audit.
    entry_long_prose: entryRules,
    // W23G.11 — Confluence + MTF fields (all nullable; undefined omits from config JSONB)
    ...(isConfluenceStrategy ? {
      confirming_indicators: confirmingIndicators,
      min_factors_satisfied: minFactorsSatisfied ?? (1 + (confirmingIndicators?.length ?? 0)),
    } : {}),
    ...(isMtfStrategy ? {
      bias_timeframe: biasTimeframe,
      bias_condition: biasCondition,
      execution_timeframe: timeframe,  // alias for existing timeframe field
    } : {}),
  };

  // Apply framework overlay (Style C 33/33/33, time_stop, risk-derived pyramid, template-hole safety net)
  const overlayed = applyFrameworkOverlay({
    compiled: compiled as any,
    source: "graduated_bucket",
    symbol: market,
    bucketId,
  });

  // ─── Pass 21 v3 corrected³ (2026-05-17): SOURCE-FIDELITY CHECK ────────
  // Anti-fabrication: verify the strategy's final entry_long has meaningful
  // overlap with the source mention's extracted_idea.entry_rules. Catches the
  // case where the graduator silently fell back to a default template (e.g.
  // "Entry on ema_crossover signal per ...") instead of using the source-
  // extracted rule. cross_source_validator already runs UPSTREAM during bucket
  // formation; this is the within-graduator complement.
  // Wave 16 (2026-05-18) — source-fidelity check evaluates PROSE-vs-PROSE.
  // Wave 15 replaced strategy.entry_long with engine grammar ("ema_9 crosses_above ema_21"
  // or the "high < low" sentinel for archetypes). The token-overlap regex finds zero
  // overlap with source prose ("Enter long after 9 EMA crosses..."), causing false-positive
  // rejections on EVERY legitimate Wave-16 graduation. Fix: compare the PRESERVED prose
  // form (strategy.entry_long_prose, written by Wave 15 framework-overlay) against source,
  // not the compiled grammar. Archetypes have no prose — skip the check entirely.
  const finalEntryLongProse = String(
    overlayed.config?.strategy?.entry_long_prose ??     // Wave 15+ preserves human prose here
    overlayed.config?.entry_long_prose ??                // top-level fallback
    (overlayed.config?.strategy?.entry_long?.toString?.()?.startsWith("ema_") ||
     overlayed.config?.strategy?.entry_long?.toString?.()?.startsWith("rsi_") ||
     overlayed.config?.strategy?.entry_long?.toString?.()?.startsWith("close ") ||
     overlayed.config?.strategy?.entry_long?.toString?.()?.startsWith("macd_") ||
     overlayed.config?.strategy?.entry_long?.toString?.() === "high < low"
      ? "" : overlayed.config?.strategy?.entry_long)    // legacy prose path
    ?? ""
  ).toLowerCase();
  const sourceEntry = String((extractedIdea as any)?.entry_rules ?? (extractedIdea as any)?.entry_condition ?? "").toLowerCase();
  const isTemplate = /^entry on \w+ signal per .+ setup; framework overlay applies risk management\.?$/.test(finalEntryLongProse);
  // Token overlap: shared meaningful tokens (excluding stopwords) of >=3 chars
  const STOPWORDS = new Set(["the","and","a","an","of","to","in","on","for","with","is","are","be","at","or","by","this","that","when"]);
  const tokens = (s: string) => new Set((s.match(/[a-z]+/g) || []).filter((t) => t.length >= 3 && !STOPWORDS.has(t)));
  const finalTokens = tokens(finalEntryLongProse);
  const sourceTokens = tokens(sourceEntry);
  let overlap = 0;
  finalTokens.forEach((t) => { if (sourceTokens.has(t)) overlap++; });
  const overlapRatio = finalTokens.size > 0 ? overlap / finalTokens.size : 0;
  // Skip the check when:
  //  (a) we couldn't extract any prose to compare (archetype path — entry_long is grammar sentinel)
  //  (b) source itself is too short to be a meaningful signal
  const sourceFidelityFail = !isArchetype && sourceEntry.length > 40 && finalEntryLongProse.length > 0 && (isTemplate || overlapRatio < 0.2);
  if (sourceFidelityFail) {
    logger.warn(
      { bucketId, strategyName, conceptName, finalEntryLong: finalEntryLongProse.slice(0, 150), sourceEntry: sourceEntry.slice(0, 150), overlapRatio, isTemplate },
      `direct-graduator: REJECTED by source-fidelity check — entry_long disagrees with source`,
    );
    await db.insert(auditLog).values({
      action: "graduation.rejected_source_fidelity",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
      result: {
        reason: isTemplate ? "default_template_used" : `low_overlap_${overlapRatio.toFixed(2)}`,
        final_entry_long_prose_head: finalEntryLongProse.slice(0, 200),
        source_entry_head: sourceEntry.slice(0, 200),
        overlap_ratio: overlapRatio,
        is_template_fallback: isTemplate,
      } as Record<string, unknown>,
      status: "rejected",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "audit_log write failed (non-blocking)"));
    return {
      strategyId: null,
      strategyName,
      skipped: true,
      reason: `source_fidelity_reject: ${isTemplate ? "default_template_used" : `low_overlap_${overlapRatio.toFixed(2)}`}`,
    };
  }

  // ─── Pass 21 v3 corrected³ (2026-05-17): LLM JUDGE GATE ──────────────
  // Call the existing dsl_quality_critic LLM judge. It catches what regex
  // gates can't: incoherent entry_condition vs entry_indicator, regime
  // mismatches, anti-pattern matches (tight-parameter-overfitting,
  // regime-fragile, hallucination loops), over-precise params.
  //
  // Fail-OPEN paths preserved: budget exhausted (100/day) and LLM
  // throw/null/non-JSON all return accept=true to prevent pipeline stalls.
  // Audit log captures every reject with the critic's concerns[] and
  // reasoning so future agents can tune.
  let criticAccepted = true;
  let criticResult: { score: number; concerns: unknown[]; reasoning: string; source: string } | null = null;
  try {
    const critic = await runDslQualityCritic(
      {
        dsl: overlayed.config as Record<string, unknown>,
        sourceFind: {
          title: String((bestMention as any)?.title ?? conceptName),
          source: String((bestMention as any)?.source ?? "graduated_bucket"),
          description: extractedEntry || thesis,
        },
      },
      bucketId,
    );
    criticResult = {
      score: critic.score,
      concerns: critic.concerns,
      reasoning: critic.reasoning,
      source: critic.source,
    };
    criticAccepted = critic.accept;
    logger.info(
      { bucketId, strategyName, conceptName, criticScore: critic.score, criticAccept: critic.accept, criticSource: critic.source, criticConcernCount: critic.concerns.length },
      `direct-graduator: dsl_quality_critic returned accept=${critic.accept} score=${critic.score} (source=${critic.source})`,
    );
  } catch (err) {
    // True throw at our call site (separate from runDslQualityCritic's own
    // internal fail-open) — let it through, log, and rely on downstream
    // audit to catch it. Fail-open by design.
    logger.warn({ err, bucketId }, "direct-graduator: dsl_quality_critic call threw — failing open");
    criticAccepted = true;
  }
  if (!criticAccepted && criticResult) {
    logger.warn(
      { bucketId, strategyName, conceptName, criticScore: criticResult.score, criticReasoning: criticResult.reasoning, criticConcerns: criticResult.concerns },
      `direct-graduator: REJECTED by dsl_quality_critic LLM judge`,
    );
    await db.insert(auditLog).values({
      action: "graduation.rejected_dsl_quality_critic",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: { bucket_id: bucketId, concept_name: conceptName, indicator: entryIndicator, archetype: archetypeName } as Record<string, unknown>,
      result: {
        critic_score: criticResult.score,
        critic_concerns: criticResult.concerns,
        critic_reasoning: criticResult.reasoning,
        critic_source: criticResult.source,
      } as Record<string, unknown>,
      status: "rejected",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "audit_log write failed (non-blocking)"));
    return {
      strategyId: null,
      strategyName,
      skipped: true,
      reason: `dsl_quality_critic_reject: score=${criticResult.score} ${criticResult.reasoning.slice(0, 200)}`,
    };
  }

  const strategyTags = [
    ...layerTags,
    "dsl-compiled",
    distinctProviders >= 3 && layersCovered >= 3 ? "3-source-consensus" : "2-source-consensus",
  ];

  // ─── Layer 1: Graduator self-audit (FAIL-CLOSED) ──────────────────────
  // Run the same rule engine the live-library drift check uses. Any DEFECT
  // (vs warning) blocks the INSERT — a faulty DSL never reaches the strategies
  // table, never reaches the backtest engine, never wastes time. Audit log
  // row preserved so we can replay rejections and tune rules.
  const audit = auditGraduatedConfig({
    conceptName,
    symbol: market,
    config: overlayed.config as any,
  });
  if (!audit.passed) {
    logger.error(
      {
        bucketId,
        strategyName,
        conceptName,
        defects: audit.defects,
        warnings: audit.warnings,
      },
      `direct-graduator: REJECTED by auditor — ${formatAuditResult(audit)}`
    );
    await db.insert(auditLog).values({
      action: "graduation.rejected_by_auditor",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
      result: {
        defects: audit.defects,
        warnings: audit.warnings,
        strategy_name: strategyName,
        applied_overlay: overlayed.appliedRules,
      } as Record<string, unknown>,
      status: "failure",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((err) => logger.warn({ err }, "audit_log write failed for rejected graduation"));
    return {
      strategyId: null,
      strategyName,
      skipped: true,
      reason: `audit_defects: ${audit.defects.map((d) => d.code).join(",")}`,
    };
  }

  // ─── Wave 23F Track D (2026-05-19): Build entry_quality block ────────────
  const confluenceFactors: string[] = Array.isArray((extractedIdea as any)?.confluence_factors)
    ? (extractedIdea as any).confluence_factors
    : [];
  // W23F A+ gate: min_factors_satisfied for entry_quality block (how many confluence_factors must hold).
  // Distinct from W23G.11 minFactorsSatisfied (which controls how many confirming_indicators must agree).
  const entryQualityMinFactors: number = typeof (extractedIdea as any)?.min_factors_satisfied === "number"
    ? (extractedIdea as any).min_factors_satisfied
    : 2;
  const sourceClaimWinRate: number | null = (extractedIdea as any)?.source_claim_win_rate ?? null;
  const sourceClaimAvgR: number | null = (extractedIdea as any)?.source_claim_avg_r ?? null;
  const entryQualityBlock = {
    confluence_factors: confluenceFactors,
    min_factors_satisfied: entryQualityMinFactors,
    source_claim_win_rate: sourceClaimWinRate,
    source_claim_avg_r: sourceClaimAvgR,
    // Empty confluence_factors → legacy_no_confluence so consumer A+ gate bypasses cleanly
    extraction_provenance: confluenceFactors.length === 0
      ? "legacy_no_confluence" as const
      : resolveProvenance(bestMention.scoutLayer ?? undefined, bestMention.sourceProvider),
  };

  // Symbols array: prefer LLM-extracted symbols, fallback to bucket primary market
  const symbolsArray: string[] = Array.isArray((extractedIdea as any)?.symbols) && (extractedIdea as any).symbols.length > 0
    ? (extractedIdea as any).symbols
    : [market];

  try {
    const [inserted] = await db.insert(strategies).values({
      name: strategyName,
      description: thesis,
      symbol: market,
      symbols: symbolsArray,
      timeframe,
      source: "graduated_bucket",
      config: {
        ...(overlayed.config as Record<string, unknown>),
        entry_quality: entryQualityBlock,
      },
      preferredRegime,
      // W23H.B: also write the new array column so Pass 2 W23H.C picker
      // (regime = ANY(preferred_regimes)) has data on every new graduation.
      // Single-value array is the safe default; extractor v9 may emit a richer
      // multi-regime array per archetype heuristic — when it does we trust it.
      preferredRegimes:
        Array.isArray((overlayed.config as Record<string, unknown>)?.preferred_regimes) &&
        ((overlayed.config as Record<string, unknown>).preferred_regimes as unknown[]).length > 0
          ? ((overlayed.config as Record<string, unknown>).preferred_regimes as string[])
          : [preferredRegime],
      tags: strategyTags,
    }).returning({ id: strategies.id });

    await db.update(strategyPendingBuckets)
      .set({ graduatedStrategyId: inserted.id, wideFingerprintHash: wideFingerprint })
      .where(eq(strategyPendingBuckets.id, bucketId));

    logger.info(
      {
        strategyId: inserted.id,
        strategyName,
        bucketId,
        sourceCount,
        distinctProviders,
        layersCovered,
        appliedOverlay: overlayed.appliedRules,
        overlayWarnings: overlayed.warnings,
        entryQualityProvenance: entryQualityBlock.extraction_provenance,
        confluenceFactorCount: confluenceFactors.length,
        symbolsCount: symbolsArray.length,
      },
      "direct-graduator: strategy created from bucket"
    );

    // Wave 23F Track D: audit entry_quality attachment
    await db.insert(auditLog).values({
      action: "graduation.entry_quality_attached",
      entityType: "strategy",
      entityId: inserted.id,
      input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
      result: {
        confluence_factor_count: entryQualityBlock.confluence_factors.length,
        min_factors_satisfied: entryQualityBlock.min_factors_satisfied,
        provenance: entryQualityBlock.extraction_provenance,
        symbols_count: symbolsArray.length,
        symbols: symbolsArray,
        has_source_claim_win_rate: entryQualityBlock.source_claim_win_rate !== null,
        has_source_claim_avg_r: entryQualityBlock.source_claim_avg_r !== null,
      } as Record<string, unknown>,
      status: "success",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) => logger.warn({ auditErr }, "direct-graduator: entry_quality_attached audit write failed"));

    // W23H.B (architect cleanup): audit emission for preferred_regimes write.
    // Architect found this audit was spec'd but missing — closing the gap so
    // Pass 2 picker has full forensic trail of regime decisions per graduation.
    const persistedPreferredRegimes =
      Array.isArray((overlayed.config as Record<string, unknown>)?.preferred_regimes) &&
      ((overlayed.config as Record<string, unknown>).preferred_regimes as unknown[]).length > 0
        ? ((overlayed.config as Record<string, unknown>).preferred_regimes as string[])
        : [preferredRegime];
    await db.insert(auditLog).values({
      action: "strategy.preferred_regimes_set",
      entityType: "strategy",
      entityId: inserted.id,
      input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
      result: {
        strategy_id: inserted.id,
        archetype: entryQualityBlock.extraction_provenance,
        regimes: persistedPreferredRegimes,
        regime_count: persistedPreferredRegimes.length,
        legacy_preferred_regime: preferredRegime,
        source: persistedPreferredRegimes.length > 1 ? "extractor_multi_regime" : "graduator_single_regime_fallback",
      } as Record<string, unknown>,
      status: "success",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) => logger.warn({ auditErr }, "direct-graduator: preferred_regimes_set audit write failed"));

    // Wave 23F Track G: SSE emission for graduation with entry_quality block.
    // Fires in parallel with the audit row — non-blocking, never throws.
    try {
      broadcastSSE("factory:graduation_entry_quality", {
        strategy_id: inserted.id,
        name: strategyName,
        symbols: symbolsArray,
        confluence_factor_count: entryQualityBlock.confluence_factors.length,
        extraction_provenance: entryQualityBlock.extraction_provenance,
        has_source_claim_win_rate: entryQualityBlock.source_claim_win_rate !== null,
        has_source_claim_avg_r: entryQualityBlock.source_claim_avg_r !== null,
        correlation_id: correlationId ?? null,
      });
    } catch (sseErr) {
      logger.warn({ sseErr }, "direct-graduator: factory:graduation_entry_quality SSE broadcast failed (non-blocking)");
    }

    // Wave 23F Track D: additional audit row for multi-market graduations
    if (symbolsArray.length > 1) {
      await db.insert(auditLog).values({
        action: "graduation.symbols_multi_market",
        entityType: "strategy",
        entityId: inserted.id,
        input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
        result: {
          symbols: symbolsArray,
          symbols_count: symbolsArray.length,
          primary_market: market,
        } as Record<string, unknown>,
        status: "success",
        decisionAuthority: "system",
        correlationId: correlationId ?? null,
      }).catch((auditErr: unknown) => logger.warn({ auditErr }, "direct-graduator: symbols_multi_market audit write failed"));

      // Wave 23F Track G: SSE emission for cross-symbol bucket convergence.
      // Fires alongside the graduation.symbols_multi_market audit row.
      // Non-blocking; failure never propagates to caller.
      try {
        broadcastSSE("factory:multi_market_bucket", {
          bucket_fingerprint: wideFingerprint,
          concept_name: conceptName,
          symbols: symbolsArray,
          layer_coverage: {
            web:     opts.webUrls.length > 0,
            youtube: opts.youtubeUrls.length > 0,
            reddit:  opts.redditUrls.length > 0,
          },
          correlation_id: correlationId ?? null,
        });
      } catch (sseErr) {
        logger.warn({ sseErr }, "direct-graduator: factory:multi_market_bucket SSE broadcast failed (non-blocking)");
      }
    }

    // ─── W23G.11 (2026-05-19): Confluence + MTF audit events ────────────────
    // Emit graduation.confluence_strategy when confirming_indicators is non-empty.
    // Emit graduation.mtf_strategy when bias_timeframe is non-null.
    // Both are advisory (non-blocking). Failed audit writes never propagate.
    if (isConfluenceStrategy && confirmingIndicators) {
      await db.insert(auditLog).values({
        action: "graduation.confluence_strategy",
        entityType: "strategy",
        entityId: inserted.id,
        input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
        result: {
          primary_indicator: entryIndicator,
          confirming_indicators: confirmingIndicators.map((ci) => ci.indicator),
          confirming_count: confirmingIndicators.length,
          min_factors_satisfied: minFactorsSatisfied ?? (1 + confirmingIndicators.length),
          entry_long_compiled: engineEntryLong.slice(0, 300),
          mtf_unsupported: compiledEngine?.mtfUnsupported ?? false,
        } as Record<string, unknown>,
        status: "success",
        decisionAuthority: "system",
        correlationId: correlationId ?? null,
      }).catch((auditErr: unknown) => logger.warn({ auditErr }, "direct-graduator: graduation.confluence_strategy audit write failed"));
    }

    if (isMtfStrategy && biasTimeframe) {
      await db.insert(auditLog).values({
        action: "graduation.mtf_strategy",
        entityType: "strategy",
        entityId: inserted.id,
        input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
        result: {
          bias_timeframe: biasTimeframe,
          bias_condition: biasCondition,
          execution_timeframe: timeframe,
          // Honest: MTF bias gate was NOT compiled into grammar (engine unsupported)
          bias_compiled_into_grammar: false,
          mtf_compile_status: "bias_omitted_engine_unsupported",
        } as Record<string, unknown>,
        status: "success",
        decisionAuthority: "system",
        correlationId: correlationId ?? null,
      }).catch((auditErr: unknown) => logger.warn({ auditErr }, "direct-graduator: graduation.mtf_strategy audit write failed"));

      logger.warn(
        { strategyId: inserted.id, strategyName, biasTimeframe, biasCondition },
        "direct-graduator W23G.11: MTF strategy graduated — bias_timeframe preserved on config but NOT enforced in entry grammar (dsl_compiler.mtf_unsupported). Future engine pass needed.",
      );
    }

    return { strategyId: inserted.id, strategyName };
  } catch (err) {
    // Wave 12 — INSERT failure is NOT silently swallowed. The caller receives
    // `insertFailed: true` and is responsible for:
    //   1. Reverting the bucket to `pending` (NOT leaving it as `graduated`)
    //   2. Firing a `strategy.cross_validated` audit with status=failure
    // We write the DLQ row here so infra failures are observable immediately
    // without waiting for the caller's audit path.
    const msg = err instanceof Error ? err.message : String(err);
    const isConstraintCollision = msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate");
    logger.error(
      { err: msg, strategyName, bucketId, conceptName, isConstraintCollision },
      "direct-graduator: strategy INSERT failed — caller must revert bucket to pending"
    );
    // Write DLQ row for operator visibility (fire-and-forget; failure logged only)
    db.insert(deadLetterQueue).values({
      operationType: isConstraintCollision ? "graduation.rejected_constraint_collision" : "graduation.rejected_insert_failed",
      entityType:    "strategy_pending_bucket",
      entityId:      bucketId,
      errorMessage:  msg,
      firstFailedAt: new Date(),
      lastFailedAt:  new Date(),
      metadata: {
        bucket_id:      bucketId,
        strategy_name:  strategyName,
        concept_name:   conceptName,
        market,
        correlation_id: correlationId ?? null,
      } as Record<string, unknown>,
    }).catch((dlqErr) => logger.warn({ dlqErr }, "direct-graduator: DLQ write failed after INSERT error"));
    // Write audit row for this insert failure
    db.insert(auditLog).values({
      action:            isConstraintCollision ? "graduation.rejected_constraint_collision" : "graduation.rejected_insert_failed",
      entityType:        "strategy_pending_bucket",
      entityId:          bucketId,
      input:             { bucket_id: bucketId, concept_name: conceptName, strategy_name: strategyName } as Record<string, unknown>,
      result:            { error: msg, is_constraint_collision: isConstraintCollision } as Record<string, unknown>,
      status:            "failure",
      decisionAuthority: "system",
      correlationId:     correlationId ?? null,
    }).catch((auditErr) => logger.warn({ auditErr }, "direct-graduator: audit write failed after INSERT error"));
    return {
      strategyId:   null,
      strategyName,
      skipped:      true,
      insertFailed: true,
      reason:       `insert_failed: ${msg}`,
    };
  }
}
