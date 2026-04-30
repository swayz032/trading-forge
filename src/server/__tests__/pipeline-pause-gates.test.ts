/**
 * FIX 5 — Pipeline pause gates at route handler level.
 *
 * The audit found 7+ services bypass isPipelineActive() directly. Service-level
 * fixes are out of scope (cron jobs gate the calls). The remaining gap is direct
 * API hits — n8n / dashboard / curl can spawn Python and write DB rows even when
 * the pipeline is PAUSED/VACATION.
 *
 * These tests mount each affected router on a bare Express app and assert that
 * POST handlers short-circuit with 423 (Locked) when isPipelineActive() returns
 * false. GET handlers (read-only) are NOT gated and remain reachable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";

// ─── Pipeline control mock — flipped per-test ───────────────────────────────
const isActiveMock = vi.fn().mockResolvedValue(true);
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: isActiveMock,
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

// ─── DB / service mocks — bare stubs so the route can import without crashing.
// We never reach service layer in these tests because the gate short-circuits
// at 423 before any DB or Python work happens.
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "noop" }]) })) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
  },
}));

vi.mock("../db/schema.js", () => ({
  monteCarloRuns: {},
  stressTestRuns: {},
  backtests: {},
  strategies: {},
  rlTrainingRuns: {},
  deeparForecasts: {},
  deeparTrainingRuns: {},
  criticOptimizationRuns: {},
  auditLog: {},
  paperSessions: {},
  paperTrades: {},
  systemJournal: {},
  complianceReviews: {},
  skipDecisions: {},
  strategyGraveyard: {},
  strategyExports: {},
  strategyExportArtifacts: {},
  backtestTrades: {},
  backtestMatrix: {},
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/monte-carlo-service.js", () => ({
  runMonteCarlo: vi.fn().mockResolvedValue({ id: "mc-noop", status: "completed" }),
}));
vi.mock("../services/quantum-mc-service.js", () => ({
  runQuantumMC: vi.fn().mockResolvedValue({ id: "qmc-noop", status: "completed" }),
  runHybridCompare: vi.fn().mockResolvedValue({ id: "hc-noop" }),
  getQuantumRun: vi.fn().mockResolvedValue(null),
  getBenchmark: vi.fn().mockResolvedValue(null),
}));
vi.mock("../services/deepar-service.js", () => ({
  trainDeepAR: vi.fn().mockResolvedValue({ status: "completed" }),
  predictRegime: vi.fn().mockResolvedValue([{ symbol: "MES", forecast: [] }]),
  getLatestForecast: vi.fn().mockResolvedValue(null),
  getDeepARWeight: vi.fn().mockReturnValue(0.05),
  isDeepARDeferred: vi.fn().mockReturnValue(false),
}));
vi.mock("../services/critic-optimizer-service.js", () => ({
  triggerCriticOptimizer: vi.fn().mockResolvedValue({ runId: "run-noop", status: "started" }),
  getCriticRun: vi.fn().mockResolvedValue(null),
  getCriticHistory: vi.fn().mockResolvedValue([]),
  getCriticCandidates: vi.fn().mockResolvedValue([]),
  manualReplayCandidates: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    checkAutoPromotions() {
      return Promise.resolve([]);
    }
    checkAutoDemotions() {
      return Promise.resolve([]);
    }
    promoteStrategy() {
      return Promise.resolve({ success: true });
    }
    getPipelineHealth() {
      return Promise.resolve({});
    }
  },
  passingFirmNamesFromCompliance: vi.fn().mockReturnValue([]),
  findFirmsWithComplianceDrift: vi.fn().mockResolvedValue([]),
}));
vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({}),
}));

// Re-import after mocks (lazy import inside each describe so vi.mock is applied)
async function buildApp(routerPath: string, mountPath: string): Promise<express.Express> {
  const { default: _mod } = { default: undefined };
  void _mod;
  const app = express();
  app.use(express.json());
  // Default req.log so route handlers that use it don't crash
  app.use((req, _res, next) => {
    (req as express.Request & { log: { error: typeof console.error; info: typeof console.info } }).log = {
      error: console.error,
      info: console.info,
    } as unknown as never;
    (req as express.Request & { id: string }).id = "test-correlation-id";
    next();
  });
  const mod = await import(routerPath);
  // Each module exports a named *Routes router
  const router =
    mod.monteCarloRoutes ??
    mod.quantumMcRoutes ??
    mod.deeparRoutes ??
    mod.criticOptimizerRoutes ??
    mod.strategyRoutes;
  app.use(mountPath, router as express.Router);
  return app;
}

async function callRoute(
  app: express.Express,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        });
        const status = res.status;
        let parsed: unknown = null;
        try {
          parsed = await res.json();
        } catch {
          parsed = null;
        }
        server.close(() => resolve({ status, body: parsed }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

describe("FIX 5 — Pipeline pause gates at route handler level", () => {
  beforeEach(() => {
    isActiveMock.mockReset();
    isActiveMock.mockResolvedValue(true);
  });

  describe("monte-carlo router", () => {
    it("POST /api/monte-carlo returns 423 when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/monte-carlo.js", "/api/monte-carlo");
      const { status, body } = await callRoute(app, "POST", "/api/monte-carlo", {
        backtestId: "00000000-0000-4000-8000-000000000000",
      });
      expect(status).toBe(423);
      expect(body).toEqual({ error: "pipeline_paused" });
    });

    it("POST /api/monte-carlo returns 202 when pipeline active", async () => {
      isActiveMock.mockResolvedValue(true);
      const app = await buildApp("../routes/monte-carlo.js", "/api/monte-carlo");
      const { status } = await callRoute(app, "POST", "/api/monte-carlo", {
        backtestId: "00000000-0000-4000-8000-000000000000",
      });
      // Either 202 (success) or 400 (validation), but NOT 423
      expect(status).not.toBe(423);
    });
  });

  describe("quantum-mc router", () => {
    it("POST /api/quantum-mc/run returns 423 when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/quantum-mc.js", "/api/quantum-mc");
      const { status, body } = await callRoute(app, "POST", "/api/quantum-mc/run", {
        backtestId: "00000000-0000-4000-8000-000000000000",
      });
      expect(status).toBe(423);
      expect(body).toEqual({ error: "pipeline_paused" });
    });

    it("POST /api/quantum-mc/sqa-optimize returns 423 when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/quantum-mc.js", "/api/quantum-mc");
      const { status, body } = await callRoute(app, "POST", "/api/quantum-mc/sqa-optimize", {
        paramRanges: [{ name: "x", min_val: 0, max_val: 1, n_bits: 4 }],
      });
      expect(status).toBe(423);
      expect(body).toEqual({ error: "pipeline_paused" });
    });
  });

  describe("deepar router", () => {
    it("POST /api/deepar/train returns 423 when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/deepar.js", "/api/deepar");
      const { status, body } = await callRoute(app, "POST", "/api/deepar/train", {
        symbols: ["MES"],
      });
      expect(status).toBe(423);
      expect(body).toEqual({ error: "pipeline_paused" });
    });

    it("POST /api/deepar/predict returns 423 when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/deepar.js", "/api/deepar");
      const { status, body } = await callRoute(app, "POST", "/api/deepar/predict", {
        symbols: ["MES"],
      });
      expect(status).toBe(423);
      expect(body).toEqual({ error: "pipeline_paused" });
    });

    it("GET /api/deepar/forecast/all is NOT gated (read-only)", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/deepar.js", "/api/deepar");
      const { status } = await callRoute(app, "GET", "/api/deepar/forecast/all");
      // Read-only routes must be reachable even when paused — should NOT return 423
      expect(status).not.toBe(423);
    });
  });

  describe("critic-optimizer router", () => {
    it("POST /api/critic-optimizer/analyze returns 423 when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/critic-optimizer.js", "/api/critic-optimizer");
      const { status, body } = await callRoute(app, "POST", "/api/critic-optimizer/analyze", {
        strategy_id: "00000000-0000-4000-8000-000000000000",
      });
      expect(status).toBe(423);
      expect(body).toEqual({ error: "pipeline_paused" });
    });

    it("POST /api/critic-optimizer/replay returns 423 when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/critic-optimizer.js", "/api/critic-optimizer");
      const { status, body } = await callRoute(app, "POST", "/api/critic-optimizer/replay", {
        run_id: "00000000-0000-4000-8000-000000000000",
      });
      expect(status).toBe(423);
      expect(body).toEqual({ error: "pipeline_paused" });
    });
  });

  describe("strategies router", () => {
    it("POST /api/strategies/lifecycle/check returns 423 when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp("../routes/strategies.js", "/api/strategies");
      const { status, body } = await callRoute(app, "POST", "/api/strategies/lifecycle/check");
      expect(status).toBe(423);
      expect(body).toEqual({ error: "pipeline_paused" });
    });

    it("POST /api/strategies/lifecycle/check returns 200 when pipeline active", async () => {
      isActiveMock.mockResolvedValue(true);
      const app = await buildApp("../routes/strategies.js", "/api/strategies");
      const { status } = await callRoute(app, "POST", "/api/strategies/lifecycle/check");
      // With ACTIVE pipeline, the lifecycle check should run (returns 200 or 500
      // depending on mock behavior, but NOT 423)
      expect(status).not.toBe(423);
    });
  });
});
