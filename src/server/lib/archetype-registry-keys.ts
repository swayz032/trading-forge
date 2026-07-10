/**
 * Canonical set of EXECUTABLE strategy archetypes — single source of truth.
 *
 * Why this module exists (2026-06-24 Layer 1 shipping-integrity fix):
 * The compilability gate must answer "does entry_indicator resolve to a REAL executable
 * archetype?" but it is pure (runs in unit tests with no DB), so it cannot import the
 * DB-coupled `direct-bucket-graduator.ts`. This module holds the archetype key set as a
 * pure, importable constant used by BOTH the graduator (`deriveEntryIndicator`) and the
 * compilability gate — so the gate's notion of "real archetype" can never drift from the
 * graduator's routing.
 *
 * A STRUCTURAL archetype here is detector-driven: the engine archetype class carries the
 * entry trigger, so the extraction does NOT need entry_params to be deterministic. A
 * concept-name ECHO (e.g. "impulse_range_sweep_4h_5m") is NOT in this set — it resolves
 * to no engine class, so it carries no trigger and must supply entry_params/entry_condition
 * or be quarantined.
 */

/**
 * Archetype names Gemma is known to emit that map directly to engine handlers
 * (mirrors `RAW_ARCHETYPES_RESPECTED` consumed by `deriveEntryIndicator`). The graduator
 * imports THIS — do not redefine it there.
 */
export const RAW_ARCHETYPES_RESPECTED: ReadonlySet<string> = new Set<string>([
  // ICT time-window archetypes
  "ict_silver_bullet_ny_am", "ict_silver_bullet_london", "ict_silver_bullet_ny_pm",
  "ict_judas_swing", "ict_ny_lunch_reversal", "ict_midnight_open", "ict_london_raid",
  "ict_turtle_soup", "ict_ote", "ict_power_of_3", "ict_unicorn", "ict_breaker",
  "ict_mitigation", "ict_iofed", "smt_reversal", "ict_quarterly_swing",
  "ict_propulsion", "ict_eqhl_raid", "ict_scalp", "ict_swing", "ict_2022",
  // Structural primitives
  "break_of_structure", "change_of_character", "market_structure_shift", "cisd",
  "fvg_retrace", "order_block", "liquidity_sweep",
  // W23G.3 short-form aliases
  "fvg", "judas_swing", "silver_bullet", "breaker_block",
  // Wyckoff
  "wyckoff_spring", "wyckoff_upthrust", "wyckoff_accumulation", "wyckoff_distribution",
  // Wave 26 Pass G archetypes
  "bounce_off_level", "ict_bias_aligned_continuation",
]);

/**
 * HIGH-1 fix (deep-scan 2026-07-09, ratified) — SUB-LAYER VOCABULARY, NOT DISPATCHABLE.
 * These names are frequently emitted by ICT-tuned LLMs but have NO engine handler /
 * ARCHETYPE_REGISTRY entry. They were previously mixed into RAW_ARCHETYPES_RESPECTED, so the
 * graduator's early-return fired `archetype:<name>` for them → the DSL compiler emitted the
 * never-true `high < low` sentinel → the strategy graduated, passed every gate, and NEVER
 * fired a signal (a silent zombie occupying a slot). Worse, "trendline_bounce" shadowed its
 * own working alias (`trendline_bounce → archetype:bounce_off_level`, deriveEntryIndicator).
 * By keeping them OUT of the archetype set, the graduator's early-return no longer matches
 * them; they fall through to the alias table (trendline_bounce → bounce_off_level) or to the
 * `uncatalogued:<term>` quarantine (queued in needs_archetype_queue for operator review) —
 * never a dead archetype. entryIndicatorResolvesToArchetype() also correctly returns false
 * for them (the compilability gate agrees they are not structural archetypes).
 */
export const SUBLAYER_VOCAB_NOT_DISPATCHABLE: ReadonlySet<string> = new Set<string>([
  "liquidity_magnet", "displacement", "htf_bias", "daily_bias",
  "accumulation", "manipulation", "distribution", "asian_range",
  "equal_highs", "equal_lows", "false_breakout", "session_open", "reversal",
  "sma_support", "ema_support", "trendline_bounce", "wick_rejection", "engulfing_rejection",
]);

/**
 * Registry-only archetype keys — registered in `ARCHETYPE_REGISTRY` (graduator) but NOT in
 * the RAW gemma-respected set above. Keep in sync with ARCHETYPE_REGISTRY; the drift-guard
 * test (`archetype-registry-keys.test.ts`) fails if a registry key is missing here.
 */
const REGISTRY_ONLY_ARCHETYPES: ReadonlySet<string> = new Set<string>([
  "gann_box_4h_continuation",
]);

/**
 * The full set the compilability gate treats as "carries the entry trigger structurally"
 * = RAW gemma-respected ∪ registry-only.
 */
export const RESOLVABLE_ARCHETYPES: ReadonlySet<string> = new Set<string>([
  ...RAW_ARCHETYPES_RESPECTED,
  ...REGISTRY_ONLY_ARCHETYPES,
]);

/**
 * True iff `entryIndicator` (or archetype field) names a real executable archetype whose
 * engine class supplies the entry trigger. Strips an optional "archetype:" prefix, trims,
 * lowercases. A concept-name echo that maps to no engine class returns false.
 */
export function entryIndicatorResolvesToArchetype(entryIndicator: string | null | undefined): boolean {
  if (typeof entryIndicator !== "string") return false;
  const raw = entryIndicator.trim().toLowerCase();
  if (raw.length === 0) return false;
  const key = raw.startsWith("archetype:") ? raw.slice("archetype:".length).trim() : raw;
  return RESOLVABLE_ARCHETYPES.has(key);
}
