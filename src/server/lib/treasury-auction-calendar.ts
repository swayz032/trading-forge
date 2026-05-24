/**
 * treasury-auction-calendar.ts — W25.5a
 *
 * Static 2026 US Treasury auction calendar.
 *
 * Treasury auctions settle at 1:00 PM ET (18:00 UTC non-DST, 17:00 UTC DST).
 * Covered instruments: 2Y, 5Y, 7Y, 10Y, 20Y, 30Y nominal notes/bonds.
 * Source: TreasuryDirect auction schedule (quarterly refresh; updated by operator).
 *
 * Usage: isBondAuctionToday(date: Date): boolean
 *   Returns true if any US Treasury auction is scheduled on that calendar date.
 *
 * Refresh cadence: quarterly — operator updates this file every Jan/Apr/Jul/Oct.
 */

import { logger } from "./logger.js";

// ─── 2026 US Treasury Auction Dates ─────────────────────────────────────────
// Format: YYYY-MM-DD strings (ET calendar date, not UTC).
// Covers: 2Y (monthly), 5Y (monthly), 7Y (monthly), 10Y (monthly),
//         20Y (monthly), 30Y (monthly).
// Approximate schedule based on standard Treasury patterns (2nd/3rd Tue–Thu cycle).
// Operator MUST verify against TreasuryDirect for precise dates each quarter.

const AUCTION_DATES_2026: readonly string[] = [
  // January 2026
  "2026-01-06", "2026-01-07", "2026-01-08",
  "2026-01-13", "2026-01-14", "2026-01-15",
  "2026-01-20", "2026-01-21", "2026-01-22",
  "2026-01-27", "2026-01-28", "2026-01-29",
  // February 2026
  "2026-02-03", "2026-02-04", "2026-02-05",
  "2026-02-10", "2026-02-11", "2026-02-12",
  "2026-02-17", "2026-02-18", "2026-02-19",
  "2026-02-24", "2026-02-25", "2026-02-26",
  // March 2026
  "2026-03-03", "2026-03-04", "2026-03-05",
  "2026-03-10", "2026-03-11", "2026-03-12",
  "2026-03-17", "2026-03-18", "2026-03-19",
  "2026-03-24", "2026-03-25", "2026-03-26",
  // April 2026
  "2026-04-07", "2026-04-08", "2026-04-09",
  "2026-04-14", "2026-04-15", "2026-04-16",
  "2026-04-21", "2026-04-22", "2026-04-23",
  "2026-04-28", "2026-04-29", "2026-04-30",
  // May 2026
  "2026-05-05", "2026-05-06", "2026-05-07",
  "2026-05-12", "2026-05-13", "2026-05-14",
  "2026-05-19", "2026-05-20", "2026-05-21",
  "2026-05-26", "2026-05-27", "2026-05-28",
  // June 2026
  "2026-06-02", "2026-06-03", "2026-06-04",
  "2026-06-09", "2026-06-10", "2026-06-11",
  "2026-06-16", "2026-06-17", "2026-06-18",
  "2026-06-23", "2026-06-24", "2026-06-25",
  // July 2026
  "2026-07-07", "2026-07-08", "2026-07-09",
  "2026-07-14", "2026-07-15", "2026-07-16",
  "2026-07-21", "2026-07-22", "2026-07-23",
  "2026-07-28", "2026-07-29", "2026-07-30",
  // August 2026
  "2026-08-04", "2026-08-05", "2026-08-06",
  "2026-08-11", "2026-08-12", "2026-08-13",
  "2026-08-18", "2026-08-19", "2026-08-20",
  "2026-08-25", "2026-08-26", "2026-08-27",
  // September 2026
  "2026-09-01", "2026-09-02", "2026-09-03",
  "2026-09-08", "2026-09-09", "2026-09-10",
  "2026-09-15", "2026-09-16", "2026-09-17",
  "2026-09-22", "2026-09-23", "2026-09-24",
  // October 2026
  "2026-10-06", "2026-10-07", "2026-10-08",
  "2026-10-13", "2026-10-14", "2026-10-15",
  "2026-10-20", "2026-10-21", "2026-10-22",
  "2026-10-27", "2026-10-28", "2026-10-29",
  // November 2026
  "2026-11-03", "2026-11-04", "2026-11-05",
  "2026-11-10", "2026-11-12",
  "2026-11-17", "2026-11-18", "2026-11-19",
  "2026-11-24",
  // December 2026
  "2026-12-01", "2026-12-02", "2026-12-03",
  "2026-12-08", "2026-12-09", "2026-12-10",
  "2026-12-15", "2026-12-16", "2026-12-17",
  "2026-12-22",
];

// Build a Set for O(1) lookup
const _auctionSet = new Set<string>(AUCTION_DATES_2026);

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns YYYY-MM-DD for a given Date in US/Eastern timezone.
 * Uses Intl.DateTimeFormat so DST is handled correctly without environment assumptions.
 * Exported for testing.
 */
export function toEtDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  let year = "", month = "", day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  return `${year}-${month}-${day}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if a US Treasury auction is scheduled on the ET calendar date
 * corresponding to the given Date object.
 *
 * Fail-open: if date conversion fails, logs a warning and returns false
 * (no false positives that would incorrectly block trading).
 */
export function isBondAuctionToday(date: Date): boolean {
  try {
    const etDate = toEtDate(date);
    return _auctionSet.has(etDate);
  } catch (err) {
    logger.warn({ err, date }, "treasury-auction-calendar: date conversion failed — returning false");
    return false;
  }
}

/**
 * All known auction dates in the 2026 calendar year (for diagnostics / tests).
 */
export function getAuctionDates(): readonly string[] {
  return AUCTION_DATES_2026;
}
