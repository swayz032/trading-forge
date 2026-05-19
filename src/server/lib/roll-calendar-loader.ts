/**
 * Roll spread cost computation for paper trading closes.
 *
 * When a paper position holds across one or more CME contract roll dates,
 * the position effectively rides from the front-month contract into the
 * back-month contract. In live trading this incurs a calendar spread cost
 * (the bid/ask spread on the roll trade). This module deducts that cost
 * from net P&L at close time so paper results are not systematically
 * overstated versus real-money trading.
 *
 * Parity note (backtest vs paper):
 *   Backtest uses ratio-adjusted continuous contracts — no roll discontinuity.
 *   Paper uses actual CME contracts — positions that cross a roll date pay
 *   this spread cost. The cost is applied at close, not at the roll date,
 *   because the position is held through the roll (not flattened by the
 *   roll handler). This is a known paper/backtest parity gap; this module
 *   closes it on the paper side.
 *
 * Data source: src/server/lib/roll-calendar-data.ts (option A — TypeScript
 * mirror of roll_calendar.py). Chosen over subprocess invocation to avoid
 * per-close latency. Both files must be kept in sync when extending years.
 */

import { rollCalendar } from "./roll-calendar-data.js";

export interface RollSpreadCost {
  /** Number of contracts that were rolled (same as abs(contracts)). */
  contractsRolled: number;
  /** Total estimated spread cost in USD. 0 if no rolls crossed. */
  estimatedSpreadCost: number;
  /** ISO date strings of every roll date crossed during the hold window. */
  rollDates: string[];
}

/**
 * Compute roll spread cost for a paper position held from entryTime to exitTime.
 *
 * A roll date is considered "crossed" if it is strictly AFTER entryTime and
 * on or before exitTime (entryTime < roll_date <= exitTime). The boundary
 * condition: if a position opens on a roll date, it is already on the new
 * contract and pays no roll cost. If it closes on a roll date, it did hold
 * through the roll and pays the spread.
 *
 * Returns zero cost when:
 *   - symbol has no calendar entry (unknown symbol)
 *   - no roll dates fall within the hold window
 *   - contracts is 0 (defensive — should not occur in normal operation)
 *
 * @param symbol    Root futures symbol, e.g. "MES", "CL", "GC"
 * @param contracts Number of contracts (signed or unsigned — abs() is used)
 * @param entryTime Position open time (UTC)
 * @param exitTime  Position close time (UTC)
 */
export function computeRollSpreadCost(
  symbol: string,
  contracts: number,
  entryTime: Date,
  exitTime: Date,
): RollSpreadCost {
  const symbolRolls = rollCalendar[symbol.toUpperCase()];
  if (!symbolRolls || symbolRolls.length === 0) {
    return { contractsRolled: 0, estimatedSpreadCost: 0, rollDates: [] };
  }

  // Compare on date boundaries using midnight UTC of each roll_date string.
  // This avoids timezone ambiguity: roll dates are calendar dates, not instants.
  // A position that opens intraday on 2026-03-10 and closes intraday on 2026-03-12
  // crossed the 2026-03-12 roll → pays the spread. A position that opens on
  // 2026-03-12 after the roll is already on the new contract → no spread paid.
  const crossedRolls = symbolRolls.filter((r) => {
    // Parse roll_date as midnight UTC so numeric comparisons are unambiguous.
    const rollMs = Date.parse(r.roll_date + "T00:00:00Z");
    return entryTime.getTime() < rollMs && rollMs <= exitTime.getTime();
  });

  if (crossedRolls.length === 0) {
    return { contractsRolled: 0, estimatedSpreadCost: 0, rollDates: [] };
  }

  const contractsAbs = Math.abs(contracts);
  const totalSpread = crossedRolls.reduce((sum, r) => sum + r.spread_estimate, 0);

  return {
    contractsRolled: contractsAbs,
    estimatedSpreadCost: totalSpread * contractsAbs,
    rollDates: crossedRolls.map((r) => r.roll_date),
  };
}
