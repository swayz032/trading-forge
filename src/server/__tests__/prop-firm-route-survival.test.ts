/**
 * Prop-Firm Route Survival Tests — B14 / W20 Pass 3
 *
 * Covers the additive survival augmentation surfaced through `prop-firm.ts`:
 *   - POST /api/prop-firm/rank — adds survivalProbability/Curve/evidenceWeight per firm
 *   - GET  /api/prop-firm/simulate/:backtestId — same fields per firm
 *   - GET  /api/prop-firm/survival/:firmId — direct diagnostic endpoint
 *   - POST /api/prop-firm/refit-priors — admin recalibration with confirm flag
 *
 * Verification matrix:
 *   1. Backward compatibility — no existing field is removed or renamed
 *   2. Determinism — same (strategy, firm) → identical survival across calls
 *   3. Per-firm error isolation — one firm's failure does not break the response
 *   4. Pause-gate posture — refit-priors honors pause; rank/survival do not
 *   5. Authority labelling — Phase 0 advisory marker present on /survival/:firmId
 *
 * Pattern matches `quantum-pre-flight.test.ts`: hoisted vi.mock state + real
 * Express app + fetch over an ephemeral port. No supertest dependency.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createHash } from "node:crypto";

// ─── Hoisted mock state ───────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  isActiveMock: vi.fn().mockResolvedValue(true),
  getCurrentPriorsMock: vi.fn(),
  refitPriorsForAllFirmsMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: mocks.isActiveMock,
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

vi.mock("../services/firm-adversarial-event-service.js", () => ({
  getCurrentPriors: mocks.getCurrentPriorsMock,
}));

vi.mock("../services/firm-priors-fitter.js", () => ({
  refitPriorsForAllFirms: mocks.refitPriorsForAllFirmsMock,
}));

// Build a chainable Drizzle-like select stub. The route file uses:
//   db.select().from(table).where(...).limit(1)
//   db.select().from(table).where(...).orderBy(...).limit(1)
// We expose a single `db.select()` mock that returns an object whose `from`
// returns a chain matching both call shapes — ultimately resolving the array
// `mocks.dbSelectMock()` returns.
vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.dbSelectMock()),
          orderBy: () => ({
            limit: () => Promise.resolve(mocks.dbSelectMock()),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("../db/schema.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual };
});

// Bypass middleware/rate-limit's transitive `../index.js` import (which would
// load the full Express app at module init). The test app applies its own
// pass-through middleware in place of the strict rate limit; production code
// path is unchanged.
vi.mock("../middleware/strict-rate-limit.js", () => ({
  strictRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  isActiveMock,
  getCurrentPriorsMock,
  refitPriorsForAllFirmsMock,
  dbSelectMock,
} = mocks;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// SUPPORTED FIRMS: MFFU + Topstep ONLY — legacy firms removed 2026-05-10 (migration 0097).
const SEED_PRIORS = {
  topstep: {
    P_suspension_30d: 0.005,
    P_payout_denial: 0.004,
    P_fund_freeze_year: 0.0,
    P_profitable_trader_ban_year: 0.012,
    P_vpn_detection: 0.0,
    automation_friendly: 1.0,
    evidence_weight: 5,
  },
  mffu: {
    P_suspension_30d: 0.0,
    P_payout_denial: 0.025,
    P_fund_freeze_year: 0.1668,
    P_profitable_trader_ban_year: 0.0,
    P_vpn_detection: 0.0,
    automation_friendly: 0.95,
    evidence_weight: 8,
  },
} as const;

function defaultPriorsFor(firmId: string) {
  return SEED_PRIORS[firmId as keyof typeof SEED_PRIORS] ?? {
    P_suspension_30d: 0,
    P_payout_denial: 0,
    P_fund_freeze_year: 0,
    P_profitable_trader_ban_year: 0,
    P_vpn_detection: 0,
    automation_friendly: 0.5,
    evidence_weight: 0,
  };
}

async function buildApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Cast through `unknown` — the dummy log is a partial pino shape that
    // satisfies the route's request-level usage. Same precedent as
    // quantum-pre-flight.test.ts.
    (req as unknown as { log: unknown; id: string }).log = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    (req as unknown as { id: string }).id = "test-correlation-id";
    next();
  });
  const { propFirmRoutes } = await import("../routes/prop-firm.js");
  app.use("/api/prop-firm", propFirmRoutes);
  return app;
}

async function call(
  app: express.Express,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const init: RequestInit = {
          method,
          headers: { "Content-Type": "application/json" },
        };
        if (body !== undefined) init.body = JSON.stringify(body);
        const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
        const status = res.status;
        const parsed = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        server.close(() => resolve({ status, body: parsed }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("B14 Pass 3 — prop-firm survival route augmentation", () => {
  beforeEach(() => {
    isActiveMock.mockReset();
    isActiveMock.mockResolvedValue(true);
    getCurrentPriorsMock.mockReset();
    getCurrentPriorsMock.mockImplementation((firmId: string) =>
      Promise.resolve(defaultPriorsFor(firmId)),
    );
    refitPriorsForAllFirmsMock.mockReset();
    dbSelectMock.mockReset();
    dbSelectMock.mockReturnValue([]);
  });

  // ── POST /api/prop-firm/rank ─────────────────────────────────────────────

  describe("POST /api/prop-firm/rank", () => {
    const validRankBody = {
      avgDailyPnl: 500,
      maxDrawdown: 1500,
      winRate: 0.65,
      profitFactor: 2.0,
      holdsOvernight: false,
      months: 12,
    };

    it("returns survivalProbability + survivalCurve + evidenceWeight per firm", async () => {
      const app = await buildApp();
      const { status, body } = await call(app, "POST", "/api/prop-firm/rank", validRankBody);
      expect(status).toBe(200);
      const rankings = body.rankings as Array<Record<string, unknown>>;
      // Only MFFU + Topstep supported after migration 0097
      expect(rankings.length).toBeGreaterThanOrEqual(2);
      for (const row of rankings) {
        // Survival fields are present (may be null on error, but key must exist).
        expect("survivalProbability" in row).toBe(true);
        expect("survivalCurve" in row).toBe(true);
        expect("evidenceWeight" in row).toBe(true);
      }
      // At least one firm should have a non-null survivalProbability under
      // the default mock (priors are seeded for both supported firms).
      const hasReal = rankings.some((r) => r.survivalProbability != null);
      expect(hasReal).toBe(true);
    });

    it("preserves ALL pre-existing fields (backward compat)", async () => {
      const app = await buildApp();
      const { body } = await call(app, "POST", "/api/prop-firm/rank", validRankBody);
      const rankings = body.rankings as Array<Record<string, unknown>>;
      const REQUIRED_FIELDS = [
        "firm",
        "displayName",
        "accountType",
        "passes",
        "violations",
        "evalDays",
        "bufferDays",
        "totalDaysToFirstPayout",
        "evalMonths",
        "bufferMonths",
        "totalEvalCost",
        "ongoingMonthlyFee",
        "bufferOngoingFees",
        "monthlyGross",
        "monthlyNet",
        "payoutSplit",
        "fundedPayoutMonths",
        "totalPayouts",
        "totalCosts",
        "roi",
        "annualizedRoi",
        "trailing",
        "maxDrawdown",
        "maxContracts",
      ];
      for (const row of rankings) {
        for (const field of REQUIRED_FIELDS) {
          expect(row, `firm ${row.firm} missing field ${field}`).toHaveProperty(field);
        }
      }
      // Top-level shape preserved
      expect(body).toHaveProperty("strategy");
      expect(body).toHaveProperty("projectionMonths");
      expect(body).toHaveProperty("rankings");
      expect(body).toHaveProperty("bestFirm");
    });

    it("survival curve has 4 horizons in [0,1]", async () => {
      const app = await buildApp();
      const { body } = await call(app, "POST", "/api/prop-firm/rank", validRankBody);
      const rankings = body.rankings as Array<Record<string, unknown>>;
      const realRows = rankings.filter((r) => r.survivalCurve != null);
      expect(realRows.length).toBeGreaterThan(0);
      for (const row of realRows) {
        const curve = row.survivalCurve as Record<string, number>;
        expect(curve).toHaveProperty("p_30d");
        expect(curve).toHaveProperty("p_90d");
        expect(curve).toHaveProperty("p_180d");
        expect(curve).toHaveProperty("p_365d");
        for (const k of ["p_30d", "p_90d", "p_180d", "p_365d"]) {
          expect(curve[k]).toBeGreaterThanOrEqual(0);
          expect(curve[k]).toBeLessThanOrEqual(1);
        }
      }
    });

    it("is deterministic — two consecutive calls produce identical survivalCurve per firm", async () => {
      const app = await buildApp();
      const { body: b1 } = await call(app, "POST", "/api/prop-firm/rank", validRankBody);
      const { body: b2 } = await call(app, "POST", "/api/prop-firm/rank", validRankBody);
      const r1 = b1.rankings as Array<Record<string, unknown>>;
      const r2 = b2.rankings as Array<Record<string, unknown>>;
      // Build firm→curve maps so sort order doesn't matter
      const map1 = new Map(r1.map((r) => [r.firm as string, r.survivalCurve]));
      const map2 = new Map(r2.map((r) => [r.firm as string, r.survivalCurve]));
      for (const [firm, curve1] of map1) {
        const curve2 = map2.get(firm);
        expect(curve2, `missing firm ${firm} in second call`).toBeDefined();
        expect(curve2).toEqual(curve1);
      }
    });

    it("isolates per-firm survival errors — one firm throwing does not break the response", async () => {
      // Make MFFU throw, Topstep succeeds.
      getCurrentPriorsMock.mockImplementation((firmId: string) => {
        if (firmId === "mffu") {
          return Promise.reject(new Error("synthetic failure"));
        }
        return Promise.resolve(defaultPriorsFor(firmId));
      });
      const app = await buildApp();
      const { status, body } = await call(app, "POST", "/api/prop-firm/rank", validRankBody);
      expect(status).toBe(200);
      const rankings = body.rankings as Array<Record<string, unknown>>;
      const mffu = rankings.find((r) => r.firm === "mffu");
      const topstep = rankings.find((r) => r.firm === "topstep");
      expect(mffu).toBeDefined();
      expect(mffu!.survivalProbability).toBeNull();
      expect(mffu!.survivalCurve).toBeNull();
      expect(mffu!.evidenceWeight).toBe(0);
      // Other firms still produce real survival data.
      expect(topstep!.survivalProbability).not.toBeNull();
    });
  });

  // ── GET /api/prop-firm/simulate/:backtestId ──────────────────────────────

  describe("GET /api/prop-firm/simulate/:backtestId", () => {
    it("returns survivalProbability + survivalCurve + evidenceWeight per firm", async () => {
      // Two consecutive db.select() calls happen in the route:
      //   1. backtests lookup
      //   2. strategies lookup (only if backtest found)
      // We sequence the dbSelectMock returns by call.
      const backtestRow = {
        id: "bt-1",
        strategyId: "strat-1",
        avgDailyPnl: "350",
        maxDrawdown: "-1500",
        winRate: "0.6",
        profitFactor: "1.8",
        avg_monthly_pnl: 7000,
      };
      const strategyRow = {
        id: "strat-1",
        name: "Test",
        dsl: { session_filter: "rth_only" },
      };
      dbSelectMock
        .mockReturnValueOnce([backtestRow])
        .mockReturnValueOnce([strategyRow]);

      const app = await buildApp();
      const { status, body } = await call(
        app,
        "GET",
        `/api/prop-firm/simulate/bt-1`,
      );
      expect(status).toBe(200);
      const results = body.results as Array<Record<string, unknown>>;
      // Only MFFU + Topstep supported after migration 0097
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (const row of results) {
        expect("survivalProbability" in row).toBe(true);
        expect("survivalCurve" in row).toBe(true);
        expect("evidenceWeight" in row).toBe(true);
      }
    });

    it("preserves ALL pre-existing simulate result fields (backward compat)", async () => {
      const backtestRow = {
        id: "bt-2",
        strategyId: "strat-2",
        avgDailyPnl: "300",
        maxDrawdown: "-1200",
        winRate: "0.55",
        profitFactor: "1.6",
      };
      dbSelectMock
        .mockReturnValueOnce([backtestRow])
        .mockReturnValueOnce([{ id: "strat-2", dsl: {} }]);
      const app = await buildApp();
      const { body } = await call(app, "GET", "/api/prop-firm/simulate/bt-2");
      const results = body.results as Array<Record<string, unknown>>;
      const REQUIRED_FIELDS = [
        "firm",
        "displayName",
        "accountType",
        "passes",
        "violations",
        "evalDays",
        "bufferDays",
        "evalCost",
        "ongoingMonthlyFee",
        "monthlyNet",
        "fundedPayoutMonths",
        "annualProfit",
        "roi",
      ];
      for (const row of results) {
        for (const field of REQUIRED_FIELDS) {
          expect(row, `firm ${row.firm} missing field ${field}`).toHaveProperty(field);
        }
      }
      // Top-level fields preserved
      expect(body).toHaveProperty("backtestId");
      expect(body).toHaveProperty("strategyId");
      expect(body).toHaveProperty("metrics");
      expect(body).toHaveProperty("results");
      expect(body).toHaveProperty("bestFirm");
    });

    it("returns 404 when backtest not found (existing behavior preserved)", async () => {
      dbSelectMock.mockReturnValue([]);
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "GET",
        "/api/prop-firm/simulate/nonexistent",
      );
      expect(status).toBe(404);
      expect(body.error).toBe("Backtest not found");
    });
  });

  // ── GET /api/prop-firm/survival/:firmId ──────────────────────────────────

  describe("GET /api/prop-firm/survival/:firmId", () => {
    it("returns sane shape for a known firm with priors", async () => {
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "GET",
        "/api/prop-firm/survival/topstep",
      );
      expect(status).toBe(200);
      expect(body.firmId).toBe("topstep");
      expect(typeof body.survivalProbability).toBe("number");
      expect(body.survivalCurve).toHaveProperty("p_30d");
      expect(body.survivalCurve).toHaveProperty("p_90d");
      expect(body.survivalCurve).toHaveProperty("p_180d");
      expect(body.survivalCurve).toHaveProperty("p_365d");
      expect(typeof body.evidenceWeight).toBe("number");
      expect(typeof body.automationFriendly).toBe("number");
      expect(body.appliedProfile).toHaveProperty("monthlyPayoutDollars");
      expect(body.appliedProfile).toHaveProperty("payoutRequestFrequency");
      expect(body.appliedProfile).toHaveProperty("usesAutomation");
      expect(body.appliedProfile).toHaveProperty("averagePosition");
    });

    it("includes phase: 'phase_0_advisory' literal", async () => {
      const app = await buildApp();
      const { body } = await call(
        app,
        "GET",
        "/api/prop-firm/survival/mffu",
      );
      expect(body.phase).toBe("phase_0_advisory");
    });

    it("returns 404 for unknown firm", async () => {
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "GET",
        "/api/prop-firm/survival/notarealfirm",
      );
      expect(status).toBe(404);
      expect(typeof body.error).toBe("string");
      expect((body.error as string).toLowerCase()).toContain("unknown firm");
    });

    it("returns sane response with evidenceWeight=0 when firm has no priors", async () => {
      // Override the mock for mffu to simulate empty priors (no data scenario).
      getCurrentPriorsMock.mockImplementation((firmId: string) => {
        if (firmId === "mffu") {
          return Promise.resolve({
            P_suspension_30d: 0,
            P_payout_denial: 0,
            P_fund_freeze_year: 0,
            P_profitable_trader_ban_year: 0,
            P_vpn_detection: 0,
            automation_friendly: 0.5,
            evidence_weight: 0,
          });
        }
        return Promise.resolve(defaultPriorsFor(firmId));
      });
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "GET",
        "/api/prop-firm/survival/mffu",
      );
      expect(status).toBe(200);
      expect(body.evidenceWeight).toBe(0);
      // Survival probability is zeroed (not 1.0) per the route's
      // "no data → no claim of safety" semantics.
      expect(body.survivalProbability).toBe(0);
      expect(body.phase).toBe("phase_0_advisory");
    });

    it("does NOT honor the pause guard (read-only diagnostic must serve always)", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "GET",
        "/api/prop-firm/survival/topstep",
      );
      // Must NOT 423 — survival reads serve regardless of pipeline state.
      expect(status).toBe(200);
      expect(body.firmId).toBe("topstep");
    });
  });

  // ── POST /api/prop-firm/refit-priors ──────────────────────────────────────

  describe("POST /api/prop-firm/refit-priors", () => {
    it("returns 400 when confirm flag is missing", async () => {
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "POST",
        "/api/prop-firm/refit-priors",
        {},
      );
      expect(status).toBe(400);
      expect(typeof body.error).toBe("string");
    });

    it("returns 400 when confirm is not literal true", async () => {
      const app = await buildApp();
      const { status } = await call(
        app,
        "POST",
        "/api/prop-firm/refit-priors",
        { confirm: false },
      );
      expect(status).toBe(400);
    });

    it("returns 423 when pipeline is paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "POST",
        "/api/prop-firm/refit-priors",
        { confirm: true },
      );
      expect(status).toBe(423);
      expect(body.error).toBe("pipeline_paused");
      // refitPriorsForAllFirms must NOT have been invoked when paused.
      expect(refitPriorsForAllFirmsMock).not.toHaveBeenCalled();
    });

    it("returns 200 with {firmsProcessed, priorsUpdated, errors, durationMs} when active", async () => {
      refitPriorsForAllFirmsMock.mockResolvedValue({
        firmsProcessed: 8,
        priorsUpdated: 2,
        errors: [],
      });
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "POST",
        "/api/prop-firm/refit-priors",
        { confirm: true },
      );
      expect(status).toBe(200);
      expect(body.firmsProcessed).toBe(8);
      expect(body.priorsUpdated).toBe(2);
      expect(body.errors).toEqual([]);
      expect(typeof body.durationMs).toBe("number");
      expect(refitPriorsForAllFirmsMock).toHaveBeenCalledOnce();
    });

    it("returns 500 when refitPriorsForAllFirms throws", async () => {
      refitPriorsForAllFirmsMock.mockRejectedValue(new Error("DB failure"));
      const app = await buildApp();
      const { status, body } = await call(
        app,
        "POST",
        "/api/prop-firm/refit-priors",
        { confirm: true },
      );
      expect(status).toBe(500);
      expect(typeof body.error).toBe("string");
      expect((body.error as string).toLowerCase()).toContain("db failure");
    });
  });
});
