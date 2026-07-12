import { describe, it, expect } from "vitest";
import { toPythonWeekday } from "./python-weekday.js";

/**
 * FG-3 regression (deep-scan 2026-07-11): pins the JS->Python weekday mapping the anti-setup
 * day_of_week gate depends on. A revert to Date.getDay()/getUTCDay() (Sun=0) — or any change that
 * shifts the mapping — must fail here. Reference dates are known UTC weekdays; Python weekday()
 * is Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6.
 */
describe("toPythonWeekday (FG-3 anti-setup day_of_week mapping)", () => {
  // 2024-01-01 was a Monday (UTC). The 7 consecutive days cover the full week.
  const cases: Array<[string, number, string]> = [
    ["2024-01-01T12:00:00Z", 0, "Monday"],
    ["2024-01-02T12:00:00Z", 1, "Tuesday"],
    ["2024-01-03T12:00:00Z", 2, "Wednesday"],
    ["2024-01-04T12:00:00Z", 3, "Thursday"],
    ["2024-01-05T12:00:00Z", 4, "Friday"],
    ["2024-01-06T12:00:00Z", 5, "Saturday"],
    ["2024-01-07T12:00:00Z", 6, "Sunday"],
  ];

  it.each(cases)("%s -> %d (%s)", (iso, expected) => {
    expect(toPythonWeekday(iso)).toBe(expected);
  });

  it("accepts epoch millis and Date objects identically", () => {
    const iso = "2024-01-03T12:00:00Z"; // Wednesday -> 2
    const ms = Date.parse(iso);
    expect(toPythonWeekday(ms)).toBe(2);
    expect(toPythonWeekday(new Date(ms))).toBe(2);
  });

  it("matches Python datetime.weekday() (Mon=0..Sun=6), NOT JS getUTCDay() (Sun=0)", () => {
    // The bug: JS getUTCDay() for a Sunday is 0; Python weekday() is 6. Guard the divergence.
    const sunday = "2024-01-07T00:00:00Z";
    expect(new Date(sunday).getUTCDay()).toBe(0); // JS convention (the wrong one for the rules)
    expect(toPythonWeekday(sunday)).toBe(6); // Python convention (correct)
  });
});
