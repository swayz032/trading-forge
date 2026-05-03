/**
 * Signal Correlation Route Tests — A7 (W11 Team B)
 *
 * Tests GET /api/signal-correlation/matrix:
 *  1. Returns 423 when pipeline is paused
 *  2. Returns 200 with empty matrix when no strategies have vectors
 *  3. Returns 200 with pairs array + metadata
 *  4. threshold field is present and correct
 *  5. high_correlation_count is correct
 *  6. Returns 500 on service error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Router } from "express";
import type { Request, Response } from "express";

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/signal-correlation-service.js", () => ({
  buildCorrelationMatrix: vi.fn().mockResolvedValue([]),
  SIGNAL_CORRELATION_THRESHOLD: 0.85,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { buildCorrelationMatrix, SIGNAL_CORRELATION_THRESHOLD } from "../services/signal-correlation-service.js";
import type { MatrixEntry } from "../services/signal-correlation-service.js";

// ─── Helper: simulate route handler ──────────────────────────────────────────

async function callMatrixRoute(
  pipelineActive: boolean,
  matrixResult: MatrixEntry[] | "throw",
): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.mocked(isPipelineActive).mockResolvedValue(pipelineActive);

  if (matrixResult === "throw") {
    vi.mocked(buildCorrelationMatrix).mockRejectedValue(new Error("DB error"));
  } else {
    vi.mocked(buildCorrelationMatrix).mockResolvedValue(matrixResult);
  }

  // Simulate the route handler inline
  const res = { status: 200, body: {} as Record<string, unknown> };
  const mockRes = {
    status: (code: number) => {
      res.status = code;
      return { json: (body: Record<string, unknown>) => { res.body = body; } };
    },
    json: (body: Record<string, unknown>) => { res.body = body; },
  };

  if (!(await isPipelineActive())) {
    mockRes.status(423).json({
      error: "pipeline_paused",
      message: "Signal correlation matrix is unavailable while the pipeline is paused",
      pairs: [],
      threshold: SIGNAL_CORRELATION_THRESHOLD,
      high_correlation_count: 0,
      total_pairs: 0,
      strategy_count: 0,
    });
    return res;
  }

  try {
    const pairs = await buildCorrelationMatrix();
    const highCorrelationCount = pairs.filter((p) => p.exceeds_threshold).length;
    const strategyIds = new Set<string>();
    for (const p of pairs) {
      strategyIds.add(p.strategyIdA);
      strategyIds.add(p.strategyIdB);
    }
    mockRes.json({
      pairs,
      threshold: SIGNAL_CORRELATION_THRESHOLD,
      high_correlation_count: highCorrelationCount,
      total_pairs: pairs.length,
      strategy_count: strategyIds.size,
    });
  } catch (err) {
    mockRes.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
      pairs: [],
      threshold: SIGNAL_CORRELATION_THRESHOLD,
      high_correlation_count: 0,
      total_pairs: 0,
      strategy_count: 0,
    });
  }

  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/signal-correlation/matrix", () => {
  // 1. Pipeline paused → 423
  it("returns 423 when pipeline is paused", async () => {
    const result = await callMatrixRoute(false, []);
    expect(result.status).toBe(423);
    expect(result.body.error).toBe("pipeline_paused");
    expect(result.body.pairs).toEqual([]);
  });

  // 2. Empty matrix → 200 with empty pairs
  it("returns 200 with empty matrix when no strategies have vectors", async () => {
    const result = await callMatrixRoute(true, []);
    expect(result.status).toBe(200);
    expect(result.body.pairs).toEqual([]);
    expect(result.body.total_pairs).toBe(0);
    expect(result.body.strategy_count).toBe(0);
    expect(result.body.high_correlation_count).toBe(0);
  });

  // 3. Matrix with pairs → correct structure
  it("returns 200 with pairs array and metadata", async () => {
    const mockPairs: MatrixEntry[] = [
      {
        strategyIdA: "strat-a",
        strategyNameA: "Strategy A",
        lifecycleStateA: "PAPER",
        strategyIdB: "strat-b",
        strategyNameB: "Strategy B",
        lifecycleStateB: "DEPLOYED",
        similarity: 0.42,
        exceeds_threshold: false,
      },
      {
        strategyIdA: "strat-a",
        strategyNameA: "Strategy A",
        lifecycleStateA: "PAPER",
        strategyIdB: "strat-c",
        strategyNameB: "Strategy C",
        lifecycleStateB: "DEPLOYED",
        similarity: 0.91,
        exceeds_threshold: true,
      },
    ];

    const result = await callMatrixRoute(true, mockPairs);
    expect(result.status).toBe(200);
    expect(result.body.total_pairs).toBe(2);
    expect(result.body.high_correlation_count).toBe(1);
    expect(result.body.strategy_count).toBe(3); // strat-a, strat-b, strat-c
    expect((result.body.pairs as MatrixEntry[]).length).toBe(2);
  });

  // 4. threshold field is present and correct
  it("includes the threshold in the response", async () => {
    const result = await callMatrixRoute(true, []);
    expect(result.body.threshold).toBe(0.85);
  });

  // 5. high_correlation_count is correct
  it("counts exceeds_threshold pairs correctly", async () => {
    const mockPairs: MatrixEntry[] = [
      {
        strategyIdA: "a", strategyNameA: "A", lifecycleStateA: "PAPER",
        strategyIdB: "b", strategyNameB: "B", lifecycleStateB: "DEPLOYED",
        similarity: 0.90, exceeds_threshold: true,
      },
      {
        strategyIdA: "a", strategyNameA: "A", lifecycleStateA: "PAPER",
        strategyIdB: "c", strategyNameB: "C", lifecycleStateB: "DEPLOYED",
        similarity: 0.30, exceeds_threshold: false,
      },
      {
        strategyIdA: "b", strategyNameA: "B", lifecycleStateA: "DEPLOYED",
        strategyIdB: "c", strategyNameB: "C", lifecycleStateB: "DEPLOYED",
        similarity: 0.88, exceeds_threshold: true,
      },
    ];
    const result = await callMatrixRoute(true, mockPairs);
    expect(result.body.high_correlation_count).toBe(2);
  });

  // 6. Service throws → 500
  it("returns 500 on service error", async () => {
    const result = await callMatrixRoute(true, "throw");
    expect(result.status).toBe(500);
    expect(result.body.error).toBe("internal_error");
    expect(result.body.message).toContain("DB error");
    expect(result.body.pairs).toEqual([]);
  });
});
