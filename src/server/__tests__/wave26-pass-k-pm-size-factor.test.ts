/**
 * wave26-pass-k-pm-size-factor.test.ts — Wave 26 Pass K Phase 2 (2026-05-26)
 *
 * Pure-function test suite for the EOD-DD-aware PM session size taper.
 *
 * Default schedule (institutional 2026 per TTT Markets + SurgeFunded + Tradecovex):
 *   Before 13:30 ET → factor 1.0 (AM session, full base size)
 *   13:30 ET        → factor 0.50 (PM start)
 *   13:30–15:00 ET  → linear decay 0.50 → 0.25
 *   15:00–15:30 ET  → factor 0.25 (floor held)
 *   15:30 ET onward → factor 0.00 (no new entries; 15:55 flatten still active for open)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  computePmSizeFactor,
  getPmSizeFactorEnvDefaults,
} from "../lib/pm-size-factor.js";

function etBar(yyyymmddHhMm: string): Date {
  const [datePart, timePart] = yyyymmddHhMm.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hh + offsetHours, mm));
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(candidate);
    const match = fmt.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/);
    if (match) {
      const [, mo, da, ye, hr, mi] = match;
      const hrN = parseInt(hr, 10) === 24 ? 0 : parseInt(hr, 10);
      if (
        parseInt(ye, 10) === y && parseInt(mo, 10) === m && parseInt(da, 10) === d &&
        hrN === hh && parseInt(mi, 10) === mm
      ) return candidate;
    }
  }
  throw new Error(`etBar: could not construct ET time for ${yyyymmddHhMm}`);
}

describe("computePmSizeFactor — AM session (before 13:30 ET)", () => {
  it("09:45 ET → factor 1.0, phase=am", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 09:45") });
    expect(r.factor).toBe(1.0);
    expect(r.phase).toBe("am");
  });

  it("11:00 ET → factor 1.0", () => {
    expect(computePmSizeFactor({ barTsUtc: etBar("2026-05-26 11:00") }).factor).toBe(1.0);
  });

  it("13:29 ET (last AM minute) → factor 1.0", () => {
    expect(computePmSizeFactor({ barTsUtc: etBar("2026-05-26 13:29") }).factor).toBe(1.0);
  });
});

describe("computePmSizeFactor — PM taper (13:30 → 15:00 ET linear decay)", () => {
  it("13:30 ET → factor 0.50 (PM start)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 13:30") });
    expect(r.factor).toBe(0.50);
    expect(r.phase).toBe("pm_taper");
  });

  it("14:15 ET (halfway through 13:30→15:00) → factor 0.375", () => {
    // Linear: 0.50 + 0.5*(0.25 - 0.50) = 0.375
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 14:15") });
    expect(r.factor).toBeCloseTo(0.375, 5);
    expect(r.phase).toBe("pm_taper");
  });

  it("14:30 ET (2/3 through taper) → factor ≈ 0.333", () => {
    // (14:30 - 13:30) / (15:00 - 13:30) = 60/90 = 0.667
    // 0.50 + 0.667 * (0.25 - 0.50) = 0.50 - 0.167 = 0.333
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 14:30") });
    expect(r.factor).toBeCloseTo(0.333, 2);
  });

  it("14:59 ET (1 min before floor) → factor barely above 0.25", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 14:59") });
    expect(r.factor).toBeGreaterThan(0.25);
    expect(r.factor).toBeLessThan(0.30);
    expect(r.phase).toBe("pm_taper");
  });
});

describe("computePmSizeFactor — PM floor (15:00 → 15:30 ET held at 0.25)", () => {
  it("15:00 ET → factor 0.25 (floor reached)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:00") });
    expect(r.factor).toBe(0.25);
    expect(r.phase).toBe("pm_floor");
  });

  it("15:15 ET → factor 0.25 (held)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:15") });
    expect(r.factor).toBe(0.25);
    expect(r.phase).toBe("pm_floor");
  });

  it("15:29 ET (last entry minute) → factor 0.25", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:29") });
    expect(r.factor).toBe(0.25);
    expect(r.phase).toBe("pm_floor");
  });
});

describe("computePmSizeFactor — PM closed (15:30 ET onward)", () => {
  it("15:30 ET → factor 0.0 (no new entries; flatten still active)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:30") });
    expect(r.factor).toBe(0.0);
    expect(r.phase).toBe("pm_closed");
    expect(r.reason).toMatch(/15:55 flatten/);
  });

  it("15:45 ET → factor 0.0", () => {
    expect(computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:45") }).factor).toBe(0.0);
  });

  it("16:30 ET → factor 0.0", () => {
    expect(computePmSizeFactor({ barTsUtc: etBar("2026-05-26 16:30") }).factor).toBe(0.0);
  });
});

describe("computePmSizeFactor — fail-safe on misconfig", () => {
  it("malformed pmStartEt → conservative fallback to 0.25", () => {
    const r = computePmSizeFactor({
      barTsUtc: etBar("2026-05-26 14:00"),
      pmStartEt: "not-a-time",
    });
    expect(r.factor).toBe(0.25);
    expect(r.reason).toMatch(/config_error/);
  });

  it("floor before start → fallback", () => {
    const r = computePmSizeFactor({
      barTsUtc: etBar("2026-05-26 14:00"),
      pmStartEt: "15:00",
      pmFloorAtEt: "13:30",  // floor before start
    });
    expect(r.factor).toBe(0.25);
  });

  it("factor out of [0,1] → fallback", () => {
    const r = computePmSizeFactor({
      barTsUtc: etBar("2026-05-26 14:00"),
      factorAtStart: 1.5,
    });
    expect(r.factor).toBe(0.25);
  });

  it("negative factor → fallback", () => {
    const r = computePmSizeFactor({
      barTsUtc: etBar("2026-05-26 14:00"),
      factorAtFloor: -0.1,
    });
    expect(r.factor).toBe(0.25);
  });
});

describe("computePmSizeFactor — custom schedule via input args", () => {
  it("custom early start (12:00) + later floor (15:30) respected", () => {
    const r = computePmSizeFactor({
      barTsUtc: etBar("2026-05-26 13:45"),
      pmStartEt: "12:00",
      pmFloorAtEt: "15:30",
      pmLastEntryEt: "15:45",
      factorAtStart: 0.80,
      factorAtFloor: 0.40,
    });
    // (13:45 - 12:00) / (15:30 - 12:00) = 105/210 = 0.5
    // 0.80 + 0.5 * (0.40 - 0.80) = 0.60
    expect(r.factor).toBeCloseTo(0.60, 2);
    expect(r.phase).toBe("pm_taper");
  });
});

describe("getPmSizeFactorEnvDefaults", () => {
  const saved = {
    pmStartEt: process.env.PM_SESSION_START_ET,
    pmFloorAtEt: process.env.PM_SIZE_FACTOR_FLOOR_AT_ET,
    pmLastEntryEt: process.env.PM_LAST_ENTRY_ET,
    factorAtStart: process.env.PM_SIZE_FACTOR_AT_13_30,
    factorAtFloor: process.env.PM_SIZE_FACTOR_AT_15_00,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      const envKey =
        k === "pmStartEt" ? "PM_SESSION_START_ET" :
        k === "pmFloorAtEt" ? "PM_SIZE_FACTOR_FLOOR_AT_ET" :
        k === "pmLastEntryEt" ? "PM_LAST_ENTRY_ET" :
        k === "factorAtStart" ? "PM_SIZE_FACTOR_AT_13_30" :
        "PM_SIZE_FACTOR_AT_15_00";
      if (v === undefined) delete process.env[envKey];
      else process.env[envKey] = v;
    }
  });

  it("defaults match institutional 2026 per TTT Markets / SurgeFunded", () => {
    delete process.env.PM_SESSION_START_ET;
    delete process.env.PM_SIZE_FACTOR_FLOOR_AT_ET;
    delete process.env.PM_LAST_ENTRY_ET;
    delete process.env.PM_SIZE_FACTOR_AT_13_30;
    delete process.env.PM_SIZE_FACTOR_AT_15_00;
    const d = getPmSizeFactorEnvDefaults();
    expect(d.pmStartEt).toBe("13:30");
    expect(d.pmFloorAtEt).toBe("15:00");
    expect(d.pmLastEntryEt).toBe("15:30");
    expect(d.factorAtStart).toBe(0.50);
    expect(d.factorAtFloor).toBe(0.25);
  });

  it("env override honored", () => {
    process.env.PM_SIZE_FACTOR_AT_13_30 = "0.75";
    process.env.PM_SIZE_FACTOR_AT_15_00 = "0.40";
    const d = getPmSizeFactorEnvDefaults();
    expect(d.factorAtStart).toBe(0.75);
    expect(d.factorAtFloor).toBe(0.40);
  });

  it("malformed env falls back to default", () => {
    process.env.PM_SIZE_FACTOR_AT_13_30 = "not-a-number";
    const d = getPmSizeFactorEnvDefaults();
    expect(d.factorAtStart).toBe(0.50);
  });
});

describe("computePmSizeFactor — DST awareness", () => {
  it("13:30 ET in March (EDT) → factor 0.50", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-03-09 13:30") });
    expect(r.factor).toBe(0.50);
  });

  it("13:30 ET in January (EST) → factor 0.50", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-01-15 13:30") });
    expect(r.factor).toBe(0.50);
  });

  it("13:30 ET in November (post fall-back, EST) → factor 0.50", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-11-05 13:30") });
    expect(r.factor).toBe(0.50);
  });
});
