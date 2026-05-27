/**
 * wave26-pass-k-lunch-blackout.test.ts — Wave 26 Pass K Phase 2 (2026-05-26)
 *
 * Pure-function test suite for the 11:30–13:30 ET lunch blackout HARD gate.
 *
 * Boundary semantics: [start, end) left-inclusive, right-exclusive.
 * Bars exactly at 11:30:00 ET are BLOCKED; bars exactly at 13:30:00 ET are CLEAR.
 *
 * Verifies:
 *   - Default ET window 11:30–13:30 (institutional 2026 per Tradeify + Tradecovex + TradingStats.net)
 *   - Bars before 11:30 ET → clear
 *   - Bars 11:30 ET to 13:29:59 ET → blocked
 *   - Bars 13:30 ET and after → clear (PM session re-opens)
 *   - DST-aware boundary handling (Intl.DateTimeFormat path)
 *   - Per-strategy override (entry_quality.lunch_blackout_disabled=true)
 *   - Env var override (LUNCH_BLACKOUT_START_ET / LUNCH_BLACKOUT_END_ET)
 *   - Malformed config fails CLOSED (block all entries on misconfig)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  evaluateLunchBlackoutGate,
  getLunchBlackoutStartEnvDefault,
  getLunchBlackoutEndEnvDefault,
} from "../lib/lunch-blackout-gate.js";

/** Construct a Date from "YYYY-MM-DD HH:MM" ET wall-clock time (DST-aware via toLocaleString round-trip). */
function etBar(yyyymmddHhMm: string): Date {
  // Format: "2026-05-26 11:30"
  const [datePart, timePart] = yyyymmddHhMm.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  // Construct ET wall-clock via Date.UTC then offset adjustment.
  // Use a known-good DST tool: build in UTC, then verify by formatting back to ET.
  // Iterate to find UTC ms that maps to the wanted ET time.
  // Brute force: try UTC = ET + 4h (EDT) or +5h (EST).
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hh + offsetHours, mm));
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(candidate);
    // fmt e.g. "05/26/2026, 11:30"
    const match = fmt.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/);
    if (match) {
      const [, mo, da, ye, hr, mi] = match;
      // hour12:false bug: returns "24" for midnight
      const hrN = parseInt(hr, 10) === 24 ? 0 : parseInt(hr, 10);
      if (
        parseInt(ye, 10) === y &&
        parseInt(mo, 10) === m &&
        parseInt(da, 10) === d &&
        hrN === hh &&
        parseInt(mi, 10) === mm
      ) {
        return candidate;
      }
    }
  }
  throw new Error(`etBar: could not construct ET time for ${yyyymmddHhMm}`);
}

describe("evaluateLunchBlackoutGate — default window 11:30–13:30 ET", () => {
  it("blocks bar exactly at 11:30:00 ET (left-inclusive)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 11:30") });
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/lunch_blackout_window:11:30-13:30 ET/);
    expect(r.windowSpec).toBe("11:30-13:30 ET");
  });

  it("blocks bar at 12:00:00 ET (middle of blackout)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 12:00") });
    expect(r.block).toBe(true);
  });

  it("blocks bar at 13:29:00 ET (last minute of blackout)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 13:29") });
    expect(r.block).toBe(true);
  });

  it("CLEAR bar exactly at 13:30:00 ET (right-exclusive — PM session re-opens)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 13:30") });
    expect(r.block).toBe(false);
    expect(r.reason).toMatch(/outside_blackout_window/);
  });

  it("CLEAR bar at 11:29:00 ET (last minute of AM session)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 11:29") });
    expect(r.block).toBe(false);
  });

  it("CLEAR bar at 09:45:00 ET (morning kill zone)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 09:45") });
    expect(r.block).toBe(false);
  });

  it("CLEAR bar at 15:00:00 ET (afternoon PM kill zone)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 15:00") });
    expect(r.block).toBe(false);
  });

  it("CLEAR bar at 15:45:00 ET (pre-flatten window)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 15:45") });
    expect(r.block).toBe(false);
  });
});

