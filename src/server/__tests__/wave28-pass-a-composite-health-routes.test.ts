/**
 * wave28-pass-a-composite-health-routes.test.ts — Wave 28 Pass A.5
 *
 * Tests for composite-health.ts route handlers.
 *
 * Pattern: direct handler invocation via mock req/res objects (matches
 * wave26-trade-journal-route.test.ts and existing suite style — no supertest).
 *
 * Coverage:
 *   1. /latest happy path — returns 200 with latest health row
 *   2. /latest empty — returns 200 with data:null + awaiting message (NOT 404)
 *   3. /latest bad strategyId (non-numeric) — returns 400
 *   4. /latest bad strategyId (zero) — returns 400
 *   5. /summary happy path — returns aggregated verdict counts
 *   6. /summary no active strategies — returns 200 with zero counts
 *   7. /summary all strategies unscored — all count as SKIPPED
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist-safe mock references ────────────────────────────────────────────────
const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    insert: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategyHealthScores: {
    id:                      "id",
    strategyId:              "strategy_id",
    evaluatedAt:             "evaluated_at",
    compositeScore:          "composite_score",
    verdict:                 "verdict",
    subsystemScores:         "subsystem_scores",
    computedFromNSubsystems: "computed_from_n_subsystems",
    weightsVersionId:        "weights_version_id",
    stalenessAgeHours:       "staleness_age_hours",
    disagreements:           "disagreements",
    createdAt:               "created_at",
  },
  strategies: {
    id:             "id",
    lifecycleState: "lifecycle_state",
  },
}));

// Stub drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (template: TemplateStringsArray, ...vals: any[]) => ({
      _sql: true,
      toSQL: () => ({ sql: (template as unknown as string[]).join("?"), params: vals }),
      join: (parts: any[], sep: any) => ({ _join: [parts, sep] }),
    }),
    {
      raw:  (s: string) => s,
      join: (parts: any[], sep: any) => ({ _join: [parts, sep] }),
    }
  ),
  and:      (...args: any[]) => args.filter(Boolean).length > 0 ? { _and: args } : undefined,
  or:       (...args: any[]) => ({ _or: args }),
  eq:       (a: any, b: any) => ({ _eq: [a, b] }),
  desc:     (a: any) => ({ _desc: a }),
  gte:      (a: any, b: any) => ({ _gte: [a, b] }),
  lte:      (a: any, b: any) => ({ _lte: [a, b] }),
  inArray:  (col: any, arr: any) => ({ _inArray: [col, arr] }),
  isNotNull:(a: any) => ({ _isNotNull: a }),
  isNull:   (a: any) => ({ _isNull: a }),
}));

// ── Chain builder ─────────────────────────────────────────────────────────────

/**
 * Build a Drizzle-like fluent chain that resolves to `rows` on await.
 * Every intermediate method returns the same proxy object; terminal await
 * returns rows.
 */
function buildChain(rows: any[]) {
  const proxy: any = new Proxy(
    {
      then: (res: (v: any) => any, rej: (e: any) => any) =>
        Promise.resolve(rows).then(res, rej),
    },
    {
      get(target, prop) {
        if (prop in target) return (target as any)[prop];
        return (..._args: any[]) => proxy;
      },
    },
  );
  return proxy;
}

// ── Mock req / res helpers ────────────────────────────────────────────────────

function mockRes() {
  const obj = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { obj.statusCode = code; return obj; },
    json(b: unknown) { obj.body = b; return obj; },
  };
  return obj;
}

