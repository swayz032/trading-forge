import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  db: {},
}));

vi.mock("../db/schema.js", () => ({
  deeparForecasts: {},
  deeparTrainingRuns: {},
  auditLog: {},
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: {
    get: vi.fn(() => ({
      call: vi.fn(),
    })),
  },
  CircuitOpenError: class CircuitOpenError extends Error {},
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../data/loaders/duckdb-service.js", () => ({
  queryOhlcv: vi.fn(),
}));

import {
  calculateRollingHitRate,
  inferPredictedRegime,
  inferRealizedRegimeFromBars,
} from "./deepar-service.js";

describe("deepar validation helpers", () => {
  it("classifies a directional follow-through window as trending", () => {
    const bars = [
      { ts_event: "2026-02-01", open: 100, high: 101, low: 99.8, close: 100.1, volume: 1000 },
      { ts_event: "2026-02-02", open: 100.1, high: 100.5, low: 99.9, close: 100.2, volume: 1000 },
      { ts_event: "2026-02-03", open: 100.2, high: 100.6, low: 100.0, close: 100.3, volume: 1000 },
      { ts_event: "2026-02-04", open: 100.3, high: 100.7, low: 100.1, close: 100.4, volume: 1000 },
      { ts_event: "2026-02-05", open: 100.4, high: 100.8, low: 100.2, close: 100.5, volume: 1000 },
      { ts_event: "2026-02-06", open: 100.5, high: 100.9, low: 100.3, close: 100.6, volume: 1000 },
      { ts_event: "2026-02-07", open: 100.6, high: 101.0, low: 100.4, close: 100.7, volume: 1000 },
      { ts_event: "2026-02-08", open: 100.7, high: 101.1, low: 100.5, close: 100.8, volume: 1000 },
      { ts_event: "2026-02-09", open: 100.8, high: 101.2, low: 100.6, close: 100.9, volume: 1000 },
      { ts_event: "2026-02-10", open: 100.9, high: 101.3, low: 100.7, close: 101.0, volume: 1000 },
      { ts_event: "2026-02-11", open: 101.0, high: 101.4, low: 100.8, close: 101.1, volume: 1000 },
      { ts_event: "2026-02-12", open: 101.1, high: 101.5, low: 100.9, close: 101.2, volume: 1000 },
      { ts_event: "2026-02-13", open: 101.2, high: 101.6, low: 101.0, close: 101.3, volume: 1000 },
      { ts_event: "2026-02-14", open: 101.3, high: 101.7, low: 101.1, close: 101.4, volume: 1000 },
      { ts_event: "2026-02-15", open: 101.4, high: 101.8, low: 101.2, close: 101.5, volume: 1000 },
      { ts_event: "2026-02-16", open: 101.5, high: 101.9, low: 101.3, close: 101.6, volume: 1000 },
      { ts_event: "2026-02-17", open: 101.6, high: 102.0, low: 101.4, close: 101.7, volume: 1000 },
      { ts_event: "2026-02-18", open: 101.7, high: 102.1, low: 101.5, close: 101.8, volume: 1000 },
      { ts_event: "2026-02-19", open: 101.8, high: 102.2, low: 101.6, close: 101.9, volume: 1000 },
      { ts_event: "2026-02-20", open: 101.9, high: 102.3, low: 101.7, close: 102.0, volume: 1000 },
      { ts_event: "2026-02-21", open: 102.0, high: 102.4, low: 101.8, close: 102.1, volume: 1000 },
      { ts_event: "2026-02-22", open: 102.1, high: 102.5, low: 101.9, close: 102.2, volume: 1000 },
      { ts_event: "2026-02-23", open: 102.2, high: 102.6, low: 102.0, close: 102.3, volume: 1000 },
      { ts_event: "2026-02-24", open: 102.3, high: 102.7, low: 102.1, close: 102.4, volume: 1000 },
      { ts_event: "2026-02-25", open: 102.4, high: 102.8, low: 102.2, close: 102.5, volume: 1000 },
      { ts_event: "2026-02-26", open: 102.5, high: 103.8, low: 102.4, close: 103.6, volume: 1300 },
      { ts_event: "2026-02-27", open: 103.6, high: 104.8, low: 103.5, close: 104.7, volume: 1400 },
      { ts_event: "2026-02-28", open: 104.7, high: 105.9, low: 104.6, close: 105.8, volume: 1400 },
      { ts_event: "2026-03-01", open: 105.8, high: 107.0, low: 105.7, close: 106.9, volume: 1500 },
      { ts_event: "2026-03-02", open: 106.9, high: 108.2, low: 106.8, close: 108.1, volume: 1500 },
    ];

    const assessment = inferRealizedRegimeFromBars(bars, "2026-02-25", 5);

    expect(assessment?.actualRegime).toBe("trending");
    expect((assessment?.actualProbabilities.trending ?? 0)).toBeGreaterThan(0.5);
  });

  it("uses actual forecast hits instead of validated-row count for rolling hit rate", () => {
    const hitRate = calculateRollingHitRate([
      { actualRegime: "trending", pHighVol: "0.10", pTrending: "0.70", pMeanRevert: "0.20" },
      { actualRegime: "high_vol", pHighVol: "0.55", pTrending: "0.25", pMeanRevert: "0.20" },
      { actualRegime: "mean_revert", pHighVol: "0.60", pTrending: "0.10", pMeanRevert: "0.30" },
    ]);

    expect(hitRate).toBeCloseTo(2 / 3, 8);
  });

  it("normalizes regime probabilities before picking the predicted regime", () => {
    const inferred = inferPredictedRegime({
      high_vol: 7,
      trending: 2,
      mean_revert: 1,
    });

    expect(inferred.predictedRegime).toBe("high_vol");
    expect(inferred.predictedProbability).toBeCloseTo(0.7, 8);
    expect(
      inferred.normalizedProbabilities.high_vol
      + inferred.normalizedProbabilities.trending
      + inferred.normalizedProbabilities.mean_revert,
    ).toBeCloseTo(1, 8);
  });
});
