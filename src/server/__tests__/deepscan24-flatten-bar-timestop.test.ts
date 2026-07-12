/**
 * deep-scan #24 (2026-07-11) — 15:55 ET flatten-bar time-stop boundary.
 *
 * On the hard-flatten bar the backtester checks the TIME-STOP first and exits at the bar CLOSE with
 * reason `time_stop` even when the bar also crossed the stop. The paper engine's BL-1 intrabar
 * stop-breach block runs first and `continue`s (skipping callExitHandler's TIME_STOP_FLATTEN), so it
 * must itself switch to time-stop semantics on the flatten bar — gated by `_isTimeStopFlattenBar`.
 * This pins the exact >= 15:55 ET boundary that gate depends on (the fix shipped with no test).
 */
import { describe, it, expect } from "vitest";
import { _isTimeStopFlattenBar } from "../lib/time-stop-flatten.js";

describe("deep-scan #24 — _isTimeStopFlattenBar (15:55 ET hard-flatten boundary)", () => {
  it("is FALSE before 15:55 ET", () => {
    expect(_isTimeStopFlattenBar("09:30")).toBe(false);
    expect(_isTimeStopFlattenBar("15:00")).toBe(false);
    expect(_isTimeStopFlattenBar("15:54")).toBe(false);
    expect(_isTimeStopFlattenBar("15:54:59")).toBe(false);
  });

  it("is TRUE at exactly 15:55 ET (the invariant threshold)", () => {
    expect(_isTimeStopFlattenBar("15:55")).toBe(true);
    expect(_isTimeStopFlattenBar("15:55:00")).toBe(true);
  });

  it("is TRUE for every bar after 15:55 ET through the close", () => {
    expect(_isTimeStopFlattenBar("15:56")).toBe(true);
    expect(_isTimeStopFlattenBar("15:59")).toBe(true);
    expect(_isTimeStopFlattenBar("16:00")).toBe(true);
    expect(_isTimeStopFlattenBar("16:30")).toBe(true);
  });

  it("handles both zero-padded and non-padded hours", () => {
    expect(_isTimeStopFlattenBar("9:30")).toBe(false);
    expect(_isTimeStopFlattenBar("16:0")).toBe(false); // minute must be 2 digits — malformed → false
  });

  it("is FALSE (fail-safe: no early flatten) for empty / unparseable input", () => {
    expect(_isTimeStopFlattenBar(undefined)).toBe(false);
    expect(_isTimeStopFlattenBar(null)).toBe(false);
    expect(_isTimeStopFlattenBar("")).toBe(false);
    expect(_isTimeStopFlattenBar("garbage")).toBe(false);
    expect(_isTimeStopFlattenBar("nn:nn")).toBe(false);
  });
});
