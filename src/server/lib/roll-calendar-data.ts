/**
 * CME contract roll dates for paper trading roll spread cost computation.
 *
 * SYNC REQUIREMENT: This file mirrors src/engine/roll_calendar.py.
 * When adding new calendar years or correcting roll dates, update BOTH files.
 * Roll dates here are the CME roll day (the day trading switches to deferred
 * contract), NOT the flatten day (which is 1 business day prior in roll_calendar.py).
 *
 * Dates are authoritative: pre-computed by running roll_calendar.py for 2024-2026.
 * To regenerate/verify:
 *   python src/engine/roll_calendar.py  (action=get_next_roll_date)
 *   or run the inline Python used to generate this file:
 *     from src.engine.roll_calendar import _equity_quarterly_roll_day, _crude_roll_day, _gold_roll_day
 *
 * Spread estimates (USD per contract) represent the typical bid/ask spread cost
 * of rolling front-month -> back-month for retail traders. These are conservative
 * mid-market estimates; actual cost varies with liquidity conditions (~±30%).
 *
 * Standard estimates (retail-side, round-trip roll cost):
 *   ES  → $8/contract   (E-mini S&P 500, quarterly)
 *   MES → $2/contract   (Micro E-mini S&P 500, quarterly)
 *   NQ  → $10/contract  (E-mini Nasdaq-100, quarterly)
 *   MNQ → $3/contract   (Micro E-mini Nasdaq-100, quarterly)
 *   CL  → $15/contract  (Crude Oil, monthly)
 *   MCL → $4/contract   (Micro Crude Oil, monthly)
 *   GC  → $12/contract  (Gold, bi-monthly)
 */

export interface RollDate {
  /** ISO date string of the CME roll day. */
  roll_date: string;
  /** Estimated spread cost in USD per contract for this roll event. */
  spread_estimate: number;
}

/**
 * Roll date calendar keyed by root symbol (uppercase).
 * Micro symbols share roll schedule with full-size but have separate entries
 * so callers look up by the exact symbol the position uses.
 *
 * Roll conventions:
 *   Equity quarterly (ES, MES, NQ, MNQ): 2nd Thursday of Mar/Jun/Sep/Dec
 *   Crude monthly (CL, MCL): business day before the 25th of the delivery month
 *   Gold bi-monthly (GC): 5th-to-last business day of Feb/Apr/Jun/Aug/Oct/Dec
 */
