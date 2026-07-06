export type ReconSeverity = "green" | "yellow" | "red";

/**
 * Pure severity decision for daily reconciliation (deep-scan A / Option B fix F-1). Leaf module
 * (no db import) so it is directly unit-testable, and so the degraded-mode clamp uses a DYNAMIC
 * effective independent-source count.
 *
 * Prior bug: the clamp used the frozen `INDEPENDENT_SOURCE_COUNT=2` literal → `2 < 3` was always
 * true → BOTH red and green were permanently capped at yellow, even after Option B is wired and
 * check 1 produces a genuine sent-vs-confirmed mismatch. That silently understated a real breach as
 * "yellow (can't verify)" on the operator's daily panel. The caller now passes an EFFECTIVE count
 * that includes the TradersPost-confirmed leg when Option B is active, so the clamp lifts and a real
 * breach reaches RED. (Discord + audit mismatchDetails always carry the raw signal regardless.)
 */
export function deriveReconSeverity(params: {
  mismatchCount: number;
  hasVerifiableData: boolean;
  effectiveIndependentSources: number;
  redMismatchCount: number;
  minIndependentSourcesForRed: number;
}): { severity: ReconSeverity; degraded: boolean } {
  const {
    mismatchCount,
    hasVerifiableData,
    effectiveIndependentSources,
    redMismatchCount,
    minIndependentSourcesForRed,
  } = params;

  let severity: ReconSeverity;
  if (mismatchCount === 0 && !hasVerifiableData) severity = "yellow";
  else if (mismatchCount === 0) severity = "green";
  else if (mismatchCount < redMismatchCount) severity = "yellow";
  else severity = "red";

  let degraded = false;
  if (effectiveIndependentSources < minIndependentSourcesForRed && (severity === "red" || severity === "green")) {
    degraded = true;
    severity = "yellow";
  }
  return { severity, degraded };
}
