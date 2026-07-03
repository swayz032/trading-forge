/**
 * price-lock-limit-gate.ts — Topstep Prohibited Conduct: no position within 2% of a
 * product's price-lock (daily price) limit.
 *
 * CME products have daily price limits relative to the prior settlement. Equity-index
 * futures lock/halt at ±7% (Globex/Level-1), then 13%, then 20% (hard lock). Topstep
 * prohibits HOLDING a position within 2% of the price-lock limit. This is DISTINCT from
 * the MFFU "2% account loss per trade" rule — this is 2% of the PRODUCT'S limit price.
 *
 * Pure function. The reference (prior settlement) is supplied by the caller (pre-market /
 * market data). When the reference is unavailable we FAIL-OPEN (allow + log): intraday
 * structural trades are essentially never within 2% of a ±7% limit, so a missing reference
 * must not halt all trading. The firm's own price-limit lock is the hard backstop.
 */

/**
 * First binding daily price-limit percentage by underlying (fraction of settlement).
 * Equity index = 0.07 (the Globex / Level-1 limit — the conservative, first-binding one).
 * Energy/metals limits vary and expand dynamically; 0.07 is a conservative default and is
 * env-overridable per underlying via PRICE_LOCK_LIMIT_PCT_<UNDERLYING>.
 */
const DEFAULT_LIMIT_PCT: Record<string, number> = {
  ES: 0.07,
  NQ: 0.07,
  RTY: 0.07,
  YM: 0.07,
  CL: 0.07,
  NG: 0.07,
  GC: 0.07,
  SI: 0.07,
};

/**
 * The proximity band: "within 2% of the limit price" → block (Topstep Prohibited Conduct).
 * Env-overridable via `PRICE_LOCK_PROXIMITY_PCT`; the value must be a fraction in (0,1).
 * Invalid input (NaN / ≤0 / ≥1) falls back to the 0.02 default — behavior unchanged
 * unless an operator sets a valid override.
 */
export const PRICE_LOCK_PROXIMITY_PCT = ((): number => {
  const raw = process.env.PRICE_LOCK_PROXIMITY_PCT;
  if (raw !== undefined) {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0 && v < 1) return v;
  }
  return 0.02;
})();

function limitPctFor(underlying: string): number {
  const envKey = `PRICE_LOCK_LIMIT_PCT_${underlying}`;
  const raw = process.env[envKey];
  if (raw !== undefined) {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0 && v < 1) return v;
  }
  return DEFAULT_LIMIT_PCT[underlying] ?? 0.07;
}

export interface PriceLockResult {
  blocked: boolean;
  reason?: "near_up_limit" | "near_down_limit" | "no_reference";
  limitUp?: number;
  limitDown?: number;
  /**
   * deepscan14 D2: true when this result reflects a fail-open with NO settlement
   * feed to check against (reason="no_reference") — i.e. the gate did not evaluate
   * anything. `blocked=false` alone is ambiguous with "checked, price is clear";
   * `inactive=true` disambiguates it as "nothing was checked." Absent/false on
   * every other branch = a real evaluation happened.
   */
  inactive?: boolean;
}

/**
 * Is `currentPrice` within PRICE_LOCK_PROXIMITY_PCT of the product's daily price limit
 * (computed from `referenceSettlement`)? Returns blocked=true when the price is within 2%
 * (of the price) of either the up- or down-limit.
 *
 * @param underlying       underlying root (ES/NQ/CL/...) — use symbolToUnderlying()
 * @param currentPrice     current/last price
 * @param referenceSettlement  prior-session settlement (the daily-limit reference); null/0 → fail-open
 */
export function checkPriceLockLimit(
  underlying: string,
  currentPrice: number,
  referenceSettlement: number | null | undefined,
): PriceLockResult {
  if (
    !referenceSettlement ||
    !Number.isFinite(referenceSettlement) ||
    referenceSettlement <= 0 ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return { blocked: false, reason: "no_reference", inactive: true }; // fail-open, gate INACTIVE
  }
  const pct = limitPctFor((underlying || "").toUpperCase());
  const limitUp = referenceSettlement * (1 + pct);
  const limitDown = referenceSettlement * (1 - pct);

  // Within 2% (of current price) of the up-limit → too close to the lock.
  // The `* 1.001` / `* 0.999` factors are a 0.1% float-comparison tolerance: they let a
  // price sitting AT (or a rounding-hair past) the computed limit still count as "near"
  // despite floating-point error in `referenceSettlement * (1 ± pct)`, without admitting
  // prices that are genuinely well beyond the limit. 0.1% is small relative to the 2% band.
  if (limitUp - currentPrice <= currentPrice * PRICE_LOCK_PROXIMITY_PCT && currentPrice <= limitUp * 1.001) {
    return { blocked: true, reason: "near_up_limit", limitUp, limitDown };
  }
  if (currentPrice - limitDown <= currentPrice * PRICE_LOCK_PROXIMITY_PCT && currentPrice >= limitDown * 0.999) {
    return { blocked: true, reason: "near_down_limit", limitUp, limitDown };
  }
  return { blocked: false, limitUp, limitDown };
}
