import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB before importing the loader (db/index throws without DATABASE_URL at load).
const mockExecute = vi.fn();
vi.mock("../db/index.js", () => ({ db: { execute: mockExecute } }));

const { getT1ReleaseWindow, __resetEconomicCalendarCacheForTests } = await import(
  "../lib/economic-calendar-loader.js"
);

describe("economic-calendar-loader — authoritative T1 window (Phase 3)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    __resetEconomicCalendarCacheForTests();
  });

  function dbRows(rows: Array<{ event_type: string; date: string; time_et: string }>) {
    mockExecute.mockResolvedValue(rows as unknown as never);
  }

  it("FOMC window blocks all products (2026-10-28 14:00 ET = 18:00 UTC; Oct = EDT UTC-4)", async () => {
    dbRows([{ event_type: "FOMC", date: "2026-10-28", time_et: "14:00" }]);
    const mes = await getT1ReleaseWindow("MES", "2026-10-28T18:00:00.000Z");
    expect(mes.inWindow).toBe(true);
    expect(mes.eventType).toBe("FOMC");
    expect(mes.source).toBe("db");
    __resetEconomicCalendarCacheForTests();
    dbRows([{ event_type: "FOMC", date: "2026-10-28", time_et: "14:00" }]);
    const mcl = await getT1ReleaseWindow("MCL", "2026-10-28T18:00:00.000Z");
    expect(mcl.inWindow).toBe(true); // FOMC affects all products
  });

  it("EIA window blocks crude ONLY (2026-01-07 10:30 ET = 15:30 UTC EST)", async () => {
    dbRows([{ event_type: "EIA", date: "2026-01-07", time_et: "10:30" }]);
    const mcl = await getT1ReleaseWindow("MCL", "2026-01-07T15:30:00.000Z");
    expect(mcl.inWindow).toBe(true);
    expect(mcl.eventType).toBe("EIA");
    __resetEconomicCalendarCacheForTests();
    dbRows([{ event_type: "EIA", date: "2026-01-07", time_et: "10:30" }]);
    const mes = await getT1ReleaseWindow("MES", "2026-01-07T15:30:00.000Z");
    expect(mes.inWindow).toBe(false); // EIA does not affect equity index
  });

  it("CPI does NOT block crude (product scope)", async () => {
    dbRows([{ event_type: "CPI", date: "2026-07-14", time_et: "08:30" }]);
    const mcl = await getT1ReleaseWindow("MCL", "2026-07-14T12:30:00.000Z"); // 08:30 ET EDT
    expect(mcl.inWindow).toBe(false);
  });

  it("outside the T−5/+2 window → not blocked", async () => {
    dbRows([{ event_type: "FOMC", date: "2026-10-28", time_et: "14:00" }]);
    // 14:06 ET EDT = 18:06 UTC — T+6, past the +2 window
    const r = await getT1ReleaseWindow("MES", "2026-10-28T18:06:00.000Z");
    expect(r.inWindow).toBe(false);
  });

  it("FAIL-SAFE: empty DB → hardcoded fallback still detects T1 windows", async () => {
    dbRows([]); // empty table
    // A hardcoded FOMC date from tier1-event-blackout.ts (2026-01-28 14:00 ET = 19:00 UTC).
    const r = await getT1ReleaseWindow("MES", "2026-01-28T19:00:00.000Z");
    expect(r.inWindow).toBe(true);
    expect(r.source).toBe("fallback");
  });

  it("FAIL-SAFE: DB read throws → hardcoded fallback (gate never silently opens)", async () => {
    mockExecute.mockRejectedValue(new Error("db down"));
    const r = await getT1ReleaseWindow("MES", "2026-01-28T19:00:00.000Z");
    expect(r.inWindow).toBe(true);
    expect(r.source).toBe("fallback");
  });
});
