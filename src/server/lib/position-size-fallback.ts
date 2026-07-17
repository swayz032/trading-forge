/**
 * POSITION SIZE FALLBACK DETECTION (leaf module) — pure, NO heavy imports.
 *
 * W3A ratify-packet (Execution Hardening, 2026-07-17), Item 3.
 *
 * paper-signal-service.ts's `risk_derived_pyramid` sizing branch
 * (`evaluateSignals()`, ~:5549) silently falls back to a hardcoded default for
 * 6 fields on the same `rawPositionSize` object whenever the compiled
 * strategy config does not carry a numeric override for that field — with NO
 * audit trail. `base_contracts` (fallback 6) was the original ask, but
 * `tier_increment` (3), `tier_threshold_dollars` (3000), `personal_dll_pct`
 * (0.67), `max_risk_pct_per_trade` (0.02), and `liquidity_comfort_cap`
 * (per-symbol) all have the IDENTICAL silent-fallback shape
 * (`typeof X === "number" ? X : default`) on the same object in the same
 * function — per this project's "fix the whole class, not just the instance"
 * convention, this module folds all 6 into one detector.
 *
 * `framework-overlay.ts` (~:384, :435-438) always stamps these 6 fields
 * authoritatively during graduation — this fallback path is designed to be
 * STRUCTURALLY UNREACHABLE in the normal graduation flow. Its only live
 * trigger is a strategy/session config that bypassed the overlay entirely
 * (hand-created row, pre-overlay legacy row, corrupted config). That is
 * exactly why the visibility fix has value: it surfaces overlay-bypass cases
 * that are otherwise invisible.
 *
 * VISIBILITY ONLY: the 6 fallback VALUES themselves are UNCHANGED here — this
 * module does not re-baseline them, only detects and reports when they
 * engage. (Note: the `base_contracts` fallback of 6 no longer matches the
 * current canonical pyramid base of 9/9/18 per CLAUDE.md §4's 2026-06-23
 * recal — if this detector ever fires in practice, that mismatch becomes
 * visible too, which is a feature of shipping the visibility fix, not a bug
 * to silently correct here.)
 *
 * Importable in tests + hot signal paths without dragging the db / sse /
 * notification graph (test-isolation discipline — CLAUDE.md
 * feedback_helper_logger_import), matching the confluence-provenance.ts
 * leaf-module pattern (paper-signal-service.ts itself is too large a
 * gateway-dependency surface to import directly in tests).
 */

import { LIQUIDITY_COMFORT_CAPS, LIQUIDITY_COMFORT_CAP_DEFAULT } from "../../shared/firm-config.js";

/**
 * Canonical fallback defaults for the 5 non-symbol-dependent
 * risk_derived_pyramid sizing fields. `liquidity_comfort_cap` is handled
 * separately below because its fallback is per-symbol, not a single constant.
 *
 * MUST stay byte-identical to the ternary defaults at the
 * paper-signal-service.ts call site — both reference this same object so the
 * detection and the actual construction of `positionSizeConfig` can never
 * drift apart.
 */
export const POSITION_SIZE_FALLBACK_DEFAULTS = {
  base_contracts: 6,
  tier_increment: 3,
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
} as const;

export interface PositionSizeFallbackField {
  /** The rawPositionSize field name that fell back to its hardcoded default. */
  field: string;
  /** The fallback value that was applied instead of a config override. */
  fallbackValue: number;
}

/**
 * Detect which of the 6 risk_derived_pyramid sizing fields on
 * `rawPositionSize` would fall back to their hardcoded default — i.e.
 * `rawPositionSize` does not carry a numeric override for that field.
 *
 * Contract: matches the EXACT `typeof X === "number"` guard used at the
 * paper-signal-service.ts call site (no additional NaN/finite guard) so this
 * detector and the actual positionSizeConfig construction never disagree on
 * which fields fell back.
 *
 * Pure, DB-free, symbol-aware only for the liquidity_comfort_cap fallback
 * (per-symbol book-depth ceiling — MES 100 / MNQ 50 / MCL 30, per CLAUDE.md
 * §4; unknown symbols fall back to LIQUIDITY_COMFORT_CAP_DEFAULT).
 */
export function detectPositionSizeFallbacks(
  rawPositionSize: Record<string, unknown> | null | undefined,
  symbol: string,
): PositionSizeFallbackField[] {
  const raw = rawPositionSize ?? {};
  const fallbacks: PositionSizeFallbackField[] = [];

  for (const field of Object.keys(POSITION_SIZE_FALLBACK_DEFAULTS) as Array<
    keyof typeof POSITION_SIZE_FALLBACK_DEFAULTS
  >) {
    if (typeof raw[field] !== "number") {
      fallbacks.push({ field, fallbackValue: POSITION_SIZE_FALLBACK_DEFAULTS[field] });
    }
  }

  if (typeof raw.liquidity_comfort_cap !== "number") {
    fallbacks.push({
      field: "liquidity_comfort_cap",
      fallbackValue: LIQUIDITY_COMFORT_CAPS[symbol.toUpperCase()] ?? LIQUIDITY_COMFORT_CAP_DEFAULT,
    });
  }

  return fallbacks;
}
