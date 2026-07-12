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
import { RAW_ARCHETYPES_RESPECTED as RAW_ARCHETYPES_RESPECTED_CANONICAL } from "../lib/archetype-registry-keys.js";
import { isHandlerDrivenEntry } from "../lib/handler-driven-entry.js";
import { db } from "../db/index.js";
import { strategies, strategyPendingBuckets, auditLog, deadLetterQueue, lifecycleTransitions } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { applyFrameworkOverlay } from "./framework-overlay.js";
import { compileDslToEngine, compileDslWithConfluence } from "../lib/dsl-compiler.js";
import type { ConfirmingIndicator } from "../lib/dsl-compiler.js";
// Band B (spec-onboarding-bridge, 2026-07-02) — was a static top-level import.
// agent-service.ts's own import graph (agent-service.ts -> backtest-service.ts
// -> paper-trading-stream.ts -> paper-execution-service.ts -> scheduler.ts ->
// lifecycle-service.ts -> {adversarial-stress-service.ts | frankenstein-
// service.ts | pine-export-service.ts | agent-coordinator-service.ts |
// multi-firm-promotion-service.ts} -> src/server/index.ts -> routes/agent.ts
// -> agent-service.ts) is a genuine, deep, pre-existing circular reference —
// confirmed via a full transitive-import trace this session, NOT specific to
// this file. `auditBidirectionalCompleteness` (Gate 1) and
// `classifyFactorSources` (Gate 2) — the two functions a new standalone
// spec-onboarding CLI needs to reuse from this file — have ZERO functional
// dependency on `runDslQualityCritic`; it is used only in the main
// `graduateBucket`-style orchestration flow below (inside a try/catch that
// already fail-opens on any throw, so deferring the import here changes
// nothing about that flow's behavior). Loading Gate 1/2 as a standalone
// import should not force-load the entire scheduler/lifecycle/index.ts
// bootstrap purely because of a sibling static import elsewhere in this
// file. Type-only import for the call signature; dynamic `await import(...)`
// at the actual call site below.
import type { runDslQualityCritic as RunDslQualityCriticFn } from "./agent-service.js";
let _runDslQualityCritic: typeof RunDslQualityCriticFn | null = null;
async function getRunDslQualityCritic(): Promise<typeof RunDslQualityCriticFn> {
  if (!_runDslQualityCritic) {
    ({ runDslQualityCritic: _runDslQualityCritic } = await import("./agent-service.js"));
  }
  return _runDslQualityCritic;
}
// Track A F-6: insertAuditRowSafe migrated for select call sites. Remaining
// db.insert(auditLog) call sites retain raw pattern until incremental migration.
// TODO: correlation_id not threaded through all call sites in this file.
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { CANONICAL_PARAM_RANGES } from "../lib/param-ranges.js";
import { applyWave25Defaults } from "../lib/wave25-strategy-defaults.js";
// Wave 26 Pass G B4 (2026-05-26) — Prom/SSE/Discord observability helpers.
// Graduator owns the audit_log writes (Gates 1 + 3); these helpers add the
// Prometheus + SSE + Discord layer additively. `skipAuditRow: true` is passed
// on Gate 1 (helper has a different action name, so no duplication) and on
// Gate 3 (same action name — flag prevents the runtime double-write).
import {
  emitBidirectionalIncompleteRejected,
  emitFactorQualityClassified,
  emitThinConfluenceWarning,
} from "../lib/confluence-quality-audit.js";
import { inferFactorsFromArchetype } from "../lib/archetype-implied-factors.js";

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
  // Wave 26 Pass G archetypes (2026-05-26) — A1 + A2 engine implementations.
  // Engine files: src/engine/strategies/bounce_off_level.py +
  //               src/engine/strategies/ict_bias_aligned_continuation.py
  // DO NOT remove these entries — they are the ARCHETYPE_REGISTRY anchors that
  // route concept names here AND trigger the graduation.archetype_route_taken
  // observability audit (see deriveEntryIndicator below).
  bounce_off_level: {
    engineSpec: "bounce_off_level",
    strategyClass: "src.engine.strategies.bounce_off_level.BounceOffLevelStrategy",
    description: "MA rejection bounce — price tests MA, rejects, entries on confirmed rejection candle",
  },
  ict_bias_aligned_continuation: {
    engineSpec: "ict_bias_aligned_continuation",
    // Canonical Python class name — matches the class in ict_bias_aligned_continuation.py
    strategyClass: "src.engine.strategies.ict_bias_aligned_continuation.ICTBiasAlignedContinuationStrategy",
    description: "BIDIRECTIONAL: HTF bias + 15m BOS/CHoCH + 5m FVG retest inside killzone. LONG on bullish bias + bullish BOS + bullish FVG; SHORT mirror-image. Anti-trend rejects if BOS opposes bias.",
  },
  // W3.4 (2026-06-22) — Gann box 4H continuation archetype. Engine file:
  //   src/engine/strategies/gann_box_4h_continuation.py
  // Source video: SY2jXlW9bt4. Quarantine-escape: video routed to uncatalogued
  // until this archetype was registered. DO NOT remove — anchor for the
  // graduation.archetype_route_taken audit and for Gann-box concept routing
  // in prettifyConcept() below.
  gann_box_4h_continuation: {
    engineSpec: "gann_box_4h_continuation",
    strategyClass: "src.engine.strategies.gann_box_4h_continuation.GannBox4HContinuationStrategy",
    description: "BIDIRECTIONAL: impulsive 4H candle Gann box → Fib zone optimum (0.50–0.75) retracement entry + FVG/OB confluence. LONG on bullish bias + bullish impulse + optimum retrace; SHORT mirror-image. Stop beyond order block; target prior daily high/low.",
  },
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

// Regime-agnostic archetypes (ICT/SMC, Wyckoff, volume profile) — these keys correspond to
// ARCHETYPE_REGISTRY entries whose edge is direction/structure-based, not regime-conditional, so
// their regime_gate is disabled and they are eligible across ALL regimes.
// MED#6 hardening (grader follow-up 2026-07-12): hoisted to MODULE scope so the preferredRegimes
// all-regime default (below) references this canonical set directly instead of a blanket
// `startsWith("archetype:")` — a FUTURE directional archetype not in this set now falls through to
// the conservative single/LLM regime fallback rather than being silently over-widened to all-3.
// SINGLE SOURCE OF TRUTH — the derivedRegime classifier reuses this same set (do not duplicate).
const REGIME_AGNOSTIC_ARCHETYPES = new Set<string>([
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
  // W3.4 (2026-06-22)
  "gann_box_4h_continuation",
]);

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
  // MA-as-S/R bounce (2026-05-26)
  bounce_off_level: ["ma_period"],
  // Wave 25 Pass 5 VWAP institutional archetypes (Wave hardening 2026-06-22, CI-trust)
  vwap_band_reject: ["band_sigma"],
  anchored_vwap_retest: ["anchor_lookback_bars"],
};
import { auditGraduatedConfig, formatAuditResult } from "./graduated-strategy-auditor.js";
import { computeWideConceptFingerprintHash } from "./strategy-fingerprint.js";
// Band B (spec-onboarding-bridge, 2026-07-02) — was `from "../index.js"`. Same
// circular-import fix as graveyard-gate.ts / model-router.ts (see their
// comments): this file is itself imported by routes/agent.ts
// (`deriveEntryIndicator`), so importing `logger` from the full app
// entrypoint made ANY standalone script that imports this file's Gate 1/2
// helpers (spec-onboarding-service.ts, this session) circularly re-enter
// routes/agent.ts -> agent-service.ts before AgentService finishes
// initializing. `../lib/logger.js` is behaviorally equivalent (identical
// pino config + test-runtime silence guard) and carries no such edge.
import { logger } from "../lib/logger.js";
import { broadcastSSE, FACTORY_EVENTS } from "../routes/sse.js";
import { notify } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

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

// ─── Wave 26 Pass G B2 (2026-05-26): AUDITOR GATES ─────────────────────────

// Sentinel value emitted by compileDslToEngine for the non-applicable direction.
// Long-only strategies get entry_short = BIDIR_SENTINEL, meaning "never fires".
const BIDIR_SENTINEL = "high < low";

/**
 * Gate 1 — Bidirectional Completeness Check.
 *
 * When direction === "both":
 *   Parametric path (no archetype, not handler-driven): BOTH entry_long AND
 *   entry_short must be non-empty AND non-sentinel ("high < low").
 *   Handler-driven path (archetype declared, OR entry_long/entry_short/
 *   entry_indicator match the shared `isHandlerDrivenEntry()` recognizer —
 *   see src/server/lib/handler-driven-entry.ts): both may be sentinel/marker
 *   OR both may be real expressions — but never ONE sentinel and ONE
 *   empty/sentinel (mixed state means the LLM extracted only one side).
 *
 * 2026-07-04 dispatch-marker fix: this gate and framework-overlay.ts's
 * direction="both" coercion guard used to each hand-roll their own "is this
 * handler-driven" check and drifted apart — framework-overlay.ts didn't
 * recognize spec-onboarding-service.ts's `archetype_dispatch:<key>` /
 * `spec_conditions:<hash>` dispatch markers, silently amputating the short
 * side of spec-onboarded "both" strategies downstream of this gate. Both call
 * sites now route through the same `isHandlerDrivenEntry()` helper so they
 * can never drift apart again. The legacy `archetype` field is preserved as
 * an alternate (OR'd) signal for callers that don't have entry_indicator handy.
 *
 * Single-direction strategies (long/short) are NOT checked — asymmetric is allowed.
 */
export interface BidirectionalAuditResult {
  pass: boolean;
  reason: string | null;
}

export function auditBidirectionalCompleteness(compiledConfig: {
  direction?: string;
  archetype?: string | null;
  entry_long?: string;
  entry_short?: string;
  entry_indicator?: string | null;
}): BidirectionalAuditResult {
  const direction = compiledConfig.direction ?? "";

  // Only applies when direction is "both"
  if (direction !== "both") {
    return { pass: true, reason: null };
  }

  const entryLong  = compiledConfig.entry_long  ?? "";
  const entryShort = compiledConfig.entry_short ?? "";
  const isHandlerDriven = Boolean(compiledConfig.archetype) ||
    isHandlerDrivenEntry(entryLong, entryShort, compiledConfig.entry_indicator ?? null);

  const longIsSentinel  = entryLong  === BIDIR_SENTINEL || entryLong  === "";
  const shortIsSentinel = entryShort === BIDIR_SENTINEL || entryShort === "";

  if (isHandlerDriven) {
    // Handler-driven path: both sentinel/marker or both real — mixed is a bug
    if (longIsSentinel !== shortIsSentinel) {
      return {
        pass: false,
        reason: "incomplete_bidirectional_extraction",
      };
    }
    return { pass: true, reason: null };
  }

  // Parametric path: both must be non-empty and non-sentinel
  if (longIsSentinel || shortIsSentinel) {
    return {
      pass: false,
      reason: "incomplete_bidirectional_extraction",
    };
  }

  return { pass: true, reason: null };
}

// ─── Gate 2 — Factor Source Telemetry Types ─────────────────────────────────

export type FactorSourceLabel = "extracted" | "auto_floor" | "kb_inferred";

export interface EntryQualityWithSources {
  confluence_factors: string[];
  min_factors_satisfied: number;
  source_claim_win_rate: number | null;
  source_claim_avg_r: number | null;
  extraction_provenance: ExtractionProvenance | "legacy_no_confluence";
  /** Maps factor name → origin label. Optional/additive — legacy rows omit this key. */
  factor_sources?: Record<string, FactorSourceLabel>;
  /** Telemetric quality tag. Optional/additive — legacy rows omit this key. */
  factor_quality?: "rich" | "thin" | "fallback_only" | null;
  /**
   * FIX A1 (deep-scan #22 fix-wave-2, 2026-07-07): Wave 25 W25.1 opt-in flag for
   * Path C (evaluateWeightedConfluence). paper-signal-service.ts:4176 reads this
   * field from INSIDE config.entry_quality — it does NOT read the sibling
   * top-level `strategies.use_weighted_scoring` DB column at signal-evaluation
   * time (that column is read elsewhere, e.g. by the scoring-strategy loader,
   * but the paper-signal-service dispatcher's decision point only looks here).
   * Must be stamped here or Path C is silently dead-on-arrival for every
   * graduated strategy regardless of what the DB column says.
   */
  use_weighted_scoring?: boolean;
  /**
   * FIX A1 (deep-scan #22 fix-wave-2, 2026-07-07): W23H.D Path A per-strategy
   * confirming indicators. paper-signal-service.ts:4162-4170 reads this from
   * INSIDE config.entry_quality, not from the sibling top-level
   * `config.confirming_indicators` key the graduator also writes (that
   * top-level copy is Wave 26 Pass E's bare confluence-factor-tag array —
   * see direct-bucket-graduator.ts buildV11ConfigAdditions callers — a
   * DIFFERENT shape than the ConfirmingIndicator{indicator,params,direction}
   * objects this field requires; do NOT wire that array in here, it would
   * silently divert Path C's error-fallback into a guaranteed-reject Path A).
   * This field carries ONLY the genuinely LLM-extracted W23G.11
   * `confirmingIndicators` (already the correct object shape) when present —
   * absent/undefined for the (common) case where the LLM did not extract any,
   * in which case Path A stays dormant and Path B/C behavior is unchanged.
   */
  confirming_indicators?: ConfirmingIndicator[];
}

/**
 * Builds `factor_sources` and `factor_quality` for an entry_quality block.
 *
 * Wave 26 Pass H2 (2026-05-26): when `entryIndicator` identifies a known
 * archetype (starts with "archetype:"), the function derives the archetype's
 * definitional confluence factors from the KB map and injects any not already
 * present in `finalFactors` into the returned factor list, tagged `kb_inferred`.
 * This means a strategy with `entry_indicator: "archetype:ict_bias_aligned_continuation"`
 * and zero LLM-extracted factors graduates with up to 5 kb_inferred factors
 * and lands in the `rich` bucket instead of `fallback_only`.
 *
 * Tag semantics:
 *   "extracted"   — LLM emitted this factor from the transcript/source
 *   "kb_inferred" — KB implied by archetype definition (Pass H2+)
 *   "auto_floor"  — injected by the ≥2 floor guard (regime_match / structural_setup)
 *
 * Operators can audit which factors are real evidence vs KB inference vs filler
 * via `entry_quality.factor_sources` in the strategy config JSONB.
 *
 * @param rawFactors    Factors extracted directly by the LLM before floor injection.
 * @param finalFactors  Factors after the ≥2 floor guard (may include auto_floor additions).
 * @param entryIndicator  Optional — e.g. "archetype:ict_bias_aligned_continuation".
 * @returns             factor_sources record, factor_quality, and merged final factor list.
 */
