/**
 * Notification Helpers — Wave 25 Pass 2 A-3
 *
 * Shared utilities for composing alert bodies. Primary concern: family-grade
 * postscript that appends a plain-English explanation and action to every
 * operator-technical alert body.
 *
 * Routing note: Trading Forge currently has a single Discord channel. A future
 * migration to two channels (operator-technical + family-plain-english) is
 * documented as a Wave 25+ carry-forward. Until then, both audiences receive
 * the same alert body — this postscript ensures the family-facing portion is
 * always present and human-readable.
 */

/**
 * Appends a family-grade postscript block to an operator-technical alert body.
 *
 * The postscript section begins with a horizontal separator ("--- For family members ---")
 * so operator tooling can strip it if a dedicated channel is introduced later.
 *
 * @param operatorBody   The existing technical alert body string. Returned unchanged
 *                       if empty so callers can still fall through to notifyCritical.
 * @param plainEnglishWhat  One sentence: what happened, jargon-free.
 * @param plainEnglishAction  What the family member should do, jargon-free.
 *                            Should NOT assume technical knowledge of the system.
 * @returns Full alert body string with the family-grade postscript appended.
 */
export function appendFamilyGradePostscript(
  operatorBody: string,
  plainEnglishWhat: string,
  plainEnglishAction: string,
): string {
  const postscript =
    "\n\n--- For family members ---\n" +
    `What this means: ${plainEnglishWhat}\n` +
    `What to do: ${plainEnglishAction}`;
  return operatorBody + postscript;
}

/**
 * The marker that identifies an already-postscripted body. Exported so every path that
 * applies the fallback tests for the SAME sentinel — an inline copy in a second file is
 * how two paths drift apart silently.
 */
export const FAMILY_SENTINEL = "--- For family members ---";

/**
 * ★ THE CENTRAL FALLBACK — one source of truth, used by BOTH alert paths.
 *
 * Background (5b Q1): `alert-service.createAlert` carried an H7 guarantee whose docstring read
 * "guarantee every critical alert carries a family-grade postscript" — but it fired only inside
 * `createAlert`, and `notification-service.notify()` does not route through `createAlert`. So all
 * 189 direct `notify*` call sites bypassed it entirely. The claim was wider than the mechanism.
 *
 * The direct path was in fact covered — by CONVENTION (65 of 68 calling files import
 * `appendFamilyGradePostscript`, 0 critical/warning sites uncovered when measured). But a
 * convention is not a mechanism: nothing stops the next `notifyCritical` in an already-importing
 * file from inheriting the import and not the habit. This function makes the guarantee
 * structural, so the docstring's claim becomes TRUE rather than being narrowed to fit.
 *
 * Additive and idempotent by construction:
 *   • CRITICAL only — matching H7's stated scope. Warnings are lower-stakes BY DESIGN, and that
 *     scope is now stated rather than silent (it was previously true but undocumented).
 *   • Applies ONLY when the sentinel is absent, so a caller's TAILORED postscript is never
 *     doubled and never replaced by the generic one. A tailored message beats a generic one.
 */
export function applyFamilyFallback(body: string, severityIsCritical: boolean): string {
  if (!severityIsCritical) return body;
  if (body.includes(FAMILY_SENTINEL)) return body;
  return appendFamilyGradePostscript(
    body,
    "The trading system detected a critical issue. Auto-remediation was attempted.",
    "No immediate action needed — wait 5 minutes. If you see multiple alerts in a row, call Tony.",
  );
}
