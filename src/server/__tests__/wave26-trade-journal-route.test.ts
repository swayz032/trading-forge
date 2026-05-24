/**
 * wave26-trade-journal-route.test.ts — Wave 26 Pass 2
 *
 * Backend tests for GET /api/trade-journal and GET /api/trade-journal/stats.
 *
 * Pattern: direct handler invocation via mock req/res objects (no supertest).
 * This matches the existing test suite style established in quantum-cost-route.test.ts,
 * prop-firm-route-survival.test.ts, etc.
 *
 * Coverage (≥6 tests):
 *  1. List: returns rows including uncritiqued positions (grade=null) via LEFT JOIN
 *  2. List: outcome=win — result row outcome is 'win' (positive price delta long)
 *  3. List: outcome=loss — result row outcome is 'loss' (negative price delta long)
 *  4. List: regime filter — returned row carries regimeAtEntry from technicalDiagnosis
 *  5. List: gradeMin filter — grade='A' passes gradeMin='B' threshold
 *  6. List: dateFrom/dateTo query params accepted — 200 response
 *  7. Stats: returns totalTrades, winRate, byGrade distribution
 *  8. Stats: byGrade counts sum correctly from inserted critique rows
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB layer before any service imports ─────────────────────────────────

const mockSelect = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperPositions: {
    id: "id", sessionId: "session_id", symbol: "symbol", side: "side",
    entryPrice: "entry_price", currentPrice: "current_price",
    contracts: "contracts", unrealizedPnl: "unrealized_pnl",
    entryTime: "entry_time", closedAt: "closed_at",
    arrivalPrice: "arrival_price",
    implementationShortfall: "implementation_shortfall",
    fillRatio: "fill_ratio", trailHwm: "trail_hwm", barsHeld: "bars_held",
    fillProbability: "fill_probability", mae: "mae", mfe: "mfe",
    previousUnrealizedPnl: "previous_unrealized_pnl",
    tp1FilledAt: "tp1_filled_at", tp2FilledAt: "tp2_filled_at",
    tp1Filled: "tp1_filled", tp2Filled: "tp2_filled",
    beStopApplied: "be_stop_applied", currentExitStyle: "current_exit_style",
    currentTrailMethod: "current_trail_method", lastHandlerEvalAt: "last_handler_eval_at",
  },
  paperSessions: {
    id: "id", strategyId: "strategy_id", firmId: "firm_id", status: "status",
  },
  tradeCritique: {
    id: "id", positionId: "position_id", sessionId: "session_id",
    accountId: "account_id", strategyId: "strategy_id", critiquedAt: "critiqued_at",
    grade: "grade", technicalDiagnosis: "technical_diagnosis",
    plainEnglishSummary: "plain_english_summary", dataCompleteness: "data_completeness",
    missingFields: "missing_fields", provider: "provider", model: "model",
    correlationId: "correlation_id", createdAt: "created_at",
  },
  strategies: { id: "id", name: "name", symbol: "symbol" },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub drizzle-orm operators so route imports succeed
vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (template: TemplateStringsArray, ...vals: any[]) => ({
      _sql: true,
      toSQL: () => ({ sql: template.join("?"), params: vals }),
    }),
    {
      raw: (s: string) => s,
    }
  ),
  and:       (...args: any[]) => args.filter(Boolean).length > 0 ? { _and: args } : undefined,
  or:        (...args: any[]) => ({ _or: args }),
  eq:        (a: any, b: any) => ({ _eq: [a, b] }),
  desc:      (a: any) => ({ _desc: a }),
  gte:       (a: any, b: any) => ({ _gte: [a, b] }),
  lte:       (a: any, b: any) => ({ _lte: [a, b] }),
  isNotNull: (a: any) => ({ _isNotNull: a }),
  isNull:    (a: any) => ({ _isNull: a }),
  inArray:   (col: any, arr: any) => ({ _inArray: [col, arr] }),
}));

// ─── Chain builder ────────────────────────────────────────────────────────────

/**
 * Build a fluent Drizzle-like chain that resolves to `rows` on await.
 * Every intermediate method (from, where, leftJoin, orderBy, limit, offset,
 * groupBy) returns the same proxy.
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

// ─── Mock req / res helpers ───────────────────────────────────────────────────

function mockRes() {
  const obj = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { obj.statusCode = code; return obj; },
    json(b: unknown) { obj.body = b; return obj; },
  };
  return obj;
}

function mockReq(
  query: Record<string, string> = {},
  params: Record<string, string> = {},
) {
  return { query, params, id: "test-corr-id" } as any;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makePosRow(overrides: Record<string, any> = {}) {
  return {
    positionId:  "pos-uuid-1",
    sessionId:   "sess-uuid-1",
    symbol:      "MES",
    side:        "long",
    entryPrice:  "5000",
    exitPrice:   "5010",
    entryTime:   new Date("2026-05-24T09:30:00Z"),
    exitTime:    new Date("2026-05-24T10:00:00Z"),
    contracts:   2,
    implementationShortfall: null,
    fillRatio:   "1.0",
    strategyId:  "strat-uuid-1",
    firmId:      "topstep",
    strategyName: "MES-ORB-15m",
    strategySymbol: "MES",
    grade:       "A",
    technicalDiagnosis: {
      realized_r: 1.5,
      regime_at_entry: "TRENDING_UP",
      exit_reason: "TP1_HIT",
      entry_quality_score: 8.2,
    },
    plainEnglishSummary: {
      one_liner: "Clean breakout.",
      what_went_right: "Confluence aligned.",
      what_to_watch: "Regime shift.",
      action_needed: "None.",
    },
    dataCompleteness: "full",
    missingFields: [],
    provider:    "openai",
    model:       "gpt-4.1",
    critiquedAt: new Date("2026-05-24T22:00:00Z"),
    correlationId: "corr-abc123",
    ...overrides,
  };
}

// ─── Get handler from router ──────────────────────────────────────────────────
// We extract the handler registered at GET "/" and GET "/stats" by executing
// the router's layer stack directly.

async function getHandler(path: "/" | "/stats") {
  const { tradeJournalRoutes } = await import("../routes/trade-journal.js");
  // Express router stores layers in .stack — find the layer that matches our path
  const layer = (tradeJournalRoutes as any).stack.find((l: any) => {
    const route = l.route;
    if (!route) return false;
    const matchPath = path === "/" ? /^\/?$/ : new RegExp(`^\\/${path.slice(1)}\\/?$`);
    return route.methods.get && matchPath.test(route.path);
  });
  if (!layer) throw new Error(`Handler not found for path ${path}`);
  // The actual route handler is the last layer in route.stack
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("trade-journal route — list endpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("1. returns rows; uncritiqued positions appear with grade=null (LEFT JOIN)", async () => {
    const critiquedRow  = makePosRow();
    const uncritiquedRow = makePosRow({
      positionId: "pos-uncritiqued",
      grade: null, technicalDiagnosis: null, plainEnglishSummary: null,
      dataCompleteness: null, missingFields: null, provider: null, model: null,
      critiquedAt: null, correlationId: null,
    });

    mockSelect
      .mockReturnValueOnce(buildChain([{ total: 2 }]))         // count
      .mockReturnValueOnce(buildChain([critiquedRow, uncritiquedRow])); // data

    const handler = await getHandler("/");
    const req = mockReq({});
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);

    const unc = body.data.find((d: any) => d.positionId === "pos-uncritiqued");
    expect(unc).toBeDefined();
    expect(unc.grade).toBeNull();
    expect(unc.plainEnglish).toBeNull();
    expect(unc.technicalDiagnosis).toBeNull();
  });

  it("2. long position where exitPrice > entryPrice → outcome=win", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ total: 1 }]))
      .mockReturnValueOnce(buildChain([
        makePosRow({ side: "long", entryPrice: "5000", exitPrice: "5020" }),
      ]));

    const handler = await getHandler("/");
    const req = mockReq({ outcome: "win" });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.data[0].outcome).toBe("win");
  });

  it("3. long position where exitPrice < entryPrice → outcome=loss", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ total: 1 }]))
      .mockReturnValueOnce(buildChain([
        makePosRow({ side: "long", entryPrice: "5020", exitPrice: "5000" }),
      ]));

    const handler = await getHandler("/");
    const req = mockReq({ outcome: "loss" });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as any).data[0].outcome).toBe("loss");
  });

  it("4. regime filter — returned row carries regimeAtEntry from technicalDiagnosis", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ total: 1 }]))
      .mockReturnValueOnce(buildChain([
        makePosRow({
          technicalDiagnosis: { regime_at_entry: "TRENDING_DOWN", realized_r: 0.8 },
        }),
      ]));

    const handler = await getHandler("/");
    const req = mockReq({ regime: "TRENDING_DOWN" });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as any).data[0].regimeAtEntry).toBe("TRENDING_DOWN");
  });

  it("5. gradeMin=B accepted; row with grade='A' is included (A rank > B rank)", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ total: 1 }]))
      .mockReturnValueOnce(buildChain([makePosRow({ grade: "A" })]));

    const handler = await getHandler("/");
    const req = mockReq({ gradeMin: "B" });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as any).data[0].grade).toBe("A");
  });

  it("6. dateFrom/dateTo params accepted — handler returns 200 with data", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ total: 1 }]))
      .mockReturnValueOnce(buildChain([makePosRow()]));

    const handler = await getHandler("/");
    const req = mockReq({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as any).data).toHaveLength(1);
  });

  it("9. pagination: limit and offset params are parsed; total still comes from count query", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ total: 100 }]))
      .mockReturnValueOnce(buildChain([])); // empty page

    const handler = await getHandler("/");
    const req = mockReq({ limit: "10", offset: "50" });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as any).total).toBe(100);
    expect((res.body as any).data).toHaveLength(0);
  });
});

describe("trade-journal route — /stats endpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("7. returns totalTrades, winRate, byGrade, byRegime, byStrategy, last7DaysCount", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ totalTrades: 10 }]))
      .mockReturnValueOnce(buildChain([{ wins: 6 }]))
      .mockReturnValueOnce(buildChain([
        { grade: "A+", count: 2, avgR: 2.1 },
        { grade: "A",  count: 3, avgR: 1.5 },
        { grade: "B",  count: 5, avgR: 0.8 },
      ]))
      .mockReturnValueOnce(buildChain([
        { regime: "TRENDING_UP", count: 7 },
        { regime: "RANGE_BOUND", count: 3 },
      ]))
      .mockReturnValueOnce(buildChain([
        { strategyName: "MES-ORB-15m", count: 6 },
        { strategyName: "MNQ-EMA-5m",  count: 4 },
      ]))
      .mockReturnValueOnce(buildChain([{ last7DaysCount: 3 }]))
      .mockReturnValueOnce(buildChain([{ r: 1.5 }, { r: 2.0 }, { r: -0.5 }, { r: 1.0 }, { r: 0.8 }]));

    const handler = await getHandler("/stats");
    const req = mockReq({});
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.totalTrades).toBe(10);
    expect(body.winRate).toBeCloseTo(0.6);
    expect(body.byGrade).toMatchObject({ "A+": 2, "A": 3, "B": 5 });
    expect(body.byRegime).toMatchObject({ TRENDING_UP: 7, RANGE_BOUND: 3 });
    expect(body.byStrategy).toMatchObject({ "MES-ORB-15m": 6, "MNQ-EMA-5m": 4 });
    expect(body.last7DaysCount).toBe(3);
  });

  it("8. byGrade distribution sums to total critiqued count", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ totalTrades: 15 }]))
      .mockReturnValueOnce(buildChain([{ wins: 9 }]))
      .mockReturnValueOnce(buildChain([
        { grade: "A+", count: 3, avgR: 2.5 },
        { grade: "B",  count: 7, avgR: 0.9 },
        { grade: "D",  count: 2, avgR: -0.5 },
      ]))
      .mockReturnValueOnce(buildChain([]))
      .mockReturnValueOnce(buildChain([]))
      .mockReturnValueOnce(buildChain([{ last7DaysCount: 5 }]))
      .mockReturnValueOnce(buildChain([]));

    const handler = await getHandler("/stats");
    const req = mockReq({});
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const byGrade = (res.body as any).byGrade as Record<string, number>;
    const sum = Object.values(byGrade).reduce((s, v) => s + v, 0);
    expect(sum).toBe(12); // 3 + 7 + 2
  });
});
