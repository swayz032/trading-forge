/**
 * Phase 1.1 — Journal Enrichment: session classification tests.
 *
 * Verifies classifySessionType() produces the correct bucket for known UTC
 * timestamps in both DST and standard time.  This is a pure-computation
 * function (no DB, no Python) so no mocks are needed beyond the module
 * infrastructure imports.
 *
 * Parity assumption: sessionType written to paperTrades must match the same
 * bucket logic used in slippage.py session multipliers (OVERNIGHT=2x,
 * LONDON=1.5x, RTH=1x).  Misclassification would cause a parity gap between
 * what the trade journal says and what slippage was actually applied.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mock all DB/infrastructure dependencies before any imports ───────────────
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
  },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn().mockReturnValue({
      setAttribute: vi.fn(),
      end: vi.fn(),
    }),
  },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn().mockReturnValue("2026-03-27"),
}));

import { classifySessionType } from "./paper-execution-service.js";

// ─── Helper: build a UTC Date from ET time + UTC offset ───────────────────────
// DST 2026: starts 2026-03-08 (second Sunday March), ends 2026-11-01 (first Sunday Nov)
// Standard time 2026 date: 2026-01-15 (January, no DST) → ET = UTC-5
// DST time 2026 date: 2026-06-15 (June, DST active) → ET = UTC-4

function utcFromEt(etHour: number, etMinute: number, isDst: boolean): Date {
  const offsetHours = isDst ? 4 : 5; // UTC = ET + offset
  const utcHour = etHour + offsetHours;
  const year = isDst ? 2026 : 2026;
  const month = isDst ? 5 : 0; // June=5 (DST), January=0 (standard), 0-indexed
  const day = 15;
  // Handle day overflow
  const adjustedHour = utcHour % 24;
  const dayAdd = Math.floor(utcHour / 24);
  return new Date(Date.UTC(year, month, day + dayAdd, adjustedHour, etMinute, 0));
}

describe("classifySessionType — DST active (summer, UTC-4)", () => {
  const dst = true;

  it("01:00 ET → ASIA", () => {
    expect(classifySessionType(utcFromEt(1, 0, dst))).toBe("ASIA");
  });

  it("02:59 ET → ASIA (boundary)", () => {
    expect(classifySessionType(utcFromEt(2, 59, dst))).toBe("ASIA");
  });

  it("03:00 ET → LONDON", () => {
    expect(classifySessionType(utcFromEt(3, 0, dst))).toBe("LONDON");
  });

  it("08:00 ET → LONDON", () => {
    expect(classifySessionType(utcFromEt(8, 0, dst))).toBe("LONDON");
  });

  it("09:29 ET → LONDON (just before NY_OPEN)", () => {
    expect(classifySessionType(utcFromEt(9, 29, dst))).toBe("LONDON");
  });

  it("09:30 ET → NY_OPEN", () => {
    expect(classifySessionType(utcFromEt(9, 30, dst))).toBe("NY_OPEN");
  });

  it("10:00 ET → NY_OPEN (within 09:30–10:30 window)", () => {
    expect(classifySessionType(utcFromEt(10, 0, dst))).toBe("NY_OPEN");
  });

  it("10:29 ET → NY_OPEN (boundary)", () => {
    expect(classifySessionType(utcFromEt(10, 29, dst))).toBe("NY_OPEN");
  });

  it("10:30 ET → NY_CORE", () => {
    expect(classifySessionType(utcFromEt(10, 30, dst))).toBe("NY_CORE");
  });

  it("12:00 ET → NY_CORE", () => {
    expect(classifySessionType(utcFromEt(12, 0, dst))).toBe("NY_CORE");
  });

  it("14:29 ET → NY_CORE (boundary)", () => {
    expect(classifySessionType(utcFromEt(14, 29, dst))).toBe("NY_CORE");
  });

  it("14:30 ET → NY_CLOSE", () => {
    expect(classifySessionType(utcFromEt(14, 30, dst))).toBe("NY_CLOSE");
  });

  it("15:30 ET → NY_CLOSE", () => {
    expect(classifySessionType(utcFromEt(15, 30, dst))).toBe("NY_CLOSE");
  });

  it("15:59 ET → NY_CLOSE (boundary)", () => {
    expect(classifySessionType(utcFromEt(15, 59, dst))).toBe("NY_CLOSE");
  });

  it("16:00 ET → CME_HALT (settlement halt 16:00–17:00 ET)", () => {
    expect(classifySessionType(utcFromEt(16, 0, dst))).toBe("CME_HALT");
  });

  it("20:00 ET → OVERNIGHT", () => {
    expect(classifySessionType(utcFromEt(20, 0, dst))).toBe("OVERNIGHT");
  });

  it("23:30 ET → OVERNIGHT (late evening)", () => {
    expect(classifySessionType(utcFromEt(23, 30, dst))).toBe("OVERNIGHT");
  });
});

describe("classifySessionType — standard time (winter, UTC-5)", () => {
  const dst = false;

  it("01:00 ET → ASIA", () => {
    expect(classifySessionType(utcFromEt(1, 0, dst))).toBe("ASIA");
  });

  it("03:00 ET → LONDON", () => {
    expect(classifySessionType(utcFromEt(3, 0, dst))).toBe("LONDON");
  });

  it("09:30 ET → NY_OPEN", () => {
    expect(classifySessionType(utcFromEt(9, 30, dst))).toBe("NY_OPEN");
  });

  it("10:30 ET → NY_CORE", () => {
    expect(classifySessionType(utcFromEt(10, 30, dst))).toBe("NY_CORE");
  });

  it("14:30 ET → NY_CLOSE", () => {
    expect(classifySessionType(utcFromEt(14, 30, dst))).toBe("NY_CLOSE");
  });

  it("16:00 ET → CME_HALT (settlement halt 16:00–17:00 ET)", () => {
    expect(classifySessionType(utcFromEt(16, 0, dst))).toBe("CME_HALT");
  });
});

describe("classifySessionType — ET offset (DST transitions)", () => {
  it("2026-03-08 02:00 UTC = DST start — still maps correctly (standard, ET-5 until 07:00 UTC)", () => {
    // 2026-03-08 is the DST start day. At 06:59 UTC it is still standard time (01:59 ET).
    // ASIA window spans 00:00–03:00 ET, so ET 01:59 → ASIA.
    const dt = new Date("2026-03-08T06:59:00Z");
    expect(classifySessionType(dt)).toBe("ASIA");
  });

  it("2026-11-01 05:00 UTC = standard time resumed (ET-5) — 00:00 ET → ASIA", () => {
    // 2026-11-01 is DST end day. At 05:00 UTC standard time applies (EST=UTC-5 → 00:00 ET).
    const dt = new Date("2026-11-01T05:00:00Z");
    expect(classifySessionType(dt)).toBe("ASIA");
  });
});
