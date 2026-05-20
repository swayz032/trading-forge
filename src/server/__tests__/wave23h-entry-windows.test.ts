/**
 * wave23h-entry-windows.test.ts — W23H.3
 *
 * Tests for the entry-windows.ts parser and checker.
 *
 * Coverage:
 *  1.  Parser: "09:45-12:00 ET" → {start:585, end:720, tz:"America/New_York"}
 *  2.  Parser: "13:30-15:30 ET" → {start:810, end:930, tz:"America/New_York"}
 *  3.  Parser: "09:00-17:00 UTC" → {start:540, end:1020, tz:"UTC"}
 *  4.  Parser: shorthand resolution (ET/PT/CT/MT)
 *  5.  Parser: IANA passthrough ("America/Chicago")
 *  6.  Parser: malformed — "09:60-12:00 ET" throws (minute out of range)
 *  7.  Parser: malformed — "9-12 ET" throws (missing colon)
 *  8.  Parser: malformed — "09:45-12:00" throws (missing TZ)
 *  9.  Parser: malformed — end ≤ start throws
 *  10. Parser: malformed — bad hour throws
 *  11. Parser: unknown timezone throws
 *  12. isBarInWindow: bar at 10:00 ET → inside "09:45-12:00 ET" window
 *  13. isBarInWindow: bar at 09:30 ET → outside "09:45-12:00 ET" window
 *  14. isBarInWindow: bar at 12:00 ET → outside (right-exclusive boundary)
 *  15. isBarInWindow: bar at 09:45 ET → inside (left-inclusive boundary)
 *  16. isBarInAnyWindow: empty array → false
 *  17. isBarInAnyWindow: multi-window — bar at 14:00 ET in "13:30-15:30 ET" → true
 *  18. isBarInAnyWindow: bar between two windows (12:15 ET) → false
 *  19. parseEntryWindows: empty/null → []
 *  20. DST handling: bar during summer (EDT) and winter (EST) still resolves correctly
 *
 * Pure function tests — no DB, no network, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  parseEntryWindow,
  parseEntryWindows,
  isBarInWindow,
  isBarInAnyWindow,
  type EntryWindow,
} from "../lib/entry-windows.js";

// ─── Parser tests ─────────────────────────────────────────────────────────────

describe("parseEntryWindow — valid specs", () => {
  it('parses "09:45-12:00 ET" correctly', () => {
    const w = parseEntryWindow("09:45-12:00 ET");
    expect(w.startMinutesOfDay).toBe(9 * 60 + 45);  // 585
    expect(w.endMinutesOfDay).toBe(12 * 60);          // 720
    expect(w.timezone).toBe("America/New_York");
    expect(w.spec).toBe("09:45-12:00 ET");
  });

  it('parses "13:30-15:30 ET" correctly', () => {
    const w = parseEntryWindow("13:30-15:30 ET");
    expect(w.startMinutesOfDay).toBe(13 * 60 + 30);  // 810
    expect(w.endMinutesOfDay).toBe(15 * 60 + 30);     // 930
    expect(w.timezone).toBe("America/New_York");
  });

  it('parses "09:00-17:00 UTC" correctly', () => {
    const w = parseEntryWindow("09:00-17:00 UTC");
    expect(w.startMinutesOfDay).toBe(9 * 60);    // 540
    expect(w.endMinutesOfDay).toBe(17 * 60);     // 1020
    expect(w.timezone).toBe("UTC");
  });

  it("resolves ET shorthand to America/New_York", () => {
    expect(parseEntryWindow("09:00-10:00 ET").timezone).toBe("America/New_York");
  });

  it("resolves PT shorthand to America/Los_Angeles", () => {
    expect(parseEntryWindow("09:00-10:00 PT").timezone).toBe("America/Los_Angeles");
  });

  it("resolves CT shorthand to America/Chicago", () => {
    expect(parseEntryWindow("09:00-10:00 CT").timezone).toBe("America/Chicago");
  });

  it("resolves MT shorthand to America/Denver", () => {
    expect(parseEntryWindow("09:00-10:00 MT").timezone).toBe("America/Denver");
  });

  it("passes IANA name through unchanged", () => {
    const w = parseEntryWindow("09:30-16:00 America/Chicago");
    expect(w.timezone).toBe("America/Chicago");
    expect(w.startMinutesOfDay).toBe(9 * 60 + 30);
    expect(w.endMinutesOfDay).toBe(16 * 60);
  });

  it("handles leading/trailing whitespace", () => {
    const w = parseEntryWindow("  09:45-12:00 ET  ");
    expect(w.startMinutesOfDay).toBe(585);
    expect(w.timezone).toBe("America/New_York");
  });

  it("handles midnight-adjacent times (00:00, 23:59)", () => {
    const w = parseEntryWindow("00:00-23:59 UTC");
    expect(w.startMinutesOfDay).toBe(0);
    expect(w.endMinutesOfDay).toBe(23 * 60 + 59);
  });
});

describe("parseEntryWindow — malformed specs", () => {
  it("throws on minute 60 (out of range)", () => {
    expect(() => parseEntryWindow("09:60-12:00 ET")).toThrow();
  });

  it("throws on missing colon separator (9-12 ET)", () => {
    expect(() => parseEntryWindow("9-12 ET")).toThrow();
  });

  it("throws on missing timezone", () => {
    expect(() => parseEntryWindow("09:45-12:00")).toThrow();
  });

  it("throws when end <= start", () => {
    expect(() => parseEntryWindow("12:00-09:45 ET")).toThrow();
    expect(() => parseEntryWindow("10:00-10:00 ET")).toThrow();
  });

  it("throws on hour > 23", () => {
    expect(() => parseEntryWindow("25:00-26:00 ET")).toThrow();
  });

  it("throws on non-numeric hour/minute", () => {
    expect(() => parseEntryWindow("aa:00-12:00 ET")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => parseEntryWindow("")).toThrow();
  });

  it("throws on unknown timezone", () => {
    expect(() => parseEntryWindow("09:00-10:00 FAKEZONE")).toThrow();
  });
});

describe("parseEntryWindows", () => {
  it("returns [] for undefined", () => {
    expect(parseEntryWindows(undefined)).toEqual([]);
  });

  it("returns [] for null", () => {
    expect(parseEntryWindows(null)).toEqual([]);
  });

  it("returns [] for empty array", () => {
    expect(parseEntryWindows([])).toEqual([]);
  });

  it("parses multiple specs", () => {
    const ws = parseEntryWindows(["09:45-12:00 ET", "13:30-15:30 ET"]);
    expect(ws).toHaveLength(2);
    expect(ws[0].startMinutesOfDay).toBe(585);
    expect(ws[1].startMinutesOfDay).toBe(810);
  });

  it("throws on first malformed spec in array", () => {
    expect(() => parseEntryWindows(["09:45-12:00 ET", "bad spec"])).toThrow();
  });
});

// ─── isBarInWindow tests ──────────────────────────────────────────────────────

describe("isBarInWindow", () => {
  const window09to12: EntryWindow = parseEntryWindow("09:45-12:00 ET");

  function makeEtBar(isoUtcDate: string, etHour: number, etMin: number): Date {
    // Create a UTC timestamp that, when converted to ET, gives the specified hour:min.
    // We use a known non-DST date (January) and a DST date (July) for DST tests.
    // For simplicity, we construct the date such that UTC offset is known.
    // We use Intl to find the UTC offset for the date and apply it.
    const datePart = isoUtcDate.slice(0, 10); // "YYYY-MM-DD"
    // Start with a rough UTC time and adjust for the ET offset
    // We use a fixed-offset approach: during EST (Jan), ET = UTC-5; during EDT (Jul), ET = UTC-4.
    // Construct: if we want 10:00 ET in January (EST, UTC-5), UTC = 10:00 + 05:00 = 15:00
    const isJuly = isoUtcDate.startsWith("2025-07") || isoUtcDate.startsWith("2024-07");
    const offset = isJuly ? 4 : 5; // EDT=-4h, EST=-5h
    const utcHour = etHour + offset;
    const utcMin = etMin;
    const ts = `${datePart}T${String(utcHour).padStart(2, "0")}:${String(utcMin).padStart(2, "0")}:00.000Z`;
    return new Date(ts);
  }

  it("bar at 10:00 ET → inside [09:45, 12:00) window", () => {
    const bar = makeEtBar("2025-01-15", 10, 0);
    expect(isBarInWindow(bar, window09to12)).toBe(true);
  });

  it("bar at 09:30 ET → outside [09:45, 12:00) window (before start)", () => {
    const bar = makeEtBar("2025-01-15", 9, 30);
    expect(isBarInWindow(bar, window09to12)).toBe(false);
  });

  it("bar at 09:45 ET → inside (left-inclusive boundary)", () => {
    const bar = makeEtBar("2025-01-15", 9, 45);
    expect(isBarInWindow(bar, window09to12)).toBe(true);
  });

  it("bar at 12:00 ET → outside (right-exclusive boundary)", () => {
    const bar = makeEtBar("2025-01-15", 12, 0);
    expect(isBarInWindow(bar, window09to12)).toBe(false);
  });

  it("bar at 11:59 ET → inside", () => {
    const bar = makeEtBar("2025-01-15", 11, 59);
    expect(isBarInWindow(bar, window09to12)).toBe(true);
  });

  it("bar at 13:00 ET → outside (after window)", () => {
    const bar = makeEtBar("2025-01-15", 13, 0);
    expect(isBarInWindow(bar, window09to12)).toBe(false);
  });
});

// ─── isBarInAnyWindow tests ───────────────────────────────────────────────────

describe("isBarInAnyWindow", () => {
  const windows = parseEntryWindows(["09:45-12:00 ET", "13:30-15:30 ET"]);

  // January date: EST (UTC-5)
  function makeBar(etHour: number, etMin: number): Date {
    const utcHour = etHour + 5;
    return new Date(`2025-01-15T${String(utcHour).padStart(2, "0")}:${String(etMin).padStart(2, "0")}:00.000Z`);
  }

  it("returns false for empty windows array", () => {
    const bar = makeBar(10, 0);
    expect(isBarInAnyWindow(bar, [])).toBe(false);
  });

  it("bar at 10:00 ET → true (in first window)", () => {
    expect(isBarInAnyWindow(makeBar(10, 0), windows)).toBe(true);
  });

  it("bar at 14:00 ET → true (in second window)", () => {
    expect(isBarInAnyWindow(makeBar(14, 0), windows)).toBe(true);
  });

  it("bar at 12:15 ET → false (between windows)", () => {
    expect(isBarInAnyWindow(makeBar(12, 15), windows)).toBe(false);
  });

  it("bar at 12:00 ET → false (right edge of first window, before second)", () => {
    expect(isBarInAnyWindow(makeBar(12, 0), windows)).toBe(false);
  });

  it("bar at 13:30 ET → true (left edge of second window)", () => {
    expect(isBarInAnyWindow(makeBar(13, 30), windows)).toBe(true);
  });

  it("bar at 15:30 ET → false (right edge of second window, exclusive)", () => {
    expect(isBarInAnyWindow(makeBar(15, 30), windows)).toBe(false);
  });

  it("bar at 09:00 ET → false (before both windows)", () => {
    expect(isBarInAnyWindow(makeBar(9, 0), windows)).toBe(false);
  });

  it("single window — works correctly", () => {
    const singleWindow = parseEntryWindows(["09:45-12:00 ET"]);
    expect(isBarInAnyWindow(makeBar(10, 0), singleWindow)).toBe(true);
    expect(isBarInAnyWindow(makeBar(9, 30), singleWindow)).toBe(false);
  });
});

// ─── DST tests ───────────────────────────────────────────────────────────────

describe("DST handling — IANA TZ math", () => {
  const window = parseEntryWindow("09:45-12:00 ET");

  it("bar at 10:00 during EDT (summer, UTC-4) resolves correctly", () => {
    // July 15, 2025 — EDT (UTC-4): ET 10:00 = UTC 14:00
    const bar = new Date("2025-07-15T14:00:00.000Z");
    expect(isBarInWindow(bar, window)).toBe(true);
  });

  it("bar at 10:00 during EST (winter, UTC-5) resolves correctly", () => {
    // January 15, 2025 — EST (UTC-5): ET 10:00 = UTC 15:00
    const bar = new Date("2025-01-15T15:00:00.000Z");
    expect(isBarInWindow(bar, window)).toBe(true);
  });

  it("bar at 09:30 during EDT is correctly outside window", () => {
    // July 15, 2025 — EDT (UTC-4): ET 09:30 = UTC 13:30
    const bar = new Date("2025-07-15T13:30:00.000Z");
    expect(isBarInWindow(bar, window)).toBe(false);
  });

  it("DST transition day — March 9, 2025 (spring forward) — bar at 10:00 EDT works", () => {
    // After spring-forward: UTC 14:00 = 10:00 EDT
    const bar = new Date("2025-03-09T14:00:00.000Z");
    expect(isBarInWindow(bar, window)).toBe(true);
  });

  it("DST transition day — November 2, 2025 (fall back) — bar at 10:00 EST works", () => {
    // After fall-back: UTC 15:00 = 10:00 EST
    const bar = new Date("2025-11-02T15:00:00.000Z");
    expect(isBarInWindow(bar, window)).toBe(true);
  });
});
