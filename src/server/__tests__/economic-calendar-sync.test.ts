import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The service imports db/index.js (throws without DATABASE_URL at module load) + the audit
// helper. Mock them so the pure exports (FOMC dates, addDays) are testable in isolation.
vi.mock("../db/index.js", () => ({ db: { execute: vi.fn().mockResolvedValue([]) } }));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: vi.fn().mockResolvedValue(true) }));
// The sync writes a best-effort JSON snapshot for the Python backtest path via a dynamic
// `await import("fs")` — mock it so the test suite never touches the real filesystem.
vi.mock("fs", () => ({ writeFileSync: vi.fn() }));

const { FOMC_ANNOUNCE_DATES, addDays, runEconomicCalendarSync } = await import(
  "../services/economic-calendar-sync-service.js"
);
const { db } = await import("../db/index.js");
const { insertAuditRowSafe } = await import("../lib/audit-log-helper.js");

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

describe("economic-calendar-sync — audit status reflects real sync outcome (bug fix)", () => {
  const originalFredKey = process.env.FRED_API_KEY;

  beforeEach(() => {
    // Force the FRED branch to skip so row counts are deterministic (governed only
    // by the hardcoded FOMC dates + the generated EIA list, both pure/static).
    delete process.env.FRED_API_KEY;
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof db.execute>>);
    vi.mocked(insertAuditRowSafe).mockReset();
    vi.mocked(insertAuditRowSafe).mockResolvedValue(true);
  });

  afterEach(() => {
    if (originalFredKey === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = originalFredKey;
  });

  it("RED-PROOF: total sync failure (every row INSERT throws) is NOT recorded as a successful info audit row", async () => {
    // Simulates the table-doesn't-exist / total-outage scenario the finding describes.
    vi.mocked(db.execute).mockRejectedValue(new Error('relation "economic_release_dates" does not exist'));

    const result = await runEconomicCalendarSync({ startDate: "2026-01-28", endDate: "2026-01-28" });

    // At least the hardcoded 2026-01-28 FOMC announce date is attempted in this window.
    expect(result.upserted).toBe(0);
    expect(insertAuditRowSafe).toHaveBeenCalledTimes(1);

    const auditRow = vi.mocked(insertAuditRowSafe).mock.calls[0][0] as Record<string, unknown>;
    // Old (pre-fix) code hardcoded status:"info" here regardless of outcome — this
    // assertion is the RED-proof: it fails against the unfixed code.
    expect(auditRow.status).not.toBe("info");
    expect(auditRow.status).toBe("error");

    const resultPayload = auditRow.result as Record<string, unknown>;
    expect(resultPayload.upserted).toBe(0);
    expect(resultPayload.attempted).toBeGreaterThan(0);
    expect(resultPayload.failedRows).toBe(resultPayload.attempted);
    expect(Array.isArray(resultPayload.failureSamples)).toBe(true);
    expect((resultPayload.failureSamples as unknown[]).length).toBeGreaterThan(0);
  });

  it("a genuinely empty calendar period (zero rows attempted) still records status:info — not misclassified as a failure", async () => {
    // 2030 is past both the hardcoded FOMC list (ends 2027-12-08) and the generated
    // EIA list (ends 2027-12-29) — guaranteed zero rows attempted, not a sync failure.
    const result = await runEconomicCalendarSync({ startDate: "2030-01-01", endDate: "2030-01-02" });

    expect(result.upserted).toBe(0);
    expect(insertAuditRowSafe).toHaveBeenCalledTimes(1);

    const auditRow = vi.mocked(insertAuditRowSafe).mock.calls[0][0] as Record<string, unknown>;
    expect(auditRow.status).toBe("info");

    const resultPayload = auditRow.result as Record<string, unknown>;
    expect(resultPayload.attempted).toBe(0);
    expect(resultPayload.failedRows).toBe(0);
  });

  it("a partial failure (some rows fail, some succeed) escalates to status:warning with a non-silent failure count", async () => {
    let callCount = 0;
    // @ts-ignore — db.execute mock: async callback return type vs PgRaw (see drift-detector.test.ts precedent)
    vi.mocked(db.execute).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [] as unknown as Awaited<ReturnType<typeof db.execute>>;
      throw new Error("upsert failed for this row");
    });

    // 2026-01-01..2026-02-28 attempts multiple rows (FOMC announce 2026-01-28 +
    // FOMC_MINUTES 2026-02-18 + generated EIA events) — guaranteed >= 2 attempted rows.
    const result = await runEconomicCalendarSync({ startDate: "2026-01-01", endDate: "2026-02-28" });

    expect(result.upserted).toBe(1);
    expect(insertAuditRowSafe).toHaveBeenCalledTimes(1);

    const auditRow = vi.mocked(insertAuditRowSafe).mock.calls[0][0] as Record<string, unknown>;
    expect(auditRow.status).toBe("warning");

    const resultPayload = auditRow.result as Record<string, unknown>;
    expect(resultPayload.upserted).toBe(1);
    expect(resultPayload.failedRows).toBeGreaterThan(0);
    expect((resultPayload.attempted as number)).toBe(1 + (resultPayload.failedRows as number));
  });

  it("a fully clean sync (no failures, rows attempted) keeps status:info", async () => {
    const result = await runEconomicCalendarSync({ startDate: "2026-01-01", endDate: "2026-02-28" });

    expect(result.upserted).toBeGreaterThan(0);
    const auditRow = vi.mocked(insertAuditRowSafe).mock.calls[0][0] as Record<string, unknown>;
    expect(auditRow.status).toBe("info");

    const resultPayload = auditRow.result as Record<string, unknown>;
    expect(resultPayload.failedRows).toBe(0);
  });
});