function mockReq(params: Record<string, string> = {}) {
  return { params, query: {}, id: "test-corr-id" } as any;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_HEALTH_ROW = {
  id: BigInt(1),
  strategyId: 42,
  evaluatedAt: new Date("2026-05-26T10:00:00Z"),
  compositeScore: 0.82,
  verdict: "HEALTHY",
  subsystemScores: {
    b14_survival: { score: 0.9, confidence: 0.85, available: true, computed_at: "2026-05-26T09:00:00Z" },
  },
  computedFromNSubsystems: 10,
  weightsVersionId: "abc123def456789012345678",
  stalenessAgeHours: 1.2,
  disagreements: null,
  createdAt: new Date("2026-05-26T10:00:00Z"),
};

// ── Route handler extraction ──────────────────────────────────────────────────
// We extract the handler functions from the Router to test them directly.
// Import compositeHealthRoutes after mocks are wired.

let latestHandler: (req: any, res: any) => Promise<void>;
let summaryHandler: (req: any, res: any) => Promise<void>;

beforeEach(async () => {
  vi.clearAllMocks();
  // Dynamic import ensures fresh module with mocks applied
  const mod = await import("../routes/composite-health.js?v=" + Date.now());
  // Extract route handlers from the Express Router stack
  const router = mod.compositeHealthRoutes as any;
  const stack: any[] = router.stack ?? [];

  for (const layer of stack) {
    const path: string = layer.route?.path ?? "";
    const method = layer.route?.stack?.[0]?.method ?? "";
    if (method !== "get") continue;

    if (path === "/summary") {
      summaryHandler = layer.route.stack[0].handle;
    } else if (path === "/:strategyId/latest") {
      latestHandler = layer.route.stack[0].handle;
    }
  }
});

// ─── /latest tests ────────────────────────────────────────────────────────────

describe("GET /api/composite-health/:strategyId/latest", () => {
  it("Test 1: happy path — 200 with latest health row", async () => {
    mockDbSelect.mockReturnValue(buildChain([SAMPLE_HEALTH_ROW]));

    const req = mockReq({ strategyId: "42" });
    const res = mockRes();
    await latestHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data).toBeTruthy();
    expect(body.data.strategyId).toBe(42);
    expect(body.data.verdict).toBe("HEALTHY");
    expect(body.data.compositeScore).toBeCloseTo(0.82);
    expect(body.data.id).toBe("1");  // bigint serialised as string
    expect(body.data.weightsVersionId).toBe("abc123def456789012345678");
  });

  it("Test 2: no row — 200 with data:null and awaiting message (not 404)", async () => {
    mockDbSelect.mockReturnValue(buildChain([]));

    const req = mockReq({ strategyId: "99" });
    const res = mockRes();
    await latestHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data).toBeNull();
    expect(body.message).toMatch(/awaiting/i);
  });

  // Defect G4: strategy_id changed INTEGER → uuid. strategyId is now an opaque
  // non-empty string; the route no longer enforces positive-integer semantics.
  // Only an empty/whitespace strategyId is a 400.
  it("Test 3a: empty strategyId — 400", async () => {
    const req = mockReq({ strategyId: "   " });
    const res = mockRes();
    await latestHandler(req, res);

    expect(res.statusCode).toBe(400);
    const body = res.body as any;
    expect(body.error).toMatch(/strategyId/i);
  });

  it("Test 3b: arbitrary string strategyId — 200 (uuid contract, no row)", async () => {
    mockDbSelect.mockReturnValue(buildChain([]));

    const req = mockReq({ strategyId: "banana" });
    const res = mockRes();
    await latestHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data).toBeNull();
  });

  // Tier-C fix (2026-07-17): composite-health-daily-digest computes fresh
  // evidence per run, but this route serves the last-WRITTEN row — the
  // aggregator's own docs delegate COMPOSITE_MAX_AGE_HOURS enforcement to this
  // consumer. Before this fix, a strategy whose aggregator cron stopped
  // running kept its last verdict (e.g. HEALTHY) forever with no signal.
  it("Test 7: stale row (aggregator stopped running) — stale:true, rowAgeHours exceeds default 48h", async () => {
    const oldEvaluatedAt = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h ago
    mockDbSelect.mockReturnValue(buildChain([{ ...SAMPLE_HEALTH_ROW, evaluatedAt: oldEvaluatedAt }]));

    const req = mockReq({ strategyId: "42" });
    const res = mockRes();
    await latestHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.stale).toBe(true);
    expect(body.data.rowAgeHours).toBeGreaterThan(48);
  });

  it("Test 8: fresh row — stale:false", async () => {
    const freshEvaluatedAt = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
    mockDbSelect.mockReturnValue(buildChain([{ ...SAMPLE_HEALTH_ROW, evaluatedAt: freshEvaluatedAt }]));

    const req = mockReq({ strategyId: "42" });
    const res = mockRes();
    await latestHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.stale).toBe(false);
    expect(body.data.rowAgeHours).toBeLessThan(48);
  });
});

// ─── /summary tests ───────────────────────────────────────────────────────────

describe("GET /api/composite-health/summary", () => {
  it("Test 4: happy path — aggregated verdict counts", async () => {
    // First call: active strategies
    // Second call: latest health rows
    mockDbSelect
      .mockReturnValueOnce(buildChain([{ id: 42 }, { id: 43 }, { id: 44 }]))
      .mockReturnValueOnce(buildChain([
        { strategyId: 42, verdict: "HEALTHY" },
        { strategyId: 43, verdict: "MARGINAL" },
        // 44 has no row → counted as SKIPPED
      ]));

    const req = mockReq();
    const res = mockRes();
    await summaryHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.counts.HEALTHY).toBe(1);
    expect(body.data.counts.MARGINAL).toBe(1);
    expect(body.data.counts.SKIPPED).toBe(1);
    expect(body.data.totalActiveStrategies).toBe(3);
    expect(body.data.computedAt).toBeTruthy();
  });

  it("Test 5: no active strategies — 200 with zero counts", async () => {
    mockDbSelect.mockReturnValue(buildChain([]));

    const req = mockReq();
    const res = mockRes();
    await summaryHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.totalActiveStrategies).toBe(0);
    expect(body.data.counts.HEALTHY).toBe(0);
    expect(body.data.counts.SKIPPED).toBe(0);
  });

  it("Test 6: all active strategies unscored — all count as SKIPPED", async () => {
    mockDbSelect
      .mockReturnValueOnce(buildChain([{ id: 10 }, { id: 11 }]))
      .mockReturnValueOnce(buildChain([]));

    const req = mockReq();
    const res = mockRes();
    await summaryHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.counts.SKIPPED).toBe(2);
    expect(body.data.totalActiveStrategies).toBe(2);
  });

  // Tier-C fix (2026-07-17): a stale row must fold into SKIPPED, not its stored
  // (possibly ancient) verdict — an abandoned HEALTHY is not current evidence.
  it("Test 9: stale HEALTHY row counts as SKIPPED, not HEALTHY — staleCount reflects it", async () => {
    const oldEvaluatedAt = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h ago
    mockDbSelect
      .mockReturnValueOnce(buildChain([{ id: 42 }, { id: 43 }]))
      .mockReturnValueOnce(buildChain([
        { strategyId: 42, verdict: "HEALTHY", evaluatedAt: oldEvaluatedAt },
        { strategyId: 43, verdict: "MARGINAL", evaluatedAt: new Date() },
      ]));

    const req = mockReq();
    const res = mockRes();
    await summaryHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data.counts.HEALTHY).toBe(0);
    expect(body.data.counts.MARGINAL).toBe(1);
    expect(body.data.counts.SKIPPED).toBe(1);
    expect(body.data.staleCount).toBe(1);
  });
});
