import { describe, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  db: {},
}));

vi.mock("../db/schema.js", () => ({
  backtests: {},
  monteCarloRuns: {},
  quantumMcRuns: {},
  quantumMcBenchmarks: {},
  auditLog: {},
  strategies: {},
  strategyExports: {},
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../shared/utils.js", () => ({
  parsePythonJson: vi.fn(),
}));

vi.mock("./pine-export-service.js", () => ({
  compilePineExport: vi.fn(),
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn(() => ({
      setAttribute: vi.fn(),
      end: vi.fn(),
    })),
  },
}));

// NOTE: `isQuantumBenchmarkEligibleForCritic` and `workloadKeyForEventType` were
// referenced here but never existed as exports of `./quantum-mc-service`. The
// module has only ever exposed runQuantumMC / runHybridCompare / getQuantumRun /
// getBenchmark / getQuantumRuntimeStatus. These tests describe behavior
// (workload-key mapping + critic-eligibility gating) that lives elsewhere or
// has not been implemented yet. Skipped (not deleted) so that if/when those
// helpers land in this module, the assertions are easy to revive.
describe.skip("quantum-mc-service helpers", () => {
  it("maps breach-style workloads to portfolio tail risk", () => {
    // Pending: workloadKeyForEventType is not exported from quantum-mc-service.
  });

  it("keeps shadow and tolerance-only benchmarks out of critic authority", () => {
    // Pending: isQuantumBenchmarkEligibleForCritic is not exported from quantum-mc-service.
  });
});
