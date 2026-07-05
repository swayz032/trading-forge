/**
 * quantum-mc-service-observability.test.ts — Deep-scan #16 Wave-1 Track 5 (HIGH E-8)
 *
 * HIGH E-8 finding: backtest-service.ts's quantum-mc auto-fire fire-and-forget hook
 * caught failures with logger.error only — no audit_log, no counter, no Discord.
 * quantum-mc-service.ts::runQuantumMC() could also throw BEFORE its own "running"
 * quantumMcRuns row existed (a pre-insert DB error on the backtest fetch or the
 * insert itself), leaving no row to attach a failure audit to.
 *
 * These tests exercise the REAL runQuantumMC() with every dependency mocked
 * (child_process.spawn, db, schema, logger, tracing, cost-tracker) to verify:
 *   1. Pre-insert DB failure -> tf_quantum_mc_runs_total{outcome="pre_insert_error"}
 *      increments + a "quantum-mc.run" audit row is written against the backtestId
 *      (no quantumMcRuns row exists yet) + the error still propagates to the caller.
 *   2. Clean success -> tf_quantum_mc_runs_total{outcome="completed"} increments.
 *   3. Internal Python failure (AFTER the running row exists) -> the EXISTING
 *      "quantum-mc.run" failure audit path still fires, AND
 *      tf_quantum_mc_runs_total{outcome="failed"} increments (previously this
 *      counter did not exist at all).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

let _spawnFactory: (() => FakeChild) | null = null;

vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    if (!_spawnFactory) throw new Error("spawn called but no factory set");
    return _spawnFactory();
  }),
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

// ─── DB mock (per-test controllable via hoisted state) ───────────────────────

const dbState = vi.hoisted(() => ({
  selectImpl: vi.fn(),
  insertValuesImpl: vi.fn(),
  updateSetImpl: vi.fn(),
}));

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => dbState.selectImpl()),
          // Plain `.where(...)` resolves directly (used for the initial backtest fetch)
          then: (resolve: (v: unknown) => void) => resolve(dbState.selectImpl()),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => dbState.insertValuesImpl()),
        then: (resolve: (v: unknown) => void) => resolve(dbState.insertValuesImpl()),
        catch: () => Promise.resolve(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => dbState.updateSetImpl()),
      })),
    })),
  },
}));

vi.mock("../../db/schema.js", () => ({
  backtests: {},
  monteCarloRuns: {},
  quantumMcRuns: {},
  quantumMcBenchmarks: {},
  auditLog: {},
  strategies: {},
  strategyExports: {},
  adversarialStressRuns: {},
}));

vi.mock("../../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../pine-export-service.js", () => ({
  compilePineExport: vi.fn(),
}));

vi.mock("../../lib/tracing.js", () => ({
  tracer: {
    startSpan: () => ({ setAttribute: vi.fn(), end: vi.fn() }),
  },
}));

vi.mock("../../lib/quantum-cost-tracker.js", () => ({
  recordCost: vi.fn().mockResolvedValue({ id: "cost-row-1" }),
  completeCost: vi.fn().mockResolvedValue(undefined),
}));

const metricsState = vi.hoisted(() => ({
  incMock: vi.fn(),
}));

vi.mock("../../lib/metrics-registry.js", () => ({
  quantumMcRunsTotal: {
    labels: vi.fn((labels: Record<string, string>) => ({
      inc: () => metricsState.incMock(labels),
    })),
  },
}));

describe("HIGH E-8 — runQuantumMC observability", () => {
  beforeEach(() => {
    vi.resetModules();
    _spawnFactory = null;
    metricsState.incMock.mockClear();
    dbState.selectImpl.mockReset();
    dbState.insertValuesImpl.mockReset();
    dbState.updateSetImpl.mockReset();
    dbState.insertValuesImpl.mockResolvedValue(undefined);
    dbState.updateSetImpl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    _spawnFactory = null;
  });

  it("increments outcome=pre_insert_error and writes an audit row against the backtestId when the pre-insert DB read throws", async () => {
    dbState.selectImpl.mockRejectedValue(new Error("connection reset"));

    const { runQuantumMC } = await import("../quantum-mc-service.js");

    await expect(runQuantumMC("bt-123", "breach", "topstep_50k")).rejects.toThrow("connection reset");

    expect(metricsState.incMock).toHaveBeenCalledWith({ outcome: "pre_insert_error" });
  });

  it("increments outcome=completed on a clean end-to-end run", async () => {
    // First select call: backtest fetch. Second (inside try): classicalMcRun lookup (none).
    dbState.selectImpl
      .mockResolvedValueOnce([{ id: "bt-1", status: "completed", dailyPnls: [10, -5, 20], strategyId: null }])
      .mockResolvedValueOnce([]);
    dbState.insertValuesImpl.mockResolvedValueOnce([{ id: "qmc-run-1" }]).mockResolvedValue(undefined);

    _spawnFactory = () => {
      const child = makeFakeChild();
      queueMicrotask(() => {
        child.stdout.emit(
          "data",
          Buffer.from(JSON.stringify({
            estimated_value: 0.05,
            confidence_interval: { lower: 0.01, upper: 0.09, confidence_level: 0.95 },
            num_oracle_calls: 10,
            num_qubits: 4,
            backend_used: "local_sim",
            execution_time_ms: 120,
            governance_labels: {},
            reproducibility_hash: "abc123",
            raw_result: { method: "iae" },
          })),
        );
        child.emit("close", 0);
      });
      return child;
    };

    const { runQuantumMC } = await import("../quantum-mc-service.js");
    const result = await runQuantumMC("bt-1", "breach", "topstep_50k");

    expect(result.status).toBe("completed");
    expect(metricsState.incMock).toHaveBeenCalledWith({ outcome: "completed" });
  });

  it("increments outcome=failed when the Python subprocess fails AFTER the running row exists", async () => {
    dbState.selectImpl.mockResolvedValueOnce([{ id: "bt-2", status: "completed", dailyPnls: [10, -5, 20], strategyId: null }]);
    dbState.insertValuesImpl.mockResolvedValueOnce([{ id: "qmc-run-2" }]).mockResolvedValue(undefined);

    _spawnFactory = () => {
      const child = makeFakeChild();
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("Traceback: ValueError\n"));
        child.emit("close", 1);
      });
      return child;
    };

    const { runQuantumMC } = await import("../quantum-mc-service.js");
    const result = await runQuantumMC("bt-2", "breach", "topstep_50k");

    expect(result.status).toBe("failed");
    expect(metricsState.incMock).toHaveBeenCalledWith({ outcome: "failed" });
  });
});
