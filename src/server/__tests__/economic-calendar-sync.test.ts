import { describe, it, expect, vi } from "vitest";

// The service imports db/index.js (throws without DATABASE_URL at module load) + the audit
// helper. Mock them so the pure exports (FOMC dates, addDays) are testable in isolation.
vi.mock("../db/index.js", () => ({ db: { execute: vi.fn().mockResolvedValue([]) } }));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: vi.fn().mockResolvedValue(true) }));

const { FOMC_ANNOUNCE_DATES, addDays } = await import("../services/economic-calendar-sync-service.js");

describe("economic-calendar-sync — authoritative FOMC dates (root-cause fix)", () => {
  it("FOMC 2026 matches the Fed's PUBLISHED schedule (not the old projected dates)", () => {
    const fomc2026 = FOMC_ANNOUNCE_DATES.filter((d) => d.startsWith("2026"));
    // Authoritative Fed announce dates (2nd meeting day), verified vs federalreserve.gov:
    expect(fomc2026).toEqual([
      "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
      "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
    ]);
  });

  it("does NOT contain the old WRONG projected FOMC dates (May 6 / Nov 4 / Dec 16)", () => {
    for (const wrong of ["2026-05-06", "2026-11-04", "2026-12-16"]) {
      expect(FOMC_ANNOUNCE_DATES).not.toContain(wrong);
    }
  });

  it("FOMC 2027 matches the Fed's tentative published schedule", () => {
    const fomc2027 = FOMC_ANNOUNCE_DATES.filter((d) => d.startsWith("2027"));
    expect(fomc2027).toEqual([
      "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
      "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
    ]);
  });

  it("FOMC_MINUTES = exactly 3 weeks (21 days) after each FOMC announce date", () => {
    // Minutes are released 3 weeks later on the same weekday (Wednesday), 14:00 ET.
    expect(addDays("2026-01-28", 21)).toBe("2026-02-18");
    expect(addDays("2026-04-29", 21)).toBe("2026-05-20");
    expect(addDays("2026-12-09", 21)).toBe("2026-12-30");
  });

  it("addDays is UTC-safe across month/year boundaries", () => {
    expect(addDays("2026-12-09", 21)).toBe("2026-12-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026 not a leap year
  });
});
