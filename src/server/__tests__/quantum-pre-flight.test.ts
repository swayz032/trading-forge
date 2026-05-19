/**
 * Tier 6 — Quantum Pre-Flight Route Tests
 *
 * Pre-flight is CACHE-READ-ONLY. It NEVER spawns quantum compute.
 * The backtest auto-fire path at backtest-service.ts:1022-1041 remains the
 * SOLE quantum-compute trigger.
 *
 * Tests verify:
 *   1. Cache hit + passed (UCI <= threshold)
 *   2. Cache hit + failed (UCI > threshold)
 *   3. Cache miss → {cached: false, passed: true} (proceed; do NOT spawn)
 *   4. Pipeline paused → {cached: false, passed: true, reason: "pipeline_paused"}
 *   5. Strategy hash determinism (same DSL → same hash)
 *   6. Hash invariance to JSON key order
 *   7. ZERO compute spawning (no runQuantumMC, no runQuantumBreachEstimation calls)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { computeStrategyHash } from "../routes/quantum-pre-flight.js";

// ─── Hoisted mock state ─────────────────────────────────────────────────────
// vi.mock factories are hoisted above imports. We hoist their backing state
// alongside them via vi.hoisted so we can drive each test from outside the
// factory closure.
const mocks = vi.hoisted(() => ({
  isActiveMock: vi.fn().mockResolvedValue(true),
  dbExecuteMock: vi.fn(),
  runQuantumMCMock: vi.fn(),
  runQuantumBreachEstimationMock: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: mocks.isActiveMock,
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

vi.mock("../db/index.js", () => ({
  db: {
    execute: (...args: unknown[]) => mocks.dbExecuteMock(...args),
  },
}));

vi.mock("../db/schema.js", () => ({
  quantumMcRuns: { backtestId: "backtest_id" },
  backtests: { id: "id", config: "config" },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Compute spawn watchdog — tests assert these were NEVER invoked.
vi.mock("../services/quantum-mc-service.js", () => ({
  runQuantumMC: mocks.runQuantumMCMock,
  runQuantumBreachEstimation: mocks.runQuantumBreachEstimationMock,
}));

const { isActiveMock, dbExecuteMock, runQuantumMCMock, runQuantumBreachEstimationMock } = mocks;

async function buildApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { log: unknown; id: string }).log = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    (req as express.Request & { id: string }).id = "test-correlation-id";
    next();
  });
  const { quantumPreFlightRoutes } = await import("../routes/quantum-pre-flight.js");
  app.use("/api/quantum/pre-flight", quantumPreFlightRoutes);
  return app;
}

async function callPreFlight(
  app: express.Express,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/quantum/pre-flight`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const status = res.status;
        const parsed = (await res.json()) as Record<string, unknown>;
        server.close(() => resolve({ status, body: parsed }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

describe("Tier 6 — Quantum Pre-Flight Route", () => {
  beforeEach(() => {
    isActiveMock.mockReset();
    isActiveMock.mockResolvedValue(true);
    dbExecuteMock.mockReset();
    runQuantumMCMock.mockReset();
    runQuantumBreachEstimationMock.mockReset();
    delete process.env.QUANTUM_PROP_FIRM_UCI_THRESHOLD;
  });

  describe("strategy hash", () => {
    it("produces deterministic 64-char hex from same DSL", () => {
      const dsl = { name: "scalper", symbol: "MES", timeframe: "5m", direction: "long" };
      const h1 = computeStrategyHash(dsl);
      const h2 = computeStrategyHash(dsl);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is invariant to JSON key order", () => {
      const dslA = { name: "x", symbol: "MES", timeframe: "5m" };
      const dslB = { timeframe: "5m", symbol: "MES", name: "x" };
      expect(computeStrategyHash(dslA)).toBe(computeStrategyHash(dslB));
    });

    it("differs when DSL content changes", () => {
      const a = { name: "x", symbol: "MES" };
      const b = { name: "x", symbol: "MNQ" };
      expect(computeStrategyHash(a)).not.toBe(computeStrategyHash(b));
    });

    it("handles nested objects deterministically", () => {
      const a = { name: "x", entry_params: { fast: 9, slow: 21 } };
      const b = { entry_params: { slow: 21, fast: 9 }, name: "x" };
      expect(computeStrategyHash(a)).toBe(computeStrategyHash(b));
    });
  });

  describe("isActive guard", () => {
    it("returns {cached:false, passed:true} when pipeline paused", async () => {
      isActiveMock.mockResolvedValue(false);
      const app = await buildApp();
      const { status, body } = await callPreFlight(app, {
        dsl: { name: "x", symbol: "MES", timeframe: "5m" },
      });
      expect(status).toBe(200);
      expect(body.cached).toBe(false);
      expect(body.passed).toBe(true);
      expect(body.reason).toBe("pipeline_paused");
      // Crucially: DB must NOT have been queried.
      expect(dbExecuteMock).not.toHaveBeenCalled();
    });
  });

  describe("cache hit — passed", () => {
    it("returns {cached:true, passed:true} when UCI <= threshold", async () => {
      // estimated_value=0.005, upper=0.003 → UCI = 0.008 < 0.01 (default threshold)
      dbExecuteMock.mockResolvedValueOnce([
        {
          id: "qmc-uuid-1",
          backtest_id: "bt-uuid-1",
          estimated_value: "0.005",
          confidence_interval: { lower: 0.001, upper: 0.003, confidence_level: 0.95 },
        },
      ]);
      const app = await buildApp();
      const { status, body } = await callPreFlight(app, {
        dsl: { name: "x", symbol: "MES", timeframe: "5m" },
      });
      expect(status).toBe(200);
      expect(body.cached).toBe(true);
      expect(body.passed).toBe(true);
      expect(body.score).toBeCloseTo(0.008, 5);
      expect(body.qmcRunId).toBe("qmc-uuid-1");
    });
  });

  describe("cache hit — failed", () => {
    it("returns {cached:true, passed:false} when UCI > threshold", async () => {
      // estimated_value=0.018, upper=0.006 → UCI = 0.024 > 0.01
      dbExecuteMock.mockResolvedValueOnce([
        {
          id: "qmc-uuid-2",
          backtest_id: "bt-uuid-2",
          estimated_value: "0.018",
          confidence_interval: { lower: 0.002, upper: 0.006, confidence_level: 0.95 },
        },
      ]);
      const app = await buildApp();
      const { status, body } = await callPreFlight(app, {
        dsl: { name: "x", symbol: "MES", timeframe: "5m" },
      });
      expect(status).toBe(200);
      expect(body.cached).toBe(true);
      expect(body.passed).toBe(false);
      expect(body.score).toBeCloseTo(0.024, 5);
      expect(body.reason).toBe("uci_above_threshold");
    });

    it("respects QUANTUM_PROP_FIRM_UCI_THRESHOLD env override", async () => {
      process.env.QUANTUM_PROP_FIRM_UCI_THRESHOLD = "0.05";
      // UCI = 0.024 — passes under loosened 0.05 threshold
      dbExecuteMock.mockResolvedValueOnce([
        {
          id: "qmc-uuid-3",
          backtest_id: "bt-uuid-3",
          estimated_value: "0.018",
          confidence_interval: { lower: 0.002, upper: 0.006, confidence_level: 0.95 },
        },
      ]);
      const app = await buildApp();
      const { body } = await callPreFlight(app, {
        dsl: { name: "x", symbol: "MES", timeframe: "5m" },
      });
      expect(body.cached).toBe(true);
      expect(body.passed).toBe(true);
    });
  });

  describe("cache miss", () => {
    it("returns {cached:false, passed:true} when no prior quantum run exists", async () => {
      dbExecuteMock.mockResolvedValueOnce([]); // empty result set
      const app = await buildApp();
      const { status, body } = await callPreFlight(app, {
        dsl: { name: "x", symbol: "MES", timeframe: "5m" },
      });
      expect(status).toBe(200);
      expect(body.cached).toBe(false);
      expect(body.passed).toBe(true);
      expect(body.score).toBeNull();
      expect(body.reason).toBe("no_prior_quantum_run");
    });
  });

  describe("validation", () => {
    it("rejects request without dsl field with 400", async () => {
      const app = await buildApp();
      const { status } = await callPreFlight(app, {});
      expect(status).toBe(400);
    });

    it("rejects non-object dsl with 400", async () => {
      const app = await buildApp();
      const { status } = await callPreFlight(app, { dsl: "not-an-object" });
      expect(status).toBe(400);
    });
  });

  describe("ZERO compute spawn audit", () => {
    it("never calls runQuantumMC across all code paths", async () => {
      const app = await buildApp();
      // Run all four scenarios end-to-end
      isActiveMock.mockResolvedValueOnce(false);
      await callPreFlight(app, { dsl: { name: "a" } });

      isActiveMock.mockResolvedValueOnce(true);
      dbExecuteMock.mockResolvedValueOnce([]);
      await callPreFlight(app, { dsl: { name: "b" } });

      isActiveMock.mockResolvedValueOnce(true);
      dbExecuteMock.mockResolvedValueOnce([
        {
          id: "qmc-x",
          backtest_id: "bt-x",
          estimated_value: "0.001",
          confidence_interval: { lower: 0.0001, upper: 0.0001, confidence_level: 0.95 },
        },
      ]);
      await callPreFlight(app, { dsl: { name: "c" } });

      expect(runQuantumMCMock).not.toHaveBeenCalled();
      expect(runQuantumBreachEstimationMock).not.toHaveBeenCalled();
    });
  });

  describe("performance", () => {
    it("cache hit returns within 200ms", async () => {
      dbExecuteMock.mockResolvedValueOnce([
        {
          id: "qmc-perf",
          backtest_id: "bt-perf",
          estimated_value: "0.002",
          confidence_interval: { lower: 0.0005, upper: 0.001, confidence_level: 0.95 },
        },
      ]);
      const app = await buildApp();
      const t0 = Date.now();
      const { status } = await callPreFlight(app, {
        dsl: { name: "perf", symbol: "MES", timeframe: "5m" },
      });
      const elapsed = Date.now() - t0;
      expect(status).toBe(200);
      expect(elapsed).toBeLessThan(200);
    });

    it("cache miss returns within 5s", async () => {
      dbExecuteMock.mockResolvedValueOnce([]);
      const app = await buildApp();
      const t0 = Date.now();
      const { status } = await callPreFlight(app, {
        dsl: { name: "perf-miss", symbol: "MES", timeframe: "5m" },
      });
      const elapsed = Date.now() - t0;
      expect(status).toBe(200);
      expect(elapsed).toBeLessThan(5_000);
    });
  });
});
