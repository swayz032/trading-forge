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
