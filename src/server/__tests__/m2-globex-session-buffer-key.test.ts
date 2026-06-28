/**
 * m2-globex-session-buffer-key.test.ts — MED M-2
 *
 * The raw bar buffer in paper-trading-stream.ts must reset on the CME Globex
 * session boundary (18:00 ET), NOT ET calendar midnight. Prior code keyed the
 * pushBar() reset on toEasternDateString (ET midnight) and only stayed correct
 * because paper-signal-service.ts::filterToGlobexSession re-filtered before every
 * VWAP read — any future callsite computing VWAP before the filter would have
 * contaminated the next session's anchor with 17:00–18:00 ET bars.
 *
 * These tests exercise the exported toGlobexSessionDateString() helper directly
 * (mirrors the existing paper-trading-stream.parity.test.ts pattern) to verify
 * the 18:00 ET boundary mapping, DST correctness, and parity with both the
 * backtester's _assign_globex_session_id() convention (ET hour >= 18 → next day)
 * and the live filterToGlobexSession key (no breakage of the filter path).
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mock infrastructure so the module imports cleanly under vitest ──────────
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
  },
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../data/fetchers/massive.js", () => ({
  createMassiveFetcher: vi.fn(() => ({
    createWebSocket: vi.fn(),
    fetchBars: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock("../services/paper-execution-service.js", () => ({
  updatePositionPrices: vi.fn(),
}));
vi.mock("../services/paper-signal-service.js", () => ({
  evaluateSignals: vi.fn(),
  updateStateOnly: vi.fn(),
  ATR: vi.fn(() => 0),
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { get: vi.fn(() => ({ call: vi.fn() })) },
}));
vi.mock("../services/volume-profile-service.js", () => ({
  getDevelopingSessionPoc: vi.fn().mockResolvedValue(null),
}));
vi.mock("../services/smt-live-service.js", () => ({
  initSmtBarBufferProvider: vi.fn(),
}));

import { toGlobexSessionDateString } from "../services/paper-trading-stream.js";
import { toEasternDateString, toFuturesTradingDayString } from "../services/paper-risk-gate.js";

describe("toGlobexSessionDateString — 18:00 ET Globex session key (M-2)", () => {
  it("winter 18:00 ET maps to the NEXT calendar day's session", () => {
    // 2026-01-15 18:00 ET (EST, UTC-5) = 2026-01-15T23:00:00Z
    const bar = new Date("2026-01-15T23:00:00.000Z");
    expect(toGlobexSessionDateString(bar)).toBe("2026-01-16");
    // ET calendar midnight keyer (the OLD buffer key) still shows the prior day
    expect(toEasternDateString(bar)).toBe("2026-01-15");
  });

  it("winter 17:59 ET stays on the CURRENT session", () => {
    // 2026-01-15 17:59 ET (EST) = 2026-01-15T22:59:00Z
    const bar = new Date("2026-01-15T22:59:00.000Z");
    expect(toGlobexSessionDateString(bar)).toBe("2026-01-15");
  });

  it("summer 18:00 ET maps to the NEXT calendar day's session", () => {
    // 2026-06-15 18:00 ET (EDT, UTC-4) = 2026-06-15T22:00:00Z
    const bar = new Date("2026-06-15T22:00:00.000Z");
    expect(toGlobexSessionDateString(bar)).toBe("2026-06-16");
    expect(toEasternDateString(bar)).toBe("2026-06-15");
  });

  it("summer 17:59 ET stays on the CURRENT session", () => {
    // 2026-06-15 17:59 ET (EDT) = 2026-06-15T21:59:00Z
    const bar = new Date("2026-06-15T21:59:00.000Z");
    expect(toGlobexSessionDateString(bar)).toBe("2026-06-15");
  });

  it("ET calendar midnight does NOT reset the Globex session (overnight bars)", () => {
    // The bug class M-2 closes: a 19:00 ET overnight bar is mid-session, but the
    // OLD ET-midnight key would already have rolled to the next calendar day at
    // 00:00 ET. The Globex key keeps the whole 18:00→17:00 span on one session.
    // 2026-01-15 19:00 ET = 2026-01-16T00:00:00Z (UTC midnight, still 19:00 ET)
    const overnightBar = new Date("2026-01-16T00:00:00.000Z");
    // 2026-01-16 00:30 ET (just past ET midnight) = 2026-01-16T05:30:00Z
    const pastEtMidnight = new Date("2026-01-16T05:30:00.000Z");
    // Both belong to the SAME Globex session (the "2026-01-16" session that opened
    // at 18:00 ET on 2026-01-15) — no mid-session reset.
    expect(toGlobexSessionDateString(overnightBar)).toBe("2026-01-16");
    expect(toGlobexSessionDateString(pastEtMidnight)).toBe("2026-01-16");
    // The OLD ET-midnight keyer would have split these two into different days.
    expect(toEasternDateString(overnightBar)).not.toBe(toEasternDateString(pastEtMidnight));
  });

  it("RTH bar (09:30 ET) keys to its own calendar day", () => {
    // 2026-06-15 09:30 ET (EDT) = 2026-06-15T13:30:00Z
    const bar = new Date("2026-06-15T13:30:00.000Z");
    expect(toGlobexSessionDateString(bar)).toBe("2026-06-15");
  });

  it("Sunday 18:00 ET Globex reopen maps to Monday's session", () => {
    // 2026-05-03 (Sun) 18:00 ET (EDT) = 2026-05-03T22:00:00Z → Monday session
    const bar = new Date("2026-05-03T22:00:00.000Z");
    expect(toGlobexSessionDateString(bar)).toBe("2026-05-04");
  });

  // ── Parity: agrees with the live filterToGlobexSession key on real bars ──────
  // filterToGlobexSession uses toFuturesTradingDayString (+7h / 17:00 boundary).
  // On every real Globex bar (none exist in the 17:00–18:00 maintenance pause),
  // the +6h/18:00 buffer key and the +7h/17:00 filter key agree — so resetting the
  // buffer on the Globex boundary does NOT break the existing filter path.
  it.each([
    ["winter 09:30 ET (RTH)", "2026-01-15T14:30:00.000Z"],
    ["winter 18:05 ET (Globex open)", "2026-01-15T23:05:00.000Z"],
    ["winter 23:30 ET (overnight)", "2026-01-16T04:30:00.000Z"],
    ["winter 03:00 ET (London)", "2026-01-15T08:00:00.000Z"],
    ["summer 09:30 ET (RTH)", "2026-06-15T13:30:00.000Z"],
    ["summer 18:05 ET (Globex open)", "2026-06-15T22:05:00.000Z"],
    ["summer 23:30 ET (overnight)", "2026-06-16T03:30:00.000Z"],
  ])("Globex buffer key agrees with filterToGlobexSession key on real bar: %s", (_label, iso) => {
    const bar = new Date(iso);
    expect(toGlobexSessionDateString(bar)).toBe(toFuturesTradingDayString(bar));
  });
});
