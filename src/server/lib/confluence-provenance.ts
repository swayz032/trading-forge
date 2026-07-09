/**
 * CONFLUENCE PROVENANCE (leaf module) — pure factor-source classification, NO heavy imports.
 *
 * Importable in tests + hot signal paths without dragging the db / sse / notification graph
 * (test-isolation discipline — CLAUDE.md feedback_helper_logger_import). Re-exported by
 * confluence-quality-audit.ts for backward-compat.
 */

/** A confluence factor's provenance. */
export type FactorSource = "extracted" | "auto_floor" | "kb_inferred";

/** Factors the graduator injects as a quality FLOOR (NOT LLM-extracted) — Trading Forge overlay, not YT edge. */
export const AUTO_FLOOR_FACTORS: ReadonlySet<string> = new Set([
  "regime_match",
  "structural_setup",
]);

/**
 * Tag each factor with its source.
 *   "auto_floor"  — in AUTO_FLOOR_FACTORS (graduator floor logic)
 *   "extracted"   — LLM extracted it from the transcript
 *   "kb_inferred" — reserved (KB-overlap path, not yet implemented)
 */
export function tagFactorSources(factors: string[]): Record<string, FactorSource> {
  const result: Record<string, FactorSource> = {};
  for (const f of factors) result[f] = AUTO_FLOOR_FACTORS.has(f) ? "auto_floor" : "extracted";
  return result;
}

/**
 * Count of EVIDENCE-BACKED confluence factors (i.e. NOT auto_floor / TF-overlay-injected).
 *
 * Used by the confluence→position-size multiplier (paper-signal-service.ts): auto_floor confluences
 * (graduator-injected regime_match / structural_setup) are Trading Forge overlay, NOT the YouTube-extracted
 * edge, and must NEVER justify the 1.5×/2× size upsize (2026-06-30 hardening). Pure / deterministic.
 */
export function evidenceBackedFactorCount(factors: string[]): number {
  return factors.filter((f) => !AUTO_FLOOR_FACTORS.has(f)).length;
}

/**
 * Derive the sizing `confluence_count` (evidence-backed factors + 1 for the always-counted
 * primary signal) from an `entry_quality` block's `confluence_factors` (string[]).
 *
 * Deep-scan #22 FIX F-1 (2026-07-09): the sizing site in paper-signal-service.ts was passing
 * `entry_quality.confirming_indicators` (an array of `{indicator, params, direction}` OBJECTS,
 * populated by deep-scan #22 FIX A1) into `evidenceBackedFactorCount(factors: string[])`. Since
 * `AUTO_FLOOR_FACTORS.has(object)` is always false, the 2026-06-30 auto_floor exclusion never
 * fired — every confluence strategy was credited as fully evidence-backed and could size up
 * (1.5×/2×) on graduator-injected quality-floor factors (regime_match / structural_setup), not
 * real YouTube-extracted edge. This helper reads the CORRECT field
 * (`entry_quality.confluence_factors`, the string[] Stage 2 already reads at signal time) and
 * prefers the per-factor `factor_sources` provenance map (graduation-time
 * Record<string, FactorSource>) over the static AUTO_FLOOR_FACTORS set when available — a factor
 * explicitly tagged "auto_floor" at graduation is excluded even if its name isn't in the static
 * set (forward-compat for future graduator-injected floor factors).
 *
 * Fail-safe direction: this function can only REDUCE or hold confluence_count relative to the
 * pre-fix (buggy) value — it never increases it. Missing/empty input → 1 (primary always counts).
 */
export function deriveEvidenceBackedConfluenceCount(
  entryQuality:
    | { confluence_factors?: string[]; factor_sources?: Record<string, FactorSource> }
    | null
    | undefined,
): number {
  const factors = entryQuality?.confluence_factors ?? [];
  const sources = entryQuality?.factor_sources;

  const evidenceBacked = sources
    ? factors.filter((f) => sources[f] !== "auto_floor").length
    : evidenceBackedFactorCount(factors);

  return evidenceBacked + 1;
}