export function classifyFactorSources(
  rawFactors: string[],
  finalFactors: string[],
  entryIndicator?: string | null,
): {
  factor_sources: Record<string, FactorSourceLabel>;
  factor_quality: "rich" | "thin" | "fallback_only";
  mergedFactors: string[];
} {
  const rawSet = new Set(rawFactors);

  // ─── Wave 26 Pass H2: archetype-implied factor injection ─────────────────
  // When entry_indicator identifies a known archetype, derive the implied
  // confluence factors and merge any that are not already in finalFactors.
  // These are tagged "kb_inferred" — not extracted, but definitionally correct.
  const impliedByArchetype: string[] = entryIndicator
    ? inferFactorsFromArchetype(entryIndicator)
    : [];

  // Build the merged factor list: start from finalFactors, add implied ones
  // that are not already present.
  const mergedSet = new Set(finalFactors);
  const kbInferredAdded: string[] = [];
  for (const implied of impliedByArchetype) {
    if (!mergedSet.has(implied)) {
      mergedSet.add(implied);
      kbInferredAdded.push(implied);
    }
  }
  const mergedFactors = [...mergedSet];

  // ─── Classify each factor by source ──────────────────────────────────────
  const sources: Record<string, FactorSourceLabel> = {};
  const kbInferredSet = new Set(kbInferredAdded);

  for (const factor of mergedFactors) {
    if (rawSet.has(factor)) {
      sources[factor] = "extracted";
    } else if (kbInferredSet.has(factor)) {
      sources[factor] = "kb_inferred";
    } else {
      sources[factor] = "auto_floor";
    }
  }

  // ─── Quality classification ───────────────────────────────────────────────
  // "rich" = ≥2 real factors (extracted OR kb_inferred)
  // "thin" = exactly 1 real factor
  // "fallback_only" = zero real factors (all auto_floor)
  const realCount = mergedFactors.filter(
    (f) => sources[f] === "extracted" || sources[f] === "kb_inferred",
  ).length;

  let factor_quality: "rich" | "thin" | "fallback_only";
  if (realCount >= 2) {
    factor_quality = "rich";
  } else if (realCount === 1) {
    factor_quality = "thin";
  } else {
    factor_quality = "fallback_only";
  }

  return { factor_sources: sources, factor_quality, mergedFactors };
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

// Wave 26 Pass G (2026-05-26) — set of archetype names that trigger the
// graduation.archetype_route_taken audit event. Start with the two new
// archetypes. Add entries here whenever a new archetype ships; the audit
// event is intentionally narrow (new archetypes only) to avoid audit noise
// for the dozens of existing ICT/Wyckoff entries already well-tested.
// W3.4 (2026-06-22): gann_box_4h_continuation added.
const WAVE26G_AUDIT_ARCHETYPES = new Set<string>([
  "bounce_off_level",
  "ict_bias_aligned_continuation",
  "gann_box_4h_continuation",
]);

// Regex patterns that correspond to each audited archetype, used to populate
// route_reason in the graduation.archetype_route_taken audit row so future
// debugging shows WHICH pattern matched, not just the destination archetype.
// Keep in sync with the routing regexes added further down in deriveEntryIndicator.
const WAVE26G_ROUTE_PATTERNS: Record<string, RegExp[]> = {
  bounce_off_level: [
    /bounce.{0,8}(off|from|at|the).{0,8}(ma|ema|sma|level|zone|area|support|resistance)/,
    /(ma|ema|sma|level|zone|support|resistance).{0,8}(bounce|reject|hold|reaction)/,
    /level.rejection|rejection.bounce|ma.rejection|ema.rejection|sma.rejection/,
  ],
  ict_bias_aligned_continuation: [
    /bias.aligned|htf.continuation|continuation.with.bias|bias.confirmation.entry/,
    /ict.continuation|smc.continuation|structure.break.continuation/,
    /bos.fvg|choch.fvg|bos.continuation|choch.continuation/,
  ],
  // W3.4 (2026-06-22) — Gann box 4H continuation routing patterns.
  gann_box_4h_continuation: [
    /gann.{0,6}box|gann.{0,6}(fib|fibonacci|zone|level|square)/,
    /(4h|4.hour|four.hour).{0,12}(candle|box|impulse|impulsive|continuation)/,
    /optimum.{0,12}(zone|fib|fibonacci|retrace|entry)/,
    /premature.{0,12}(zone|fib|entry)|overextended.{0,12}(zone|fib)/,
  ],
};

/**
 * Map concept name to a valid engine-compatible indicator, or null if no
 * supported indicator matches. Order matters — more-specific patterns first.
 * Returning null causes the graduator to reject the bucket (audited as
 * 'no_engine_compatible_indicator').
 */
/**
 * Wave 26 Pass D (2026-05-25) — engine-indicator whitelist for LLM-passthrough.
 * If the bucket's concept name doesn't match any regex but the LLM's
 * `entry_indicator` field is already one of these known engine-supported names,
 * use it directly. Closes the gap where new vocabulary in concept_name causes
 * rejection even though the LLM correctly identified a supported indicator
 * (e.g. concept "4h_pattern_entry_model" with entry_indicator "fair_value_gap").
 */
const ENGINE_INDICATOR_WHITELIST = new Set([
  "sma_crossover", "ema_crossover", "macd_crossover", "donchian_breakout",
  "supertrend", "ichimoku_cloud", "dema_crossover", "alma_filter",
  "rsi_reversal", "rsi_divergence", "connors_rsi2",
  "bollinger_breakout", "vwap_fade", "vwap_reversion", "keltner_squeeze",
  "atr_breakout", "atr_trailing_stop",
  "cumulative_delta", "vwap_order_flow", "volume_profile", "liquidity_sweep_breakout",
  "session_open_breakout", "overnight_drift", "fifo_session_open",
  "news_fade_mco", "event_driven_fade",
]);

// ─── Wave 26 Pass H1 (2026-05-26) — RAW_ARCHETYPES_RESPECTED ─────────────
// Set of all archetype keys Gemma is known to emit correctly.
// When llmEntryIndicator is already a known archetype name, we return it
// immediately WITHOUT running the regex chain (derive_entry_indicator_path:
// 'gemma_archetype_respected'). This prevents the regex chain from
// overwriting a correct Gemma emission (e.g. 'ict_bias_aligned_continuation')
// with a false regex match (e.g. 'break_of_structure').
// 2026-06-24 (Layer 1 shipping-integrity): moved to the pure module
// `src/server/lib/archetype-registry-keys.ts` (single source of truth) so the
// compilability gate can share the same set without importing this DB-coupled module.
const RAW_ARCHETYPES_RESPECTED = RAW_ARCHETYPES_RESPECTED_CANONICAL;

export function deriveEntryIndicator(
  conceptName: string,
  fallback: string | null,
  llmEntryIndicator?: string | null,
  _derivePathOut?: { path?: string },
): string | null {
  const cn = conceptName.toLowerCase();

  // ─── Wave 26 Pass H1 (2026-05-26) — GEMMA ARCHETYPE EARLY-RETURN ──────
  // If Gemma already emitted a known archetype name in entry_indicator,
  // return `archetype:<name>` immediately WITHOUT running the regex chain.
  // derive_entry_indicator_path: 'gemma_archetype_respected'.
  if (llmEntryIndicator) {
    const rawTrimmed = llmEntryIndicator.trim().toLowerCase();
    const archetypeKey = rawTrimmed.startsWith("archetype:")
      ? rawTrimmed.slice("archetype:".length)
      : rawTrimmed;
    if (RAW_ARCHETYPES_RESPECTED.has(archetypeKey) || ARCHETYPE_REGISTRY[archetypeKey]) {
      if (_derivePathOut) _derivePathOut.path = "gemma_archetype_respected";
      return `archetype:${archetypeKey}`;
    }
  }

  // ─── Pass 21 v3 (2026-05-17) — STRUCTURAL ARCHETYPE ROUTING ──────────
  // Check ARCHETYPE_REGISTRY FIRST. ICT/SMC/Wyckoff strategies are
  // structural (detector-driven, not parameter-driven). The prettifier
  // recognizes them and emits a canonical archetype name; if that name
  // is registered, return an "archetype:<name>" sentinel so the DSL Quality
  // Critic gate routes it through the structural path instead of the
  // parametric pattern_library path. Engine compiles via engineSpec field.
  const prettyArchetype = prettifyConcept(conceptName);
  if (ARCHETYPE_REGISTRY[prettyArchetype]) {
    if (_derivePathOut) _derivePathOut.path = "derived_from_prettify";
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

  // ─── Wave 26 Pass H Phase 1.5 (2026-05-26) Fix 4 — Market-structure guard ──
  // "ms" / "mss" / "bos" / "choch" / "market_structure" / "structure_shift" are
  // ICT market-structure tokens — they must NEVER fall into MA/EMA crossover
  // matching. Without this guard, concept names like "htf_bias_and_ms_confirmation"
  // could (via Gemma's pass-through entry_indicator) collide with the MA regex
  // family. This early-negative is checked BEFORE every MA/EMA/SMA branch below
  // and lets the concept fall through to its proper structural archetype.
  const isMarketStructureish = /(^|_)(ms|mss|bos|choch)(_|$)|market[_\s-]?structure|structure[_\s-]?shift|break[_\s-]?of[_\s-]?structure/.test(cn);

  // EMA crossover / moving-average crossover — genuine MA-vs-MA cross signals.
  // KEEP these routed to ema_crossover. "ema.cross", "ma_cross", "pullback.ema" are
  // MA-vs-MA or price-returning-to-trending-MA patterns, NOT S/R bounce patterns.
  // Phase 1.5: bare 2-letter "ma" / "ms" alone DO NOT trigger MA — require explicit
  // ≥3-char tokens (ema/sma/wma/hull/kama/vwma) OR explicit "_ma_cross" / "ma.cross".
  if (!isMarketStructureish && /ema.cross|exponential_moving_average_cross|moving_average_cross|(^|_)ma_cross(_|$)|(^|_)ma\.cross|ema.pullback|pullback.ema/.test(cn)) return "ema_crossover";
  // W23H-postmortem (2026-05-20): single-MA-pullback (Linda Raschke / Bellafiore
  // style — "20 moving average pullback") — price pulls BACK to a trending MA,
  // NOT bouncing off a static S/R level. Stays ema_crossover (same compile path).
  if (!isMarketStructureish && /moving.average.pullback|(^|_)ma\.pullback|(\d+).{0,4}(ema|sma|wma|hull|kama|vwma).{0,8}pullback|pullback.{0,8}\d+.{0,4}(ema|sma|wma|hull|kama|vwma)/.test(cn)) return "ema_crossover";

  // ─── bounce_off_level routing (2026-05-26) ──────────────────────────────────
  // MA-as-support/resistance signal class: price BOUNCES OFF a single MA that
  // acts as a dynamic S/R level. Fundamentally different from ema_crossover (which
  // is MA-vs-MA cross or price-pullback-to-a-trending-MA).
  //
  // Fixes the 6 mis-mapped strategies that were incorrectly routed to ema_crossover:
  //   200_ma_ceiling_floor_{mes,mnq,mcl}_15m  (ceiling/floor keywords)
  //   trendline_bounce_setup_{mes,mnq,mcl}_4h  (bounce keyword)
  //
  // Ordering: must come AFTER the genuine crossover routes above so that concept
  // names containing "ema_cross" or "pullback" still hit ema_crossover above.
  // Phase 1.5 Fix 4: market-structure-ish concepts never route into MA-as-S/R.
  if (!isMarketStructureish && /(ceiling|floor|support|resistance|bounce|reject|holds?|test).{0,12}(ema|sma|wma|moving.?average)/.test(cn)) return "archetype:bounce_off_level";
  if (!isMarketStructureish && /(ema|sma|wma|moving.?average).{0,12}(ceiling|floor|support|resistance|bounce|reject|holds?|test)/.test(cn)) return "archetype:bounce_off_level";
  if (!isMarketStructureish && /(\d+).{0,4}(ema|sma|wma).{0,12}(ceiling|floor|support|resistance|bounce)/.test(cn)) return "archetype:bounce_off_level";
  // "trendline_bounce_setup" — trendline-bounce is behaviorally identical to
  // MA-as-S/R (dynamic level + rejection candle). Same archetype handler.
  if (/trendline.bounce|trendline.{0,8}(reject|test|hold|support|resistance)/.test(cn)) return "archetype:bounce_off_level";
  if (!isMarketStructureish && /(^|_)(\d+)_(ma|ema|sma)(_|$)/.test(cn)) return "archetype:bounce_off_level";  // bare "200_ma", "50_sma"
  if (/(^|_)ema(_|$)/.test(cn)) return "ema_crossover";  // generic EMA without S/R qualifier → crossover default
  if (/(^|_)sma(_|$)/.test(cn)) return "ema_crossover";  // generic SMA without S/R qualifier → crossover default

  // Opening-range / session-open breakout (ORB family).
  if (/orb|opening.range|first.hour|session.open/.test(cn)) return "session_open_breakout";

  // Generic breakout fallback — only matches if no more-specific pattern hit.
  if (/breakout/.test(cn)) return "session_open_breakout";

  // ─── Pass 21 v3 corrected (2026-05-17) — engine-supported indicators ──
  // The KB catalog (src/agents/kb/indicator-catalog.md) supports more than
  // pattern_library. Add explicit routes for the newly-graduating archetypes.
  if (/supertrend/.test(cn)) return "supertrend";
  if (/cumulative.delta|cvd.divergence/.test(cn)) return "cumulative_delta";
  // Wave 26 Pass E.3 fix-up² (2026-05-25) — engine's pattern_library compiles
  // only 13 parametric indicators (see CLAUDE.md §2b). Neither volume_profile
  // nor liquidity_sweep_breakout are among them. Route VP-concept strategies
  // to archetype:order_block — institutional zones where price gets absorbed
  // structurally match VP imbalance/POC/VAH/VAL semantics, AND the archetype
  // path doesn't require pattern_library compile (structural detector handles it).
  if (/volume.profile|market.profile|(^|_)poc(_|$)|(^|_)vah(_|$)|(^|_)val(_|$)/.test(cn)) return "archetype:order_block";
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

  // ─── Wave 26 Pass D (2026-05-25) — vocabulary expansion ─────────────────
  // Operator's 29-URL batch introduced 6 new concept-name patterns that fell
  // through the chain even though they map cleanly to existing engine
  // primitives. Each line below corresponds to a graduation rejection observed
  // in audit_log on 2026-05-25. All target engine-supported indicators — no
  // new engine work needed.

  // "extreme band reversal" / "3-sigma BB" / "outlier band" → bollinger_breakout
  // (engine compiles bollinger_breakout with std_dev=3.0 for 3-sigma variants).
  if (/extreme.band|(\d|three|two).{0,2}sigma|outlier.band|band.reversal/.test(cn)) return "bollinger_breakout";

  // "one candle setup" / "first candle break" / "opening candle break" → ORB family.
  // The "first 5m candle of RTH" pattern is functionally identical to ORB with
  // a 5-minute range_minutes; engine compiles via session_open_breakout.
  if (/(one|first|opening).{0,4}(candle|bar)|first.{0,4}\d+.?min.{0,4}(candle|bar)/.test(cn)) return "session_open_breakout";

  // "MA trend following" / "20 MA trend" / "moving average trend following" →
  // ema_crossover (engine's canonical MA-pullback compile target; same pattern
  // shape — slope check + price-to-MA distance — captured by the existing
  // ema_crossover primitive via fast/slow period derivation).
  if (/ma.trend.follow|moving.average.trend|trend.follow.{0,8}(ma|ema|sma)|(\d+).{0,4}(ma|ema|sma).{0,8}trend/.test(cn)) return "ema_crossover";

  // ─── Wave 26 Pass G (2026-05-26) — ict_bias_aligned_continuation routes ───
  // "multi confluence short/long setup" / "bias aligned continuation" /
  // "ict short continuation" / "htf bias + bos + fvg" variants.
  // These are the 3-layer ICT model (4H bias → 15m BOS → 5m FVG) that Gemma
  // couldn't fit into any existing archetype. The archetype is BIDIRECTIONAL —
  // a "short setup" video describes the bearish leg but the engine fires both.
  // Regex order: most-specific first.
  if (/multi.confluence.short.setup|multi.confluence.long.setup/.test(cn)) {
    return "archetype:ict_bias_aligned_continuation";
  }
  if (/bias.aligned.(continuation|short|long|setup)|bias.continuation/.test(cn)) {
    return "archetype:ict_bias_aligned_continuation";
  }
  if (/ict.short.continuation|ict.long.continuation/.test(cn)) {
    return "archetype:ict_bias_aligned_continuation";
  }
  // Generic "htf bias + structure" without a more-specific archetype match
  if (/htf.bias.{0,10}(bos|choch|structure.break|fvg)|4h.bias.{0,10}(bos|choch|fvg)/.test(cn)) {
    return "archetype:ict_bias_aligned_continuation";
  }

  // "multi confluence" / "stacked confluence" / "confluence setup" — these are
  // meta-patterns (multiple confluences stacked, not a primitive indicator).
  // Route via the bucket's entry_archetype fallback; if that's unknown, default
  // to ema_crossover (most multi-confluence setups gate MA-based entries).
  if (/multi.confluence|stacked.confluence|confluence.setup/.test(cn)) {
    if (fallback && ENTRY_INDICATOR_MAP[fallback]) return ENTRY_INDICATOR_MAP[fallback];
    return "ema_crossover";
  }

  // "market structure level" / "structure level identification" / "swing
  // structure" → Wave 25 BOS/MSS archetype. Operator strategies routinely
  // describe "identify lower highs / break of structure" which IS the BOS
  // signal; ARCHETYPE_REGISTRY has break_of_structure already, route via that.
  if (/market.structure(?!.shift)|structure.level|swing.structure|major.structure/.test(cn)) return "archetype:break_of_structure";

  // Wave 26 Pass E.2 (2026-05-25) — top-down bias / HTF trend strategies route
  // to break_of_structure archetype. Top-down bias = trade in direction of HTF
  // trend, confirmed by structure break on LTF. Closes top_down_bias_oil_short
  // straggler from operator's 2026-05-25 ingest.
  if (/top.down.bias|top.down.trend|htf.bias.trade|directional.bias/.test(cn)) return "archetype:break_of_structure";

  // Wave 26 Pass E.3 fix-up² — vacuum / VP-imbalance concepts → archetype:order_block
  // (engine's pattern_library doesn't compile liquidity_sweep_breakout either).
  if (/vacuum.{0,4}(volume.profile|vp)|volume.profile.{0,4}(imbalance|void)|vp.{0,4}(imbalance|void)/.test(cn)) return "archetype:order_block";

  // ─── Wave 26 Pass G (2026-05-26) — new engine archetype routing ──────────
  // bounce_off_level: MA rejection / level bounce concepts. Pattern covers
  // "bounce off EMA", "price rejects MA", "level rejection bounce", etc.
  // The engine archetype handles MA-type + MA-period detection internally.
  if (/bounce.{0,8}(off|from|at|the).{0,8}(ma|ema|sma|level|zone|area|support|resistance)|(ma|ema|sma|level|zone|support|resistance).{0,8}(bounce|reject|hold|reaction)|level.rejection|rejection.bounce|ma.rejection|ema.rejection|sma.rejection/.test(cn)) {
    return "archetype:bounce_off_level";
  }

  // ict_bias_aligned_continuation: HTF bias + BOS/CHoCH + FVG killzone continuation.
  // Concepts that mention HTF/bias alignment + structure break + FVG in one phrase.
  if (/bias.aligned|htf.continuation|continuation.with.bias|bias.confirmation.entry|ict.continuation|smc.continuation|structure.break.continuation|bos.fvg|choch.fvg|bos.continuation|choch.continuation/.test(cn)) {
    return "archetype:ict_bias_aligned_continuation";
  }

  // ─── LLM passthrough fallback ───────────────────────────────────────────
  // Concept name didn't match any regex BUT the LLM extracted a known
  // engine-supported entry_indicator. Trust the LLM in this narrow path —
  // it correctly identified the indicator even though the bucket name diverges.
  // Example: concept "4h_pattern_entry_model" + LLM entry_indicator "fair_value_gap"
  // → returns "archetype:fvg_retrace" (the engine analog).
  if (llmEntryIndicator) {
    const llm = llmEntryIndicator.toLowerCase().trim();
    if (ENGINE_INDICATOR_WHITELIST.has(llm)) return llm;
    // Common LLM-vocabulary aliases for archetype indicators
    if (llm === "fair_value_gap" || llm === "fvg") return "archetype:fvg_retrace";
    if (llm === "order_block" || llm === "supply_demand_zone" || llm === "demand_supply_zone") return "archetype:order_block";
    // Wave 26 Pass E.2 — market_structure / structure_break LLM vocabulary
    if (llm === "market_structure" || llm === "structure_break" || llm === "bos" || llm === "break_of_structure") return "archetype:break_of_structure";
    if (llm === "liquidity_sweep") return "liquidity_sweep_breakout";
    if (llm === "fibonacci_retracement") return "archetype:ict_ote";
    if (llm === "simple_moving_average" || llm === "exponential_moving_average") return "ema_crossover";
    if (llm === "trendline_breakout") return "session_open_breakout";  // breakout of a trendline level → ORB-analog
    if (llm === "trendline_bounce") return "archetype:bounce_off_level";  // bounce off trendline = MA-as-S/R analog
    if (llm === "previous_range_pullback" || llm === "break_and_retest") return "session_open_breakout";
    // Wave 26 Pass E.3 fix-up² — volume_profile_imbalance / vacuum VP concepts
    // route to archetype:order_block. Engine's pattern_library doesn't compile
    // bare volume_profile OR liquidity_sweep_breakout as parametric indicators
    // (only 13 are supported per CLAUDE.md §2b). Archetype:order_block is the
    // engine-supported structural detector that matches VP-imbalance semantics
    // (institutional absorption zones).
    if (llm === "volume_profile_imbalance" || llm === "volume_profile") return "archetype:order_block";
    // Wave 26 Pass G (2026-05-26) — LLM aliases for ict_bias_aligned_continuation
    if (
      llm === "bias_aligned_continuation" ||
      llm === "ict_bias_aligned_continuation" ||
      llm === "ict_short_continuation" ||
      llm === "ict_long_continuation" ||
      llm === "multi_confluence_short_setup" ||
      llm === "multi_confluence_long_setup" ||
      llm === "htf_bias_continuation" ||
      llm === "bias_continuation"
    ) return "archetype:ict_bias_aligned_continuation";
  }

  // Fallback to archetype mapping ONLY for ambiguous cases.
  if (fallback && ENTRY_INDICATOR_MAP[fallback]) return ENTRY_INDICATOR_MAP[fallback];

  // ─── Wave 26 Pass J Phase 3 (2026-05-26) — UNCATALOGUED SPEAKER TERM ──
  // Previously: no mapping → return null → caller dropped the strategy silently.
  // Now: emit `uncatalogued:<sanitized_term>` so the caller graduates the
  // strategy AND queues the speaker term in `needs_archetype_queue` for
  // operator/Claude review. The catalog grows from real-world videos instead
  // of bottlenecking them. derive_entry_indicator_path: 'uncatalogued_speaker_term'.
  //
  // Sanitize: lowercase, [a-z0-9_] only, max 64 chars, never empty.
  const speakerCandidate =
    (llmEntryIndicator?.toLowerCase().trim() ?? "") ||
    (fallback?.toLowerCase().trim() ?? "") ||
    cn;
  const sanitized = speakerCandidate
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (sanitized.length > 0) {
    if (_derivePathOut) _derivePathOut.path = "uncatalogued_speaker_term";
    return `uncatalogued:${sanitized}`;
  }

  // Truly empty input → unrecoverable. Log + reject.
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
  // bounce_off_level — MA-as-S/R archetype default. Concept name usually contains
  // the period (e.g. "200_ma_ceiling_floor") — smartExtractPeriods picks it up.
  // Fallback: 200 SMA (most-cited MA-as-S/R level in retail content).
  bounce_off_level:    { ma_period: 200 },
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
  } else if (indicator === "bounce_off_level") {
    // MA-as-S/R bounce: extract the MA period from concept name (e.g. "200_ma", "50_sma").
    // smartExtractPeriods picks up the numeric prefix. Use the first plausible MA
    // period (common textbook periods: 20, 50, 100, 200).
    const maPeriodCandidates = nums.filter((n) => [20, 50, 100, 200].includes(n));
    if (maPeriodCandidates.length > 0) {
      params["ma_period"] = maPeriodCandidates[0];
    } else if (nums.length > 0) {
      params["ma_period"] = nums[0];
    }
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

  // ── bounce_off_level — MA-as-S/R (2026-05-26) ──────────────────────────────
  // These concept names belong to the MA-as-support/resistance signal class.
  // Routes to ARCHETYPE_REGISTRY["bounce_off_level"] via prettifyConcept result.
  // Must appear BEFORE the noise-strip fallback so the ARCHETYPE_REGISTRY check
  // in deriveEntryIndicator() fires (not the explicit if-chain further below).
  if (/(ceiling|floor|support|resistance|bounce|reject|holds?|test).{0,12}(ma|ema|sma|moving.?average)/.test(cn)) return "bounce_off_level";
  if (/(ma|ema|sma|moving.?average).{0,12}(ceiling|floor|support|resistance|bounce|reject|holds?|test)/.test(cn)) return "bounce_off_level";
  if (/(\d+).{0,4}(ma|ema|sma).{0,12}(ceiling|floor|support|resistance|bounce)/.test(cn)) return "bounce_off_level";
  if (/trendline.bounce|trendline.{0,8}(reject|test|hold|support|resistance)/.test(cn)) return "bounce_off_level";
  if (/(^|_)(\d+)_(ma|ema|sma)(_|$)/.test(cn)) return "bounce_off_level";  // bare "200_ma", "50_sma"

  // ── gann_box_4h_continuation — W3.4 (2026-06-22) ──────────────────────────
  // Gann box drawn over an impulsive 4H candle, divided by Fib zones (0/0.25/0.5/0.75/1).
  // Entry in optimum zone (0.50–0.75) on retracement wick + FVG/OB confluence.
  // Must appear BEFORE the noise-strip fallback so the ARCHETYPE_REGISTRY check fires.
  // Source video: SY2jXlW9bt4 (quarantine-escape path).
  if (/gann.{0,6}box|gann.{0,6}(fib|fibonacci|zone|level|square)/.test(cn)) return "gann_box_4h_continuation";
  if (/(4h|4.hour|four.hour).{0,12}(candle|box|impulse|impulsive|continuation)/.test(cn)) return "gann_box_4h_continuation";
  if (/(candle|impulse|impulsive).{0,12}(4h|4.hour|four.hour)/.test(cn)) return "gann_box_4h_continuation";
  if (/(fib|fibonacci).{0,12}(zone|box|optimum|retracement).{0,12}(4h|4.hour|continuation)/.test(cn)) return "gann_box_4h_continuation";
  if (/optimum.{0,12}(zone|fib|fibonacci|retrace|entry)/.test(cn)) return "gann_box_4h_continuation";
  if (/premature.{0,12}(zone|fib|entry)|overextended.{0,12}(zone|fib)/.test(cn)) return "gann_box_4h_continuation";

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
  /** Wave 26 Pass D (2026-05-25): operator-force-graduate path sets this true
   *  to sidestep the GRADUATION_DAILY_CAP guardrail. The cap exists to stop
   *  autonomous scout pipeline floods; operator-explicit manual ingest of a
   *  URL batch is by definition not a flood — every URL was chosen. Cron drain
   *  still passes `bypassDailyCap=false` (default) and respects the cap. */
  bypassDailyCap?: boolean;
}): Promise<DirectGraduationResult> {
  const { bucketId, bestMention, bucketMeta, sourceCount, distinctProviders, layersCovered, layerTags, correlationId, bypassDailyCap = false } = opts;
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
  // Wave 26 Pass D: pass LLM's entry_indicator through for whitelist passthrough
  // when concept name doesn't match any regex.
  const llmEntryIndicator = ((extractedIdea as any)?.entry_indicator ?? null) as string | null;
  const earlyIndicator = deriveEntryIndicator(conceptName, bucketMeta.entryArchetype, llmEntryIndicator);
  const entryParamsFromExtraction = (extractedIdea as any)?.entry_params;
  const llmParams = (entryParamsFromExtraction && typeof entryParamsFromExtraction === "object")
    ? (entryParamsFromExtraction as Record<string, unknown>)
    : {};
  const namedParams = earlyIndicator ? deriveEntryParams(conceptName, earlyIndicator) : {};
  // LLM-provided values take precedence over name-derived (LLM is authoritative
  // when present; name-derive is a fallback for empty extractions).
  const effectiveEntryParams: Record<string, unknown> = { ...namedParams, ...llmParams };

  // Wave 26 Pass D (2026-05-25) — per-symbol sweep-buffer default fill.
  // LLM extractions of `session_open_breakout` routinely leave `buffer_ticks`
  // null (no explicit tick count in the source). PARAM_RANGES validates
  // buffer_ticks ∈ [1,10] when present, so null → param_range_violation
  // rejection. Fill from canonical CLAUDE.md §4 per-symbol policy table
  // (mirrors src/engine/context/structural_stops.py) BEFORE range validation.
  if (earlyIndicator === "session_open_breakout"
      && (effectiveEntryParams.buffer_ticks === null || effectiveEntryParams.buffer_ticks === undefined)) {
    const SWEEP_BUFFER_DEFAULTS: Record<string, number> = { MES: 3, MNQ: 5, MCL: 2 };
    const envOverride = process.env[`STOP_BUFFER_TICKS_${market}`];
    const fallbackTicks = envOverride ? Number.parseInt(envOverride, 10) : SWEEP_BUFFER_DEFAULTS[market];
    if (Number.isFinite(fallbackTicks) && fallbackTicks >= 1 && fallbackTicks <= 10) {
      effectiveEntryParams.buffer_ticks = fallbackTicks;
    }
  }

  // Wave 26 Pass E.3 fix-up — liquidity_sweep_breakout default-fill. Same
  // pattern as buffer_ticks. Fires when VP/POC/vacuum concepts re-route here.
  // Sensible institutional defaults: sweep_lookback=20 bars (typical equal-high
  // / equal-low cluster lookback), volume_spike_multiplier=1.5x (sweep candle
  // volume > 1.5× average is the institutional sweep signature).
  if (earlyIndicator === "liquidity_sweep_breakout") {
    if (effectiveEntryParams.sweep_lookback === null || effectiveEntryParams.sweep_lookback === undefined) {
      const env = process.env.LIQUIDITY_SWEEP_LOOKBACK_DEFAULT;
      const fallback = env ? Number.parseInt(env, 10) : 20;
      if (Number.isFinite(fallback) && fallback >= 5 && fallback <= 100) {
        effectiveEntryParams.sweep_lookback = fallback;
      }
    }
    if (effectiveEntryParams.volume_spike_multiplier === null || effectiveEntryParams.volume_spike_multiplier === undefined) {
      const env = process.env.LIQUIDITY_SWEEP_VOLUME_MULT_DEFAULT;
      const fallback = env ? Number.parseFloat(env) : 1.5;
      if (Number.isFinite(fallback) && fallback >= 1.0 && fallback <= 5.0) {
        effectiveEntryParams.volume_spike_multiplier = fallback;
      }
    }
  }

  // Wave 26 Pass E.2 (2026-05-25) — volume_profile default-fill. Same pattern
  // as buffer_ticks. Sensible institutional defaults: profile_window=20 bars
  // (matches the developing_session_poc 20-bar lookback used elsewhere) and
  // node_threshold_pct=0.02 (2% volume threshold for LVN/HVN detection).
  // Env override: VP_PROFILE_WINDOW_DEFAULT / VP_NODE_THRESHOLD_PCT_DEFAULT.
  if (earlyIndicator === "volume_profile") {
    if (effectiveEntryParams.profile_window === null || effectiveEntryParams.profile_window === undefined) {
      const env = process.env.VP_PROFILE_WINDOW_DEFAULT;
      const fallback = env ? Number.parseInt(env, 10) : 20;
      if (Number.isFinite(fallback) && fallback >= 5 && fallback <= 100) {
        effectiveEntryParams.profile_window = fallback;
      }
    }
    if (effectiveEntryParams.node_threshold_pct === null || effectiveEntryParams.node_threshold_pct === undefined) {
      const env = process.env.VP_NODE_THRESHOLD_PCT_DEFAULT;
      const fallback = env ? Number.parseFloat(env) : 0.02;
      if (Number.isFinite(fallback) && fallback > 0 && fallback <= 0.5) {
        effectiveEntryParams.node_threshold_pct = fallback;
      }
    }
  }

  // MED (freshscan8 2026-07-12): fingerprint on the RESOLVED direction (what the strategy is actually
  // persisted with, config.direction=resolvedDirection ~2296), NOT the raw extracted `direction` (default
  // "long", line ~1435). resolvedDirection (~2128) upgrades long/absent/both → "both" (only explicit
  // "short" stays one-sided), and it's computed AFTER this fingerprint, so replicate its rule here.
  // Otherwise a concept that persists as "both" was fingerprinted under "long" → same-concept
  // re-graduations escaped dedup as duplicate "both" strategies. Mirrors the 2128-2146 resolution exactly.
  const fingerprintDirection: "long" | "short" | "both" = direction === "short" ? "short" : "both";
  const wideFingerprint = computeWideConceptFingerprintHash({
    market,
    concept_name: conceptName,
    timeframe,
    direction: fingerprintDirection,
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
  // Wave 26 Pass D — operator-force-graduate path bypasses cap (see opts.bypassDailyCap docstring).
  if (todayGraduated >= DAILY_CAP && !bypassDailyCap) {
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
  // ─── Wave 26 Pass H1 (2026-05-26) — derive_entry_indicator_path audit ──
  // Capture which path deriveEntryIndicator took so graduation audits reflect
  // whether Gemma's archetype was respected or overridden by the regex chain.
  const _derivePathOut: { path?: string } = {};
  const entryIndicator = deriveEntryIndicator(conceptName, bucketMeta.entryArchetype, llmEntryIndicator, _derivePathOut);
  const deriveEntryIndicatorPath: string =
    _derivePathOut.path ??
    (entryIndicator === null
      ? "no_match"
      : entryIndicator.startsWith("archetype:")
        ? "derived_from_regex"
        : "derived_from_regex");

  // Wave 26 Pass G (2026-05-26) — graduation.archetype_route_taken audit.
  // Fire whenever deriveEntryIndicator routes to a NEW named archetype so
  // future mis-mappings are visible before they become silent library drift.
  // The new archetypes (bounce_off_level, ict_bias_aligned_continuation) plus
  // any future archetype added to ARCHETYPE_REGISTRY will appear here.
  // Fire-and-forget (.catch) — NEVER blocks the signal flow.
  if (
    entryIndicator !== null &&
    entryIndicator.startsWith("archetype:") &&
    WAVE26G_AUDIT_ARCHETYPES.has(entryIndicator.slice("archetype:".length))
  ) {
    const routedArchetype = entryIndicator.slice("archetype:".length);
    // Determine which regex pattern matched (first-match scan for display).
    const routeReason = WAVE26G_ROUTE_PATTERNS[routedArchetype]
      ?.find((re) => re.test(conceptName.toLowerCase()))
      ?.toString() ?? "archetype_registry_lookup";
    insertAuditRowSafe({
      action: "graduation.archetype_route_taken",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: {
        bucket_id: bucketId,
        concept_name: conceptName,
      } as Record<string, unknown>,
      result: {
        archetype: routedArchetype,
        route_reason: routeReason,
        derive_entry_indicator_path: deriveEntryIndicatorPath,
      } as Record<string, unknown>,
      status: "info",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) =>
      logger.warn({ err: auditErr }, "graduation.archetype_route_taken audit write failed (non-blocking)")
    );
  }

  // ─── Wave 26 Pass J Phase 3 (2026-05-26) — UNCATALOGUED → QUEUE, DON'T DROP ──
  // When deriveEntryIndicator returns `uncatalogued:<speaker_term>`, the
  // speaker taught a real strategy whose vocabulary doesn't map to a known
  // canonical indicator or archetype. Previously these were silently dropped.
  // Now: insert into needs_archetype_queue (UPSERT bumps extraction_count) and
  // emit a `graduation.queued_for_archetype` audit so operator + Claude can
  // review high-frequency terms (extraction_count >= 3) and promote them to
  // real canonical archetypes. Bucket reverts to pending (not graduated)
  // because the engine can't compile an uncatalogued indicator yet — but the
  // strategy concept is PRESERVED for future archetype creation instead of
  // dropped into oblivion.
  if (entryIndicator !== null && entryIndicator.startsWith("uncatalogued:")) {
    const speakerTerm = entryIndicator.slice("uncatalogued:".length);
    try {
      // UPSERT: insert new row OR bump extraction_count on collision
      await db.execute(sql`
        INSERT INTO needs_archetype_queue (
          bucket_id, speaker_term, verbatim_description, transcript_quote, source_url, extraction_count, status
        ) VALUES (
          ${bucketId}::uuid, ${speakerTerm}, ${conceptName}, NULL, NULL, 1, 'pending'
        )
        ON CONFLICT (speaker_term)
        DO UPDATE SET
          extraction_count = needs_archetype_queue.extraction_count + 1,
          updated_at = NOW()
      `);
    } catch (qErr) {
      logger.warn(
        { err: qErr, bucketId, speakerTerm },
        "needs_archetype_queue UPSERT failed (non-blocking — strategy still preserved via audit)",
      );
    }
    await db.insert(auditLog).values({
      action: "graduation.queued_for_archetype",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: { bucket_id: bucketId, concept_name: conceptName, archetype: bucketMeta.entryArchetype } as Record<string, unknown>,
      result: {
        speaker_term: speakerTerm,
        strategy_name: strategyName,
        next_action: "operator_review_when_extraction_count_ge_3",
        derive_entry_indicator_path: deriveEntryIndicatorPath,
      } as Record<string, unknown>,
      status: "info",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "audit_log write failed (non-blocking)"));

    // ─── Pass 2 Track D (2026-06-22) — UNCATALOGUED PINE RECIPE AUDIT ────────
    // Emit a dedicated audit row so the operator can trace every uncatalogued
    // speaker term that entered the `needs_archetype_queue`. The existing
    // `graduation.queued_for_archetype` row records queue state; this row
    // records the Pine export contract (alert_only band) so the export pipeline
    // can distinguish "queued but no pine recipe" from "queued with alert_only".
    await insertAuditRowSafe({
      action: "graduation.uncatalogued_pine_recipe_assigned",
      entityType: "strategy_pending_bucket",
      entityId: bucketId,
      input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
      result: {
        speaker_term: speakerTerm,
        pine_band: "alert_only",
        recipe_source: "UNCATALOGUED_SPEAKER_TERM",
        strategy_name: strategyName,
      } as Record<string, unknown>,
      status: "info",
      decisionAuthority: "system",
      correlationId: correlationId ?? null,
    });

    return {
      strategyId: null,
      strategyName,
      skipped: true,
      reason: "queued_for_archetype",
    };
  }

  // Pass 21 (2026-05-16) — REJECT graduation if no engine-compatible indicator.
  // Concepts like Supertrend, ICT/SMC, FVG, Volume Profile, Pivot Points have
  // no entry in the engine's pattern_library, so a strategy with these would
  // fail at compile time anyway. Better to reject here, log the concept for
  // future engine work, and free up the daily-cap slot.
  //
  // Wave 26 Pass J Phase 3: deriveEntryIndicator now returns null ONLY when
  // both llmEntryIndicator AND fallback AND conceptName all sanitize to empty —
  // truly unrecoverable input. Common "no canonical match" cases now route to
  // the uncatalogued queue (block above) instead of returning null.
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
  // Wave 26 Pass E.2 (2026-05-25) — vocabulary expansion. Gemma 4's LLM prose
  // uses canonical 2026 SMC/ICT/structure vocabulary that the original Pass 21
  // keyword set didn't cover: "demand zone" / "supply zone" (order_block synonym),
  // "lower high" / "higher low" / "swing low broken" (break_of_structure),
  // "fib" / "fibonacci" / "% retrace" (ict_ote OTE expression), "volume profile" /
  // "vacuum" / "POI" (volume_profile). Without these tokens hasRealRules=false
  // and graduation fails with thin_archetype_dsl on RICH LLM prose. Closes 4 of
  // 7 stragglers from operator's 2026-05-25 29-URL ingest.
  const hasRealRules = extractedEntry.length > 40 &&
    /(close|cross|break|above|below|enter|trigger|when|rsi\s*[<>]|ema\(|sma\(|sweep|displacement|mss|(^|\W)fvg(\W|$)|retrace|(^|\W)ote(\W|$)|breaker|choch|(^|\W)bos(\W|$)|cisd|killzone|manipulation|order.block|fair.value.gap|liquidity|raid|accumulation|distribution|spring|upthrust|poc|vah|val|imbalance|absorption|demand.zone|supply.zone|(^|\W)poi(\W|$)|lower.high|higher.low|swing.low|swing.high|fib(onacci)?|fibonacci|\d{1,2}%|0\.\d{2,3}|volume.profile|vacuum|impulse|wait.for|identif|setup|enter.on|entry.upon)/.test(extractedEntry);

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
    // Wave 26 Pass D (2026-05-25) — widen identifier to accept canonical OTE
    // fib-percentage expressions. Operator's Gemma-4 extractions describe OTE
    // as "71% fib retracement" / "0.71 fib level" without using the literal
    // "OTE" abbreviation — same mechanic, different vocabulary. Both pass.
    ict_ote: { identifier: /ote|optimal.trade.entry|optimal.entry|fib.{0,3}(level|zone|retrace).{0,20}(0\.62|0\.705?|0\.71|0\.79|62%|70\.5%|71%|79%)|(0\.62|0\.705?|0\.71|0\.79|62%|70\.5%|71%|79%).{0,20}fib.{0,3}(level|zone|retrace)|(71|705|62|79).{0,3}(fib|level|zone).{0,20}(retrac|pullback|entry)/i, context: [/bos|break.of.structure/i, /62|70|71|79|fib|fibonacci/i] },
    ict_power_of_3: { identifier: /power.of.3|power.of.three|accumulation.*manipulation|po3/i, context: [/asia/i, /london/i, /ny/i] },
    ict_unicorn: { identifier: /unicorn/i, context: [/breaker|breaker.block/i, /fvg|fair.value.gap/i] },
    ict_breaker: { identifier: /breaker|failed.swing|flipped/i, context: [/retest|return/i] },
    ict_mitigation: { identifier: /mitigation/i, context: [/retest|return|reentry/i] },
    ict_iofed: { identifier: /iofed|displacement.*fvg|fvg.*displacement/i, context: [/order.flow/i, /htf|higher.timeframe/i] },
    smt_reversal: { identifier: /smt|smart.money.divergence|correlation.divergence/i, context: [/mss|reversal/i, /nq.*es|es.*nq/i] },
    ict_turtle_soup: { identifier: /turtle.soup|equal.high|equal.low|eqh|eql/i, context: [/sweep|failure|reversal/i] },
    ict_midnight_open: { identifier: /midnight|00[:.]00|ndog|nwog|new.day.opening.gap/i, context: [/mean.reversion|return/i] },
    fvg_retrace: { identifier: /fvg|fair.value.gap/i, context: [/retrace|return|fill/i] },
    // W23H-postmortem (2026-05-20): "supply & demand" is the operator-canonical
    // synonym for "order block" — same mechanic, different vocabulary (Sam Seiden
    // / IBLV / Trade with Pat / Brooks call them supply/demand zones; ICT calls
    // them order blocks). Both must satisfy the archetype identifier check.
    order_block: { identifier: /order.block|(^|\s)ob(\s|$)|last.opposite|supply.{0,3}(and.{0,3})?demand|demand.zone|supply.zone|institutional.zone|institutional.supply|institutional.demand/i, context: [/retest|return|reject|bounce/i] },
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
    // Wave hardening 2026-06-22, CI-trust — 6 archetypes added to ARCHETYPE_REGISTRY
    // without MECHANIC_KEYWORDS entries; adding now to close the coverage gap.
    // fvg / judas_swing / silver_bullet / breaker_block are W23G.3 short-form aliases
    // that route to the same engine handlers as their ict_* canonical equivalents.
    // bounce_off_level / ict_bias_aligned_continuation are Wave 26 Pass G engine impls.
    fvg: { identifier: /fvg|fair.value.gap/i, context: [/retrace|return|fill|displacement/i] },
    judas_swing: { identifier: /judas|manipulation|fake.move|fake.breakout/i, context: [/mss|market.structure.shift|reversal/i] },
    silver_bullet: { identifier: /silver.bullet/i, context: [/sweep|liquidity/i, /fvg|fair.value.gap/i] },
    breaker_block: { identifier: /breaker|failed.swing|flipped/i, context: [/retest|return/i] },
    bounce_off_level: { identifier: /bounce|reject|ma.{0,10}support|ma.{0,10}resistance|moving.average.{0,15}(level|zone|touch)|price.{0,10}(test|touch).{0,10}(ema|sma|ma)/i, context: [/support|resistance|level/i] },
    ict_bias_aligned_continuation: { identifier: /bias|htf.{0,10}(long|short|bull|bear)|continuation/i, context: [/bos|break.of.structure|choch|change.of.character/i, /fvg|fair.value.gap/i] },
  };

  let mechanicKeywordErrors: string[] = [];
  let mechanicKeywordContextWarnings: string[] = [];
  if (isArchetype && archetypeName && ARCHETYPE_MECHANIC_KEYWORDS[archetypeName]) {
    const spec = ARCHETYPE_MECHANIC_KEYWORDS[archetypeName];
    if (!spec.identifier.test(extractedEntry)) {
      // Wave 26 Pass E.3 (2026-05-25) — identifier-missing is HARD-FAIL only
      // when the prose is ALSO thin (hasRealRules=false). When the LLM emitted
      // RICH prose containing structural vocabulary (sweep / structure / level /
      // retrace / impulse / demand / supply / etc.) BUT didn't use the literal
      // archetype-specific token (e.g. "BOS" / "OTE" / "FVG"), demote to
      // advisory warning. Rationale:
      //   - The 3-layer cross-validation gate already confirms intent.
      //   - hasRealRules acts as the hallucination guard (40+ chars + keywords).
      //   - The archetype identifier is one keyword among the LLM's natural
      //     vocabulary; modern LLMs paraphrase ("price retraces to 71% level"
      //     instead of "OTE entry", "swing low broken" instead of "BOS").
      //   - Pre-Pass-E3 behavior caused 4+ legitimate strategies/27 to be
      //     rejected from operator's 2026-05-25 ingest with rich correct prose.
      if (hasRealRules) {
        // Demote to advisory — log + accept
        mechanicKeywordContextWarnings = [
          `identifier_paraphrased: archetype ${archetypeName} identifier regex (${spec.identifier.source}) not literal in prose, but hasRealRules=true — accepting per Pass E.3 demotion`,
        ];
      } else {
        mechanicKeywordErrors = [spec.identifier.source];
      }
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
  // Regime-agnostic archetypes — MED#6 hardening (2026-07-12): now the MODULE-level
  // REGIME_AGNOSTIC_ARCHETYPES canonical set (single source of truth; see definition near the top).
  const UNSPECIFIED_ARCHETYPES = REGIME_AGNOSTIC_ARCHETYPES;

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

  // ─── Wave 26 Pass I (2026-05-26): Extract v11 Gemma fields ───────────────────
  // Null-safe reads — all fields are optional (v10 extractions leave them absent).
  // If absent, defaults keep existing behavior unchanged (backward-compat absolute).
  const v11EntrySequence: Array<{ step: number; name: string; rule: string; indicators_needed?: string[] }> =
    Array.isArray((extractedIdea as any)?.entry_sequence)
      ? (extractedIdea as any).entry_sequence
      : [];
  const v11StopLoss: { anchor?: string; buffer_atr?: number; rationale?: string } | null =
    (extractedIdea as any)?.stop_loss && typeof (extractedIdea as any).stop_loss === "object"
      ? (extractedIdea as any).stop_loss
      : null;
  const v11Targets: Array<{ priority: number; type: string; rationale?: string }> =
    Array.isArray((extractedIdea as any)?.targets)
      ? (extractedIdea as any).targets
      : [];
  const v11Filters: Array<{ type: string; condition?: string; value?: unknown; rationale?: string }> =
    Array.isArray((extractedIdea as any)?.filters)
      ? (extractedIdea as any).filters
      : [];
  const v11Timeframes: { bias?: string[]; entry?: string[]; trigger?: string[] } | null =
    (extractedIdea as any)?.timeframes && typeof (extractedIdea as any).timeframes === "object"
      ? (extractedIdea as any).timeframes
      : null;
  const v11IndicatorsUsed: Array<{ name: string; purpose?: string }> =
    Array.isArray((extractedIdea as any)?.indicators_used)
      ? (extractedIdea as any).indicators_used
      : [];
  const v11ExtractionGapReason: string | null =
    typeof (extractedIdea as any)?.extraction_gap_reason === "string"
      ? (extractedIdea as any).extraction_gap_reason
      : null;

  // Resolve v11 timeframe hierarchy fields. First elements of each tier take priority.
  const v11BiasTf: string | null = v11Timeframes?.bias?.[0] ?? null;
  const v11EntryTf: string | null = v11Timeframes?.entry?.[0] ?? null;
  const v11TriggerTf: string | null = v11Timeframes?.trigger?.[0] ?? null;

  // 5-TF hierarchy from bias array — map the multiple bias TFs to the
  // Wave 25 Pass 2 column contract (daily/htf/itf columns).
  // Schema: bias[0]=highest-TF bias → daily_tf proxy; bias[1]=HTF; remaining=ITF candidate.
  const v11DailyTf: string | null =
    v11Timeframes?.bias && v11Timeframes.bias.length >= 1 ? v11Timeframes.bias[0] : null;
  const v11HtfTf: string | null =
    v11Timeframes?.bias && v11Timeframes.bias.length >= 2 ? v11Timeframes.bias[1] : null;
  const v11ItfTf: string | null =
    v11Timeframes?.bias && v11Timeframes.bias.length >= 3
      ? v11Timeframes.bias[2]
      : (v11EntryTf ?? null);

  // Flatten all entry_sequence[].indicators_needed into a unique set
  // to UNION with existing confirming_indicators.
  const v11SeqIndicators: string[] = v11EntrySequence.flatMap(
    (step) => Array.isArray(step.indicators_needed) ? step.indicators_needed : []
  );

  // Whether v11 emits explicit stop/targets (triggers adaptive exit override)
  const v11HasExplicitStop = v11StopLoss !== null && typeof v11StopLoss.anchor === "string";
  const v11HasTargets = v11Targets.length > 0;

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

  // Deep-scan #15 FIX-3 (2026-07-03): FRAMEWORK_OVERLAY_APPLIED was declared in
  // sse.ts's FACTORY_EVENTS catalog with full payload docs but had ZERO
  // broadcastSSE call sites anywhere in the repo — a documented-but-dead event.
  // applyFrameworkOverlay() itself stays a pure function (no I/O — see its own
  // module docstring); the caller (here) is the correct place to turn its
  // return value into an observable event. Fires once per overlay application
  // (leader row only — variants re-apply the same overlay per-market and are
  // not separately broadcast to avoid one graduation flooding N events).
  // Fire-and-forget: never blocks or fails graduation.
  try {
    broadcastSSE(FACTORY_EVENTS.FRAMEWORK_OVERLAY_APPLIED, {
      concept_name: conceptName,
      symbol: market,
      source: "graduated_bucket",
      bucket_id: bucketId,
      applied_rules: overlayed.appliedRules,
      warnings: overlayed.warnings,
      correlation_id: correlationId ?? null,
    });
  } catch (sseErr) {
    logger.warn({ sseErr }, "direct-graduator: factory:framework_overlay_applied SSE broadcast failed (non-blocking)");
  }

  // ─── Wave 26 Pass G B2 (2026-05-26): GATE 1 — BIDIRECTIONAL COMPLETENESS ──
  // When direction === "both" the compiled engine config must have coherent
  // entry expressions on BOTH sides. Extractions that only captured one
  // direction produce a sentinel on the other side ("high < low" or ""), which
  // the backtester silently ignores — the strategy runs as long-only, not
  // bidirectional. This gate catches the pattern before it reaches the DB.
  {
    const biAudit = auditBidirectionalCompleteness({
      direction: compiled.direction,
      archetype: isArchetype && archetypeName ? archetypeName : null,
      entry_long:  String(compiled.strategy?.entry_long  ?? ""),
      entry_short: String(compiled.strategy?.entry_short ?? ""),
      entry_indicator: compiled.entry_indicator ?? null,
    });
    if (!biAudit.pass) {
      logger.warn(
        {
          bucketId,
          strategyName,
          conceptName,
          direction: compiled.direction,
          entryLong:  String(compiled.strategy?.entry_long  ?? "").slice(0, 100),
          entryShort: String(compiled.strategy?.entry_short ?? "").slice(0, 100),
          isArchetype,
        },
        `direct-graduator: REJECTED by Gate 1 bidirectional-completeness — ${biAudit.reason}`,
      );

      // Revert bucket to pending (no-poison: set both status=pending AND graduated_at=NULL).
      await db.update(strategyPendingBuckets)
        .set({ status: "pending", graduatedAt: null })
        .where(eq(strategyPendingBuckets.id, bucketId))
        .catch((revErr: unknown) => logger.warn({ err: revErr, bucketId }, "Gate1: bucket revert failed (non-blocking)"));

      await db.insert(auditLog).values({
        action: "graduation.rejected_incomplete_bidirectional",
        entityType: "strategy_pending_bucket",
        entityId: bucketId,
        input: { bucket_id: bucketId, concept_name: conceptName, direction: compiled.direction } as Record<string, unknown>,
        result: {
          reason: biAudit.reason,
          entry_long_head:  String(compiled.strategy?.entry_long  ?? "").slice(0, 200),
          entry_short_head: String(compiled.strategy?.entry_short ?? "").slice(0, 200),
          is_archetype: isArchetype,
          archetype_name: isArchetype ? archetypeName : null,
        } as Record<string, unknown>,
        status: "rejected",
        decisionAuthority: "system",
        correlationId: correlationId ?? null,
      }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "Gate1: audit_log write failed (non-blocking)"));

      // Discord notify — operator sees these as re-extract debt
      const discordChannel = process.env.DISCORD_CH_STRATEGY_FINDS ?? "strategy-finds";
      notify({
        severity: "WARNING",
        title: `Strategy \`${strategyName}\` bidirectional extraction incomplete`,
        body: appendFamilyGradePostscript(
          `Strategy \`${strategyName}\` (bucket \`${bucketId}\`) had bidirectional intent but Gemma only extracted one side. Bucket reset to \`pending\` for re-extract. Channel: #${discordChannel}.`,
          `The scout pipeline found a strategy but couldn't figure out both the BUY and SELL entry rules from the source video/article.`,
          `No action needed — the system will re-try the extraction automatically.`,
        ),
        metadata: {
          strategy_name: strategyName,
          bucket_id: bucketId,
          concept_name: conceptName,
          direction: compiled.direction,
          reason: biAudit.reason,
        },
      });

      // Pass G B4 (2026-05-26): Prom counter + SSE broadcast on Gate 1 reject.
      // Helper's own audit row is suppressed (different action name from the
      // graduator-side row but we keep the contract symmetric); helper still
      // emits Prometheus `tf_graduation_bidirectional_rejection_total{reason}`
      // and SSE `factory:bidirectional_rejected` to the dashboard.
      try {
        emitBidirectionalIncompleteRejected({
          strategy_name: strategyName,
          correlation_id: correlationId ?? null,
          direction: String(compiled.direction ?? ""),
          rejection_reason: biAudit.reason ?? "incomplete_bidirectional_extraction",
          empty_side: (() => {
            const longEmpty  = !compiled.strategy?.entry_long  || String(compiled.strategy.entry_long)  === "high < low";
            const shortEmpty = !compiled.strategy?.entry_short || String(compiled.strategy.entry_short) === "high < low";
            if (longEmpty && shortEmpty) return "both_sides_empty";
            if (longEmpty) return "long_side_empty";
            if (shortEmpty) return "short_side_empty";
            return "neither_empty";
          })(),
          skipAuditRow: true,
        });
      } catch (helperErr: unknown) {
        logger.warn({ err: String(helperErr), bucketId, strategyName }, "Gate1: emitBidirectionalIncompleteRejected helper failed (non-blocking)");
      }

      return {
        strategyId: null,
        strategyName,
        skipped: true,
        reason: `gate1_incomplete_bidirectional: ${biAudit.reason}`,
      };
    }
  }

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
    const runDslQualityCritic = await getRunDslQualityCritic();
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
  const rawConfluenceFactors: string[] = Array.isArray((extractedIdea as any)?.confluence_factors)
    ? (extractedIdea as any).confluence_factors
    : [];
  // Wave 26 Pass G institutional-grade floor (2026-05-26): every graduated strategy
  // MUST have ≥2 confluence factors so the Wave 25 11-factor weighted score has
  // multiple boxes to check. If LLM extracted only 1, append `regime_match` —
  // always available because `preferred_regimes` is set on every Wave 26-shaped
  // strategy. Safe addition: regime_match is a binary check, never hard-blocks.
  // Closes audit finding 2026-05-26 (24 of 84 strategies had single-factor confluence).
  const confluenceFactors: string[] = (() => {
    const f = [...rawConfluenceFactors];
    if (f.length < 2) {
      if (!f.includes("regime_match")) f.push("regime_match");
      // After dedupe-push, if STILL <2 (i.e. raw was empty), add a second
      if (f.length < 2 && !f.includes("structural_setup")) f.push("structural_setup");
    }
    return f;
  })();
  // W23F A+ gate: min_factors_satisfied for entry_quality block (how many confluence_factors must hold).
  // Distinct from W23G.11 minFactorsSatisfied (which controls how many confirming_indicators must agree).
  const entryQualityMinFactors: number = typeof (extractedIdea as any)?.min_factors_satisfied === "number"
    ? (extractedIdea as any).min_factors_satisfied
    : 2;
  const sourceClaimWinRate: number | null = (extractedIdea as any)?.source_claim_win_rate ?? null;
  const sourceClaimAvgR: number | null = (extractedIdea as any)?.source_claim_avg_r ?? null;

  // ─── Wave 26 Pass G B2 + Pass H2 (2026-05-26): GATE 2 — Factor Source Telemetry ──
  // Classify each confluence factor by its origin: extracted (LLM), auto_floor
  // (injected by the ≥2 floor guard), or kb_inferred (Wave 26 Pass H2: derived from
  // archetype's definitional component set via archetype-implied-factors.ts).
  // Pass H2 injects kb_inferred factors BEFORE quality classification so archetype
  // strategies land in "rich" based on their definitional evidence, not just what
  // the LLM happened to name explicitly.
  // Purely additive — legacy rows omit these keys; JSONB column accepts them
  // transparently without a migration.
  const {
    factor_sources,
    factor_quality: rawFactorQuality,
    mergedFactors: finalConfluenceFactors,
  } = classifyFactorSources(rawConfluenceFactors, confluenceFactors, entryIndicator);

  // Wave 26 Pass I — v11 factor_quality promotion rule.
  // A richly-extracted strategy (entry_sequence ≥ 3 steps OR targets ≥ 3) is
  // treated as "rich" even if the LLM confluence_factors list was auto-floored.
  // This reflects that the v11 extraction provided institutional-grade detail.
  //
  // FIX A3 (deep-scan #22 fix-wave-2, 2026-07-07): the promotion previously fired
  // REGARDLESS of realCount — a 3-step entry_sequence with ZERO real (extracted OR
  // kb_inferred) confluence factors still got stamped "rich", which (a) suppressed
  // Gate 3's thin_confluence_warning for a strategy that had NO real evidence behind
  // its confluence factors, and (b) corrupted the tf_graduation_factor_quality_total
  // telemetry (a fallback_only strategy reporting as rich). classifyFactorSources()'s
  // OWN contract (line ~455-457 above) is realCount>=2 → rich; realCount===0 → never
  // rich. The v11 promotion is a LEGITIMATE upgrade path (thin → rich when the
  // extraction is otherwise deep) but must never manufacture "rich" out of zero real
  // evidence — that's exactly the "no confluence WHATSOEVER" case Gate 3 exists to flag.
  const realFactorCount = Object.values(factor_sources).filter(
    (src) => src === "extracted" || src === "kb_inferred",
  ).length;
  const v11RichExtraction =
    (v11EntrySequence.length >= 3 || v11Targets.length >= 3) && realFactorCount >= 2;
  const factor_quality: "rich" | "thin" | "fallback_only" =
    v11RichExtraction ? "rich" : rawFactorQuality;

  // Use the merged factor list (may include kb_inferred additions from archetype)
  // as the canonical confluence_factors for the entry_quality block.
  const entryQualityBlock: EntryQualityWithSources = {
    confluence_factors: finalConfluenceFactors,
    min_factors_satisfied: entryQualityMinFactors,
    source_claim_win_rate: sourceClaimWinRate,
    source_claim_avg_r: sourceClaimAvgR,
    // Empty confluence_factors → legacy_no_confluence so consumer A+ gate bypasses cleanly
    extraction_provenance: finalConfluenceFactors.length === 0
      ? "legacy_no_confluence" as const
      : resolveProvenance(bestMention.scoutLayer ?? undefined, bestMention.sourceProvider),
    // Gate 2 telemetric fields — additive, null-safe for legacy consumers
    factor_sources,
    factor_quality,
  };

  // Symbols array: prefer LLM-extracted symbols, fallback to bucket primary market
  const symbolsArray: string[] = Array.isArray((extractedIdea as any)?.symbols) && (extractedIdea as any).symbols.length > 0
    ? (extractedIdea as any).symbols
    : [market];

  try {
    // Wave 26 Pass E (2026-05-25) — auto-apply Wave 25 institutional defaults
    // to every NEW graduation. Closes the gap where graduator emitted Wave 23
    // defaults only, requiring operator to run wave25-pass1/7-opt-in.ts per
    // strategy. The opt-in scripts still work for pre-Pass-E rows + as
    // panic-revert tools — Pass E just makes the default state "fully wired".
    const wave25Defaults = applyWave25Defaults({
      strategyName,
      conceptName,
      execTimeframe: timeframe,
      originalMarket: market,
      confluenceFactors: finalConfluenceFactors,
    });

    // ─── FIX A1 (deep-scan #22 fix-wave-2, 2026-07-07) ────────────────────────
    // Stamp use_weighted_scoring + confirming_indicators INSIDE entryQualityBlock
    // (config.entry_quality) — the ONLY location paper-signal-service.ts reads
    // them from at signal-evaluation time (paper-signal-service.ts:4162-4177).
    // Previously use_weighted_scoring was written ONLY as the top-level
    // `strategies.use_weighted_scoring` DB column and confirming_indicators
    // ONLY as the top-level `config.confirming_indicators` JSONB key — both
    // dead-on-arrival for the Path C / Path A dispatcher, silently falling every
    // graduated strategy to Path B (canonical-5 boolean), where Wave-vocab
    // confluence_factors then hit unknown_factor_fail_closed and could push
    // below min_factors_satisfied and BLOCK the entry outright.
    // entryQualityBlock is mutated here (not re-declared) so both the leader
    // INSERT (below) and the fan-out variant INSERT (further down, same object
    // reference) pick up the fix identically — Wave 26 Pass H1 Bug 3 field-
    // parity invariant preserved.
    // NOTE: confirming_indicators here is intentionally the genuinely
    // LLM-extracted W23G.11 `confirmingIndicators` (real ConfirmingIndicator
    // objects) — NOT `v11MergedConfirmingIndicators` (the bare confluence-factor-
    // tag string array Wave 26 Pass E stamps at the top-level config key). That
    // string array is NOT the ConfirmingIndicator{indicator,params,direction}
    // shape confirming-indicator-evaluator.ts requires; wiring it in here would
    // make Path A engage (since it's non-empty on nearly every graduation) and
    // then fail EVERY factor as `unknown_indicator:<factor-tag>` — turning the
    // Path C error-fallback (designed to land safely on Path B) into a
    // guaranteed-reject Path A instead. `confirmingIndicators` stays undefined
    // for the common case (no LLM confluence extraction), which correctly keeps
    // Path A dormant exactly as before this fix.
    entryQualityBlock.use_weighted_scoring = wave25Defaults.useWeightedScoring;
    if (confirmingIndicators && confirmingIndicators.length > 0) {
      entryQualityBlock.confirming_indicators = confirmingIndicators;
    }

    // ─── Wave 26 Pass I (2026-05-26): v11 config additions ────────────────────
    // Build the fields to stamp on every row (leader + variants).
    // All v11 arrays/objects read from extractedIdea were extracted null-safely
    // above — if absent they are [] or null so the spread below is a no-op for
    // legacy v10 graduations (backward-compat absolute).

    // Merged confirming_indicators: union of Wave 25 defaults + v11 entry_sequence indicators.
    const v11MergedConfirmingIndicators: string[] = Array.from(
      new Set([
        ...wave25Defaults.configAdditions.confirming_indicators,
        ...v11SeqIndicators,
      ])
    ).filter((s) => typeof s === "string" && s.length > 0);

    // Bias/entry/trigger timeframe overrides from v11 timeframes block.
    // Only override when v11 actually emits the field; otherwise preserve Wave 25 defaults.
    const v11BiasTimeframe: string = v11BiasTf ?? wave25Defaults.configAdditions.bias_timeframe;
    const v11EntryTimeframe: string | null = v11EntryTf;
    const v11TriggerTimeframe: string | null = v11TriggerTf;

    // Adaptive exit_plan_config override when v11 emits explicit stop + targets.
    // The adaptive engine (Wave 25 Pass 7 / Wave 25.5) reads target_sequence + stop_anchor.
    const v11ExitPlanConfigOverride: Record<string, unknown> | null =
      v11HasExplicitStop && v11HasTargets
        ? {
            exit_style: "adaptive",
            ...(v11StopLoss?.anchor ? { stop_anchor: v11StopLoss.anchor } : {}),
            ...(typeof v11StopLoss?.buffer_atr === "number" ? { stop_buffer_atr: v11StopLoss.buffer_atr } : {}),
            target_sequence: v11Targets,
          }
        : null;

    // Build the final exit_plan_config for this row: v11 override wins over wave25 default.
    const finalExitPlanConfig: Record<string, unknown> =
      v11ExitPlanConfigOverride ?? (wave25Defaults.exitPlanConfig as Record<string, unknown>);

    // Lifecycle metadata: extraction_gap_reason triggers NEEDS_REVISION path.
    const v11LifecycleMetadata: Record<string, unknown> | null =
      v11ExtractionGapReason
        ? { extraction_gap_reason: v11ExtractionGapReason }
        : null;

    // Helper: build v11-stamped additions object for config JSONB (shared leader + variant).
    const buildV11ConfigAdditions = (): Record<string, unknown> => ({
      // v11 entry sequence — array of ordered entry steps with indicators_needed
      ...(v11EntrySequence.length > 0 ? { entry_sequence: v11EntrySequence } : {}),
      // v11 filters — avoid_when conditions + min_rr
      ...(v11Filters.length > 0 ? { filters: v11Filters } : {}),
      // v11 indicators_used — explicit indicator roles list
      ...(v11IndicatorsUsed.length > 0 ? { indicators_used: v11IndicatorsUsed } : {}),
      // v11 timeframe slots: bias/entry/trigger as canonical fields
      bias_timeframe: v11BiasTimeframe,
      ...(v11EntryTimeframe ? { entry_timeframe: v11EntryTimeframe } : {}),
      ...(v11TriggerTimeframe ? { trigger_timeframe: v11TriggerTimeframe } : {}),
      // 5-TF hierarchy overrides from v11 bias[] array
      ...(v11DailyTf ? { daily_tf: v11DailyTf } : {}),
      ...(v11HtfTf ? { htf_tf: v11HtfTf } : {}),
      ...(v11ItfTf ? { itf_tf: v11ItfTf } : {}),
      // lifecycle_metadata for NEEDS_REVISION path
      ...(v11LifecycleMetadata ? { lifecycle_metadata: v11LifecycleMetadata } : {}),
      // FIX 4 (deepscan11 Track P, 2026-07-02): v11 stop_loss and targets moved
      // under extraction_hints namespace. Previously these were stamped at the
      // top level of config JSONB (e.g. config.stop_loss, config.targets) which
      // is confusable with config.strategy.stop_loss — the field the paper engine
      // and backtester ACTUALLY read as the operational stop config. At top level
      // they also bypassed auditGraduatedConfig (auditor runs before v11 additions
      // are merged). Under extraction_hints the namespace is unambiguous:
      //   - paper-signal-service reads config.stop_loss (operational) — unchanged
      //   - backtester reads config.strategy.stop_loss (compiled) — unchanged
      //   - extraction_hints.stop_loss is queryable for provenance analysis
      ...(v11StopLoss !== null || v11Targets.length > 0 ? {
        extraction_hints: {
          ...(v11StopLoss !== null ? { stop_loss: v11StopLoss } : {}),
          ...(v11Targets.length > 0 ? { targets: v11Targets } : {}),
        },
      } : {}),
    });

    // Wave 26 Pass F (2026-05-25) — REVISED multi-symbol approach. Instead of
    // packing [MES,MNQ,MCL] into one row (Pass E), graduate as SEPARATE rows
    // per market. Operator decision: backtest each (concept × market) pair
    // independently → DEPLOY-stage filters to markets where the concept earns.
    // Leader row written here; non-leader variants are inserted in the fan-out
    // block below this main INSERT.
    const leaderSymbol = wave25Defaults.symbols[0] ?? market;
    const symbolsArrayWithFanOut = [leaderSymbol];

    const [inserted] = await db.insert(strategies).values({
      name: strategyName,
      description: thesis,
      symbol: market,
      symbols: symbolsArrayWithFanOut,
      timeframe,
      source: "graduated_bucket",
      config: {
        ...(overlayed.config as Record<string, unknown>),
        entry_quality: entryQualityBlock,
        // Wave 26 Pass E — bias_timeframe + confirming_indicators in config JSONB
        bias_timeframe: v11BiasTimeframe,
        confirming_indicators: v11MergedConfirmingIndicators,
        // Wave 26 Pass H1 Bug 3 — traceability fields on leader row
        source_url:       bestMention.sourceUrl ?? null,
        source_bucket_id: bucketId,
        // Wave 26 Pass I — v11 Gemma fields stamped on config JSONB
        ...buildV11ConfigAdditions(),
      },
      // Wave 26 Pass E — Wave 25 Pass 1/2/7 institutional columns auto-set
      // (5-TF columns are set via raw SQL below — Drizzle schema not synced with migration 0138)
      useWeightedScoring: wave25Defaults.useWeightedScoring,
      confluenceScoreThreshold: String(wave25Defaults.confluenceScoreThreshold),
      confluenceScoreWeights: wave25Defaults.confluenceScoreWeights,
      // Wave 26 Pass I — v11 adaptive exit override takes precedence over wave25 default
      exitPlanConfig: finalExitPlanConfig as typeof wave25Defaults.exitPlanConfig,
      preferredRegime,
      // W23H.B: also write the new array column so Pass 2 W23H.C picker
      // (regime = ANY(preferred_regimes)) has data on every new graduation.
      // Single-value array is the safe default; extractor v9 may emit a richer
      // multi-regime array per archetype heuristic — when it does we trust it.
      // W23H-postmortem (2026-05-20): expanded preferred_regimes inference.
      // When LLM emits a multi-regime array, use it as-is. When LLM emits only
      // a single legacy preferred_regime, apply the archetype heuristic from
      // W23H.B to ENRICH based on entry_indicator — structural archetypes
      // (ICT/SMC/Wyckoff/CRT) work in ALL 3 regimes by design, breakout/ORB
      // works trending+range, mean-reversion is range-only, trend indicators
      // are trending-only. This prevents bidirectional archetype strategies
      // from being narrowly filtered to a single regime.
      preferredRegimes: (() => {
        const cfg = overlayed.config as Record<string, unknown>;
        const llmRegimes = Array.isArray(cfg?.preferred_regimes) ? cfg.preferred_regimes as string[] : null;
        if (llmRegimes && llmRegimes.length > 1) return llmRegimes; // trust rich LLM emission
        const ind = String(entryIndicator || "").toLowerCase();
        // Archetype-based default heuristic — must stay in lockstep with
        // transcript-extractor.md v9 W23H.B archetype heuristic section.
        const STRUCTURAL_RX = /archetype:(ict_|wyckoff_|fvg|order_block|liquidity_sweep|judas|silver_bullet|breaker|turtle_soup|power_of_3|ote|smc|cisd|mss|bos|choch|change_of_character|bounce_off_level|ict_bias_aligned_continuation)/;
        const BREAKOUT_RX = /^(opening_range_breakout|atr_breakout|donchian_breakout|bollinger_breakout|session_open_breakout)$/;
        const MEAN_REV_RX = /^(rsi_reversal|vwap_reversion|connors_rsi2|vwap_fade|stochastic_rsi)$/;
        const TREND_RX = /^(ema_crossover|sma_crossover|dema_crossover|macd_crossover|supertrend|ichimoku_cloud)$/;
        if (STRUCTURAL_RX.test(ind)) return ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"];
        if (BREAKOUT_RX.test(ind)) return ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"];
        if (MEAN_REV_RX.test(ind)) return ["RANGE_BOUND"];
        if (TREND_RX.test(ind)) return ["TRENDING_UP", "TRENDING_DOWN"];
        // MED#6 (fresh-scan 2026-07-12) + grader hardening (2026-07-12): a regime-agnostic ARCHETYPE
        // (e.g. gann_box_4h_continuation, break_of_structure) that none of the specific heuristics above
        // matched must default to ALL regimes — otherwise the single-[preferredRegime] fallback silently
        // EXCLUDED the bidirectional archetype from regime-matched strategy picks. Narrowed from a blanket
        // `startsWith("archetype:")` to actual membership in the canonical REGIME_AGNOSTIC_ARCHETYPES set:
        // a future DIRECTIONAL archetype (not in the set) now falls through to the conservative single/LLM
        // fallback instead of being over-widened to all-3 (the latent fragility the grader flagged).
        if (ind.startsWith("archetype:") && REGIME_AGNOSTIC_ARCHETYPES.has(ind.slice("archetype:".length))) {
          return ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"];
        }
        // Unknown / directional-archetype-not-in-set → preserve LLM emit (or single fallback)
        return llmRegimes && llmRegimes.length > 0 ? llmRegimes : [preferredRegime];
      })(),
      tags: strategyTags,
    }).returning({ id: strategies.id });

    // Wave 26 Pass E — 5-TF MTF hierarchy columns (Wave 25 Pass 2 W25.4).
    // Migration 0138 added daily_tf/htf_tf/itf_tf/trigger_tf to PG but Drizzle
    // schema.ts isn't synced — use raw SQL UPDATE for these 4 columns.
    // Wave 26 Pass I: v11 TF overrides from bias[] take precedence over wave25 defaults.
    await db.execute(sql`
      UPDATE strategies SET
        daily_tf   = ${v11DailyTf ?? wave25Defaults.dailyTf},
        htf_tf     = ${v11HtfTf   ?? wave25Defaults.htfTf},
        itf_tf     = ${v11ItfTf   ?? wave25Defaults.itfTf},
        trigger_tf = ${v11TriggerTf ?? wave25Defaults.triggerTf}
      WHERE id = ${inserted.id}::uuid
    `);

    await db.update(strategyPendingBuckets)
      .set({ graduatedStrategyId: inserted.id, wideFingerprintHash: wideFingerprint })
      .where(eq(strategyPendingBuckets.id, bucketId));

    // ─── Wave 26 Pass I (2026-05-26): NEEDS_REVISION lifecycle path ──────────
    // When v11 emits extraction_gap_reason, the strategy was extracted but with
    // known gaps. Mark lifecycle_state = NEEDS_REVISION so the operator dashboard
    // surfaces these as re-extract debt.
    if (v11ExtractionGapReason) {
      // Deep-scan #16 Wave 2 (D-1 + D-2, 2026-07-04):
      //  D-1: the NEEDS_REVISION UPDATE was previously .catch()-swallowed while the
      //       `lifecycle.needs_revision_set` audit row was written UNCONDITIONALLY —
      //       so the audit could claim the transition while the DB row stayed CANDIDATE
      //       (the conveyor picks it up while the operator's debt view parks it). We now
      //       run the UPDATE with RETURNING id and only claim the transition (audit +
      //       ledger) when a row actually changed.
      //  D-2: the state change + typed `lifecycle_transitions` ledger row + audit row
      //       are written together in one db.transaction() so 90-day reconstruction from
      //       the typed ledger is complete (no raw-SQL-only phantom-origin teleport).
      let transitioned = false;
      let priorState: string | null = null;
      try {
        await db.transaction(async (tx) => {
          const priorRows = await tx.execute(sql`
            SELECT lifecycle_state FROM strategies WHERE id = ${inserted.id}::uuid
          `);
          priorState = ((priorRows as unknown) as Array<{ lifecycle_state: string }>)[0]?.lifecycle_state ?? null;

          const updated = await tx.execute(sql`
            UPDATE strategies SET lifecycle_state = 'NEEDS_REVISION'
            WHERE id = ${inserted.id}::uuid
              AND lifecycle_state NOT IN ('GRAVEYARD', 'RETIRED', 'DEPLOYED', 'PILOT', 'DEPLOY_READY')
            RETURNING id
          `);
          if (((updated as unknown) as Array<unknown>).length === 0) {
            // Protected/terminal state or row vanished — the transition did NOT happen.
            // Do NOT write the ledger/audit inside this tx; the outer branch alerts.
            return;
          }
          transitioned = true;

          // D-2: typed ledger row matching the canonical promoteStrategy shape
          // (strategyId/fromState/toState/decisionAuthority/reason/correlationId).
          await tx.insert(lifecycleTransitions).values({
            strategyId: inserted.id,
            fromState: priorState ?? "CANDIDATE",
            toState: "NEEDS_REVISION",
            decisionAuthority: "gate",
            reason: `extraction_gap: ${v11ExtractionGapReason}`,
            correlationId: correlationId ?? null,
          });

          // Audit row written in the SAME tx so audit + state + ledger are atomic.
          await tx.insert(auditLog).values({
            action: "lifecycle.needs_revision_set",
            entityType: "strategy",
            entityId: inserted.id,
            input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
            result: {
              extraction_gap_reason: v11ExtractionGapReason,
              strategy_name: strategyName,
              from_state: priorState ?? "CANDIDATE",
              v11_fields_present: v11EntrySequence.length > 0 || v11Targets.length > 0,
            } as Record<string, unknown>,
            status: "warning",
            decisionAuthority: "gate",
            correlationId: correlationId ?? null,
          });
        });
      } catch (revErr: unknown) {
        transitioned = false;
        logger.error(
          { err: revErr, strategyId: inserted.id, strategyName },
          "Pass I: NEEDS_REVISION transition (state + ledger + audit) failed — NOT claiming the transition",
        );
      }

      if (transitioned) {
        logger.warn(
          { strategyId: inserted.id, strategyName, extractionGapReason: v11ExtractionGapReason, fromState: priorState },
          "direct-graduator Pass I: strategy marked NEEDS_REVISION due to extraction_gap_reason",
        );
      } else {
        // D-1: the UPDATE did NOT change the DB (protected state, or it threw).
        // Emit a distinct failure audit so the mismatch is observable, and DO NOT
        // claim NEEDS_REVISION. Fire-and-forget (outside the rolled-back tx).
        insertAuditRowSafe({
          action: "lifecycle.needs_revision_set_failed",
          entityType: "strategy",
          entityId: inserted.id,
          input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
          result: {
            extraction_gap_reason: v11ExtractionGapReason,
            strategy_name: strategyName,
            prior_state: priorState,
            note: "NEEDS_REVISION UPDATE affected 0 rows or threw — transition NOT applied; DB state unchanged",
          } as Record<string, unknown>,
          status: "failure",
          decisionAuthority: "gate",
          correlationId: correlationId ?? null,
        }).catch((auditErr: unknown) =>
          logger.warn({ err: auditErr }, "Pass I: lifecycle.needs_revision_set_failed audit write failed (non-blocking)"),
        );
        logger.warn(
          { strategyId: inserted.id, strategyName, extractionGapReason: v11ExtractionGapReason, priorState },
          "direct-graduator Pass I: NEEDS_REVISION NOT applied (protected state or error) — audit reflects unchanged DB",
        );
      }
    }

    // ─── Wave 26 Pass G B4 (2026-05-26): GATE 2 — Factor Quality Telemetry ─
    // Fire-and-forget Prometheus counter + confluence-depth histogram. Helper
    // owns the `graduation.factor_quality_classified` audit row end-to-end
    // (graduator does not write a competing row for this action name).
    try {
      emitFactorQualityClassified({
        strategy_id:        inserted.id,
        strategy_name:      strategyName,
        correlation_id:     correlationId ?? null,
        factor_quality:     factor_quality as "rich" | "thin" | "fallback_only",
        factor_sources:     factor_sources as Record<string, "extracted" | "auto_floor" | "kb_inferred">,
        confluence_factors: finalConfluenceFactors,
      });
    } catch (helperErr: unknown) {
      logger.warn({ err: String(helperErr), strategyId: inserted.id, strategyName }, "Gate2: emitFactorQualityClassified helper failed (non-blocking)");
    }

    // ─── Pass 2 Track D (2026-06-22) — ARCHETYPE PINE RECIPE AUDIT ───────────
    // When the graduator stamps entry_indicator = "archetype:<key>", emit a
    // dedicated audit row so the export pipeline can trace which pine_band was
    // assigned and which ARCHETYPE_PINE_RECIPE template applies. The alert_only
    // band signals that Pine emits an indicator-pane scaffold + alertcondition()
    // only — the Python engine at src/engine/strategies/<class>.py owns all
    // entry/exit decisions. Never emitted for parametric strategies.
    if (isArchetype && archetypeName) {
      await insertAuditRowSafe({
        action: "graduation.archetype_pine_recipe_assigned",
        entityType: "strategy",
        entityId: inserted.id,
        input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
        result: {
          archetype_key: archetypeName,
          pine_band: "alert_only",
          recipe_source: "ARCHETYPE_PINE_RECIPE",
          strategy_name: strategyName,
        } as Record<string, unknown>,
        status: "info",
        decisionAuthority: "system",
        correlationId: correlationId ?? null,
      });
    }

    // ─── Wave 26 Pass F (2026-05-25) — per-market fan-out ────────────────
    // Operator mandate: each (concept × market) pair gets its OWN strategy
    // row so backtest yields per-market verdicts. Symbol-agnostic concepts
    // INSERT one leader row above + non-leader variants here. Symbol-specific
    // concepts (single-element wave25Defaults.symbols) skip this block.
    // Per-variant: re-apply framework-overlay with the variant market for
    // correct base_contracts (MES 6 / MNQ 6 / MCL 18) + liquidity_cap.
    const fanOutMarkets = wave25Defaults.symbols.slice(1) as Array<"MES" | "MNQ" | "MCL">;
    const fanOutStrategyIds: string[] = [];
    for (const variantMarket of fanOutMarkets) {
      try {
        const variantName = deriveStrategyName(conceptName, variantMarket, timeframe).slice(0, 80);
        // Per-variant framework-overlay run — picks up correct per-market sizing
        const variantOverlayed = applyFrameworkOverlay({
          compiled: compiled as any,
          source: "graduated_bucket",
          symbol: variantMarket,
          bucketId,
        });
        // ─── Wave 26 Pass H1 (2026-05-26) Bug 3 — variant field parity ───────
        // Variant rows MUST be byte-identical in the entry_quality block (except
        // symbol/timeframe/derived params) to the leader row. Stamp source_url,
        // source_bucket_id, and entry_archetype so promotion-gate inputs are
        // trustworthy for ALL variants, not just the leader.
        const variantConfig = variantOverlayed.config as Record<string, unknown>;
        const variantMetadata = (variantConfig.metadata ?? {}) as Record<string, unknown>;
        const variantEntryArchetype = variantMetadata.entry_archetype
          ?? (entryIndicator?.startsWith("archetype:")
              ? entryIndicator.slice("archetype:".length)
              : undefined);

        // ─── FIX 2 (deepscan11 Track P, 2026-07-02): per-variant auditor gate ──
        // The leader's Layer 1 audit (above) only checks the leader's symbol. Variant
        // rows are inserted with per-market framework overlays (different base_contracts,
        // liquidity_cap, stop ceilings) — a valid leader config can produce an invalid
        // variant config. Run the auditor on each variant before INSERT. A defective
        // variant writes graduation.variant_rejected_by_auditor and continues (leader
        // + clean variants still graduate; only the bad variant is skipped).
        const variantAudit = auditGraduatedConfig({
          conceptName,
          symbol: variantMarket,
          config: variantConfig as any,
        });
        if (!variantAudit.passed) {
          logger.error(
            { bucketId, strategyName, variantMarket, defects: variantAudit.defects },
            `direct-graduator FIX2: variant ${variantMarket} REJECTED by auditor — ${formatAuditResult(variantAudit)}`
          );
          await db.insert(auditLog).values({
            action: "graduation.variant_rejected_by_auditor",
            entityType: "strategy_pending_bucket",
            entityId: bucketId,
            input: { bucket_id: bucketId, concept_name: conceptName, leader_strategy_id: inserted.id, variant_market: variantMarket } as Record<string, unknown>,
            result: {
              defects: variantAudit.defects,
              warnings: variantAudit.warnings,
              variant_market: variantMarket,
              variant_name: variantName,
            } as Record<string, unknown>,
            status: "failure",
            decisionAuthority: "system",
            correlationId: correlationId ?? null,
          }).catch((e: unknown) => logger.warn({ err: e, variantMarket, bucketId }, "variant_rejected_by_auditor audit write failed"));
          continue; // skip this variant — other variants and the leader are unaffected
        }

        const [variantInserted] = await db.insert(strategies).values({
          name: variantName,
          description: thesis,
          symbol: variantMarket,
          symbols: [variantMarket],
          timeframe,
          source: "graduated_bucket",
          config: {
            ...variantConfig,
            ...(variantEntryArchetype ? {
              metadata: { ...variantMetadata, entry_archetype: variantEntryArchetype },
            } : {}),
            entry_quality: entryQualityBlock,
            bias_timeframe: v11BiasTimeframe,
            confirming_indicators: v11MergedConfirmingIndicators,
            // Wave 26 Pass H1: stamp traceability fields identical to leader
            source_url:       bestMention.sourceUrl ?? null,
            source_bucket_id: bucketId,
            // Wave 26 Pass I — v11 fields byte-identical on variants (Pass H1 rule)
            ...buildV11ConfigAdditions(),
          },
          useWeightedScoring: wave25Defaults.useWeightedScoring,
          confluenceScoreThreshold: String(wave25Defaults.confluenceScoreThreshold),
          confluenceScoreWeights: wave25Defaults.confluenceScoreWeights,
          // Wave 26 Pass I — v11 adaptive exit override on variants too
          exitPlanConfig: finalExitPlanConfig as typeof wave25Defaults.exitPlanConfig,
          preferredRegime,
          preferredRegimes: (() => {
            const cfg = variantOverlayed.config as Record<string, unknown>;
            const llmRegimes = Array.isArray(cfg?.preferred_regimes) ? cfg.preferred_regimes as string[] : null;
            if (llmRegimes && llmRegimes.length > 1) return llmRegimes;
            const ind = String(entryIndicator || "").toLowerCase();
            const STRUCTURAL_RX = /archetype:(ict_|wyckoff_|fvg|order_block|liquidity_sweep|judas|silver_bullet|breaker|turtle_soup|power_of_3|ote|smc|cisd|mss|bos|choch|change_of_character|bounce_off_level|ict_bias_aligned_continuation)/;
            const BREAKOUT_RX = /^(opening_range_breakout|atr_breakout|donchian_breakout|bollinger_breakout|session_open_breakout)$/;
            const MEAN_REV_RX = /^(rsi_reversal|vwap_reversion|connors_rsi2|vwap_fade|stochastic_rsi)$/;
            const TREND_RX = /^(ema_crossover|sma_crossover|dema_crossover|macd_crossover|supertrend|ichimoku_cloud)$/;
            if (STRUCTURAL_RX.test(ind)) return ["TRENDING_UP","TRENDING_DOWN","RANGE_BOUND"];
            if (BREAKOUT_RX.test(ind))   return ["TRENDING_UP","TRENDING_DOWN","RANGE_BOUND"];
            if (MEAN_REV_RX.test(ind))   return ["RANGE_BOUND"];
            if (TREND_RX.test(ind))      return ["TRENDING_UP","TRENDING_DOWN"];
            // MED#5 (freshscan4 2026-07-12): leader/variant PARITY. The leader IIFE (~2926) has this
            // REGIME_AGNOSTIC_ARCHETYPES all-regime branch (MED#6); the per-market variant rows
            // (MNQ/MCL) lacked it, so a regime-agnostic archetype not matched by the RXs above
            // (gann_box/smt_reversal/break_of_structure/market_structure_shift → derivedRegime
            // UNSPECIFIED → preferredRegime sentinel "TRENDING_UP") stored the variants with
            // preferred_regimes=["TRENDING_UP"] only → the W23H.C picker silently EXCLUDED the MNQ/MCL
            // variants in RANGE_BOUND / TRENDING_DOWN regimes while keeping the MES leader. Same fix.
            if (ind.startsWith("archetype:") && REGIME_AGNOSTIC_ARCHETYPES.has(ind.slice("archetype:".length))) {
              return ["TRENDING_UP","TRENDING_DOWN","RANGE_BOUND"];
            }
            return llmRegimes && llmRegimes.length > 0 ? llmRegimes : [preferredRegime];
          })(),
          tags: strategyTags,
        }).returning({ id: strategies.id });
        // 5-TF columns via raw SQL (Drizzle schema not synced w/ migration 0138)
        // Wave 26 Pass I: v11 TF overrides on variants, identical to leader.
        await db.execute(sql`
          UPDATE strategies SET
            daily_tf   = ${v11DailyTf   ?? wave25Defaults.dailyTf},
            htf_tf     = ${v11HtfTf     ?? wave25Defaults.htfTf},
            itf_tf     = ${v11ItfTf     ?? wave25Defaults.itfTf},
            trigger_tf = ${v11TriggerTf ?? wave25Defaults.triggerTf}
          WHERE id = ${variantInserted.id}::uuid
        `);
        fanOutStrategyIds.push(variantInserted.id);
        await db.insert(auditLog).values({
          action: "graduation.market_variant_created",
          entityType: "strategy",
          entityId: variantInserted.id,
          input: { bucket_id: bucketId, leader_strategy_id: inserted.id, variant_market: variantMarket } as Record<string, unknown>,
          result: { variant_name: variantName, variant_market: variantMarket, leader_market: leaderSymbol } as Record<string, unknown>,
          status: "success",
          decisionAuthority: "system",
          correlationId: correlationId ?? null,
        }).catch((e: unknown) => logger.warn({ err: e }, "market_variant audit failed (non-blocking)"));
        // ─── Wave 26 Pass H1 Bug 3 — variant Gate 2 telemetry ─────────────
        // Every variant row must call emitFactorQualityClassified() so Prometheus
        // counters and audit rows are accurate for all graduated strategies, not
        // just the leader. Fire-and-forget — never blocks graduation.
        try {
          emitFactorQualityClassified({
            strategy_id:        variantInserted.id,
            strategy_name:      variantName,
            correlation_id:     correlationId ?? null,
            factor_quality:     factor_quality as "rich" | "thin" | "fallback_only",
            factor_sources:     factor_sources as Record<string, "extracted" | "auto_floor" | "kb_inferred">,
            confluence_factors: finalConfluenceFactors,
          });
        } catch (variantGate2Err: unknown) {
          logger.warn({ err: String(variantGate2Err), variantStrategyId: variantInserted.id, variantName },
            "Gate2: emitFactorQualityClassified for variant failed (non-blocking)");
        }
      } catch (variantErr: unknown) {
        // Non-fatal: variant failure doesn't roll back the leader graduation.
        // Operator can re-run the fan-out via the backfill script.
        logger.warn({ err: variantErr, variantMarket, bucketId },
          `direct-graduator: fan-out variant INSERT failed (non-blocking) for ${variantMarket}`);
      }
    }

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
        confluenceFactorCount: finalConfluenceFactors.length,
        symbolsCount: symbolsArray.length,
      },
      "direct-graduator: strategy created from bucket"
    );

    // Deep-scan #15 FIX-3 (2026-07-03): STRATEGY_CREATED was declared in
    // sse.ts's FACTORY_EVENTS catalog with full payload docs but had ZERO
    // broadcastSSE call sites anywhere in the repo — a documented-but-dead
    // event. This is the real strategy-row-created completion point (leader
    // row + any fan-out variants for this bucket). Fire-and-forget; never
    // blocks or fails graduation.
    try {
      broadcastSSE(FACTORY_EVENTS.STRATEGY_CREATED, {
        strategy_id: inserted.id,
        name: strategyName,
        symbol: market,
        symbols: symbolsArray,
        source: "graduated_bucket",
        bucket_id: bucketId,
        concept_name: conceptName,
        fan_out_strategy_ids: fanOutStrategyIds,
        entry_quality_provenance: entryQualityBlock.extraction_provenance,
        correlation_id: correlationId ?? null,
      });
    } catch (sseErr) {
      logger.warn({ sseErr }, "direct-graduator: factory:strategy_created SSE broadcast failed (non-blocking)");
    }

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

    // ─── Wave 26 Pass G B2 (2026-05-26): GATE 3 — fallback_only thin-confluence warning ─
    // When the strategy graduated with ALL auto-floor factors (no real LLM extraction),
    // write a library-debt audit row and Discord WARN so the operator knows this strategy
    // needs a re-extract pass to lift factor_quality to "rich" or "thin".
    // Purely advisory — does NOT block or revert the successful graduation.
    if (factor_quality === "fallback_only") {
      await db.insert(auditLog).values({
        action: "graduation.thin_confluence_warning",
        entityType: "strategy",
        entityId: inserted.id,
        input: { bucket_id: bucketId, concept_name: conceptName } as Record<string, unknown>,
        result: {
          strategy_id: inserted.id,
          factor_quality,
          factor_sources,
          confluence_factors: finalConfluenceFactors,
          raw_factor_count: rawConfluenceFactors.length,
          final_factor_count: finalConfluenceFactors.length,
        } as Record<string, unknown>,
        status: "warning",
        decisionAuthority: "system",
        correlationId: correlationId ?? null,
      }).catch((auditErr: unknown) => logger.warn({ auditErr }, "Gate3: thin_confluence_warning audit write failed (non-blocking)"));

      notify({
        severity: "WARNING",
        title: `Library debt: \`${strategyName}\` graduated with auto-floor-only confluence`,
        body: appendFamilyGradePostscript(
          `Strategy \`${strategyName}\` (id: \`${inserted.id}\`) graduated successfully but ALL ${finalConfluenceFactors.length} confluence factors were auto-injected by the floor guard — the LLM extracted zero real factors from the source. This strategy may rank lower in backtest scheduler queue until re-extracted. factor_quality=fallback_only.`,
          `A new trading strategy was added to the library but the system couldn't confirm what specific signals it uses — it filled in generic defaults instead.`,
          `No action needed now. The system will flag this for re-processing on the next scout cycle.`,
        ),
        metadata: {
          strategy_id: inserted.id,
          strategy_name: strategyName,
          factor_quality,
          confluence_factors: finalConfluenceFactors,
          factor_sources,
        },
      });

      logger.warn(
        { strategyId: inserted.id, strategyName, factor_quality, factor_sources, confluenceFactors: finalConfluenceFactors },
        "direct-graduator Gate3: fallback_only factor_quality — graduated with auto-floor confluence only",
      );

      // Pass G B4 (2026-05-26): SSE broadcast (audit row + Discord already
      // written above by graduator — skipAuditRow=true on helper prevents
      // the runtime duplicate). Helper still drives FACTORY_EVENTS.THIN_CONFLUENCE_GRADUATED.
      try {
        emitThinConfluenceWarning({
          strategy_id:        inserted.id,
          strategy_name:      strategyName,
          correlation_id:     correlationId ?? null,
          factor_quality:     factor_quality as "fallback_only",
          confluence_factors: finalConfluenceFactors,
          source_url:         null, // graduator does not currently resolve the source URL at this site
          skipAuditRow:       true,
        });
      } catch (helperErr: unknown) {
        logger.warn({ err: String(helperErr), strategyId: inserted.id, strategyName }, "Gate3: emitThinConfluenceWarning helper failed (non-blocking)");
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
