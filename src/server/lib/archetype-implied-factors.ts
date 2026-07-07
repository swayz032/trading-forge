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
// FIX A2 (deep-scan #22 fix-wave-2, 2026-07-07): every entry below was rewritten
// to use ONLY the canonical 11-factor vocabulary (see confluence-score.ts::
// CODE_DEFAULTS), closing a self-contradiction where this module's own docstring
// (lines 11-12, 46-50 above) mandated the canonical 11 while ~14 non-canonical
// concept-labels (htf_bias_aligned, fvg_present_or_ob, displacement_confirmed,
// asian_range_swept, manipulation_phase_done, false_breakout_confirmed,
// session_open_aligned, ma_as_support_resistance, rejection_pattern_confirmed,
// opening_range_breakout, first_30min_volume_above_avg, accumulation_phase_active,
// distribution_phase_active, liquidity_sweep_confirmed) were injected instead.
//
// Why this matters now that FIX A1 makes Path C actually fire: Path C
// (evaluateWeightedConfluence) evaluates the fixed 11 CODE_DEFAULTS keys
// directly — it does NOT consult entry_quality.confluence_factors at all — so
// non-canonical names were harmless to Path C but were NEVER just inert. Path B
// (canonical-5 fallback, still live for pre-Wave-25 legacy strategies and the
// Path C error-fallback) DOES iterate confluence_factors and fail-closes any
// name it doesn't recognize (`unknown_factor_fail_closed` — see
// paper-signal-service.ts:4890). Gate 2's factor_quality classification also
// treats every value here as "the" confluence vocabulary surfaced to operators.
// A non-canonical kb_inferred factor was therefore silently guaranteed to
// fail-closed the moment it reached Path B, dragging satisfiedCount down and
// risking a false stage2Blocked — while still (incorrectly) counting as "real"
// evidence for the rich/thin/fallback_only classification.
//
// Mapping rationale (nearest canonical concept, chosen over extending the
// vocabulary — extending Path B's 5-name if/else AND Path C's 11-factor
// CODE_DEFAULTS AND confluence-decay.ts's NO_DECAY_FACTORS list for ~14 new
// names is a much larger, riskier surface change than remapping definitional
// synonyms that already have a canonical home):
//   htf_bias_aligned, displacement_confirmed, rejection_pattern_confirmed,
//     accumulation_phase_active, distribution_phase_active,
//     manipulation_phase_done            → market_structure_aligned
//       (all are components of StructureState — BOS/CHoCH/MSS/HTF-bias/
//       displacement/premium-discount-zone — the exact fields
//       evalMarketStructureAligned() already reads)
//   fvg_present_or_ob                    → market_structure_aligned
//       (FVG/OB occupy the structure engine's premium_discount_zone, not a
//       distinct liquidity target)
//   asian_range_swept, false_breakout_confirmed, liquidity_sweep_confirmed
//                                        → liquidity_target_clear
//       (a swept/raided liquidity pool IS the liquidity-target-clear concept)
//   session_open_aligned, opening_range_breakout → killzone_active
//       (session-open / ORB timing windows are killzone semantics)
//   first_30min_volume_above_avg         → delta_or_volume_signature
//       (directly a volume-confirmation signal)
//   ma_as_support_resistance             → vp_level_proximity
//       (price proximity to a significant dynamic level)
//
// Duplicate factors collapsed after mapping (e.g. an archetype that implied
// both market_structure_aligned and htf_bias_aligned now implies
// market_structure_aligned once); the ≤5-factor limit and per-archetype
// definitional intent are both preserved. See archetype-implied-factors-
// canonical.test.ts for the enforcement test.
export const ARCHETYPE_IMPLIED_FACTORS: Record<string, string[]> = {
  // ─── ICT bias-aligned continuation: 4H bias → MSS/BoS → FVG retest → DOL ──
  // Definitional component set: HTF direction + market structure break + FVG/OB
  // in the pull-back zone + clear liquidity target + killzone session window.
  ict_bias_aligned_continuation: [
    "market_structure_aligned",  // BOS/CHoCH/MSS aligned with HTF bias + FVG/OB pull-back zone
    "liquidity_target_clear",    // DOL within acceptable R:R
    "killzone_active",           // NY AM or PM session window active
  ],

  // ─── ICT Silver Bullet (NY AM): 10-11 ET window + MSS + FVG + displacement ─
  ict_silver_bullet_ny_am: [
    "killzone_active",           // 10-11 ET window is the defining characteristic
    "market_structure_aligned",  // structural shift + FVG + displacement at setup time
  ],

  // ─── ICT Silver Bullet (NY PM): 2-3 ET window ─────────────────────────────
  ict_silver_bullet_ny_pm: [
    "killzone_active",           // 2-3 ET PM window
    "market_structure_aligned",
  ],

  // ─── ICT Power of 3: accumulation → manipulation (sweep) → distribution ───
  ict_power_of_3: [
    "liquidity_target_clear",    // Asian range swept = liquidity pool cleared; opposite side is the target
    "market_structure_aligned",  // manipulation-phase-done + displacement into distribution leg
  ],

  // ─── ICT Turtle Soup: equal high/low liquidity raid + reversal ─────────────
  ict_turtle_soup: [
    "liquidity_target_clear",    // equal highs/lows swept (liquidity pool raided then failed)
    "market_structure_aligned",  // lower-TF structure shift after sweep
  ],

  // ─── ICT Judas Swing: opening manipulation → true direction ────────────────
  ict_judas_swing: [
    "killzone_active",           // opening session context required
    "market_structure_aligned",  // manipulation-phase-done + shift confirms true direction
  ],

  // ─── ICT OTE (Optimal Trade Entry): Fibonacci-based HTF discount/premium ───
  ict_ote: [
    "market_structure_aligned",  // swing point + FVG overlap anchors the Fibonacci levels; HTF bias
    "regime_match",              // OTE is a trend-following tool
  ],

  // ─── Bounce off level (MA-as-support/resistance) ───────────────────────────
  // MA serves as dynamic S/R; rejection candle confirms the level held.
  bounce_off_level: [
    "vp_level_proximity",        // MA line acting as a structural level (price proximity to it)
    "market_structure_aligned",  // rejection candle / pinbar / engulf confirms the level held
    "regime_match",              // trend in place for the MA to be meaningful
  ],

  // ─── FVG Retest ─────────────────────────────────────────────────────────────
  fvg_retrace: [
    "market_structure_aligned",  // FVG occupies the structure engine's PD-zone
    "vp_level_proximity",        // retrace targets the gap level itself
  ],

  // ─── Order Block ─────────────────────────────────────────────────────────────
  order_block: [
    "market_structure_aligned",
    "vp_level_proximity",
  ],

  // ─── Liquidity Magnet: targeting opposite-side liquidity pools ───────────────
  liquidity_magnet: [
    "liquidity_target_clear",
    "market_structure_aligned",
  ],

  // ─── Market Structure Shift (generic) ───────────────────────────────────────
  market_structure_shift: [
    "market_structure_aligned",  // includes the displacement leg that confirms the shift
  ],

  // ─── Break of Structure (BoS / CHoCH) ───────────────────────────────────────
  // Wave 26 Pass H Phase 1 (2026-05-26) — extended depth: BoS implies HTF bias
  // alignment + displacement (the impulse that broke structure) on top of the
  // structural shift itself. Lifts thin → rich for BoS strategies.
  break_of_structure: [
    "market_structure_aligned",  // includes HTF-bias-aligned + displacement components
  ],

  // ─── Session Open Breakout (e.g. London open / NY open continuation) ────────
  session_open_breakout: [
    "killzone_active",           // session-open + opening-range-breakout timing window
    "delta_or_volume_signature", // first-30min volume above average
  ],

  // ─── EMA Crossover (parametric trend-follow) ────────────────────────────────
  ema_crossover: [
    "regime_match",
    "market_structure_aligned",  // HTF direction alignment
  ],

  // ─── Opening Range Breakout (parametric ORB) ────────────────────────────────
  opening_range_breakout: [
    "killzone_active",           // opening-range timing window
    "delta_or_volume_signature", // first-30min volume above average
  ],

  // ─── VWAP Bounce (parametric VWAP touch + reject) ───────────────────────────
  vwap_bounce: [
    "vwap_alignment",
    "regime_match",
  ],

  // ─── Moving Average (parametric MA-as-S/R bare) ─────────────────────────────
  moving_average: [
    "regime_match",
    "vp_level_proximity",        // MA acting as dynamic S/R
  ],

  // ─── Displacement: impulsive move creating FVG ──────────────────────────────
  displacement: [
    "market_structure_aligned",
  ],

  // ─── Wyckoff Spring: accumulation low sweep + reversal ──────────────────────
  wyckoff_spring: [
    "market_structure_aligned",  // accumulation-phase-active is a structural-phase read
    "liquidity_target_clear",    // the sweep itself clears a liquidity pool
  ],

  // ─── Wyckoff Upthrust: distribution high sweep + reversal ───────────────────
  wyckoff_upthrust: [
    "market_structure_aligned",  // distribution-phase-active is a structural-phase read
    "liquidity_target_clear",    // the sweep itself clears a liquidity pool
  ],

  // ─── VWAP band reject: institutional discount/premium + σ rejection ──────────
  vwap_band_reject: [
    "vwap_alignment",
    "market_structure_aligned",
  ],

  // ─── Anchored VWAP retest ────────────────────────────────────────────────────
  anchored_vwap_retest: [
    "vwap_alignment",
    "market_structure_aligned",  // includes the displacement leg that created the retest setup
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
