/**
 * archetype-implied-factors.ts — Wave 26 Pass H2 (2026-05-26)
 *
 * Pure-function knowledge-base: maps each known archetype name to the set of
 * confluence factors that the archetype definitionally implies.  These factors
 * are tagged `kb_inferred` in factor_sources so operators can always distinguish
 * genuinely LLM-extracted evidence ("extracted") from KB-derived inference
 * ("kb_inferred") from auto-floor filler ("auto_floor").
 *
 * RULES:
 *   - Every implied factor must be a canonical member of the 11-factor weighted-
 *     scoring vocabulary (§2b of CLAUDE.md, confluence-score.ts::CODE_DEFAULTS).
 *   - Limit ≤ 5 factors per archetype — no over-stuffing.
 *   - This map is the ONLY place kb_inferred factors originate; it is not a
 *     promotion or an execution path — it is a metadata annotation.
 *
 * CONSUMER CONTRACT:
 *   `inferFactorsFromArchetype(archetypeName)` accepts both the bare name
 *   ("ict_bias_aligned_continuation") and the prefixed form
 *   ("archetype:ict_bias_aligned_continuation") — strips prefix automatically.
 *   Returns [] for unknown archetypes (fail-open, no inference).
 *
 * BACKFILL CONTRACT:
 *   The B3 backfill script imports this module to re-classify the existing
 *   99 strategies.  The script must use this function — not a local copy — to
 *   ensure the single source of truth for kb_inferred reasoning is here.
 *
 * DOWNSTREAM CLASSIFICATION:
 *   classifyFactorSources() in direct-bucket-graduator.ts passes the implied
 *   factor list to the factor-quality classifier.  The quality rules are:
 *     "rich"          — ≥2 real factors (extracted OR kb_inferred)
 *     "thin"          — exactly 1 real factor
 *     "fallback_only" — zero real factors (all auto_floor)
 *
 * SYNC CONTRACT:
 *   If you add a new archetype to ARCHETYPE_REGISTRY in direct-bucket-graduator.ts,
 *   add a corresponding entry here (even if [] for archetypes without strong
 *   implied factor sets).  Keep both files in sync.
 */

// ─── Archetype → implied confluence factor map ────────────────────────────────

/**
 * Maps bare archetype names to their KB-implied confluence factors.
 *
 * Factor names MUST be members of the 11-factor canonical vocabulary:
 *   market_structure_aligned, liquidity_target_clear, smt_confirmation,
 *   vwap_alignment, killzone_active, delta_or_volume_signature,
 *   vp_level_proximity, macro_alignment, internals_aligned,
 *   cross_asset_aligned, regime_match
 *
 * Plus the auto-floor vocabulary (never add these as implied — they are floor
 * fillers, not evidence):  regime_match, structural_setup
 *
 * Note: regime_match appears in the 11-factor model but NOT as a kb_inferred
 * implication — it is the auto_floor fallback.  Any archetype that implies
 * "regime context" uses market_structure_aligned or a more specific factor.
 */