export const rollCalendar: Record<string, RollDate[]> = {

  // ── ES: E-mini S&P 500, quarterly ────────────────────────────────────────
  ES: [
    { roll_date: "2024-03-14", spread_estimate: 8 },
    { roll_date: "2024-06-13", spread_estimate: 8 },
    { roll_date: "2024-09-12", spread_estimate: 8 },
    { roll_date: "2024-12-12", spread_estimate: 8 },
    { roll_date: "2025-03-13", spread_estimate: 8 },
    { roll_date: "2025-06-12", spread_estimate: 8 },
    { roll_date: "2025-09-11", spread_estimate: 8 },
    { roll_date: "2025-12-11", spread_estimate: 8 },
    { roll_date: "2026-03-12", spread_estimate: 8 },
    { roll_date: "2026-06-11", spread_estimate: 8 },
    { roll_date: "2026-09-10", spread_estimate: 8 },
    { roll_date: "2026-12-10", spread_estimate: 8 },
  ],

  // ── MES: Micro E-mini S&P 500, same roll dates as ES ─────────────────────
  MES: [
    { roll_date: "2024-03-14", spread_estimate: 2 },
    { roll_date: "2024-06-13", spread_estimate: 2 },
    { roll_date: "2024-09-12", spread_estimate: 2 },
    { roll_date: "2024-12-12", spread_estimate: 2 },
    { roll_date: "2025-03-13", spread_estimate: 2 },
    { roll_date: "2025-06-12", spread_estimate: 2 },
    { roll_date: "2025-09-11", spread_estimate: 2 },
    { roll_date: "2025-12-11", spread_estimate: 2 },
    { roll_date: "2026-03-12", spread_estimate: 2 },
    { roll_date: "2026-06-11", spread_estimate: 2 },
    { roll_date: "2026-09-10", spread_estimate: 2 },
    { roll_date: "2026-12-10", spread_estimate: 2 },
  ],

  // ── NQ: E-mini Nasdaq-100, quarterly ─────────────────────────────────────
  NQ: [
    { roll_date: "2024-03-14", spread_estimate: 10 },
    { roll_date: "2024-06-13", spread_estimate: 10 },
    { roll_date: "2024-09-12", spread_estimate: 10 },
    { roll_date: "2024-12-12", spread_estimate: 10 },
    { roll_date: "2025-03-13", spread_estimate: 10 },
    { roll_date: "2025-06-12", spread_estimate: 10 },
    { roll_date: "2025-09-11", spread_estimate: 10 },
    { roll_date: "2025-12-11", spread_estimate: 10 },
    { roll_date: "2026-03-12", spread_estimate: 10 },
    { roll_date: "2026-06-11", spread_estimate: 10 },
    { roll_date: "2026-09-10", spread_estimate: 10 },
    { roll_date: "2026-12-10", spread_estimate: 10 },
  ],

  // ── MNQ: Micro E-mini Nasdaq-100, same roll dates as NQ ──────────────────
  MNQ: [
    { roll_date: "2024-03-14", spread_estimate: 3 },
    { roll_date: "2024-06-13", spread_estimate: 3 },
    { roll_date: "2024-09-12", spread_estimate: 3 },
    { roll_date: "2024-12-12", spread_estimate: 3 },
    { roll_date: "2025-03-13", spread_estimate: 3 },
    { roll_date: "2025-06-12", spread_estimate: 3 },
    { roll_date: "2025-09-11", spread_estimate: 3 },
    { roll_date: "2025-12-11", spread_estimate: 3 },
    { roll_date: "2026-03-12", spread_estimate: 3 },
    { roll_date: "2026-06-11", spread_estimate: 3 },
    { roll_date: "2026-09-10", spread_estimate: 3 },
    { roll_date: "2026-12-10", spread_estimate: 3 },
  ],

  // ── CL: Crude Oil, monthly ────────────────────────────────────────────────
  // Roll day = business day before the 25th of the delivery month.
  CL: [
    // 2024
    { roll_date: "2024-01-24", spread_estimate: 15 },
    { roll_date: "2024-02-23", spread_estimate: 15 },
    { roll_date: "2024-03-22", spread_estimate: 15 },
    { roll_date: "2024-04-24", spread_estimate: 15 },
    { roll_date: "2024-05-24", spread_estimate: 15 },
    { roll_date: "2024-06-24", spread_estimate: 15 },
    { roll_date: "2024-07-24", spread_estimate: 15 },
    { roll_date: "2024-08-23", spread_estimate: 15 },
    { roll_date: "2024-09-24", spread_estimate: 15 },
    { roll_date: "2024-10-24", spread_estimate: 15 },
    { roll_date: "2024-11-22", spread_estimate: 15 },
    { roll_date: "2024-12-24", spread_estimate: 15 },
    // 2025
    { roll_date: "2025-01-24", spread_estimate: 15 },
    { roll_date: "2025-02-24", spread_estimate: 15 },
    { roll_date: "2025-03-24", spread_estimate: 15 },
    { roll_date: "2025-04-24", spread_estimate: 15 },
    { roll_date: "2025-05-23", spread_estimate: 15 },
    { roll_date: "2025-06-24", spread_estimate: 15 },
    { roll_date: "2025-07-24", spread_estimate: 15 },
    { roll_date: "2025-08-22", spread_estimate: 15 },
    { roll_date: "2025-09-24", spread_estimate: 15 },
    { roll_date: "2025-10-24", spread_estimate: 15 },
    { roll_date: "2025-11-24", spread_estimate: 15 },
    { roll_date: "2025-12-24", spread_estimate: 15 },
    // 2026
    { roll_date: "2026-01-23", spread_estimate: 15 },
    { roll_date: "2026-02-24", spread_estimate: 15 },
    { roll_date: "2026-03-24", spread_estimate: 15 },
    { roll_date: "2026-04-24", spread_estimate: 15 },
    { roll_date: "2026-05-22", spread_estimate: 15 },
    { roll_date: "2026-06-24", spread_estimate: 15 },
    { roll_date: "2026-07-24", spread_estimate: 15 },
    { roll_date: "2026-08-24", spread_estimate: 15 },
    { roll_date: "2026-09-24", spread_estimate: 15 },
    { roll_date: "2026-10-23", spread_estimate: 15 },
    { roll_date: "2026-11-24", spread_estimate: 15 },
    { roll_date: "2026-12-24", spread_estimate: 15 },
  ],

  // ── MCL: Micro Crude Oil, same roll dates as CL ───────────────────────────
  MCL: [
    // 2024
    { roll_date: "2024-01-24", spread_estimate: 4 },
    { roll_date: "2024-02-23", spread_estimate: 4 },
    { roll_date: "2024-03-22", spread_estimate: 4 },
    { roll_date: "2024-04-24", spread_estimate: 4 },
    { roll_date: "2024-05-24", spread_estimate: 4 },
    { roll_date: "2024-06-24", spread_estimate: 4 },
    { roll_date: "2024-07-24", spread_estimate: 4 },
    { roll_date: "2024-08-23", spread_estimate: 4 },
    { roll_date: "2024-09-24", spread_estimate: 4 },
    { roll_date: "2024-10-24", spread_estimate: 4 },
    { roll_date: "2024-11-22", spread_estimate: 4 },
    { roll_date: "2024-12-24", spread_estimate: 4 },
    // 2025
    { roll_date: "2025-01-24", spread_estimate: 4 },
    { roll_date: "2025-02-24", spread_estimate: 4 },
    { roll_date: "2025-03-24", spread_estimate: 4 },
    { roll_date: "2025-04-24", spread_estimate: 4 },
    { roll_date: "2025-05-23", spread_estimate: 4 },
    { roll_date: "2025-06-24", spread_estimate: 4 },
    { roll_date: "2025-07-24", spread_estimate: 4 },
    { roll_date: "2025-08-22", spread_estimate: 4 },
    { roll_date: "2025-09-24", spread_estimate: 4 },
    { roll_date: "2025-10-24", spread_estimate: 4 },
    { roll_date: "2025-11-24", spread_estimate: 4 },
    { roll_date: "2025-12-24", spread_estimate: 4 },
    // 2026
    { roll_date: "2026-01-23", spread_estimate: 4 },
    { roll_date: "2026-02-24", spread_estimate: 4 },
    { roll_date: "2026-03-24", spread_estimate: 4 },
    { roll_date: "2026-04-24", spread_estimate: 4 },
    { roll_date: "2026-05-22", spread_estimate: 4 },
    { roll_date: "2026-06-24", spread_estimate: 4 },
    { roll_date: "2026-07-24", spread_estimate: 4 },
    { roll_date: "2026-08-24", spread_estimate: 4 },
    { roll_date: "2026-09-24", spread_estimate: 4 },
    { roll_date: "2026-10-23", spread_estimate: 4 },
    { roll_date: "2026-11-24", spread_estimate: 4 },
    { roll_date: "2026-12-24", spread_estimate: 4 },
  ],

  // ── GC: Gold, bi-monthly (delivery months: Feb/Apr/Jun/Aug/Oct/Dec) ──────
  // Roll day = 5th-to-last business day of delivery month.
  GC: [
    // 2024
    { roll_date: "2024-02-23", spread_estimate: 12 },
    { roll_date: "2024-04-24", spread_estimate: 12 },
    { roll_date: "2024-06-24", spread_estimate: 12 },
    { roll_date: "2024-08-26", spread_estimate: 12 },
    { roll_date: "2024-10-25", spread_estimate: 12 },
    { roll_date: "2024-12-25", spread_estimate: 12 },
    // 2025
    { roll_date: "2025-02-24", spread_estimate: 12 },
    { roll_date: "2025-04-24", spread_estimate: 12 },
    { roll_date: "2025-06-24", spread_estimate: 12 },
    { roll_date: "2025-08-25", spread_estimate: 12 },
    { roll_date: "2025-10-27", spread_estimate: 12 },
    { roll_date: "2025-12-25", spread_estimate: 12 },
    // 2026
    { roll_date: "2026-02-23", spread_estimate: 12 },
    { roll_date: "2026-04-24", spread_estimate: 12 },
    { roll_date: "2026-06-24", spread_estimate: 12 },
    { roll_date: "2026-08-25", spread_estimate: 12 },
    { roll_date: "2026-10-26", spread_estimate: 12 },
    { roll_date: "2026-12-25", spread_estimate: 12 },
  ],
};
