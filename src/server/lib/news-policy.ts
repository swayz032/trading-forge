/**
 * news-policy.ts — Firm-aware Tier-1 news-window behavior resolver (Phase 2).
 *
 * Wave hardening 2026-06-22 Phase 2, MFFU Feb-2026 + Topstep News Policy.
 *
 * Phase 1 corrected the T1 EVENT SET (FOMC/FOMC_MINUTES/CPI/NFP universal +
 * EIA for crude). Phase 2 makes the BEHAVIOR firm-aware — the two approved firms
 * have OPPOSITE news policies:
 *
 *   • Topstep (PRIMARY / bot's first choice): trading during news is ALLOWED with
 *     caution. Topstep's own guidance: "cut your position size, use limit orders, or
 *     avoid trading the event." → the bot AUTO-REDUCES size in the window, never blocks.
 *
 *   • MFFU 50k Rapid (secondary, RESTRICTED account): T1 trading is PROHIBITED. Rapid
 *     Sim Funded / Pro Sim Funded are restricted accounts where T1 trading is not
 *     allowed at all. → the bot HARD-BLOCKS entries in the window.
 *
 * Unknown/missing firm → BLOCK (fail-safe — never assume a permissive firm policy).
 *
 * This module is a PURE resolver (no I/O, no Date.now). Callers pass the firm + the
 * already-detected event window state; this maps it to allow / reduce_size / block.
 */

export type NewsAction = "allow" | "reduce_size" | "block";

/**
 * Topstep-side caution size factor — multiplies position size in a T1 window.
 * 0.5 = half size (Topstep's "cut your position size" guidance). Env-tunable.
 * Clamped to (0, 1]; values outside fall back to the 0.5 default.
 */
export function getNewsReduceSizeFactor(): number {
  const raw = process.env.NEWS_REDUCE_SIZE_FACTOR;
  if (raw === undefined) return 0.5;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v > 1) return 0.5;
  return v;
}

/**
 * Normalize a firm key to the canonical lowercase firm id (strips "_50k" etc).
 */
export function normalizeFirmKey(firmKey: string | null | undefined): string {
  if (!firmKey) return "";
  return firmKey.toLowerCase().replace(/_\d+k$/, "").trim();
}

/**
 * Resolve what the bot should do when a signal fires inside a Tier-1 news window.
 *
 * @param firmKey   resolved firm key for the signal's account (e.g. "topstep", "mffu", "mffu_50k")
 * @param inT1Window whether the bar is inside a T1 window for this symbol (caller-detected)
 * @param bypassNewsBlackout per-strategy B11 opt-in — event-driven strategies trade through
 * @returns { action, sizeFactor } — sizeFactor only meaningful for "reduce_size"
 */
export function resolveNewsAction(
  firmKey: string | null | undefined,
  inT1Window: boolean,
  bypassNewsBlackout: boolean = false,
): { action: NewsAction; sizeFactor: number } {
  if (!inT1Window) return { action: "allow", sizeFactor: 1 };
  // B11: explicit per-strategy opt-in (event-driven strategies). Holidays handled separately.
  if (bypassNewsBlackout) return { action: "allow", sizeFactor: 1 };

  const firm = normalizeFirmKey(firmKey);

  // Topstep (PRIMARY): caution — reduce size, never block.
  if (firm === "topstep") {
    return { action: "reduce_size", sizeFactor: getNewsReduceSizeFactor() };
  }

  // MFFU (incl. Rapid restricted) + unknown/missing → fail-safe HARD BLOCK.
  // The operator's MFFU account is a 50k Rapid plan = restricted (T1 prohibited).
  return { action: "block", sizeFactor: 1 };
}

/**
 * Per-event-type product scope. Determines which symbols a T1 event affects.
 *   • FOMC / FOMC_MINUTES → ALL products (rate decisions move everything).
 *   • CPI / NFP (Employment Report) → equity-index products (MES/MNQ/ES/NQ).
 *   • EIA (Crude Oil Inventories) → crude only (MCL/CL).
 * An event with no entry here defaults to ALL products (conservative).
 */
const INDEX_SYMBOLS = new Set(["MES", "MNQ", "ES", "NQ", "M2K", "RTY", "MYM", "YM"]);
const CRUDE_SYMBOLS = new Set(["MCL", "CL", "QM"]);

export function eventAffectsSymbol(eventType: string, symbol: string): boolean {
  const t = (eventType || "").toUpperCase();
  const s = (symbol || "").toUpperCase();
  // FOMC family → all products.
  if (t === "FOMC" || t === "FOMC_MINUTES") return true;
  // CPI / NFP → equity index. (Macro-sensitive crude is covered by FOMC + EIA separately.)
  if (t === "CPI" || t === "NFP") return INDEX_SYMBOLS.has(s);
  // EIA → crude only.
  if (t === "EIA") return CRUDE_SYMBOLS.has(s);
  // Unknown event type → conservative: affects all.
  return true;
}
