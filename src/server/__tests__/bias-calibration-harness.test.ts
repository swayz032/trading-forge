/**
 * Bias Calibration Harness Tests — Track 5 Phase D Readiness
 *
 * 6 tests covering:
 *   1. fitCalibration writes a row to bias_calibration_curves
 *   2. fitCalibration returns CalibrationCurve with correct shape
 *   3. runAblation writes a row to bias_ablation_results
 *   4. runAblation returns AblationResult with null gpt5_verdict
 *   5. computePbo returns a number between 0 and 1
 *   6. computePbo idempotency: same call twice produces same PBO (deterministic math)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mockState = vi.hoisted(() => {
  const insertedCalibration: unknown[] = [];
  const insertedAblation: unknown[] = [];
  const insertedAuditLog: unknown[] = [];
  const biasDecisionRows: unknown[] = [];
  return { insertedCalibration, insertedAblation, insertedAuditLog, biasDecisionRows };
});

const makeDbChain = () => {
  // Returns a thenable chain that resolves at any point (.where().orderBy() or just .where())
  const resolveRows = () => Promise.resolve(mockState.biasDecisionRows);
  const leaf = {
    orderBy: vi.fn().mockImplementation(resolveRows),
    then: (r: (v: unknown[]) => void, e?: (err: unknown) => void) =>
      resolveRows().then(r, e),
    catch: (e: (err: unknown) => void) => resolveRows().catch(e),
  };
  const mid = {
    where: vi.fn().mockReturnValue(leaf),
    orderBy: vi.fn().mockImplementation(resolveRows),
    then: (r: (v: unknown[]) => void, e?: (err: unknown) => void) =>
      resolveRows().then(r, e),
    catch: (e: (err: unknown) => void) => resolveRows().catch(e),
  };
  return { from: vi.fn().mockReturnValue(mid) };
};

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockImplementation(() => makeDbChain()),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((row: unknown) => {
        const tableName = (table as { _: { name: string } })._?.name ?? "unknown";
        if (tableName === "bias_calibration_curves") mockState.insertedCalibration.push(row);
        else if (tableName === "bias_ablation_results") mockState.insertedAblation.push(row);
        else mockState.insertedAuditLog.push(row);
        return Promise.resolve();
      }),
    })),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock("../db/schema.js", () => ({
  biasDecisions: { _: { name: "bias_decisions" }, decisionTimestamp: "decision_timestamp", engineMode: "engine_mode" },
  biasCalibrationCurves: { _: { name: "bias_calibration_curves" }, fitAt: "fit_at" },
  biasAblationResults: { _: { name: "bias_ablation_results" }, runAt: "run_at" },
  auditLog: { _: { name: "audit_log" } },
}));

vi.mock("../index.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values })),
  and: vi.fn((...args: unknown[]) => args),
  gte: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  count: vi.fn(),
}));

import {
  fitCalibration,
  runAblation,
  computePbo,
  BIAS_HARNESS_CONFIG,
} from "../services/bias-calibration-harness.js";

describe("fitCalibration", () => {
  beforeEach(() => {
    mockState.insertedCalibration.length = 0;
    mockState.insertedAuditLog.length = 0;
    mockState.biasDecisionRows = [];
  });

  it("writes a row to bias_calibration_curves", async () => {
    const result = await fitCalibration(30);
    expect(mockState.insertedCalibration.length).toBe(1);
  });

  it("returns CalibrationCurve with correct shape", async () => {
    const result = await fitCalibration(30);
    expect(result).toMatchObject({
      windowDays: 30,
      curveMethod: "platt",
      version: BIAS_HARNESS_CONFIG.calibrationVersion,
    });
    expect(typeof result.reliabilityScore).toBe("number");
    expect(typeof result.sampleSize).toBe("number");
    expect(typeof result.curveParams).toBe("object");
    expect(result.curveParams).toHaveProperty("intercept");
    expect(result.curveParams).toHaveProperty("slope");
  });
});

describe("runAblation", () => {
  beforeEach(() => {
    mockState.insertedAblation.length = 0;
    mockState.insertedAuditLog.length = 0;
    mockState.biasDecisionRows = [
      { playbook: "TREND_CONTINUATION_LONG", rawStateProbs: { trend: 0.8 }, hysteresisApplied: false },
      { playbook: "TREND_CONTINUATION_SHORT", rawStateProbs: { trend: 0.3 }, hysteresisApplied: true },
      { playbook: "NO_TRADE", rawStateProbs: { trend: 0.2 }, hysteresisApplied: false },
    ];
  });

  it("writes a row to bias_ablation_results", async () => {
    await runAblation("2018-2026", 2.0);
    expect(mockState.insertedAblation.length).toBe(1);
  });

  it("returns AblationResult with null gpt5_verdict", async () => {
    const result = await runAblation("2018-2026", 2.0);
    expect(result.pboScore).toBeNull(); // PBO is populated by computePbo separately
    expect(result.costMultiplier).toBe(2.0);
    expect(result.periodStart).toBe("2018-01-01");
    expect(result.periodEnd).toBe("2026-12-31");
    // gpt5_verdict is set to null at DB insert time
    const insertedRow = mockState.insertedAblation[0] as Record<string, unknown>;
    expect(insertedRow.gpt5Verdict).toBeNull();
  });
});

describe("computePbo", () => {
  beforeEach(() => {
    mockState.biasDecisionRows = Array.from({ length: 30 }, (_, i) => ({
      playbook: i % 3 === 0 ? "TREND_CONTINUATION_LONG" : "NO_TRADE",
      rawStateProbs: { trend: i % 2 === 0 ? 0.7 : 0.3 },
      decisionTimestamp: new Date(Date.now() - i * 3600000).toISOString(),
    }));
  });

  it("returns a number between 0 and 1", async () => {
    const pbo = await computePbo();
    expect(typeof pbo).toBe("number");
    expect(pbo).toBeGreaterThanOrEqual(0);
    expect(pbo).toBeLessThanOrEqual(1);
  });

  it("is deterministic: same input rows produce same PBO", async () => {
    const pbo1 = await computePbo();
    const pbo2 = await computePbo();
    expect(pbo1).toBe(pbo2);
  });

  it("returns 1.0 when insufficient sample", async () => {
    mockState.biasDecisionRows = [
      { playbook: "TREND_CONTINUATION_LONG", rawStateProbs: { trend: 0.7 }, decisionTimestamp: new Date().toISOString() },
    ];
    const pbo = await computePbo();
    expect(pbo).toBe(1.0);
  });
});
