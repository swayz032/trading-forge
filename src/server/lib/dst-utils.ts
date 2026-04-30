/**
 * Shared US DST helpers used by paper-execution-service, paper-risk-gate,
 * and paper-signal-service.
 *
 * Canonical implementation: matches paper-risk-gate.ts (the correct one).
 * US DST: second Sunday of March (2:00 AM ET = 7:00 AM UTC)
 *      through first Sunday of November (2:00 AM ET = 6:00 AM UTC, still EDT).
 *
 * - EDT = UTC-4  (-240 min)
 * - EST = UTC-5  (-300 min)
 *
 * DST end corner case: when November 1 is itself a Sunday, firstSunNov = 1 + 0 = 1
 * (i.e., Nov 1 is the DST end day).  The buggy ternary `novSunday1 === 0 ? 7 :
 * novSunday1` that existed in paper-execution-service.ts forced this to Nov 8 instead.
 * The formula `1 + (7 - nov1Day) % 7` is correct and needs no guard.
 *
 * Verification (DST-end edge cases):
 *   Nov  1 2026 (Sunday)  → firstSunNov = 1 + (7-0)%7 = 1 + 0 = 1  → Nov  1  ✓
 *   Nov  1 2027 (Monday)  → firstSunNov = 1 + (7-1)%7 = 1 + 6 = 7  → Nov  7  ✓
 *   Nov  7 2021 (Sunday)  → firstSunNov = 1 + (7-0)%7 = 1 + 0 = 1? NO:
 *     nov1 = Nov 1 2021 = Monday (day 1) → firstSunNov = 1+6 = 7 → Nov 7 ✓
 *
 * Verification (DST-start edge cases):
 *   Mar  8 2026 (Sunday)  → marSun2 = 1 + (7-0)%7 + 7 = 1+0+7 = 8  → Mar  8  ✓
 *   Mar  1 2026 (Sunday)  → for year 2026 Mar 1 is Sunday, so marSun2 = 8 → Mar  8  ✓
 */

/**
 * Return true if the given UTC Date falls within US DST.
 * Second Sunday of March at 07:00 UTC (= 2:00 AM ET still in EST)
 * through first Sunday of November at 06:00 UTC (= 2:00 AM ET still in EDT).
 */
export function isUsDst(date: Date): boolean {
  const year = date.getUTCFullYear();

  // Second Sunday of March: find first Sunday in March, add 7 days
  const mar1 = new Date(Date.UTC(year, 2, 1)); // March 1
  const mar1Day = mar1.getUTCDay(); // 0=Sun
  const secondSunMar = 1 + (7 - mar1Day) % 7 + 7; // day-of-month of second Sunday
  const dstStart = new Date(Date.UTC(year, 2, secondSunMar, 7, 0)); // 2AM ET = 7AM UTC (still EST)

  // First Sunday of November
  const nov1 = new Date(Date.UTC(year, 10, 1)); // Nov 1
  const nov1Day = nov1.getUTCDay(); // 0=Sun
  const firstSunNov = 1 + (7 - nov1Day) % 7;   // no ternary guard: 0 → first Sunday IS Nov 1
  const dstEnd = new Date(Date.UTC(year, 10, firstSunNov, 6, 0)); // 2AM ET = 6AM UTC (still EDT)

  return date >= dstStart && date < dstEnd;
}

/**
 * Return the ET UTC offset in minutes.
 *   EDT (DST active) → -240 min
 *   EST (standard)   → -300 min
 */
export function getEtOffsetMinutes(date: Date): number {
  return isUsDst(date) ? -240 : -300;
}
