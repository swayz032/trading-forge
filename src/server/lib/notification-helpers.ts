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
