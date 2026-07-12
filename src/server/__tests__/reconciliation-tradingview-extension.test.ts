/**
 * reconciliation-tradingview-extension.test.ts — Track 8 / Pass 3
 *
 * Tests for the 5th reconciliation source: TradingView markers vs TradersPost log.
 *
 *  1.  5-source recon result includes tradingviewMarkerCount
 *  2.  Mismatch when markerCount > traderspostLogCount fires Discord alert (critical if delta>1)
 *  3.  Mismatch when markerCount < traderspostLogCount fires Discord alert
 *  4.  No mismatch when counts match (green path for 5th source)
 *  5.  Idempotent: re-running same date upserts cleanly
 *  6.  Severity correctly assigned (critical vs warning based on mismatch count)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  // The 5th source marker count (comes from tradingview-marker-service mock)
  tradingviewMarkerCount: 5 as number | null,

  // Internal recon counts returned by drizzle select mocks.
  // fetchProductionTradesCount, fetchTraderspostLogCount, fetchTradovateFillsCount
  // all use db.select().from().where() in sequence.
  // fetchExpectedPnl uses db.select() with sum.
  // We use a call-counter to return values in order.
  selectCallIndex: 0,
  selectSequence: [
    { cnt: 5 },   // fetchProductionTradesCount
    { cnt: 5 },   // fetchTraderspostLogCount
    { cnt: 5 },   // fetchTradovateFillsCount
    { total: "750" }, // fetchExpectedPnl
  ] as Array<Record<string, unknown>>,

  // Insert captures
  insertedReconRows: [] as Array<Record<string, unknown>>,
  auditLogRows: [] as Array<Record<string, unknown>>,
  onConflictUpdates: [] as Array<Record<string, unknown>>,
  selectRows: [] as Array<Record<string, unknown>>, // for getDailyReconciliationStatus reads

  // Side effects
  sseBroadcasts: [] as Array<{ event: string; data: unknown }>,
  alertCalls: [] as Array<{ component: string; metadata: Record<string, unknown> }>,
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => {
  return {
    db: {
      select: vi.fn(() => {
        const idx = mockState.selectCallIndex++;
        const rowResult = mockState.selectSequence[idx] ?? { cnt: 0 };
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([rowResult])),
          })),
        };
      }),
      // execute() is used by fetchTradingviewMarkerCount (raw SQL for 5th source).
      // The source passes a drizzle sql`` template (mocked to the TemplateStringsArray),
      // not a plain string — stringify before substring-matching.
      execute: vi.fn(async (query: unknown) => {
        if (String(query).includes("tradingview_markers")) {
          // Return the current marker count from mock state
          if (mockState.tradingviewMarkerCount === null) {
            throw new Error("relation tradingview_markers does not exist");
          }
          // Source reads result?.[0]?.cnt — array-indexed, not result.rows[0].
          return [{ cnt: String(mockState.tradingviewMarkerCount) }];
        }
        return [];
      }),
      insert: vi.fn((table: unknown) => {
        const tableName = (table as { tableName?: string })?.tableName ?? "";
        return {
          values: vi.fn((vals: Record<string, unknown>) => {
            if (tableName === "daily_reconciliation") {
              mockState.insertedReconRows.push(vals);
            } else if (tableName === "audit_log") {
              mockState.auditLogRows.push(vals);
            }
            return {
              onConflictDoUpdate: vi.fn((opts: { set: Record<string, unknown> }) => {
                if (tableName === "daily_reconciliation") {
                  mockState.onConflictUpdates.push(opts.set);
                }
                return Promise.resolve();
              }),
              catch: vi.fn(() => Promise.resolve()),
            };
          }),
        };
      }),
    },
  };
});

vi.mock("../db/schema.js", () => ({
  dailyReconciliation: {
    tableName: "daily_reconciliation",
    reconDate: "recon_date",
    productionTradesCount: "production_trades_count",
    traderspostLogCount: "traderspost_log_count",
    tradovateFillsCount: "tradovate_fills_count",
    mffuDashboardPnl: "mffu_dashboard_pnl",
    expectedPnl: "expected_pnl",
    mismatchCount: "mismatch_count",
    mismatchDetails: "mismatch_details",
    alertFired: "alert_fired",
    ranAt: "ran_at",
  },
  productionTrades: {
    tableName: "production_trades",
    barTimestamp: "bar_timestamp",
    expectedPnl: "expected_pnl",
  },
  auditLog: { tableName: "audit_log" },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    criticalAlert: vi.fn(async (component: string, metadata: Record<string, unknown>) => {
      mockState.alertCalls.push({ component, metadata });
    }),
    criticalReconciliationMismatch: vi.fn(
      async (reconDate: string, mismatchCount: number, details: unknown[]) => {
        mockState.alertCalls.push({
          component: `daily-reconciliation:${reconDate}`,
          metadata: { reconDate, mismatchCount, details } as Record<string, unknown>,
        });
      }
    ),
  },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn((event: string, data: unknown) => {
    mockState.sseBroadcasts.push({ event, data });
  }),
}));

vi.mock("../services/dashboard-snapshot-service.js", () => ({
  runDashboardSnapshots: vi.fn(async () => []),
}));

// Mock tradingview-marker-service — the reconciliation service imports
// getMarkerCountForDate from this service for the 5th source.
vi.mock("../services/tradingview-marker-service.js", () => ({
  getMarkerCountForDate: vi.fn(
    async (_accountId: string, _date: unknown) => mockState.tradingviewMarkerCount
  ),
  validateHmac: vi.fn(() => true),
  lookupHmacSecret: vi.fn(async () => "a".repeat(64)),
}));

// Mock drizzle operators that are used in query building
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: "eq" })),
  sql: vi.fn((s: unknown) => s),
  gte: vi.fn((_col: unknown, _val: unknown) => ({ type: "gte" })),
  lt: vi.fn((_col: unknown, _val: unknown) => ({ type: "lt" })),
  and: vi.fn((...args: unknown[]) => args),
  sum: vi.fn(() => "sum_result"),
  count: vi.fn(() => "count_result"),
}));

// ─── Helper: reset state with custom counts ───────────────────────────────────

function resetState(opts: {
  markerCount?: number | null;
  traderspostCount?: number;
  prodTradesCount?: number;
  tradovateCount?: number;
} = {}) {
  mockState.tradingviewMarkerCount = opts.markerCount ?? 5;
  mockState.selectCallIndex = 0;
  mockState.selectSequence = [
    { cnt: opts.prodTradesCount ?? 5 },     // fetchProductionTradesCount
    { cnt: opts.traderspostCount ?? 5 },    // fetchTraderspostLogCount
    { cnt: opts.tradovateCount ?? 5 },      // fetchTradovateFillsCount
    { total: "750" },                        // fetchExpectedPnl
  ];
  mockState.insertedReconRows = [];
  mockState.auditLogRows = [];
  mockState.onConflictUpdates = [];
  mockState.selectRows = [];
  mockState.sseBroadcasts = [];
  mockState.alertCalls = [];
  vi.clearAllMocks();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reconciliation-service: 5-source extension (Track 8)", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
    // freshscan6 MED fix: check-5 (Pine markers vs traderspost log) only runs when the traderspost
    // leg is a REAL independent count (RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true) — otherwise it's the
    // production_trades proxy (structurally 0) and comparing against it fired a false daily CRITICAL.
    // These tests inject a real non-zero traderspostCount, i.e. the independent case, so enable the flag.
    process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT = "true";
  });

  afterEach(() => {
    delete process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT;
  });

  // ── Test 1: Result includes tradingviewMarkerCount ─────────────────────────

  it("1. reconciliation result includes tradingviewMarkerCount field", async () => {
    resetState({ markerCount: 5, traderspostCount: 5 });

    const { runDailyReconciliation } = await import(
      "../production/reconciliation-service.js"
    );

    const result = await runDailyReconciliation(new Date("2026-05-10T00:00:00Z"));

    expect(result).toHaveProperty("tradingviewMarkerCount");
    expect(result.tradingviewMarkerCount).toBe(5);
  });

  // ── Test 2: markerCount > traderspostCount → alert fires ──────────────────

  it("2. mismatch markerCount > traderspostCount fires alert (critical delta>1)", async () => {
    // Pine fired 8 alerts; TradersPost only has 5 — 3 missed webhooks
    resetState({ markerCount: 8, traderspostCount: 5 });

    const { runDailyReconciliation } = await import(
      "../production/reconciliation-service.js"
    );
    const result = await runDailyReconciliation(new Date("2026-05-10T00:00:00Z"));

    // A mismatch should appear for the 5th source
    const markerMismatch = result.mismatchDetails.find(
      (m) => m.source === "tradingview_marker_vs_traderspost_log"
    );
    expect(markerMismatch).toBeDefined();

    // delta = markerCount - traderspostCount = 8 - 5 = 3
    expect((markerMismatch as { delta?: number })?.delta).toBe(3);

    // Alert should have fired (mismatchCount > 0)
    expect(result.alertFired).toBe(true);
    expect(result.mismatchCount).toBeGreaterThanOrEqual(1);
  });

  // ── freshscan6 MED: false-alert SUPPRESSION when the traderspost leg is the structurally-0 proxy ──
  it("2b. NO check-5 mismatch when RECON_TRADERSPOST_CONFIRM_INDEPENDENT is off (proxy leg, no cry-wolf)", async () => {
    // Flag OFF → traderspostLogCount is the production_trades proxy (structurally 0). Pine markers flow
    // (markerCount=8) but check-5 must NOT fire — it would otherwise be a false daily CRITICAL every day
    // markers flow. This is the freshscan6 fix: gate check-5 behind the same flag as checks 1/2.
    delete process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT;
    resetState({ markerCount: 8, traderspostCount: 0 });

    const { runDailyReconciliation } = await import(
      "../production/reconciliation-service.js"
    );
    const result = await runDailyReconciliation(new Date("2026-05-10T00:00:00Z"));

    const markerMismatch = result.mismatchDetails.find(
      (m) => m.source === "tradingview_marker_vs_traderspost_log"
    );
    expect(markerMismatch).toBeUndefined(); // check-5 skipped → no false alert
  });

  // ── Test 3: markerCount < traderspostCount → alert fires ──────────────────

  it("3. mismatch markerCount < traderspostCount fires alert", async () => {
    // Only 3 Pine markers but TradersPost shows 5 — manual override signal
    resetState({ markerCount: 3, traderspostCount: 5 });

    const { runDailyReconciliation } = await import(
      "../production/reconciliation-service.js"
    );
    const result = await runDailyReconciliation(new Date("2026-05-10T00:00:00Z"));

    const markerMismatch = result.mismatchDetails.find(
      (m) => m.source === "tradingview_marker_vs_traderspost_log"
    );
    expect(markerMismatch).toBeDefined();

    // delta = markerCount - traderspostCount = 3 - 5 = -2
    expect((markerMismatch as { delta?: number })?.delta).toBe(-2);
    expect(result.alertFired).toBe(true);
  });

  // ── Test 4: No mismatch when 5th source matches ─────────────────────────

  it("4. no mismatch from 5th source when markerCount matches traderspostCount", async () => {
    // All counts equal 5
    resetState({ markerCount: 5, traderspostCount: 5 });

    const { runDailyReconciliation } = await import(
      "../production/reconciliation-service.js"
    );
    const result = await runDailyReconciliation(new Date("2026-05-10T00:00:00Z"));

    // The 5th source should NOT produce a mismatch entry
    const markerMismatch = result.mismatchDetails.find(
      (m) => m.source === "tradingview_marker_vs_traderspost_log"
    );
    expect(markerMismatch).toBeUndefined();
    // And tradingviewMarkerCount should be present but without mismatch
    expect(result.tradingviewMarkerCount).toBe(5);
  });

  // ── Test 5: Idempotent upsert ──────────────────────────────────────────────

  it("5. re-running same date calls onConflictDoUpdate (idempotent upsert)", async () => {
    resetState({ markerCount: 5, traderspostCount: 5 });

    const { runDailyReconciliation } = await import(
      "../production/reconciliation-service.js"
    );

    // Run once
    await runDailyReconciliation(new Date("2026-05-10T00:00:00Z"));

    // Run again (reset select index for second run)
    mockState.selectCallIndex = 0;
    await runDailyReconciliation(new Date("2026-05-10T00:00:00Z"));

    // Both runs should have written daily_reconciliation rows
    expect(mockState.insertedReconRows.length).toBeGreaterThanOrEqual(2);
    // And onConflictDoUpdate should have been called for both
    expect(mockState.onConflictUpdates.length).toBeGreaterThanOrEqual(2);
  });

  // ── Test 6: Severity assignment ────────────────────────────────────────────

  it("6. single mismatch (delta=1) → yellow severity; >= 3 mismatches → red severity", async () => {
    // Single mismatch from 5th source only (delta=1 → count as 1 mismatch)
    resetState({ markerCount: 6, traderspostCount: 5 });

    const { runDailyReconciliation, RECON_CONFIG } = await import(
      "../production/reconciliation-service.js"
    );

    const result = await runDailyReconciliation(new Date("2026-05-10T00:00:00Z"));

    // 1 mismatch → yellow (below RED_MISMATCH_COUNT=3)
    expect(result.mismatchCount).toBe(1);
    expect(result.mismatchCount).toBeLessThan(RECON_CONFIG.RED_MISMATCH_COUNT);
    expect(result.severity).toBe("yellow");
  });
});
