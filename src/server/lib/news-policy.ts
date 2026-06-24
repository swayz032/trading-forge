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
 *   • MFFU 50k BUILDER (secondary): news trading is ALLOWED (eval + sim funded). Builder
 *     is NOT a T1-restricted plan → caution like Topstep: AUTO-REDUCE size, never block.
 *     (MFFU Rapid Sim Funded / Pro Sim Funded ARE T1-restricted — if the operator ever
 *     switches to those plans, restore a HARD BLOCK for those plan keys.)
 *
 * Unknown/missing firm → BLOCK (fail-safe — never assume a permissive firm policy).
 *
 * This module is a PURE resolver (no I/O, no Date.now). Callers pass the firm + the
 * already-detected event window state; this maps it to allow / reduce_size / block.
 */

import { isUsDst } from "./dst-utils.js";
import { EIA_EVENTS } from "./eia-dates.js";

export type NewsAction = "allow" | "reduce_size" | "block";

// Asymmetric entry-block window per the operator's choice (MFFU ±2min flatten + safety
// buffer): no new entry from T−5 to T+2 around a Tier-1 release.
export const NEWS_ENTRY_BLOCK_BEFORE_MIN = 5;
export const NEWS_ENTRY_BLOCK_AFTER_MIN = 2;

// EIA Crude Oil Inventories is a Tier-1 event for CRUDE products only (MCL/CL/QM).
// It is NOT in the universal Python calendar_filter set (which would wrongly block
// MES/MNQ at 10:30) — it is detected here, product-scoped.
const CRUDE_SYMBOLS_EIA = new Set(["MCL", "CL", "QM"]);

/**
 * Is the given bar inside an EIA release window for a CRUDE symbol?
 *
 * EIA releases Wednesday 10:30 ET (holiday weeks shift to Thursday 11:00 ET — baked into
 * EIA_EVENTS, generated from the Python source). Window is the asymmetric entry block
 * [T−5min, T+2min]. Returns false for non-crude symbols (product scope).
 */
export function isEiaWindow(symbol: string, barTimestampUtc: string): boolean {
  if (!CRUDE_SYMBOLS_EIA.has((symbol || "").toUpperCase())) return false;

  let barDate: Date;
  try {
    barDate = new Date(barTimestampUtc);
    if (Number.isNaN(barDate.getTime())) return false;
  } catch {
    return false;
  }

  const etOffsetMs = (isUsDst(barDate) ? -4 : -5) * 3_600_000;
  const barEtDateStr = new Date(barDate.getTime() + etOffsetMs).toISOString().slice(0, 10);

  for (const evt of EIA_EVENTS) {
    if (evt.date !== barEtDateStr) continue;
    const [hh, mm] = evt.time_et.split(":").map(Number);
    if (hh === undefined || mm === undefined) continue;
    const evtEtMidnightUtcMs =
      Date.UTC(
        parseInt(evt.date.slice(0, 4)),
        parseInt(evt.date.slice(5, 7)) - 1,
        parseInt(evt.date.slice(8, 10)),
      ) - etOffsetMs;
    const evtUtcMs = evtEtMidnightUtcMs + (hh * 3_600_000 + mm * 60_000);
    const diffMs = barDate.getTime() - evtUtcMs;
    if (
      diffMs >= -NEWS_ENTRY_BLOCK_BEFORE_MIN * 60_000 &&
      diffMs <= NEWS_ENTRY_BLOCK_AFTER_MIN * 60_000
    ) {
      return true;
    }
  }
  return false;
}

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

  // MFFU (BUILDER plan): news trading is ALLOWED (eval + sim funded) — Builder is NOT a
  // T1-restricted plan (unlike Rapid/Pro Sim Funded). Treat like Topstep: caution, reduce
  // size in the window, never block. (If the operator ever switches to MFFU Rapid/Pro, those
  // ARE T1-prohibited — restore a hard block for those plan keys.)
  if (firm === "mffu") {
    return { action: "reduce_size", sizeFactor: getNewsReduceSizeFactor() };
  }

  // Unknown/missing firm → fail-safe HARD BLOCK (we don't know the plan's news rules).
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
