/**
 * Slumhouse street translators — jargon → plain English.
 *
 * Pure functions. No DB, no I/O. Every caller passes raw TF data; these
 * helpers format it for non-trader members per the Slumdawg jargon table.
 *
 * See docs/slumdawg-analyst/01-system-prompt.md for the canonical translation
 * table that Anam.ai uses; these helpers stay in lockstep with that table.
 */

const SYMBOL_MAP: Record<string, string> = {
  MES: "Mini-S&P",
  MNQ: "Mini-Nasdaq",
  MCL: "Mini-Oil",
  // Mini-contract (Phase 5) translations stay symbol-faithful since they're
  // 10× larger — the friend portal won't see these until Phase 5 activates.
  ES: "S&P",
  NQ: "Nasdaq",
  CL: "Crude Oil",
};

export function symbolToStreet(symbol: string): string {
  if (!symbol) return "Unknown";
  return SYMBOL_MAP[symbol.toUpperCase()] ?? symbol;
}

const STATION_MAP: Record<string, string> = {
  CANDIDATE: "Prep Station",
  TESTING: "On the Stove",
  SHADOW: "On the Stove",
  PAPER: "Taste Test",
  DEPLOY_READY: "Small Plates",
  PILOT: "Small Plates",
  DEPLOYED: "On the Menu",
  DECLINING: "On the Menu", // still serving real money; just on the way out
  GRAVEYARD: "Tossed",
};

export function lifecycleToStation(state: string | null | undefined): string {
  if (!state) return "Unknown";
  return STATION_MAP[state.toUpperCase()] ?? state;
}

/**
 * formatBag — render a dollar amount with sign and grouping.
 * Uses the figure dash (−) for negatives so they read right in proportional fonts.
 *
 *   formatBag(2847.5)  → "+$2,848"
 *   formatBag(-430.21) → "−$430"
 *   formatBag(0)       → "$0"
 *   formatBag(NaN)     → "$0"
 */
export function formatBag(dollars: number): string {
  if (!Number.isFinite(dollars)) return "$0";
  const rounded = Math.round(dollars);
  if (rounded === 0) return "$0";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

/**
 * betSize — bucket raw contract count into street size labels.
 * Tuned to the operator's Wave 23 pyramid (base 6, +3 per +$3K profit, cap 100).
 *
 *   1..6   → "small bet"
 *   7..12  → "medium bet"
 *   13..   → "big bet"
 */
export function betSize(contracts: number): string {
  if (!Number.isFinite(contracts) || contracts <= 0) return "small bet";
  if (contracts <= 6) return "small bet";
  if (contracts <= 12) return "medium bet";
  return "big bet";
}

/**
 * oddsOuttaHundred — render a [0,1] probability as "N outta 100".
 * Clamps to [0,1] to defend against MC numeric noise.
 *
 *   oddsOuttaHundred(0.03) → "3 outta 100"
 *   oddsOuttaHundred(0.5)  → "50 outta 100"
 *   oddsOuttaHundred(NaN)  → "0 outta 100"
 */
export function oddsOuttaHundred(p: number): string {
  if (!Number.isFinite(p)) return "0 outta 100";
  const clamped = Math.max(0, Math.min(1, p));
  const n = Math.round(clamped * 100);
  return `${n} outta 100`;
}
