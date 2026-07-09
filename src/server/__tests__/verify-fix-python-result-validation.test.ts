/**
 * Regression tests — deep-scan verify-fix cluster (2026-07-06)
 *
 * C) frankenstein-service.ts / adversarial-stress-service.ts previously trusted
 * parsePythonJson output with ZERO runtime validation, yet `passed` gated a real
 * TESTING→PAPER promotion. A Python serialization bug making `passed` non-boolean
 * would silently corrupt the promotion. These tests lock in the added validators
 * that fail CLOSED (throw) on a malformed shape.
 *
 * The validators are pure functions with no DB / no I/O — cheap to unit test.
 */
import { describe, it, expect, vi } from "vitest";

// Mock heavy leaf imports so importing the services doesn't boot the server / DB.
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../services/pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));

import { validateFrankensteinResult } from "../services/frankenstein-service.js";
import { validateAdversarialStressResult } from "../services/adversarial-stress-service.js";

describe("validateFrankensteinResult — fail-closed on malformed Python payload", () => {
  const valid = {
    test_mode: "full_shuffle",
    n_shuffles: 100,
    p95_sharpe: 1.2,
    median_pf: 1.4,
    passed: true,
    sharpe_distribution: [],
    pf_distribution: [],
    failure_examples: [],
    wall_clock_ms: 1234,
    status: "completed",
    error_message: null,
  };

  it("accepts a well-formed result (passed boolean, numeric fields present)", () => {
    expect(() => validateFrankensteinResult(valid)).not.toThrow();
  });

  it("accepts null p95_sharpe / median_pf (documented nullable)", () => {
    expect(() => validateFrankensteinResult({ ...valid, p95_sharpe: null, median_pf: null })).not.toThrow();
  });

  it("THROWS when `passed` is a truthy string instead of a strict boolean", () => {
    expect(() => validateFrankensteinResult({ ...valid, passed: "true" })).toThrow(/passed/);
  });

  it("THROWS when `passed` is 1 (number) instead of boolean", () => {
    expect(() => validateFrankensteinResult({ ...valid, passed: 1 })).toThrow(/passed/);
  });

  it("THROWS when `passed` is null (serialization dropped it)", () => {
    expect(() => validateFrankensteinResult({ ...valid, passed: null })).toThrow(/passed/);
  });

  it("THROWS when n_shuffles is non-finite", () => {
    expect(() => validateFrankensteinResult({ ...valid, n_shuffles: NaN })).toThrow(/n_shuffles/);
  });

  it("THROWS when wall_clock_ms is missing", () => {
    const { wall_clock_ms: _drop, ...noWall } = valid;
    expect(() => validateFrankensteinResult(noWall)).toThrow(/wall_clock_ms/);
  });

  it("THROWS when p95_sharpe is a non-numeric non-null value", () => {
    expect(() => validateFrankensteinResult({ ...valid, p95_sharpe: "1.2" })).toThrow(/p95_sharpe/);
  });

  it("THROWS on non-object input", () => {
    expect(() => validateFrankensteinResult(null)).toThrow();
    expect(() => validateFrankensteinResult("not-json")).toThrow();
  });
});

describe("validateAdversarialStressResult — light shape check", () => {
  const valid = {
    worst_case_breach_prob: 0.12,
    breach_minimal_n_trades: 8,
    worst_sequence_examples: [],
    n_qubits: 4,
    n_trades: 100,
    daily_loss_limit: 1000,
    method: "grover",
    status: "completed",
    error_message: null,
    wall_clock_ms: 500,
    qpu_seconds: 0,
    governance_labels: {},
    reproducibility_hash: "abc",
    hardware: "sim",
  };

  it("accepts a well-formed result", () => {
    expect(() => validateAdversarialStressResult(valid)).not.toThrow();
  });

  it("accepts null breach metrics (documented nullable)", () => {
    expect(() => validateAdversarialStressResult({ ...valid, worst_case_breach_prob: null, breach_minimal_n_trades: null })).not.toThrow();
  });

  it("THROWS when status is not a string", () => {
    expect(() => validateAdversarialStressResult({ ...valid, status: 200 })).toThrow(/status/);
  });

  it("THROWS when worst_case_breach_prob is a non-numeric non-null value", () => {
    expect(() => validateAdversarialStressResult({ ...valid, worst_case_breach_prob: "high" })).toThrow(/worst_case_breach_prob/);
  });

  it("THROWS on non-object input", () => {
    expect(() => validateAdversarialStressResult(undefined)).toThrow();
  });
});
