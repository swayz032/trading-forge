/**
 * layer4-office-deploy-approvals.test.ts
 *
 * Layer-4 Office P0 — DEPLOY_READY → DEPLOYED approval card endpoints.
 *
 * Covers:
 *   - auth guard: 401 without admin session on all 3 routes (no promotion call)
 *   - GET list: plain-English evidence card built from latest backtest + MC run
 *   - fail-closed: missing WFE/PBO/B14 or stale backtest ⇒ approvable=false
 *   - approve: refuses 409 on non-approvable evidence WITHOUT touching the
 *     promotion path; calls the EXISTING lifecycle promote with
 *     actor="human_release" when approvable; audit row with correlationId
 *   - reject: requires a reason; routes through DEPLOY_READY → PAPER
 *
 * Service-level pattern (no HTTP layer) — consistent with
 * wave-b-office-switches.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({ db: {} }));

vi.mock("../db/schema.js", () => ({
  strategies: {
    id: "id", name: "name", symbol: "symbol", timeframe: "timeframe",
    lifecycleState: "lifecycleState",
  },
  backtests: {
    id: "id", strategyId: "strategyId", status: "status", createdAt: "createdAt",
    walkForwardResults: "walkForwardResults", resultExtras: "resultExtras", kEff: "kEff",
  },
  monteCarloRuns: {
    backtestId: "backtestId", riskMetrics: "riskMetrics", createdAt: "createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "__eq__"),
  and: vi.fn(() => "__and__"),
  desc: vi.fn(() => "__desc__"),
}));

vi.mock("../lib/slumhouse/admin-session.js", () => ({
  adminSessionFromCookie: vi.fn(),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const promoteStrategyMock = vi.hoisted(() => vi.fn());
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    promoteStrategy = promoteStrategyMock;
  },
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { db } from "../db/index.js";
import { adminSessionFromCookie } from "../lib/slumhouse/admin-session.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { deployApprovalsRouter, buildDeployEvidence } from "../routes/slumhouse/deploy-approvals.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fluent drizzle chain where .limit() resolves the provider's value. */
function makeChain(provider: () => unknown): unknown {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(provider()),
  };
  return chain;
}

function buildSelectMock(responses: unknown[][]): void {
  let i = 0;
  (db as any).select = vi.fn().mockImplementation(() => {
    const idx = i++;
    return makeChain(() => responses[idx] ?? []);
  });
}