export const ARCHETYPE_IMPLIED_FACTORS: Record<string, string[]> = {
  // ─── ICT bias-aligned continuation: 4H bias → MSS/BoS → FVG retest → DOL ──
  // Definitional component set: HTF direction + market structure break + FVG/OB
  // in the pull-back zone + clear liquidity target + killzone session window.
  ict_bias_aligned_continuation: [
    "market_structure_aligned",  // BOS/CHoCH/MSS aligned with HTF bias
    "htf_bias_aligned",          // 4H/D direction matches trade direction
    "fvg_present_or_ob",         // FVG or order-block as entry zone
    "liquidity_target_clear",    // DOL within acceptable R:R
    "killzone_active",           // NY AM or PM session window active
  ],

  // ─── ICT Silver Bullet (NY AM): 10-11 ET window + MSS + FVG + displacement ─
  ict_silver_bullet_ny_am: [
    "killzone_active",           // 10-11 ET window is the defining characteristic
    "market_structure_aligned",  // structural shift at the setup time
    "fvg_present_or_ob",         // FVG created by the displacement leg
    "displacement_confirmed",    // impulsive displacement candle required
  ],

  // ─── ICT Silver Bullet (NY PM): 2-3 ET window ─────────────────────────────
  ict_silver_bullet_ny_pm: [
    "killzone_active",           // 2-3 ET PM window
    "market_structure_aligned",
    "fvg_present_or_ob",
    "displacement_confirmed",
  ],

  // ─── ICT Power of 3: accumulation → manipulation (sweep) → distribution ───
  ict_power_of_3: [
    "asian_range_swept",         // Asian range high/low swept (manipulation phase)
    "manipulation_phase_done",   // price has swept, ready for distribution
    "displacement_confirmed",    // impulsive move into distribution leg
    "liquidity_target_clear",    // opposite side liquidity is the target
  ],

  // ─── ICT Turtle Soup: equal high/low liquidity raid + reversal ─────────────
  ict_turtle_soup: [
    "liquidity_target_clear",    // equal highs/lows as the liquidity pool
    "false_breakout_confirmed",  // price swept beyond levels then reversed
    "market_structure_aligned",  // lower-TF structure shift after sweep
  ],

  // ─── ICT Judas Swing: opening manipulation → true direction ────────────────
  ict_judas_swing: [
    "session_open_aligned",      // opening session context required
    "manipulation_phase_done",   // opening fake-out completed
    "market_structure_aligned",  // shift confirms true direction
  ],

  // ─── ICT OTE (Optimal Trade Entry): Fibonacci-based HTF discount/premium ───
  ict_ote: [
    "market_structure_aligned",  // swing point anchors the Fibonacci levels
    "htf_bias_aligned",          // OTE is a trend-following tool
    "fvg_present_or_ob",         // FVG often overlaps OTE zone
  ],

  // ─── Bounce off level (MA-as-support/resistance) ───────────────────────────
  // MA serves as dynamic S/R; rejection candle confirms the level held.
  bounce_off_level: [
    "ma_as_support_resistance",  // MA line acting as structural level
    "rejection_pattern_confirmed", // rejection candle / pinbar / engulf at MA
    "regime_match",              // trend in place for the MA to be meaningful
  ],

  // ─── FVG Retest ─────────────────────────────────────────────────────────────
  fvg_retrace: [
    "fvg_present_or_ob",
    "market_structure_aligned",
  ],

  // ─── Order Block ─────────────────────────────────────────────────────────────
  order_block: [
    "fvg_present_or_ob",
    "market_structure_aligned",
  ],

  // ─── Liquidity Magnet: targeting opposite-side liquidity pools ───────────────
  liquidity_magnet: [
    "liquidity_target_clear",
    "market_structure_aligned",
  ],

  // ─── Market Structure Shift (generic) ───────────────────────────────────────
  market_structure_shift: [
    "market_structure_aligned",
    "displacement_confirmed",
  ],

  // ─── Break of Structure (BoS / CHoCH) ───────────────────────────────────────
  // Wave 26 Pass H Phase 1 (2026-05-26) — extended depth: BoS implies HTF bias
  // alignment + displacement (the impulse that broke structure) on top of the
  // structural shift itself. Lifts thin → rich for BoS strategies.
  break_of_structure: [
    "market_structure_aligned",
    "displacement_confirmed",
    "htf_bias_aligned",
  ],

  // ─── Session Open Breakout (e.g. London open / NY open continuation) ────────
  session_open_breakout: [
    "killzone_active",
    "opening_range_breakout",
    "first_30min_volume_above_avg",
  ],

  // ─── EMA Crossover (parametric trend-follow) ────────────────────────────────
  ema_crossover: [
    "regime_match",
    "htf_bias_aligned",
  ],

  // ─── Opening Range Breakout (parametric ORB) ────────────────────────────────
  opening_range_breakout: [
    "killzone_active",
    "first_30min_volume_above_avg",
  ],

  // ─── VWAP Bounce (parametric VWAP touch + reject) ───────────────────────────
  vwap_bounce: [
    "vwap_alignment",
    "regime_match",
  ],

  // ─── Moving Average (parametric MA-as-S/R bare) ─────────────────────────────
  moving_average: [
    "regime_match",
    "ma_as_support_resistance",
  ],

  // ─── Displacement: impulsive move creating FVG ──────────────────────────────
  displacement: [
    "displacement_confirmed",
  ],

  // ─── Wyckoff Spring: accumulation low sweep + reversal ──────────────────────
  wyckoff_spring: [
    "accumulation_phase_active",
    "liquidity_sweep_confirmed",
  ],

  // ─── Wyckoff Upthrust: distribution high sweep + reversal ───────────────────
  wyckoff_upthrust: [
    "distribution_phase_active",
    "liquidity_sweep_confirmed",
  ],

  // ─── VWAP band reject: institutional discount/premium + σ rejection ──────────
  vwap_band_reject: [
    "vwap_alignment",
    "market_structure_aligned",
  ],

  // ─── Anchored VWAP retest ────────────────────────────────────────────────────
  anchored_vwap_retest: [
    "vwap_alignment",
    "market_structure_aligned",
    "displacement_confirmed",
  ],
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the KB-implied confluence factors for the given archetype name.
 *
 * Accepts both the bare archetype key ("ict_bias_aligned_continuation") and
 * the prefixed sentinel form ("archetype:ict_bias_aligned_continuation").
 *
 * @param archetypeName  Bare or prefixed archetype identifier.
 * @returns              Array of implied factor names; empty array for unknown archetypes.
 */
export function inferFactorsFromArchetype(archetypeName: string): string[] {
  const key = archetypeName.startsWith("archetype:")
    ? archetypeName.slice("archetype:".length).trim()
    : archetypeName.trim();
  return ARCHETYPE_IMPLIED_FACTORS[key] ?? [];
}
