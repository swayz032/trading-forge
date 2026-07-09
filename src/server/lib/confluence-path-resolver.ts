/**
 * Deep-scan #22 cap-closer Z6 (2026-07-09) — Path-C / Path-A / Path-B
 * confluence dispatch resolver.
 *
 * BEHAVIOR-PRESERVING EXTRACTION — this is the byte-identical decision logic
 * that was previously inlined in paper-signal-service.ts:
 *   - entryQuality read:            (was) paper-signal-service.ts:4162-4177
 *   - isLegacyStrategy:             (was) paper-signal-service.ts:4179-4181
 *   - useWeightedScoring:           (was) paper-signal-service.ts:4363
 *   - customIndicators/usePerStrategy: (was) paper-signal-service.ts:4767-4768
 *
 * WHY THIS EXISTS
 * ----------------
 * paper-signal-service.ts bootstraps DATABASE_URL via a module-top-level
 * `import { db } from "../db/index.js"`, so a pglite-backed unit test cannot
 * import the real dispatcher function directly. Every prior test covering
 * this decision (deepscan22-x6-factory-failure-injection.test.ts Control 1,
 * deepscan22-y6-path-c-db-roundtrip.test.ts) had to hand-copy a MIRROR of
 * this logic — a semantic edit to the real reader that doesn't touch the
 * pinned substrings a static-pin test checks would drift undetected. This
 * module is a pure, DB-free, logger-free leaf so tests can import the REAL
 * decision function instead of a mirror.
 *
 * Pure: no DB, no logger, no network, no I/O. Reads only the passed-in raw
 * strategy config object. Never throws.
 */

import type { ConfirmingIndicator } from "../services/confirming-indicator-evaluator.js";

export interface EntryQualityForDispatch {
  confluence_factors?: string[];
  min_factors_satisfied?: number;
  extraction_provenance?: string;
  /** W23G.11 per-strategy confirming indicators (W23H.D: evaluated at signal time) */
  confirming_indicators?: ConfirmingIndicator[];
  /**
   * Wave 25 W25.1: opt-in to weighted probabilistic scoring (Path C).
   * When true, Stage 2 uses evaluateWeightedConfluence() instead of boolean counting.
   * Default false — existing strategies continue on Path A or B unchanged.
   */
  use_weighted_scoring?: boolean;
}

export interface ConfluenceDispatchResult {
  /** The resolved entry_quality block (undefined when neither top-level nor strategy-nested exists). */
  entryQuality: EntryQualityForDispatch | undefined;
  /** True when there's no entry_quality block, or its provenance is legacy_no_confluence. */
  isLegacyStrategy: boolean;
  /**
   * True when Path C (Wave 25 weighted confluence scoring) should be
   * attempted. Note: this resolves the STATIC dispatch decision only — at
   * the paper-signal-service.ts call site, a Path C failure at RUNTIME
   * (pathCFailed, set inside a try/catch around evaluateWeightedConfluence())
   * additionally falls through to Path A/B. That runtime fallback is NOT
   * modeled here (it depends on a try/catch outcome, not on config shape)
   * and remains the caller's responsibility, exactly as before extraction.
   */
  useWeightedScoring: boolean;
  /** True when Path A (per-strategy confirming_indicators[]) should evaluate; false → Path B (canonical 5). */
  usePerStrategy: boolean;
  /** entryQuality.confirming_indicators, normalized to [] when absent. */
  customIndicators: ConfirmingIndicator[];
}

/**
 * Resolves the entry_quality block plus the Path C / A / B dispatch decision
 * from a raw strategy config object (the `strategies.config` JSONB shape).
 *
 * Dispatch priority order (mirrors paper-signal-service.ts exactly):
 *   1. Legacy bypass — no entry_quality, or extraction_provenance === "legacy_no_confluence"
 *      (isLegacyStrategy=true; caller skips Path C/A/B entirely)
 *   2. Path C (opt-in) — entry_quality.use_weighted_scoring === true
 *   3. Path A — entry_quality.confirming_indicators[] non-empty
 *   4. Path B (fallback) — canonical 5-factor list
 */
export function resolveConfluenceDispatch(
  rawConfig: Record<string, unknown>,
): ConfluenceDispatchResult {
  const entryQuality = (
    rawConfig.entry_quality ??
    (rawConfig.strategy as Record<string, unknown> | undefined)?.entry_quality
  ) as EntryQualityForDispatch | undefined;

  const isLegacyStrategy =
    !entryQuality ||
    entryQuality.extraction_provenance === "legacy_no_confluence";

  const useWeightedScoring = entryQuality?.use_weighted_scoring === true && !isLegacyStrategy;

  const customIndicators = entryQuality?.confirming_indicators ?? [];
  const usePerStrategy = customIndicators.length > 0;

  return { entryQuality, isLegacyStrategy, useWeightedScoring, usePerStrategy, customIndicators };
}
