/**
 * evidence-completeness.ts — deep-scan #15 FIX M1 (2026-07-03)
 *
 * Single source of truth for the PAPER → DEPLOY_READY "evidence completeness"
 * roll-up accounting, shared by BOTH the cron path (lifecycle-service.ts) and
 * the manual/deferred path (paper-to-deploy-ready-gates.ts) so the two can never
 * drift.
 *
 * WHY THIS EXISTS
 * ---------------
 * Each promotion gate pushes one status string into `gateEvidenceStatuses`. The
 * governor blocks promotion when >= 3 of the tracked gates report INCOMPLETE
 * evidence (documented grandfather / infra-unavailable / broken-producer states).
 *
 * The bug (3 auditors, deep-scan #15): the incompleteness predicate only counted
 * statuses containing "legacy" or equal to "data_unavailable". A gate that returns
 * an explicit "malformed" (wrong-key / shape-drift / broken-producer) status was
 * booked as "complete" evidence — so a broken-producer strategy DODGED the
 * >= 3-incomplete governor and promoted on the strength of a gate that never
 * actually measured anything. `evaluateSlippageSurvivalGate` fail-OPENs on a
 * malformed row (never fabricates a block) but the roll-up must still count that
 * as MISSING evidence, not as protection.
 *
 * This module is intentionally free of DB access and side effects (pure) so it is
 * importable from the gate-chain integration test (which cannot import
 * lifecycle-service.ts — that pulls ../db/index.js and throws without
 * DATABASE_URL at collection time).
 */

/**
 * True when a gate's evidence status counts as INCOMPLETE toward the
 * >= 3-incomplete promotion governor.
 *
 * INCOMPLETE buckets:
 *   - anything containing "legacy"  (legacy_null / legacy_proceed / legacy_unavailable / ...)
 *   - "data_unavailable"            (infra read failure — gate proceeded fail-open)
 *   - "malformed"                   (FIX M1: wrong-key / shape-drift / broken producer —
 *                                    gate fail-OPENed but measured nothing)
 *
 * COMPLETE buckets (NOT incomplete): "complete", "clean", and any genuine-pass
 * status that carried real institutional-grade data.
 *
 * The predicate is deliberately conservative: an unknown/unexpected status is
 * treated as COMPLETE (never fabricates an incompleteness block) — only the
 * explicitly-enumerated missing-evidence markers count.
 */
export function isIncompleteEvidenceStatus(status: string): boolean {
  return (
    status.includes("legacy") ||
    status === "data_unavailable" ||
    status === "malformed"
  );
}

/**
 * Map a Slippage-Survival gate `status` to its evidence-completeness bucket.
 *
 * FIX M1: "malformed" (producer wrote a slippage_survival object with no
 * `breaks_at` own-key) now books an INCOMPLETE "malformed" bucket instead of a
 * false "complete". "legacy_null" keeps its existing incomplete bucket. Every
 * genuine-pass status ("clean" / "disabled" / "insufficient_sample" /
 * "warn_breaks_at_above_block") books "complete" — this does NOT change the
 * per-gate block/pass decision, only the roll-up accounting.
 *
 * NOTE: "disabled" (master switch OFF, the default) intentionally books
 * "complete" — a disabled advisory gate is not a producer error and must not
 * flood every strategy's incomplete count while the gate is inert.
 */
export function slippageEvidenceBucket(status: string): string {
  if (status === "legacy_null") return "legacy_null";
  if (status === "malformed") return "malformed";
  return "complete";
}

/**
 * Map a BIF gate outcome to its evidence-completeness bucket.
 *
 * FIX M1 (identical-pattern hardening): a legacy-null BIF books "legacy_null"
 * (unchanged); any explicit malformed/error reason books the INCOMPLETE
 * "malformed" bucket; everything else books "complete". The BIF gate coerces a
 * non-finite/garbage `bif` value to the legacy-null path already, so today this
 * only ever returns "legacy_null" or "complete" — the malformed branch is a
 * forward-safe guard so a future BIF producer-error reason cannot be silently
 * booked as complete evidence.
 */
export function bifEvidenceBucket(legacyNull: boolean, reason?: string | null): string {
  if (legacyNull) return "legacy_null";
  const r = (reason ?? "").toLowerCase();
  if (r.includes("malformed") || r.includes("producer_error") || r.includes("shape_drift")) {
    return "malformed";
  }
  return "complete";
}
