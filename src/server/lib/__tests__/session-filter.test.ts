/**
 * Session extraction + temporal normalization tests (2026-06-24 Layer 3A / 3A.5).
 * Covers the operator's example phrases + the benchmark videos' real sessions.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeSessionPhrase,
  extractSessionFromTranscript,
  sessionFilterLabel,
} from "../session-filter.js";

describe("normalizeSessionPhrase — temporal normalization", () => {
  it("NY ORB → region NY, 09:30–10:00, subtype ORB", () => {
    const sf = normalizeSessionPhrase("we take the opening range breakout at the New York open");
    expect(sf?.region).toBe("NY");
    expect(sf?.subtype).toBe("ORB");
    expect(sf?.start).toBe("09:30");
    expect(sf?.timezone).toBe("America/New_York");
  });

  it("London killzone → LONDON 02:00–05:00 KILLZONE", () => {
    const sf = normalizeSessionPhrase("only trade the London killzone");
    expect(sf?.region).toBe("LONDON");
    expect(sf?.subtype).toBe("KILLZONE");
    expect(sf?.start).toBe("02:00");
    expect(sf?.end).toBe("05:00");
  });

  it('explicit "9:30" anchors the start with high confidence', () => {
    const sf = normalizeSessionPhrase("wait for the 9:30 candle to form");
    expect(sf?.start).toBe("09:30");
    expect(sf?.confidence ?? 0).toBeGreaterThanOrEqual(0.85);
  });

  it('"8 AM EST" → 08:00 ET', () => {
    const sf = normalizeSessionPhrase("the setup begins at 8 AM EST");
    expect(sf?.start).toBe("08:00");
  });

  it('"13:30 UTC" → converted to ET (08:30)', () => {
    const sf = normalizeSessionPhrase("the window opens 13:30 UTC");
    expect(sf?.start).toBe("08:30");
  });

  it('overnight high/low session (W7nln) → OVERNIGHT 16:00→09:30', () => {
    const sf = normalizeSessionPhrase("mark the overnight high and overnight low");
    expect(sf?.subtype).toBe("OVERNIGHT");
    expect(sf?.start).toBe("16:00");
    expect(sf?.end).toBe("09:30");
  });

  it('"no lunch" → constraint no_lunch', () => {
    const sf = normalizeSessionPhrase("avoid lunch, no trades during lunch");
    expect(sf?.constraints).toContain("no_lunch");
  });

  it("returns null when there is no session/time signal", () => {
    expect(normalizeSessionPhrase("price respects the moving average")).toBeNull();
    expect(normalizeSessionPhrase("")).toBeNull();
    expect(normalizeSessionPhrase(null)).toBeNull();
  });

  it("does not misfire on a bare timeframe like 5m/4h (not a session)", () => {
    // "5m"/"4h" are timeframes, not clock times — the clock regex requires HH:mm or am/pm.
    expect(normalizeSessionPhrase("use the 5m chart")).toBeNull();
  });
});

describe("extractSessionFromTranscript", () => {
  it("picks the dominant session from a multi-cue transcript", () => {
    const t =
      "In this strategy we focus on the New York session. We mark the opening range at 9:30 EST. " +
      "We never trade during lunch. Some people use London but we stick to NY.";
    const sf = extractSessionFromTranscript(t);
    expect(sf?.region).toBe("NY");
    expect(sf?.start).toBe("09:30");
    expect(sf?.constraints).toContain("no_lunch");
  });

  it("returns null for a transcript with no session content", () => {
    expect(extractSessionFromTranscript("we look for a hammer candle off the 20 ema")).toBeNull();
  });
});

describe("sessionFilterLabel (backward-compat string view)", () => {
  it("derives a canonical label from the structured window", () => {
    expect(sessionFilterLabel({ region: "NY", subtype: "ORB" })).toBe("NY_ORB");
    expect(sessionFilterLabel({ region: "LONDON", subtype: "KILLZONE" })).toBe("LONDON_KILLZONE");
    expect(sessionFilterLabel({ constraints: ["no_lunch"] })).toBe("NO_LUNCH");
    expect(sessionFilterLabel(null)).toBeNull();
  });
});
