/**
 * wave28-pass-a-digest-cron.test.ts — Wave 28 Pass A.4 (observability-reliability)
 *
 * Tests composite-health-digest-service.ts
 *
 * Coverage:
 *   1. Happy path: 5 active strategies, all HEALTHY → Discord notifyInfo called + audit written
 *   2. dryRun=true → no Discord post, audit row still written with dry_run=true
 *   3. DST guard at ET-hour=16 → skipped + digest_skipped_dst_guard audit emitted
 *   4. DST guard at ET-hour=18 → skipped + digest_skipped_dst_guard audit emitted
 *   5. Lock contention → skipped + digest_skipped_lock_contention audit emitted
 *   6. Pipeline PAUSED path: pipeline-exempt registration verified (_PIPELINE_GATE_EXEMPT set)
 *   7. Mixed verdicts: HEALTHY 3 / CRITICAL 2 → message includes both counts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoist-safe module mocks ────────────────────────────────────────────────────

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { mockInsertAuditRowSafe } = vi.hoisted(() => ({
  mockInsertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mockInsertAuditRowSafe,
}));

const { mockNotifyInfo } = vi.hoisted(() => ({
  mockNotifyInfo: vi.fn(),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyInfo: mockNotifyInfo,
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

// DB mock — inArray query for active strategies
const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: {
    id: "id",
    name: "name",
    lifecycleState: "lifecycle_state",
  },
  backtests: {},
  monteCarloRuns: {},
  walkForwardWindows: {},
  tradeCritique: {},
  promptVersions: {},
  deeparForecasts: {},
  syntheticBlackSwanRuns: {},
  nemoScenarioBank: {},
  quantumMcRuns: {},
  auditLog: {},
}));

// aggregateStrategyHealth mock
const { mockAggregateStrategyHealth } = vi.hoisted(() => ({
  mockAggregateStrategyHealth: vi.fn(),
}));
vi.mock("../services/strategy-health-aggregator.js", () => ({
  aggregateStrategyHealth: mockAggregateStrategyHealth,
}));

// notification-helpers mock
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((body: string, _what: string, _action: string) => body + "\n--- For family members ---"),
}));

// ── Helper: build a mock Drizzle select chain ──────────────────────────────────
function buildSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(result),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

// ── Imports after mocks ────────────────────────────────────────────────────────

import {
  runCompositeHealthDailyDigest,
  _resetDigestLockForTest,
} from "../services/composite-health-digest-service.js";

// ── Test setup ─────────────────────────────────────────────────────────────────

const STRATEGY_IDS = [
  "11111111-0000-0000-0000-000000000001",
  "11111111-0000-0000-0000-000000000002",
  "11111111-0000-0000-0000-000000000003",
  "11111111-0000-0000-0000-000000000004",
  "11111111-0000-0000-0000-000000000005",
];

const ACTIVE_STRATEGIES = STRATEGY_IDS.map((id, idx) => ({
  id,
  name: `strategy_${idx + 1}`,
}));

// A Date at 17:00 ET (EST, UTC-5 → 22:00 UTC)
function makeEt17Date(): Date {
  // 2026-01-15 22:00 UTC = 17:00 EST (UTC-5)
  return new Date("2026-01-15T22:00:00Z");
}

// A Date at 16:00 ET
function makeEt16Date(): Date {
  return new Date("2026-01-15T21:00:00Z");
}

// A Date at 18:00 ET
function makeEt18Date(): Date {
  return new Date("2026-01-15T23:00:00Z");
}

function makeHealthyResult() {
  return { written: true, rowId: "row-1", verdict: "HEALTHY", composite: 0.85, n: 10 };
}

function makeCriticalResult() {
  return { written: true, rowId: "row-2", verdict: "CRITICAL", composite: 0.10, n: 8 };
}

function makeSkippedResult() {
  return { written: false, reason: "below_threshold", n: 3, verdict: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetDigestLockForTest();
  mockDbSelect.mockReturnValue(buildSelectChain(ACTIVE_STRATEGIES));
});

afterEach(() => {
  _resetDigestLockForTest();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runCompositeHealthDailyDigest", () => {
  it("happy path: 5 active strategies all HEALTHY → Discord notifyInfo called + audit row written", async () => {
    mockAggregateStrategyHealth.mockResolvedValue(makeHealthyResult());

    const result = await runCompositeHealthDailyDigest({ asOf: makeEt17Date() });

    expect(result.status).toBe("emitted");
    expect(result.strategiesChecked).toBe(5);
    expect(result.verdicts?.HEALTHY).toBe(5);
    expect(result.verdicts?.CRITICAL).toBe(0);
    expect(result.verdicts?.MARGINAL).toBe(0);
    expect(result.verdicts?.UNHEALTHY).toBe(0);
    expect(result.verdicts?.SKIPPED).toBe(0);

    // Discord post must have been called
    expect(mockNotifyInfo).toHaveBeenCalledTimes(1);
    const [title, body] = mockNotifyInfo.mock.calls[0] as [string, string, unknown];
    expect(title).toContain("Composite Strategy Health");
    expect(body).toContain("HEALTHY");

    // Audit row must have been written
    const auditCalls = mockInsertAuditRowSafe.mock.calls as Array<[{ action: string; result?: Record<string, unknown> }]>;
    const emittedCall = auditCalls.find(([a]) => a.action === "composite_health.daily_digest_emitted");
    expect(emittedCall).toBeDefined();
    const payload = emittedCall![0].result as Record<string, unknown>;
    expect(payload.strategies_checked).toBe(5);
    expect((payload.verdicts as Record<string, number>).HEALTHY).toBe(5);
    expect(payload.dry_run).toBe(false);
  });

  it("dryRun=true → no Discord post, audit row still written with dry_run=true", async () => {
    mockAggregateStrategyHealth.mockResolvedValue(makeHealthyResult());

    const result = await runCompositeHealthDailyDigest({ asOf: makeEt17Date(), dryRun: true });

    expect(result.status).toBe("emitted");
    expect(result.dryRun).toBe(true);
    // Discord must NOT have been called
    expect(mockNotifyInfo).not.toHaveBeenCalled();

    // Audit row must still be written
    const auditCalls = mockInsertAuditRowSafe.mock.calls as Array<[{ action: string; result?: Record<string, unknown> }]>;
    const emittedCall = auditCalls.find(([a]) => a.action === "composite_health.daily_digest_emitted");
    expect(emittedCall).toBeDefined();
    const payload = emittedCall![0].result as Record<string, unknown>;
    expect(payload.dry_run).toBe(true);
  });

  it("DST guard at ET-hour=16 → status=skipped_dst_guard, digest_skipped_dst_guard audit emitted", async () => {
    const result = await runCompositeHealthDailyDigest({ asOf: makeEt16Date() });

    expect(result.status).toBe("skipped_dst_guard");
    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockAggregateStrategyHealth).not.toHaveBeenCalled();

    const auditCalls = mockInsertAuditRowSafe.mock.calls as Array<[{ action: string }]>;
    const skipCall = auditCalls.find(([a]) => a.action === "composite_health.digest_skipped_dst_guard");
    expect(skipCall).toBeDefined();
  });

  it("DST guard at ET-hour=18 → status=skipped_dst_guard, digest_skipped_dst_guard audit emitted", async () => {
    const result = await runCompositeHealthDailyDigest({ asOf: makeEt18Date() });

    expect(result.status).toBe("skipped_dst_guard");
    expect(mockNotifyInfo).not.toHaveBeenCalled();

    const auditCalls = mockInsertAuditRowSafe.mock.calls as Array<[{ action: string }]>;
    const skipCall = auditCalls.find(([a]) => a.action === "composite_health.digest_skipped_dst_guard");
    expect(skipCall).toBeDefined();
  });

  it("lock contention → status=skipped_lock_contention, digest_skipped_lock_contention audit emitted", async () => {
    // Simulate in-flight lock by calling without resolving first
    // We use the test-reset helper to jam the lock manually.
    // Force lock by NOT resetting before this test — we call twice.
    // First call runs normally; second sees contention.
    mockAggregateStrategyHealth.mockResolvedValue(makeHealthyResult());

    // First call at 17:00 ET — acquires lock, runs normally
    const first = await runCompositeHealthDailyDigest({ asOf: makeEt17Date() });
    expect(first.status).toBe("emitted");

    // Lock has been released. We need to hold the lock during a concurrent call.
    // Simulate contention by jamming it via a long-running promise inside aggregateStrategyHealth.
    let resolveAgg!: () => void;
    const aggPending = new Promise<void>((resolve) => { resolveAgg = resolve; });
    mockAggregateStrategyHealth.mockImplementationOnce(() => aggPending.then(() => makeHealthyResult()));

    // We cannot easily test true concurrent lock contention in vitest without worker threads.
    // Instead, directly test the lock contention path by hijacking the internal lock.
    // The _resetDigestLockForTest is our seam; we do NOT reset it here and call it
    // from a state where it's artificially "in flight" via a direct manipulation.
    // This is the accepted vitest pattern for in-process lock testing.

    // Reset so we can test the contention path directly via the exported seam
    // by re-importing and calling twice concurrently.
    resolveAgg();
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue(buildSelectChain(ACTIVE_STRATEGIES));

    // Run two concurrent calls; the second should see contention.
    let firstResolved = false;
    let secondResolved = false;

    mockAggregateStrategyHealth.mockImplementation(async () => {
      // Slow down first aggregation so second call overlaps
      await new Promise((r) => setTimeout(r, 0));
      return makeHealthyResult();
    });

    const p1 = runCompositeHealthDailyDigest({ asOf: makeEt17Date() }).then((r) => {
      firstResolved = true;
      return r;
    });
    const p2 = runCompositeHealthDailyDigest({ asOf: makeEt17Date() }).then((r) => {
      secondResolved = true;
      return r;
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(firstResolved).toBe(true);
    expect(secondResolved).toBe(true);

    const statuses = [r1.status, r2.status];
    expect(statuses).toContain("emitted");
    expect(statuses).toContain("skipped_lock_contention");

    const auditCalls = mockInsertAuditRowSafe.mock.calls as Array<[{ action: string }]>;
    const lockCall = auditCalls.find(([a]) => a.action === "composite_health.digest_skipped_lock_contention");
    expect(lockCall).toBeDefined();
  });

  it("pipeline PAUSED: composite-health-daily-digest is in _PIPELINE_GATE_EXEMPT set", async () => {
    // This test verifies the scheduler registration without importing the whole scheduler.
    // We read the scheduler source as a string and verify the job name appears in the
    // _PIPELINE_GATE_EXEMPT initialization block.
    // This is a static code-contract assertion — mirrors the pattern used in
    // scheduler-reconcile-pipelinegate.test.ts.
    const fs = await import("fs");
    const path = await import("path");
    const schedulerPath = path.resolve(
      process.cwd(),
      "src/server/scheduler.ts",
    );
    const src = fs.readFileSync(schedulerPath, "utf-8");

    // Verify 4 required registrations in scheduler.ts
    expect(src).toContain('"composite-health-daily-digest"');
    // _PIPELINE_GATE_EXEMPT contains the job
    const exemptIdx = src.indexOf("_PIPELINE_GATE_EXEMPT");
    const exemptBlock = src.slice(exemptIdx, src.indexOf("])", exemptIdx) + 2);
    expect(exemptBlock).toContain('"composite-health-daily-digest"');
    // registerJob call
    expect(src).toContain('registerJob("composite-health-daily-digest"');
    // cron.schedule call
    const cronIdx = src.lastIndexOf('registerJob("composite-health-daily-digest"');
    const cronRegion = src.slice(cronIdx, cronIdx + 2000);
    expect(cronRegion).toContain("cron.schedule");
    // _scheduledJobs.add
    expect(cronRegion).toContain('_scheduledJobs.add("composite-health-daily-digest")');
  });

  it("mixed verdicts: HEALTHY 3 / CRITICAL 2 → message includes both counts in audit row", async () => {
    // 3 healthy + 2 critical
    const resolvers = [
      makeHealthyResult(),
      makeHealthyResult(),
      makeHealthyResult(),
      makeCriticalResult(),
      makeCriticalResult(),
    ];
    let callIdx = 0;
    mockAggregateStrategyHealth.mockImplementation(async () => resolvers[callIdx++]);

    const result = await runCompositeHealthDailyDigest({ asOf: makeEt17Date() });

    expect(result.status).toBe("emitted");
    expect(result.verdicts?.HEALTHY).toBe(3);
    expect(result.verdicts?.CRITICAL).toBe(2);
    expect(result.verdicts?.MARGINAL).toBe(0);

    // Discord body must mention both HEALTHY and CRITICAL
    expect(mockNotifyInfo).toHaveBeenCalledTimes(1);
    const body = mockNotifyInfo.mock.calls[0][1] as string;
    expect(body).toMatch(/HEALTHY.*3|3.*HEALTHY/);
    expect(body).toMatch(/CRITICAL.*2|2.*CRITICAL/);

    // Audit row should capture correct verdicts
    const auditCalls = mockInsertAuditRowSafe.mock.calls as Array<[{ action: string; result?: Record<string, unknown> }]>;
    const emitCall = auditCalls.find(([a]) => a.action === "composite_health.daily_digest_emitted");
    expect(emitCall).toBeDefined();
    const verdicts = (emitCall![0].result as Record<string, unknown>).verdicts as Record<string, number>;
    expect(verdicts.HEALTHY).toBe(3);
    expect(verdicts.CRITICAL).toBe(2);
  });
});
