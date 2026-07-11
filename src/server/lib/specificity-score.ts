/**
 * SPECIFICITY SCORE + SEMANTIC COMPRESSION LOSS (SCL) — Fidelity Phase 2A.
 *
 * The edge→predicate compilation contract (docs/designs/edge-to-predicate-compilation-contract.md)
 * proved the compiler's dominant fidelity failure is SELECTION: it grabs a GENERIC confirmation
 * (structure_shift@prior_swing) when the educator's actual trigger is a SPECIFIC event+level
 * (OR-low retest + FVG). Two deterministic tools fix it without an LLM:
 *
 *  1. specificity score — ranks candidate triggers so the compiler PREFERS the most specific one.
 *  2. SCL = triggerSpecificity(edge) − triggerSpecificity(predicate) — a fail-closed gate: if the
 *     compiled predicate dropped too much of the edge's available specificity, QUARANTINE rather
 *     than ship a lossy compile. Cheap, runs every compile; the LLM grader becomes a periodic audit.
 *
 * Pure / deterministic. SCL gate uses TRIGGER-specificity only (named level + confluence + timeframe
 * + rare pattern) — session is its own axis, and sequence-depth (multi-leg) is Phase 2B, surfaced
 * here as `multiLegGap` (observability) but NOT gated in 2A to avoid over-quarantining multi-step
 * strategies before the legs can be compiled.
 */

/** Specific structural references. The generic `prior_swing` default is deliberately NOT named. */
const NAMED_LEVEL_RE =
  /\b(opening range|\borb\b|range (?:high|low|edge)|(?:the|our|a) range|opening price|overnight (?:high|low)|asian? (?:high|low|session low|range)|order block|\bob\b|breaker|session (?:high|low)|daily (?:high|low)|\bpdh\b|\bpdl\b|fair value gap|\bfvg\b)\b/i;

/** Confluence families — each distinct family present adds specificity. */
const CONFLUENCE_FAMILIES: RegExp[] = [
  /\b(fair value gap|\bfvg\b)\b/i,
  /\b(order block|\bob\b)\b/i,
  /\b(displacement|displac(?:e|ed|ing))\b/i,
  /\b(smt|divergence)\b/i,
  /\b(sweep|liquidity (?:grab|pool|run)|run on liquidity|swept)\b/i,
  /\b(breaker block|breaker)\b/i,
  /\b(equal (?:highs|lows)|\beqh\b|\beql\b)\b/i,
  /\b(imbalance)\b/i,
];

/** Rare, named, non-generic mechanics (high specificity signal). */
const RARE_PATTERN_RE =
  /\b(change in state of delivery|cisd|breaker block|swing failure|\bsfp\b|chain of state|chain state|optimum zone|inducement|displacement)\b/i;

/** Explicit refinement timeframe (drop-down TF). */
const TIMEFRAME_RE =
  /\b(1m|5m|15m|30m|1h|4h|1d|one[- ]minute|five[- ]minute|fifteen[- ]minute|thirty[- ]minute|hourly|four[- ]hour|daily)\b/i;

export interface TriggerFeatures {
  named_level: boolean;
  timeframe_specific: boolean;
  confluence_count: number;
  rare_pattern: boolean;
}

/** Extract trigger-specificity features from a text span (window, quote, or full corpus). */
export function triggerFeaturesFromText(text: string | null | undefined): TriggerFeatures {
  const t = typeof text === "string" ? text : "";
  return {
    named_level: NAMED_LEVEL_RE.test(t),
    timeframe_specific: TIMEFRAME_RE.test(t),
    confluence_count: CONFLUENCE_FAMILIES.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0),
    rare_pattern: RARE_PATTERN_RE.test(t),
  };
}

/** Merge two feature sets to the MAX available (used to build the edge ceiling from many windows). */
export function maxFeatures(a: TriggerFeatures, b: TriggerFeatures): TriggerFeatures {
  return {
    named_level: a.named_level || b.named_level,
    timeframe_specific: a.timeframe_specific || b.timeframe_specific,
    confluence_count: Math.max(a.confluence_count, b.confluence_count),
    rare_pattern: a.rare_pattern || b.rare_pattern,
  };
}

/** TRIGGER specificity — the axes a single confirmation predicate can represent. Used by the SCL gate. */
export function triggerSpecificity(f: TriggerFeatures): number {
  return (f.named_level ? 5 : 0) + (f.timeframe_specific ? 4 : 0) + f.confluence_count * 3 + (f.rare_pattern ? 2 : 0);
}

/** Whether a compiled predicate's level_ref counts as a NAMED (specific) level. prior_swing = generic. */
const NAMED_PREDICATE_LEVELS = new Set([
  "opening_range_edge", "opening_price", "order_block", "overnight_high_low", "session_level", "range_edge",
]);
export function predicateLevelIsNamed(levelRef: string | null | undefined): boolean {
  return levelRef != null && NAMED_PREDICATE_LEVELS.has(levelRef);
}

/**
 * Semantic Compression Loss for the trigger axes.
 * `edge` = the richest specificity available across the whole source.
 * `predicate` = what the chosen compiled predicate actually captured.
 * SCL > 0 means the compile dropped specificity that WAS available in the source.
 */
export function computeScl(edge: TriggerFeatures, predicate: TriggerFeatures): number {
  return Math.max(0, triggerSpecificity(edge) - triggerSpecificity(predicate));
}

/** Default SCL tolerance — above this, the compile is too lossy → quarantine. Env-overridable. */
export function sclMaxTolerance(): number {
  const v = Number(process.env.SCL_MAX_TOLERANCE);
  return Number.isFinite(v) && v >= 0 ? v : 6;
}

/**
 * SCL HARD GATE enable flag — DEFAULT OFF for Phase 2A.
 * SCL is shipped as TELEMETRY (always computed + surfaced). The hard quarantine gate is opt-in until
 * the tolerance is calibrated against an LLM re-grade: the candidate-scoped ceiling can still over-count
 * on rich multi-confluence educators (multi-leg spread = Phase 2B), and hard-quarantining a faithful
 * winner is the expensive error (CLAUDE.md §13 "ship STRICT, loosen with DATA"). Flip on post-calibration.
 */
export function sclGateEnabled(): boolean {
  return process.env.SCL_GATE_ENABLED === "true";
}
