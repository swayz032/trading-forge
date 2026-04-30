/**
 * Tests for Phase 4.6 — Paper Session Feedback Service
 *
 * Covers:
 *   1. computeSessionFeedback returns null when session is not found
 *   2. computeSessionFeedback returns a zero-trade summary when there are no trades
 *   3. Win rate computation (overall and by session window)
 *   4. P&L totals and best/worst session windows
 *   5. Stop tightness ratio (median MAE / |avg_loss|)
 *   6. Realized R:R computation (MFE / |MAE| per trade)
 *   7. MFE capture rate (avg_win / avg_mfe_on_winners)
 *   8. Win rate by side (long vs short)
 *   9. hasMaeData flag is false when all MAE/MFE values are null
 *  10. Notes string is non-empty and informative
 *  11. computeAndPersistSessionFeedback catches and suppresses DB errors
 *  12. Schema: paper_session_feedback is referenced in paper.ts routes
 *  13. Route: GET /api/paper/sessions/:id/feedback is defined
 *  14. Route: GET /api/paper/strategies/:strategyId/feedback is defined
 *  15. Auto-stop path: computeAndPersistSessionFeedback is called in scheduler.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  },
}));
vi.mock("../db/schema.js", () => ({
  paperTrades: {},
  paperSessions: {},
  paperSessionFeedback: {},
  strategies: {},
}));
vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Re-import after mocking
import { db } from "../db/index.js";
import { computeSessionFeedback, computeAndPersistSessionFeedback } from "../services/paper-session-feedback-service.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MockTrade = {
  pnl: string;
  grossPnl: string | null;
  side: "long" | "short";
  entryTime: Date;
  exitTime: Date;
  sessionType: string | null;
  mae: string | null;
  mfe: string | null;
};

function mockSession(overrides: Partial<{
  strategyId: string | null;
  startedAt: Date;
  stoppedAt: Date;
}> = {}) {
  return {
    strategyId: overrides.strategyId ?? "strat-uuid-1",
    startedAt: overrides.startedAt ?? new Date("2026-01-01T09:30:00Z"),
    stoppedAt: overrides.stoppedAt ?? new Date("2026-01-01T16:00:00Z"),
  };
}

function setupDbMocks(session: ReturnType<typeof mockSession> | null, trades: MockTrade[]) {
  let callCount = 0;
  // db.select() is called twice: once for trades, once for session
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // First call: trades query
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.resolve(trades)),
          })),
        })),
      };
    }
    // Second call: session query
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(session ? [session] : [])),
      })),
    };
  });
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe("computeSessionFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when session does not exist", async () => {
    setupDbMocks(null, []);
    const result = await computeSessionFeedback("missing-session-id");
    expect(result).toBeNull();
  });

  it("returns a zero-trade summary when there are no trades", async () => {
    setupDbMocks(mockSession(), []);
    const result = await computeSessionFeedback("session-1");
    expect(result).not.toBeNull();
    expect(result!.totalTrades).toBe(0);
    expect(result!.winRate).toBeNull();
    expect(result!.hasMaeData).toBe(false);
    expect(result!.notes).toContain("No trades");
  });

  it("computes correct win rate for a set of trades", async () => {
    const trades: MockTrade[] = [
      { pnl: "100", grossPnl: "105", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
      { pnl: "-50", grossPnl: "-47", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
      { pnl: "200", grossPnl: "205", side: "short", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: null, mfe: null },
      { pnl: "-75", grossPnl: "-72", side: "short", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: null, mfe: null },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-2");
    expect(result).not.toBeNull();
    expect(result!.totalTrades).toBe(4);
    // 2 winners out of 4
    expect(result!.winRate).toBeCloseTo(0.5, 5);
  });

  it("computes win rate by session window correctly", async () => {
    const trades: MockTrade[] = [
      // NY_OPEN: 2 trades, 2 wins
      { pnl: "100", grossPnl: "105", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
      { pnl: "150", grossPnl: "155", side: "short", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
      // LONDON: 2 trades, 0 wins
      { pnl: "-80", grossPnl: "-77", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "LONDON", mae: null, mfe: null },
      { pnl: "-60", grossPnl: "-57", side: "short", entryTime: new Date(), exitTime: new Date(), sessionType: "LONDON", mae: null, mfe: null },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-3");
    expect(result!.winRateBySession["NY_OPEN"]).toBeCloseTo(1.0, 5);
    expect(result!.winRateBySession["LONDON"]).toBeCloseTo(0.0, 5);
    expect(result!.bestSessionWindow).toBe("NY_OPEN");
    expect(result!.worstSessionWindow).toBe("LONDON");
  });

  it("computes P&L totals correctly", async () => {
    const trades: MockTrade[] = [
      { pnl: "300", grossPnl: "310", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: null, mfe: null },
      { pnl: "-100", grossPnl: "-95", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: null, mfe: null },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-4");
    expect(result!.totalPnl).toBeCloseTo(200, 5);
    expect(result!.pnlBySession["NY_CORE"]).toBeCloseTo(200, 5);
  });

  it("computes profit factor as gross_profit / gross_loss", async () => {
    const trades: MockTrade[] = [
      { pnl: "400", grossPnl: "410", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
      { pnl: "-100", grossPnl: "-95", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-5");
    // gross_profit = 400, gross_loss = 100, PF = 4.0
    expect(result!.profitFactor).toBeCloseTo(4.0, 5);
  });

  it("sets hasMaeData=false when all mae/mfe are null", async () => {
    const trades: MockTrade[] = [
      { pnl: "100", grossPnl: "105", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-6");
    expect(result!.hasMaeData).toBe(false);
    expect(result!.medianMae).toBeNull();
    expect(result!.avgRrRealized).toBeNull();
  });

  it("computes stop tightness ratio when MAE data is available", async () => {
    // If median_mae = 60 and avg_loss = -40, ratio = 60/40 = 1.5 (too tight)
    const trades: MockTrade[] = [
      { pnl: "100", grossPnl: "105", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: "-50", mfe: "200" },
      { pnl: "-40", grossPnl: "-37", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: "-60", mfe: "20" },
      { pnl: "-40", grossPnl: "-37", side: "short", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: "-70", mfe: "15" },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-7");
    expect(result!.hasMaeData).toBe(true);
    // median of [50, 60, 70] = 60
    expect(result!.medianMae).toBeCloseTo(60, 5);
    // avg_loss = mean([-40, -40]) = -40
    expect(result!.avgLoss).toBeCloseTo(-40, 5);
    // stop_tightness = 60 / 40 = 1.5
    expect(result!.stopTightnessRatio).toBeCloseTo(1.5, 5);
  });

  it("computes average realized R:R from MFE/|MAE| per trade", async () => {
    // trade1: MFE=200, MAE=50 → R:R = 4.0
    // trade2: MFE=60, MAE=60  → R:R = 1.0
    const trades: MockTrade[] = [
      { pnl: "100", grossPnl: "105", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: "-50", mfe: "200" },
      { pnl: "-40", grossPnl: "-37", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: "-60", mfe: "60" },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-8");
    // mean([4.0, 1.0]) = 2.5
    expect(result!.avgRrRealized).toBeCloseTo(2.5, 5);
  });

  it("computes MFE capture rate as avg_win / avg_mfe_on_winners", async () => {
    // winner: pnl=100, mfe=200 → capture = 100/200 = 0.50
    const trades: MockTrade[] = [
      { pnl: "100", grossPnl: "105", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: "-30", mfe: "200" },
      { pnl: "-50", grossPnl: "-47", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: "-70", mfe: "40" },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-9");
    expect(result!.avgMfeOnWinners).toBeCloseTo(200, 5);
    expect(result!.mfeCaptureRate).toBeCloseTo(0.5, 5);
  });

  it("computes win rate by side correctly", async () => {
    const trades: MockTrade[] = [
      { pnl: "100", grossPnl: "105", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
      { pnl: "-50", grossPnl: "-47", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
      { pnl: "200", grossPnl: "205", side: "short", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: null, mfe: null },
      { pnl: "150", grossPnl: "155", side: "short", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: null, mfe: null },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-10");
    // long: 1 win / 2 = 0.5
    expect(result!.winRateBySide["long"]).toBeCloseTo(0.5, 5);
    // short: 2 wins / 2 = 1.0
    expect(result!.winRateBySide["short"]).toBeCloseTo(1.0, 5);
  });

  it("produces a non-empty notes string", async () => {
    const trades: MockTrade[] = [
      { pnl: "100", grossPnl: "105", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_OPEN", mae: null, mfe: null },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-11");
    expect(typeof result!.notes).toBe("string");
    expect(result!.notes.length).toBeGreaterThan(0);
    expect(result!.notes).toContain("trade");
  });

  it("notes include stop tightness warning when ratio > 1.2", async () => {
    const trades: MockTrade[] = [
      { pnl: "-40", grossPnl: "-37", side: "long", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: "-80", mfe: "10" },
      { pnl: "-40", grossPnl: "-37", side: "short", entryTime: new Date(), exitTime: new Date(), sessionType: "NY_CORE", mae: "-80", mfe: "10" },
    ];
    setupDbMocks(mockSession(), trades);

    const result = await computeSessionFeedback("session-12");
    // median_mae=80, avg_loss=-40, ratio=2.0 → too tight
    expect(result!.notes).toContain("too tight");
  });
});

describe("computeAndPersistSessionFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when db.delete fails", async () => {
    setupDbMocks(mockSession(), []);
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
      where: vi.fn(() => Promise.reject(new Error("db error"))),
    });
    await expect(computeAndPersistSessionFeedback("session-err")).resolves.not.toThrow();
  });

  it("does not throw when session is not found", async () => {
    setupDbMocks(null, []);
    await expect(computeAndPersistSessionFeedback("missing")).resolves.not.toThrow();
  });
});

// ─── Source-level checks (no real DB) ────────────────────────────────────────

describe("paper-session-feedback route integration", () => {
  it("paper.ts imports paperSessionFeedback from schema", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
      "utf8",
    );
    expect(src).toMatch(/paperSessionFeedback/);
    expect(src).toMatch(/sessions\/:id\/feedback/);
    expect(src).toMatch(/strategies\/:strategyId\/feedback/);
  });

  it("paper.ts imports computeAndPersistSessionFeedback", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
      "utf8",
    );
    expect(src).toMatch(/computeAndPersistSessionFeedback/);
  });

  it("scheduler.ts imports computeAndPersistSessionFeedback", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/scheduler.ts"),
      "utf8",
    );
    expect(src).toMatch(/computeAndPersistSessionFeedback/);
    // Should appear at least twice: import + call in stopPaperSession
    const occurrences = (src.match(/computeAndPersistSessionFeedback/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("schema.ts defines paperSessionFeedback table", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/db/schema.ts"),
      "utf8",
    );
    expect(src).toMatch(/paperSessionFeedback/);
    expect(src).toMatch(/paper_session_feedback/);
    expect(src).toMatch(/win_rate_by_session/);
    expect(src).toMatch(/stop_tightness_ratio/);
    expect(src).toMatch(/avg_rr_realized/);
    expect(src).toMatch(/mfe_capture_rate/);
  });

  it("paper.ts broadcasts paper:session-feedback-computed SSE event on stop", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
      "utf8",
    );
    expect(src).toMatch(/paper:session-feedback-computed/);
    expect(src).toMatch(/broadcastSSE\("paper:session-feedback-computed"/);
  });

  it("paper.ts calls computeAndPersistSessionFeedback from the kill path", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
      "utf8",
    );
    // Verify there are at least two invocation sites (stop + kill)
    const occurrences = (src.match(/computeAndPersistSessionFeedback/g) ?? []).length;
    // One import + two call sites = minimum 3
    expect(occurrences).toBeGreaterThanOrEqual(3);
    // Verify the kill-path comment is present
    expect(src).toMatch(/kill path/);
  });

  it("migration 0037 defines the paper_session_feedback table", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/db/migrations/0037_paper_session_feedback.sql"),
      "utf8",
    );
    expect(src).toMatch(/CREATE TABLE/);
    expect(src).toMatch(/paper_session_feedback/);
    expect(src).toMatch(/stop_tightness_ratio/);
    expect(src).toMatch(/win_rate_by_session/);
    expect(src).toMatch(/mfe_capture_rate/);
    expect(src).toMatch(/has_mae_data/);
  });
});