describe("evaluateLunchBlackoutGate — per-strategy override", () => {
  it("perStrategyDisabled=true bypasses blackout (mean-reversion archetype escape hatch)", () => {
    const r = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 12:00"),
      perStrategyDisabled: true,
    });
    expect(r.block).toBe(false);
    expect(r.perStrategyOverrideApplied).toBe(true);
    expect(r.reason).toMatch(/per_strategy_override/);
  });

  it("perStrategyDisabled=false does NOT bypass blackout (default behavior)", () => {
    const r = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 12:00"),
      perStrategyDisabled: false,
    });
    expect(r.block).toBe(true);
    expect(r.perStrategyOverrideApplied).toBe(false);
  });

  it("perStrategyDisabled undefined does NOT bypass blackout", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 12:00") });
    expect(r.block).toBe(true);
    expect(r.perStrategyOverrideApplied).toBe(false);
  });
});

describe("evaluateLunchBlackoutGate — custom window via input args", () => {
  it("respects custom narrower window 12:00-13:00", () => {
    const r11 = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 11:45"),
      startEt: "12:00",
      endEt: "13:00",
    });
    expect(r11.block).toBe(false);  // before custom start

    const r12 = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 12:30"),
      startEt: "12:00",
      endEt: "13:00",
    });
    expect(r12.block).toBe(true);
  });
});

describe("evaluateLunchBlackoutGate — fail-CLOSED on malformed config", () => {
  it("missing minute separator → block + error reason", () => {
    const r = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 10:00"),  // outside any window
      startEt: "1130",  // missing colon
      endEt: "13:30",
    });
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/lunch_blackout_config_error/);
  });

  it("end before start → block + error reason", () => {
    const r = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 10:00"),
      startEt: "13:30",
      endEt: "11:30",  // invalid: end before start
    });
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/lunch_blackout_config_error/);
  });

  it("hour out of range → block + error reason", () => {
    const r = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 10:00"),
      startEt: "25:00",
      endEt: "26:00",
    });
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/lunch_blackout_config_error/);
  });
});

describe("Env var defaults", () => {
  const savedStart = process.env.LUNCH_BLACKOUT_START_ET;
  const savedEnd = process.env.LUNCH_BLACKOUT_END_ET;
  afterEach(() => {
    if (savedStart === undefined) delete process.env.LUNCH_BLACKOUT_START_ET;
    else process.env.LUNCH_BLACKOUT_START_ET = savedStart;
    if (savedEnd === undefined) delete process.env.LUNCH_BLACKOUT_END_ET;
    else process.env.LUNCH_BLACKOUT_END_ET = savedEnd;
  });

  it("default start is 11:30 (institutional 2026 per Tradeify 13yr dataset)", () => {
    delete process.env.LUNCH_BLACKOUT_START_ET;
    expect(getLunchBlackoutStartEnvDefault()).toBe("11:30");
  });

  it("default end is 13:30 (institutional 2026 per TradingStats.net + Tradecovex)", () => {
    delete process.env.LUNCH_BLACKOUT_END_ET;
    expect(getLunchBlackoutEndEnvDefault()).toBe("13:30");
  });

  it("env override honored", () => {
    process.env.LUNCH_BLACKOUT_START_ET = "12:00";
    process.env.LUNCH_BLACKOUT_END_ET = "13:00";
    expect(getLunchBlackoutStartEnvDefault()).toBe("12:00");
    expect(getLunchBlackoutEndEnvDefault()).toBe("13:00");
  });

  it("empty-string env falls back to default", () => {
    process.env.LUNCH_BLACKOUT_START_ET = "";
    process.env.LUNCH_BLACKOUT_END_ET = "";
    expect(getLunchBlackoutStartEnvDefault()).toBe("11:30");
    expect(getLunchBlackoutEndEnvDefault()).toBe("13:30");
  });
});

describe("evaluateLunchBlackoutGate — DST handling", () => {
  it("blocks 12:00 ET in March (EDT) — same wall-clock time despite UTC offset shift", () => {
    // 2026-03-09 was the first Monday after spring-forward (DST start was 2026-03-08)
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-03-09 12:00") });
    expect(r.block).toBe(true);
  });

  it("blocks 12:00 ET in January (EST) — same wall-clock time despite UTC offset shift", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-01-15 12:00") });
    expect(r.block).toBe(true);
  });

  it("blocks 12:00 ET in November (after fall-back, EST)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-11-05 12:00") });
    expect(r.block).toBe(true);
  });
});
