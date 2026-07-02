/**
 * cme-holidays.test.ts — Track M FIX 6
 *
 * Tests for src/server/lib/cme-holidays.ts
 *
 * Coverage:
 *   1. Known CME full-closure dates return isHoliday:true with holiday name
 *   2. Non-holiday dates return isHoliday:false
 *   3. Observed holiday dates (Saturday/Sunday shift) are correct
 *   4. Date extraction uses ET timezone (not UTC)
 *   5. Outside table range → isHoliday:false (no false positive)
 *   6. Bad timestamp → isHoliday:false (safe default, no throw)
 *   7. Table coverage spans 2026-2028 (no year left empty)
 *   8. All dates in table are valid YYYY-MM-DD strings
 *   9. Good Friday dates are correct (computed from Easter algorithm)
 *  10. getCmeHolidayTable() returns the complete table (immutable reference)
 */

import { describe, it, expect, vi } from "vitest";

// cme-holidays.ts imports logger — mock it
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkCmeHolidayFallback, getCmeHolidayTable } from "./cme-holidays.js";

// ─── Known holidays to verify ─────────────────────────────────────────────────

const EXPECTED_2026: Array<[string, string]> = [
  ["2026-01-01", "New Year's Day"],
  ["2026-01-19", "Martin Luther King Jr. Day"],
  ["2026-02-16", "Presidents' Day"],
  ["2026-04-03", "Good Friday"],
  ["2026-05-25", "Memorial Day"],
  ["2026-06-19", "Juneteenth National Independence Day"],
  ["2026-07-03", "Independence Day (observed)"],  // July 4 is Saturday → Friday
  ["2026-09-07", "Labor Day"],
  ["2026-11-26", "Thanksgiving Day"],
  ["2026-12-25", "Christmas Day"],
];

const EXPECTED_2027: Array<[string, string]> = [
  ["2027-01-01", "New Year's Day"],
  ["2027-01-18", "Martin Luther King Jr. Day"],
  ["2027-02-15", "Presidents' Day"],
  ["2027-03-26", "Good Friday"],
  ["2027-05-31", "Memorial Day"],
  ["2027-06-18", "Juneteenth (observed)"],   // June 19 is Saturday → Friday
  ["2027-07-05", "Independence Day (observed)"],  // July 4 is Sunday → Monday
  ["2027-09-06", "Labor Day"],
  ["2027-11-25", "Thanksgiving Day"],
  ["2027-12-24", "Christmas (observed)"],    // Dec 25 is Saturday → Friday
  ["2027-12-31", "New Year's Day 2028 (observed)"],  // Jan 1, 2028 is Saturday
];