/** Find an express route handler on the router by method + path. */
function findHandler(method: string, path: string): (req: any, res: any) => Promise<void> {
  const layer = (deployApprovalsRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method} ${path}`);
  return layer.route.stack[0].handle;
}

const getList = () => findHandler("get", "/slumhouse/admin/deploy-approvals");
const postApprove = () => findHandler("post", "/slumhouse/admin/deploy-approvals/:id/approve");
const postReject = () => findHandler("post", "/slumhouse/admin/deploy-approvals/:id/reject");

function makeReq(opts: { body?: Record<string, unknown>; params?: Record<string, string> } = {}): any {
  return { body: opts.body ?? {}, params: opts.params ?? {}, headers: { cookie: "" } };
}

function makeRes() {
  let capturedStatus = 200;
  let capturedBody: unknown = null;
  const res = {
    status: vi.fn().mockImplementation((code: number) => { capturedStatus = code; return res; }),
    json: vi.fn().mockImplementation((b: unknown) => { capturedBody = b; }),
    getStatus: () => capturedStatus,
    getBody: () => capturedBody as Record<string, unknown>,
  };
  return res;
}

const GOOD_BT = {
  id: "bt-1",
  createdAt: new Date(), // fresh
  walkForwardResults: { wfe_overall: 0.85, pbo_overall: 0.05, windows: [1, 2, 3, 4] },
  resultExtras: { deflated_sharpe: 1.8 },
  kEff: "34",
};
const GOOD_MC = {
  riskMetrics: { probability_of_ruin_ci: { ci_high: 0.1 }, probability_of_ruin: 0.05 },
  createdAt: new Date(),
};

// ─────────────────────────────────────────────────────────────────────────────

describe("auth guard — 401 without admin session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(false);
  });

  it("GET list returns 401 with no DB access", async () => {
    const res = makeRes();
    await getList()(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.getBody()).toEqual({ ok: false, error: "locked" });
  });

  it("approve returns 401 and never calls the promotion path", async () => {
    const res = makeRes();
    await postApprove()(makeReq({ params: { id: "s1" } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(promoteStrategyMock).not.toHaveBeenCalled();
  });

  it("reject returns 401 and never calls the promotion path", async () => {
    const res = makeRes();
    await postReject()(makeReq({ params: { id: "s1" }, body: { reason: "nope" } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(promoteStrategyMock).not.toHaveBeenCalled();
  });
});

describe("buildDeployEvidence — plain-English evidence + fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("full fresh evidence ⇒ approvable=true with 5 metrics + verdict headlines", async () => {
    buildSelectMock([[GOOD_BT], [GOOD_MC]]);
    const ev = await buildDeployEvidence("s1");
    expect(ev.approvable).toBe(true);
    expect(ev.blockers).toEqual([]);
    expect(ev.evidenceState).toBe("ok");
    const byKey = Object.fromEntries(ev.evidence.map((m) => [m.key, m]));
    expect(byKey.regime_tests.headline).toBe("Survived 34 market-regime tests");
    expect(byKey.pbo.headline).toBe("5% chance the results are luck");
    expect(byKey.b14.headline).toBe("90% chance of surviving the firm's rules");
    expect(byKey.wfe.headline).toContain("of its edge on data it never saw");
    expect(byKey.dsr.headline).toContain("1.80");
    // raw values ride small beneath (detail)
    expect(byKey.pbo.detail).toContain("PBO 0.050");
    expect(byKey.b14.detail).toContain("ci_high 0.100");
  });

  it("no completed backtest ⇒ approvable=false, evidenceState=missing", async () => {
    buildSelectMock([[]]);
    const ev = await buildDeployEvidence("s1");
    expect(ev.approvable).toBe(false);
    expect(ev.evidenceState).toBe("missing");
    expect(ev.blockers[0]).toContain("No completed backtest");
  });

  it("stale backtest (older than BACKTEST_STALENESS_DAYS) ⇒ approvable=false", async () => {
    const old = { ...GOOD_BT, createdAt: new Date(Date.now() - 45 * 86_400_000) };
    buildSelectMock([[old], [GOOD_MC]]);
    const ev = await buildDeployEvidence("s1");
    expect(ev.approvable).toBe(false);
    expect(ev.evidenceState).toBe("stale");
    expect(ev.blockers.join(" ")).toContain("days old");
  });

  it("missing PBO / B14 ⇒ approvable=false with named blockers", async () => {
    const bt = { ...GOOD_BT, walkForwardResults: { wfe_overall: 0.85 } };
    buildSelectMock([[bt], [{ riskMetrics: {}, createdAt: new Date() }]]);
    const ev = await buildDeployEvidence("s1");
    expect(ev.approvable).toBe(false);
    expect(ev.evidenceState).toBe("missing");
    expect(ev.blockers.join(" ")).toContain("PBO");
    expect(ev.blockers.join(" ")).toContain("B14");
  });

  it("failing thresholds (pbo too high, wfe too low, ruin too high) ⇒ blockers", async () => {
    const bt = {
      ...GOOD_BT,
      walkForwardResults: { wfe_overall: 0.4, pbo_overall: 0.5, windows: [] },
    };
    const mc = { riskMetrics: { probability_of_ruin_ci: { ci_high: 0.6 } }, createdAt: new Date() };
    buildSelectMock([[bt], [mc]]);
    const ev = await buildDeployEvidence("s1");
    expect(ev.approvable).toBe(false);
    expect(ev.blockers.length).toBe(3);
  });

  it("legacy scalar ruin fallback is flagged as the older estimate", async () => {
    const mc = { riskMetrics: { probability_of_ruin: 0.08 }, createdAt: new Date() };
    buildSelectMock([[GOOD_BT], [mc]]);
    const ev = await buildDeployEvidence("s1");
    const b14 = ev.evidence.find((m) => m.key === "b14")!;
    expect(b14.headline).toContain("older estimate");
    expect(b14.value).toBe(0.08);
  });
});

describe("GET /slumhouse/admin/deploy-approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
  });

  it("lists DEPLOY_READY strategies with evidence", async () => {
    buildSelectMock([
      [{ id: "s1", name: "orb_mnq_15m", symbol: "MNQ", timeframe: "15m", lifecycleState: "DEPLOY_READY" }],
      [GOOD_BT],
      [GOOD_MC],
    ]);
    const res = makeRes();
    await getList()(makeReq(), res);
    const body = res.getBody();
    expect(body.ok).toBe(true);
    const list = body.strategies as any[];
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("s1");
    expect(list[0].approvable).toBe(true);
    expect(list[0].evidence).toHaveLength(5);
  });
});

describe("POST approve — fail-closed + existing promotion path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    promoteStrategyMock.mockResolvedValue({ success: true });
  });

  it("refuses 409 when evidence is not approvable and does NOT promote", async () => {
    buildSelectMock([[]]); // no backtest
    const res = makeRes();
    await postApprove()(makeReq({ params: { id: "s1" } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.getBody().error).toBe("evidence_not_approvable");
    expect(promoteStrategyMock).not.toHaveBeenCalled();
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "slumhouse_admin.deploy_approve_refused",
        correlationId: expect.any(String),
      }),
    );
  });

  it("approvable evidence ⇒ promoteStrategy(DEPLOY_READY→DEPLOYED, human_release) + audit", async () => {
    buildSelectMock([[GOOD_BT], [GOOD_MC]]);
    const res = makeRes();
    await postApprove()(makeReq({ params: { id: "s1" } }), res);
    expect(promoteStrategyMock).toHaveBeenCalledWith(
      "s1",
      "DEPLOY_READY",
      "DEPLOYED",
      expect.objectContaining({
        actor: "human_release",
        reason: "office_deploy_approval",
        correlationId: expect.any(String),
      }),
    );
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "slumhouse_admin.deploy_approved",
        decisionAuthority: "human",
        correlationId: expect.any(String),
      }),
    );
    const body = res.getBody();
    expect(body.ok).toBe(true);
    expect(body.newState).toBe("DEPLOYED");
  });

  it("promotion refusal bubbles as 403 (gates keep veto power)", async () => {
    buildSelectMock([[GOOD_BT], [GOOD_MC]]);
    promoteStrategyMock.mockResolvedValue({ success: false, error: "gate blocked" });
    const res = makeRes();
    await postApprove()(makeReq({ params: { id: "s1" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.getBody().error).toBe("gate blocked");
  });
});

describe("POST reject — reason required + DEPLOY_READY→PAPER", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    promoteStrategyMock.mockResolvedValue({ success: true });
  });

  it("missing/short reason ⇒ 400, no promotion", async () => {
    const res = makeRes();
    await postReject()(makeReq({ params: { id: "s1" }, body: { reason: " " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.getBody().error).toBe("reason_required");
    expect(promoteStrategyMock).not.toHaveBeenCalled();
  });

  it("valid reason ⇒ promoteStrategy(DEPLOY_READY→PAPER, human_release) + audit", async () => {
    const res = makeRes();
    await postReject()(
      makeReq({ params: { id: "s1" }, body: { reason: "needs another week of paper" } }),
      res,
    );
    expect(promoteStrategyMock).toHaveBeenCalledWith(
      "s1",
      "DEPLOY_READY",
      "PAPER",
      expect.objectContaining({
        actor: "human_release",
        reason: expect.stringContaining("needs another week of paper"),
      }),
    );
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "slumhouse_admin.deploy_rejected" }),
    );
    expect(res.getBody().newState).toBe("PAPER");
  });
});
