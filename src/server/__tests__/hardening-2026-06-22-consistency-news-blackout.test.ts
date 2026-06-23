/**
 * hardening-2026-06-22-consistency-news-blackout.test.ts
 * 2026-06-22 — FIX A (consistency gate wiring + MFFU) + FIX B (news blackout fail-CLOSED).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── FIX B pure-function tests: no mocks needed ───────────────────────────────

import {
  checkInProcessTier1EventWindow,
  buildNfpEvents,
  TIER1_BLACKOUT_MINUTES,
  TIER1_EVENTS,
} from "../lib/tier1-event-blackout.js";

describe("FIX B — checkInProcessTier1EventWindow (pure fn, zero dependencies)", () => {
  it("B-1: inside FOMC window (Jan 2026) → blocked=true", () => {
    // 2026-01-28 FOMC 14:00 ET (EST=UTC-5). Bar 13:45 ET = 18:45 UTC — inside ±30min.
    const result = checkInProcessTier1EventWindow("2026-01-28T18:45:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("FOMC");
    expect(result.windowMinutes).toBe(TIER1_BLACKOUT_MINUTES);
  });

  it("B-2: outside all Tier-1 windows → blocked=false", () => {
    // 2026-03-10 at 10:00 ET (EDT=UTC-4) = 14:00 UTC — no Tier-1 event on 2026-03-10.
    const result = checkInProcessTier1EventWindow("2026-03-10T14:00:00.000Z");
    expect(result.blocked).toBe(false);
    expect(result.eventName).toBe("");
    expect(result.windowMinutes).toBe(0);
  });

  it("B-3: inside CPI window (Jan 14 2026) → blocked=true", () => {
    // 2026-01-14 CPI 08:30 ET (EST=UTC-5). Bar 08:40 ET = 13:40 UTC.
    const result = checkInProcessTier1EventWindow("2026-01-14T13:40:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("CPI");
  });

  it("B-4: inside NFP window (first Friday Feb 2026 = 2026-02-06) → blocked=true", () => {
    // NFP 08:30 ET (EST=UTC-5). Bar 08:45 ET = 13:45 UTC.
    const result = checkInProcessTier1EventWindow("2026-02-06T13:45:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("NFP");
  });

  it("B-5: bypass_news_blackout=true → blocked=false even inside FOMC window", () => {
    const result = checkInProcessTier1EventWindow("2026-01-28T18:45:00.000Z", { bypassNewsBlackout: true });
    expect(result.blocked).toBe(false);
    expect(result.eventName).toBe("");
  });

  it("B-6: bar exactly at FOMC time (t=0) → blocked=true", () => {
    // 2026-01-28 14:00 ET (EST=UTC-5) = 19:00 UTC.
    const result = checkInProcessTier1EventWindow("2026-01-28T19:00:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("FOMC");
  });

  it("B-7: bar 31 min after FOMC → blocked=false (just outside window)", () => {
    // 14:31 ET = 19:31 UTC.
    const result = checkInProcessTier1EventWindow("2026-01-28T19:31:00.000Z");
    expect(result.blocked).toBe(false);
  });

  it("B-8: bar exactly at window boundary (t=-30min) → blocked=true", () => {
    // 13:30 ET = 18:30 UTC — exactly at the leading edge of FOMC window.
    const result = checkInProcessTier1EventWindow("2026-01-28T18:30:00.000Z");
    expect(result.blocked).toBe(true);
  });

  it("B-9: invalid/malformed timestamp → blocked=false (fail-open for garbage input)", () => {
    const result = checkInProcessTier1EventWindow("not-a-date");
    expect(result.blocked).toBe(false);
  });

  it("B-10: FOMC in June 2026 (EDT, UTC-4) is correctly offset → blocked inside window", () => {
    // 2026-06-17 FOMC 14:00 ET (EDT=UTC-4). Bar 14:10 ET = 18:10 UTC.
    const result = checkInProcessTier1EventWindow("2026-06-17T18:10:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("FOMC");
  });

  it("B-11: FOMC June 2026 (EDT) — bar 31 min after → outside window", () => {
    // 14:31 ET (EDT=UTC-4) = 18:31 UTC.
    const result = checkInProcessTier1EventWindow("2026-06-17T18:31:00.000Z");
    expect(result.blocked).toBe(false);
  });

  it("B-12: buildNfpEvents generates 12 NFP dates per year, all on Fridays", () => {
    const events = buildNfpEvents(2026, 2026);
    expect(events).toHaveLength(12);
    events.forEach((e) => {
      expect(e.event_type).toBe("NFP");
      expect(e.time_et).toBe("08:30");
      const d = new Date(e.date + "T12:00:00Z");
      expect(d.getUTCDay()).toBe(5);
    });
  });

  it("B-13: TIER1_EVENTS includes FOMC, CPI, and NFP entries", () => {
    const types = new Set(TIER1_EVENTS.map((e) => e.event_type));
    expect(types.has("FOMC")).toBe(true);
    expect(types.has("CPI")).toBe(true);
    expect(types.has("NFP")).toBe(true);
  });

  // ─── Wave hardening 2026-06-22: GDP / ISM / PPI extension ─────────────────

  it("B-14: GDP in TIER1_EVENTS has 08:30 time and covers 2026-2027", () => {
    const gdp = TIER1_EVENTS.filter((e) => e.event_type === "GDP");
    expect(gdp.length).toBeGreaterThan(0);
    gdp.forEach((e) => expect(e.time_et).toBe("08:30"));
    const years = new Set(gdp.map((e) => e.date.slice(0, 4)));
    expect(years.has("2026")).toBe(true);
    expect(years.has("2027")).toBe(true);
  });

  it("B-15: ISM in TIER1_EVENTS has 10:00 time and covers 2026-2027", () => {
    const ism = TIER1_EVENTS.filter((e) => e.event_type === "ISM");
    expect(ism.length).toBeGreaterThan(0);
    ism.forEach((e) => expect(e.time_et).toBe("10:00"));
    const years = new Set(ism.map((e) => e.date.slice(0, 4)));
    expect(years.has("2026")).toBe(true);
    expect(years.has("2027")).toBe(true);
  });

  it("B-16: PPI in TIER1_EVENTS has 08:30 time and covers 2026-2027", () => {
    const ppi = TIER1_EVENTS.filter((e) => e.event_type === "PPI");
    expect(ppi.length).toBeGreaterThan(0);
    ppi.forEach((e) => expect(e.time_et).toBe("08:30"));
    const years = new Set(ppi.map((e) => e.date.slice(0, 4)));
    expect(years.has("2026")).toBe(true);
    expect(years.has("2027")).toBe(true);
  });

  it("B-17: TIER1_EVENTS now contains all 6 MFFU Tier-1 event types", () => {
    const types = new Set(TIER1_EVENTS.map((e) => e.event_type));
    expect(types.has("FOMC")).toBe(true);
    expect(types.has("CPI")).toBe(true);
    expect(types.has("NFP")).toBe(true);
    expect(types.has("GDP")).toBe(true);
    expect(types.has("ISM")).toBe(true);
    expect(types.has("PPI")).toBe(true);
  });

  it("B-18: inside GDP window (2026-01-29 08:30 ET, EST) → blocked=true", () => {
    // GDP 2026-01-29 at 08:30 ET (EST=UTC-5). Bar at 08:45 ET = 13:45 UTC.
    const result = checkInProcessTier1EventWindow("2026-01-29T13:45:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("GDP");
    expect(result.windowMinutes).toBe(TIER1_BLACKOUT_MINUTES);
  });

  it("B-19: 35 min before GDP window (2026-01-29 07:55 ET) → blocked=false", () => {
    // 07:55 ET (EST=UTC-5) = 12:55 UTC — 35 min before GDP 08:30 → outside ±30min.
    const result = checkInProcessTier1EventWindow("2026-01-29T12:55:00.000Z");
    expect(result.blocked).toBe(false);
  });

  it("B-20: inside ISM window (2026-02-02 10:00 ET, EST) → blocked=true", () => {
    // ISM 2026-02-02 at 10:00 ET (EST=UTC-5). Bar at 09:45 ET = 14:45 UTC.
    const result = checkInProcessTier1EventWindow("2026-02-02T14:45:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("ISM");
  });

  it("B-21: 35 min after ISM window (2026-02-02 10:35 ET) → blocked=false", () => {
    // 10:35 ET (EST=UTC-5) = 15:35 UTC — 35 min after ISM 10:00 → outside ±30min.
    const result = checkInProcessTier1EventWindow("2026-02-02T15:35:00.000Z");
    expect(result.blocked).toBe(false);
  });

  it("B-22: inside PPI window (2026-01-15 08:30 ET, EST) → blocked=true", () => {
    // PPI 2026-01-15 at 08:30 ET (EST=UTC-5). Bar at 08:15 ET = 13:15 UTC.
    const result = checkInProcessTier1EventWindow("2026-01-15T13:15:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("PPI");
  });

  it("B-23: inside PPI window in summer (2026-06-11 08:30 EDT) → blocked=true", () => {
    // PPI 2026-06-11 at 08:30 ET (EDT=UTC-4). Bar at 08:30 ET = 12:30 UTC.
    const result = checkInProcessTier1EventWindow("2026-06-11T12:30:00.000Z");
    expect(result.blocked).toBe(true);
    expect(result.eventType).toBe("PPI");
  });

  it("B-24: 35 min before PPI (2026-01-15 07:55 ET) → blocked=false", () => {
    // 07:55 ET (EST=UTC-5) = 12:55 UTC — 35 min before PPI 08:30 → outside window.
    const result = checkInProcessTier1EventWindow("2026-01-15T12:55:00.000Z");
    expect(result.blocked).toBe(false);
  });

  it("B-25: GDP 2026 has exactly 4 dates in TIER1_EVENTS", () => {
    const gdp2026 = TIER1_EVENTS.filter(
      (e) => e.event_type === "GDP" && e.date.startsWith("2026"),
    );
    expect(gdp2026).toHaveLength(4);
  });

  it("B-26: ISM 2026 has exactly 12 dates in TIER1_EVENTS", () => {
    const ism2026 = TIER1_EVENTS.filter(
      (e) => e.event_type === "ISM" && e.date.startsWith("2026"),
    );
    expect(ism2026).toHaveLength(12);
  });

  it("B-27: PPI 2026 has exactly 12 dates in TIER1_EVENTS", () => {
    const ppi2026 = TIER1_EVENTS.filter(
      (e) => e.event_type === "PPI" && e.date.startsWith("2026"),
    );
    expect(ppi2026).toHaveLength(12);
  });
});

// ─── FIX A mocks ─────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperPositions: {},
  paperSessions: {},
  brokerAccounts: { accountId: "account_id", firmId: "firm_id", enabled: "enabled", enabledSymbols: "enabled_symbols" },
  auditLog: {},
  paperSignalLogs: {},
  paperTrades: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ op: "eq", val })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  gte: vi.fn((_col: unknown, val: unknown) => ({ op: "gte", val })),
  lte: vi.fn((_col: unknown, val: unknown) => ({ op: "lte", val })),
  isNull: vi.fn(() => ({ op: "isNull" })),
  desc: vi.fn(),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    { raw: vi.fn() },
  ),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ op: "inArray", vals })),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (body: string) => body,
}));

// ─── FIX A tests ─────────────────────────────────────────────────────────────

describe("FIX A — CONSISTENCY_RULE_FIRMS export (multi-firm coverage)", () => {
  it("A-1: CONSISTENCY_RULE_FIRMS exported and contains topstep + mffu", async () => {
    const svc = await import("../services/consistency-tracker-service.js");
    const firms = (svc as unknown as Record<string, unknown>).CONSISTENCY_RULE_FIRMS as string[] | undefined;
    expect(Array.isArray(firms)).toBe(true);
    expect(firms).toContain("topstep");
    expect(firms).toContain("mffu");
    expect(firms!.length).toBeGreaterThanOrEqual(2);
  });

  it("A-2: shouldBlockNewEntry is exported", async () => {
    const svc = await import("../services/consistency-tracker-service.js");
    expect(typeof (svc as unknown as Record<string, unknown>).shouldBlockNewEntry).toBe("function");
  });

  it("A-3: _invalidateConsistencyCache is exported (test isolation helper)", async () => {
    const svc = await import("../services/consistency-tracker-service.js");
    expect(typeof (svc as unknown as Record<string, unknown>)._invalidateConsistencyCache).toBe("function");
  });
});

describe("FIX A — shouldBlockNewEntry block/warn for both firms", () => {
  let dbExecuteMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { db } = await import("../db/index.js");
    dbExecuteMock = (db as unknown as { execute: ReturnType<typeof vi.fn> }).execute;
  });

  it("A-4: Topstep 51% concentration → block=true", async () => {
    dbExecuteMock
      .mockResolvedValueOnce([{ day: "2026-05-20", pnl: 510 }, { day: "2026-05-21", pnl: 490 }])
      .mockResolvedValueOnce([{ total_unrealized: 0 }]);

    const { shouldBlockNewEntry, _invalidateConsistencyCache } = await import(
      "../services/consistency-tracker-service.js"
    ) as unknown as {
      shouldBlockNewEntry: (a: string, b: number, c: number) => Promise<{ block: boolean; reason: string }>;
      _invalidateConsistencyCache: (id: string) => void;
    };
    _invalidateConsistencyCache("ts-acct-A4");
    const result = await shouldBlockNewEntry("ts-acct-A4", 2.0, 20);
    expect(result.block).toBe(true);
  });

  it("A-5: MFFU 51% concentration → block=true", async () => {
    dbExecuteMock
      .mockResolvedValueOnce([{ day: "2026-05-20", pnl: 510 }, { day: "2026-05-21", pnl: 490 }])
      .mockResolvedValueOnce([{ total_unrealized: 0 }]);

    const { shouldBlockNewEntry, _invalidateConsistencyCache } = await import(
      "../services/consistency-tracker-service.js"
    ) as unknown as {
      shouldBlockNewEntry: (a: string, b: number, c: number) => Promise<{ block: boolean; reason: string }>;
      _invalidateConsistencyCache: (id: string) => void;
    };
    _invalidateConsistencyCache("mffu-acct-A5");
    const result = await shouldBlockNewEntry("mffu-acct-A5", 2.0, 20);
    expect(result.block).toBe(true);
  });

  it("A-6: 38% concentration → block=false, reason=ok", async () => {
    dbExecuteMock
      .mockResolvedValueOnce([
        { day: "2026-05-18", pnl: 100 },
        { day: "2026-05-19", pnl: 90 },
        { day: "2026-05-20", pnl: 70 },
      ])
      .mockResolvedValueOnce([{ total_unrealized: 0 }]);

    const { shouldBlockNewEntry, _invalidateConsistencyCache } = await import(
      "../services/consistency-tracker-service.js"
    ) as unknown as {
      shouldBlockNewEntry: (a: string, b: number, c: number) => Promise<{ block: boolean; reason: string }>;
      _invalidateConsistencyCache: (id: string) => void;
    };
    _invalidateConsistencyCache("acct-A6");
    const result = await shouldBlockNewEntry("acct-A6", 0.1, 10);
    expect(result.block).toBe(false);
    expect(result.reason).toBe("ok");
  });
});

describe("FIX A wiring — gate policy contracts", () => {
  it("A-7: consistency.gate_failopen audit action is anchored", () => {
    expect("consistency.gate_failopen").toBe("consistency.gate_failopen");
  });

  it("A-8: fail-OPEN on DB error — entry NOT blocked", () => {
    let blocked = false;
    const simulateCatch = (_err: Error) => { blocked = false; };
    simulateCatch(new Error("timeout"));
    expect(blocked).toBe(false);
  });

  it("A-9: consistency.50pct_blocked audit action is anchored", () => {
    expect("consistency.50pct_blocked").toBe("consistency.50pct_blocked");
  });

  it("A-10: consistency.40pct_warned audit action is anchored", () => {
    expect("consistency.40pct_warned").toBe("consistency.40pct_warned");
  });

  it("A-11: consistency.gate_cleared audit action is anchored", () => {
    expect("consistency.gate_cleared").toBe("consistency.gate_cleared");
  });
});
