/**
 * cme-holidays.ts — In-process CME full-closure date table (FIX 6, Track M).
 *
 * Used as an emergency fallback inside the paper-signal-service.ts outer calendar
 * catch block. When the Python calendar_filter subprocess fails, the Tier-1
 * event in-process checker (tier1-event-blackout.ts) handles economic event
 * blackouts. But neither covers holiday detection in the outer catch.
 *
 * This module provides a static table of CME full-closure dates 2026-2028
 * so the outer catch can BLOCK on holidays (fail-CLOSED) rather than fail-OPEN.
 * Non-holidays in the outer catch retain the current fail-OPEN behavior.
 *
 * Coverage: New Year's Day, MLK Day, Presidents' Day, Good Friday, Memorial Day,
 * Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas.
 * Observed dates are used when the holiday falls on a weekend (CME follows the
 * U.S. federal government observed holiday schedule).
 *
 * Correctness contract:
 *   - All dates are in ET calendar (America/New_York) in YYYY-MM-DD format.
 *   - Observed shifts: Saturday holidays → preceding Friday, Sunday → following Monday.
 *   - Good Friday dates are derived from the Gregorian Easter algorithm.
 *   - The table must be reviewed and extended before 2029-01-01.
 *
 * Import cycle: this file imports ONLY from ./logger.js (no DB, no services,
 * no other lib modules that could create a circular dependency).
 */

import { logger } from "./logger.js";

// ─── CME Full-Closure Dates 2026-2028 ─────────────────────────────────────────
// Key: "YYYY-MM-DD", Value: holiday name (for audit/log messages)
// Observed dates included where the holiday falls on a Saturday or Sunday.

const CME_FULL_CLOSURE_DATES: ReadonlyMap<string, string> = new Map([
  // ── 2026 ──────────────────────────────────────────────────────────────────
  ["2026-01-01", "New Year's Day"],
  ["2026-01-19", "Martin Luther King Jr. Day"],   // 3rd Monday of January
  ["2026-02-16", "Presidents' Day"],              // 3rd Monday of February
  ["2026-04-03", "Good Friday"],                  // Easter April 5
  ["2026-05-25", "Memorial Day"],                 // last Monday of May
  ["2026-06-19", "Juneteenth National Independence Day"],
  ["2026-07-03", "Independence Day (observed)"],  // July 4 is Saturday → Friday July 3
  ["2026-09-07", "Labor Day"],                    // 1st Monday of September
  ["2026-11-26", "Thanksgiving Day"],             // 4th Thursday of November
  ["2026-12-25", "Christmas Day"],

  // ── 2027 ──────────────────────────────────────────────────────────────────
  ["2027-01-01", "New Year's Day"],
  ["2027-01-18", "Martin Luther King Jr. Day"],   // 3rd Monday of January
  ["2027-02-15", "Presidents' Day"],              // 3rd Monday of February
  ["2027-03-26", "Good Friday"],                  // Easter March 28
  ["2027-05-31", "Memorial Day"],                 // last Monday of May
  ["2027-06-18", "Juneteenth (observed)"],        // June 19 is Saturday → Friday June 18
  ["2027-07-05", "Independence Day (observed)"],  // July 4 is Sunday → Monday July 5
  ["2027-09-06", "Labor Day"],                    // 1st Monday of September
  ["2027-11-25", "Thanksgiving Day"],             // 4th Thursday of November
  ["2027-12-24", "Christmas (observed)"],         // Dec 25 is Saturday → Friday Dec 24
  ["2027-12-31", "New Year's Day 2028 (observed)"], // Jan 1, 2028 is Saturday → Friday Dec 31

  // ── 2028 ──────────────────────────────────────────────────────────────────
  // Note: New Year's Day 2028 (Jan 1 = Saturday) is observed 2027-12-31 above.
  ["2028-01-17", "Martin Luther King Jr. Day"],   // 3rd Monday of January
  ["2028-02-21", "Presidents' Day"],              // 3rd Monday of February
  ["2028-04-14", "Good Friday"],                  // Easter April 16
  ["2028-05-29", "Memorial Day"],                 // last Monday of May
  ["2028-06-19", "Juneteenth National Independence Day"], // June 19 is Monday
  ["2028-07-04", "Independence Day"],             // July 4 is Tuesday
  ["2028-09-04", "Labor Day"],                    // 1st Monday of September (Sept 1 = Friday)
  ["2028-11-23", "Thanksgiving Day"],             // 4th Thursday of November
  ["2028-12-25", "Christmas Day"],                // Dec 25 is Monday
]);

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CmeHolidayCheckResult {
  isHoliday: boolean;
  holidayName: string | null;
  date: string;
}

/**
 * Check whether the given bar timestamp falls on a CME full-closure date.
 *
 * Extracts the ET calendar date from barTimestamp (UTC ISO-8601 string) and
 * looks it up in the static 2026-2028 table. Outside the table range, returns
 * isHoliday: false (conservative: missing dates are not false-positives).
 *
 * Called from the outer calendar catch block in paper-signal-service.ts when
 * the Python subprocess is unavailable. Do NOT use as the primary holiday gate
 * (that is getCachedSignalCalendarStatus → Python calendar_filter).
 */
export function checkCmeHolidayFallback(barTimestamp: string): CmeHolidayCheckResult {
  try {
    // Convert UTC timestamp to ET calendar date.
    // DST-aware: EDT = UTC-4, EST = UTC-5. We compute the ET date by checking
    // whether the UTC date falls in the EDT window (second Sunday of March through
    // first Sunday of November). For a simple date-only check, using a fixed
    // formatter is safer than manual math.
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
    const date = formatter.format(new Date(barTimestamp)); // returns "YYYY-MM-DD"
    const holidayName = CME_FULL_CLOSURE_DATES.get(date) ?? null;
    return { isHoliday: holidayName !== null, holidayName, date };
  } catch (err) {
    // Parsing failure → safe-default (not a holiday). Log so we know the
    // in-process check itself failed.
    logger.error(
      { err, barTimestamp },
      "cme-holidays: checkCmeHolidayFallback failed to parse timestamp — defaulting to non-holiday",
    );
    return { isHoliday: false, holidayName: null, date: "" };
  }
}

/**
 * Returns the full closure date table for testing and parity audits.
 * Exposed so test suites can verify coverage without re-enumerating dates.
 */
export function getCmeHolidayTable(): ReadonlyMap<string, string> {
  return CME_FULL_CLOSURE_DATES;
}
