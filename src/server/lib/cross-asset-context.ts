/**
 * cross-asset-context.ts — Confluence HIGH-1 (deep-scan 2026-07-09, ratified)
 *
 * Pure resolver that maps a `pre_market_sessions` row's cross-asset fields
 * (dxy_direction / us10y_direction / computed_at) into the three SignalContext
 * fields the `cross_asset_aligned` confluence factor + its decay actually read:
 *   - dxyDirection          (evalCrossAssetAligned)
 *   - us10yDirection         (evalCrossAssetAligned)
 *   - cross_asset_age_hours  (deriveFactorDecay → cross_asset_aligned taper)
 *
 * WHY THIS EXISTS: before this fix, `paper-signal-service.ts` never populated
 * these on the Path C weightedCtx, so `evalCrossAssetAligned` returned
 * `cross_asset_data_unavailable` (satisfied=false) on EVERY live/paper signal —
 * a documented-DEFAULT-ON-but-never-wired factor. This helper is the seam that
 * makes the DB→ctx thread testable and keeps the domain validation + age math
 * in one pure, RED-provable place.
 *
 * Domain-safety: any stored direction outside {"up","down","flat"} maps to null
 * (a garbage row can never satisfy the factor). Age is null when computed_at is
 * absent or in the future relative to the signal bar (never negative).
 */

export type CrossAssetDirection = "up" | "down" | "flat" | null;

export interface CrossAssetPreMarketRow {
  dxyDirection?: string | null;
  us10yDirection?: string | null;
  /** pre_market_sessions.computed_at — when the reading was taken. */
  computedAt?: Date | string | null;
}

export interface ResolvedCrossAssetContext {
  dxyDirection: CrossAssetDirection;
  us10yDirection: CrossAssetDirection;
  /** Hours between the pre-market reading and the current signal bar. */
  cross_asset_age_hours: number | null;
}

/** Coerce an arbitrary stored value into the "up"|"down"|"flat" domain, else null. */
function coerceDirection(value: string | null | undefined): CrossAssetDirection {
  return value === "up" || value === "down" || value === "flat" ? value : null;
}

/**
 * Resolve the cross-asset SignalContext slice from a pre_market_sessions row.
 * `row` null/undefined (no pre-market row for today) → all-null (factor stays
 * `cross_asset_data_unavailable`, unchanged conservative behavior).
 *
 * @param row            the pre_market_sessions row (or null when absent)
 * @param barTimestampMs the current signal bar timestamp in epoch ms
 */
export function resolveCrossAssetContext(
  row: CrossAssetPreMarketRow | null | undefined,
  barTimestampMs: number,
): ResolvedCrossAssetContext {
  if (!row) {
    return { dxyDirection: null, us10yDirection: null, cross_asset_age_hours: null };
  }

  let ageHours: number | null = null;
  if (row.computedAt != null) {
    const computedMs = new Date(row.computedAt).getTime();
    if (Number.isFinite(computedMs) && Number.isFinite(barTimestampMs)) {
      const deltaMs = barTimestampMs - computedMs;
      // Never negative: a bar earlier than the reading has no meaningful "age".
      ageHours = deltaMs >= 0 ? deltaMs / 3_600_000 : null;
    }
  }

  return {
    dxyDirection: coerceDirection(row.dxyDirection),
    us10yDirection: coerceDirection(row.us10yDirection),
    cross_asset_age_hours: ageHours,
  };
}
