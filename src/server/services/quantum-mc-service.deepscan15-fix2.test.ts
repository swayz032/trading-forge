/**
 * quantum-mc-service.deepscan15-fix2.test.ts — deep-scan #15 FIX-1 (H2)
 *
 * quantum-mc-service.ts::runPythonQuantumMC spawned its Python subprocess
 * directly via child_process.spawn, bypassing the shared python-runner
 * semaphore (MAX_PYTHON_SUBPROCESSES / getPythonSubprocessStats()). This meant
 * the tower could run MAX_PYTHON_SUBPROCESSES (backtest lane) PLUS N untracked
 * quantum-MC subprocesses simultaneously while /api/health reported the
 * backtest lane as "not saturated" — a false-green health signal.
 *
 * The fix wraps the spawn with acquireExternalPythonSlot("backtest") /
 * releaseExternalPythonSlot("backtest") from python-runner.ts. This test
 * mocks python-runner.js and child_process to assert:
 *   1. acquireExternalPythonSlot is called BEFORE spawn
 *   2. releaseExternalPythonSlot is called AFTER the subprocess completes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ─── Call-order tracking ──────────────────────────────────────────────────────

let _callOrder: string[] = [];

// ─── child_process mock — immediately succeeds on next tick ─────────────────

vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    _callOrder.push("spawn");
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    setTimeout(() => child.emit("close", 0), 0);
    return child;
  }),
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

vi.mock("../../shared/utils.js", () => ({
  parsePythonJson: vi.fn(() => ({
    estimated_value: 0.1,
    confidence_interval: { lower: 0.05, upper: 0.15, confidence_level: 0.95 },
    num_oracle_calls: 10,
    num_qubits: 4,
    backend_used: "local_sim",
    execution_time_ms: 500,
    governance_labels: { experimental: true },
    reproducibility_hash: "hash123",
    raw_result: { method: "iae" },
  })),
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./pine-export-service.js", () => ({
  compilePineExport: vi.fn(),
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })),
  },
}));

vi.mock("../lib/quantum-cost-tracker.js", () => ({
  recordCost: vi.fn(() => Promise.resolve({ id: "cost-row-id" })),
  completeCost: vi.fn(() => Promise.resolve(undefined)),
}));

// ─── FIX H2 under test: python-runner acquire/release spies ─────────────────

vi.mock("../lib/python-runner.js", () => ({
  acquireExternalPythonSlot: vi.fn((lane: string = "backtest") => {
    _callOrder.push(`acquire:${lane}`);
    return Promise.resolve();
  }),
  releaseExternalPythonSlot: vi.fn((lane: string = "backtest") => {
    _callOrder.push(`release:${lane}`);
  }),
}));

// ─── DB mock: sequential thenable/chainable query builder ────────────────────
// Each call consumes the next entry in _dbSeq, regardless of whether the
// terminal method in the call chain is .limit() / .returning() / a bare
// await on the chain object itself (drizzle chains are thenable).

let _dbSeq: unknown[] = [];
let _dbIdx = 0;

function _nextSeq(): Promise<unknown> {
  const result = _dbIdx < _dbSeq.length ? _dbSeq[_dbIdx++] : [];
  return Promise.resolve(result);
}

function _makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.set = vi.fn(() => chain);
  chain.limit = vi.fn(() => _nextSeq());
  chain.returning = vi.fn(() => _nextSeq());
  // Thenable: `await db.x().y().z()` without an explicit terminal method
  // resolves via this, matching drizzle's real query-builder contract.
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    _nextSeq().then(resolve, reject);
  return chain;
}

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => _makeChain()),
    insert: vi.fn(() => _makeChain()),
    update: vi.fn(() => _makeChain()),
  },
}));

vi.mock("../db/schema.js", () => ({
  backtests: { id: "id", strategyId: "strategy_id" },
  monteCarloRuns: { backtestId: "backtest_id" },
  quantumMcRuns: { id: "id" },
  quantumMcBenchmarks: {},
  auditLog: {},
  strategies: {},
  strategyExports: {},
  adversarialStressRuns: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: col, val })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  _callOrder = [];
  _dbSeq = [];
  _dbIdx = 0;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("H2 — quantum-mc-service.ts routes its bespoke spawn through the python-runner semaphore", () => {
  it("acquires a backtest-lane slot before spawning and releases it after completion", async () => {
    _dbSeq = [
      // [0] backtests lookup: const [bt] = await db.select().from(backtests).where(...)
      [{ id: "bt-1", status: "completed", dailyPnls: [1, 2, 3], strategyId: null }],
      // [1] insert quantumMcRuns .values().returning()
      [{ id: "qmc-row-1" }],
      // [2] update quantumMcRuns .set().where() — awaited directly
      [],
      // [3] insert auditLog .values() — awaited directly
      [],
      // [4] select monteCarloRuns ... .limit(1) — empty, skips benchmark persistence
      [],
    ];

    const { runQuantumMC } = await import("../services/quantum-mc-service.js");

    const result = await runQuantumMC("bt-1", "breach", "topstep_50k", {});

    expect((result as { status: string }).status).toBe("completed");

    // The fix: acquire/release must wrap the spawn call.
    expect(_callOrder).toContain("acquire:backtest");
    expect(_callOrder).toContain("spawn");
    expect(_callOrder).toContain("release:backtest");
    expect(_callOrder.indexOf("acquire:backtest")).toBeLessThan(_callOrder.indexOf("spawn"));
    expect(_callOrder.indexOf("spawn")).toBeLessThan(_callOrder.indexOf("release:backtest"));
  });
});