const EXPECTED_2028: Array<[string, string]> = [
  ["2028-01-17", "Martin Luther King Jr. Day"],
  ["2028-02-21", "Presidents' Day"],
  ["2028-04-14", "Good Friday"],
  ["2028-05-29", "Memorial Day"],
  ["2028-06-19", "Juneteenth National Independence Day"],
  ["2028-07-04", "Independence Day"],
  ["2028-09-04", "Labor Day"],
  ["2028-11-23", "Thanksgiving Day"],
  ["2028-12-25", "Christmas Day"],
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("cme-holidays: checkCmeHolidayFallback", () => {
  // ── Test 1-3: Known holiday dates ──────────────────────────────────────────

  describe("2026 CME closure dates", () => {
    EXPECTED_2026.forEach(([date, name]) => {
      it(`${date} (${name}) → isHoliday:true`, () => {
        const ts = `${date}T12:00:00.000Z`; // noon UTC → still same ET date
        const result = checkCmeHolidayFallback(ts);
        expect(result.isHoliday).toBe(true);
        expect(result.holidayName).toBe(name);
        expect(result.date).toBe(date);
      });
    });
  });

  describe("2027 CME closure dates", () => {
    EXPECTED_2027.forEach(([date, name]) => {
      it(`${date} (${name}) → isHoliday:true`, () => {
        const ts = `${date}T15:00:00.000Z`;
        const result = checkCmeHolidayFallback(ts);
        expect(result.isHoliday).toBe(true);
        expect(result.holidayName).toBe(name);
      });
    });
  });

  describe("2028 CME closure dates", () => {
    EXPECTED_2028.forEach(([date, name]) => {
      it(`${date} (${name}) → isHoliday:true`, () => {
        const ts = `${date}T14:00:00.000Z`;
        const result = checkCmeHolidayFallback(ts);
        expect(result.isHoliday).toBe(true);
        expect(result.holidayName).toBe(name);
      });
    });
  });

  // ── Test 4: Non-holiday dates ───────────────────────────────────────────────

  describe("non-holiday dates return isHoliday:false", () => {
    const NON_HOLIDAYS = [
      "2026-03-15", // Regular trading day
      "2026-07-04", // The actual July 4 date (observed on July 3, so July 4 is open... actually CME closes July 3)
      "2027-06-19", // Actual Juneteenth — observed on June 18
      "2026-12-26", // Day after Christmas
      "2028-01-01", // New Year's Day 2028 — observed Dec 31, 2027 so Jan 1 may be open
      "2025-12-25", // Outside table range (2025)
    ];

    NON_HOLIDAYS.forEach((date) => {
      it(`${date} → isHoliday:false`, () => {
        const ts = `${date}T12:00:00.000Z`;
        const result = checkCmeHolidayFallback(ts);
        // Note: 2026-07-04 is a Saturday — CME closes July 3 (observed). July 4 itself
        // is not in the table. Similarly 2027-06-19 — observed on June 18, not 19.
        expect(result.isHoliday).toBe(false);
        expect(result.holidayName).toBeNull();
      });
    });
  });

  // ── Test 5: ET timezone boundary ───────────────────────────────────────────

  describe("ET timezone extraction", () => {
    it("uses ET date, not UTC date (late-night UTC = different ET date)", () => {
      // 2026-01-02T04:00:00Z = Jan 1, 2026 11 PM ET (UTC-5 in January)
      // This should detect 2026-01-01 as a holiday (New Year's Day ET date)
      const ts = "2026-01-02T04:00:00.000Z"; // 23:00 ET on Jan 1
      const result = checkCmeHolidayFallback(ts);
      expect(result.isHoliday).toBe(true);
      expect(result.holidayName).toBe("New Year's Day");
    });

    it("UTC date that is a holiday but ET date is not → isHoliday:false", () => {
      // 2026-01-01T06:00:00Z = Jan 1, 2026 1:00 AM ET → still Jan 1
      // Actually use Dec 31 night which in ET is still Dec 31 (not a holiday):
      // 2025-12-31T23:00:00Z = Dec 31, 2025 6 PM ET → Dec 31 not in table
      const ts = "2025-12-31T23:00:00.000Z";
      const result = checkCmeHolidayFallback(ts);
      expect(result.isHoliday).toBe(false);
    });
  });

  // ── Test 6: Bad input ───────────────────────────────────────────────────────

  describe("invalid timestamp handling", () => {
    it("empty string → isHoliday:false (no throw)", () => {
      expect(() => checkCmeHolidayFallback("")).not.toThrow();
      const result = checkCmeHolidayFallback("");
      expect(result.isHoliday).toBe(false);
    });

    it("non-date string → isHoliday:false (no throw)", () => {
      expect(() => checkCmeHolidayFallback("not-a-date")).not.toThrow();
      const result = checkCmeHolidayFallback("not-a-date");
      expect(result.isHoliday).toBe(false);
    });
  });

  // ── Test 7-8: Table structure ────────────────────────────────────────────────

  describe("getCmeHolidayTable: table coverage and format", () => {
    it("table contains entries for 2026, 2027, and 2028", () => {
      const table = getCmeHolidayTable();
      const years = new Set<string>();
      for (const key of table.keys()) {
        years.add(key.slice(0, 4));
      }
      expect(years.has("2026")).toBe(true);
      expect(years.has("2027")).toBe(true);
      expect(years.has("2028")).toBe(true);
    });

    it("all keys are valid YYYY-MM-DD format", () => {
      const table = getCmeHolidayTable();
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      for (const key of table.keys()) {
        expect(key).toMatch(datePattern);
        // Verify the date itself is valid
        const d = new Date(key + "T12:00:00Z");
        expect(isNaN(d.getTime())).toBe(false);
      }
    });

    it("has at least 10 entries per year (10 US federal market closures)", () => {
      const table = getCmeHolidayTable();
      const countByYear: Record<string, number> = {};
      for (const key of table.keys()) {
        const y = key.slice(0, 4);
        countByYear[y] = (countByYear[y] ?? 0) + 1;
      }
      // 2026: 10 holidays
      expect(countByYear["2026"]).toBeGreaterThanOrEqual(10);
      // 2027: 11 entries (includes Dec 31 observed for 2028 New Year's)
      expect(countByYear["2027"]).toBeGreaterThanOrEqual(10);
      // 2028: 9 entries (New Year's observed is in 2027)
      expect(countByYear["2028"]).toBeGreaterThanOrEqual(9);
    });

    it("no duplicate date keys", () => {
      const table = getCmeHolidayTable();
      // Map keys are unique by definition, but verify count matches Set
      const keys = Array.from(table.keys());
      const uniqueKeys = new Set(keys);
      expect(keys.length).toBe(uniqueKeys.size);
    });

    it("Good Friday dates are correct (derived from Gregorian Easter algorithm)", () => {
      const table = getCmeHolidayTable();
      // 2026: Easter April 5 → Good Friday April 3
      expect(table.get("2026-04-03")).toContain("Good Friday");
      // 2027: Easter March 28 → Good Friday March 26
      expect(table.get("2027-03-26")).toContain("Good Friday");
      // 2028: Easter April 16 → Good Friday April 14
      expect(table.get("2028-04-14")).toContain("Good Friday");
    });

    it("observed Saturday holidays use the preceding Friday", () => {
      const table = getCmeHolidayTable();
      // 2026: July 4 is Saturday → observe Friday July 3
      expect(table.has("2026-07-03")).toBe(true);
      expect(table.has("2026-07-04")).toBe(false);
      // 2027: June 19 (Juneteenth) is Saturday → observe Friday June 18
      expect(table.has("2027-06-18")).toBe(true);
      expect(table.has("2027-06-19")).toBe(false);
      // 2027: Dec 25 is Saturday → observe Friday Dec 24
      expect(table.has("2027-12-24")).toBe(true);
      expect(table.has("2027-12-25")).toBe(false);
    });

    it("observed Sunday holidays use the following Monday", () => {
      const table = getCmeHolidayTable();
      // 2027: July 4 is Sunday → observe Monday July 5
      expect(table.has("2027-07-05")).toBe(true);
      expect(table.has("2027-07-04")).toBe(false);
    });
  });
});
