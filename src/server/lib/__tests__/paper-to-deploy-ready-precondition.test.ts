/**
 * paper-to-deploy-ready-precondition.test.ts — Gate 3 manual/cron parity
 * (ratify-packet: docs/ratify-packets/gate3-manual-cron-parity-2026-07-17.md)
 *
 * Pure-function unit tests for evaluatePaperToDeployReadyPrecondition() —
 * no DB, no mocks. Exhaustive boundary coverage mirroring the cron's
 * `tradingDays >= 30 && rollingSharpe >= 1.5` condition
 * (lifecycle-service.ts ~:5601).
 */
import { describe, it, expect } from "vitest";
import {
  evaluatePaperToDeployReadyPrecondition,
  PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS,
  PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE,
} from "../paper-to-deploy-ready-precondition.js";

describe("Gate 3 constants", () => {
  it("PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS === 30 (matches cron literal)", () => {
    expect(PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS).toBe(30);
  });

  it("PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE === 1.5 (matches cron literal)", () => {
    expect(PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE).toBe(1.5);
  });
});

describe("evaluatePaperToDeployReadyPrecondition — the 0-day/Sharpe=0 bug case", () => {
  it("BLOCKS: tradingDays=0, rollingSharpe=0 (the exact defect scenario)", () => {
    const result = evaluatePaperToDeployReadyPrecondition({ tradingDays: 0, rollingSharpe: 0 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("trading_days_or_sharpe_below_threshold");
    expect(result.auditAction).toBe("lifecycle.paper_to_deploy_ready_precondition_blocked");
    expect(result.tradingDays).toBe(0);
    expect(result.rollingSharpe).toBe(0);
    expect(result.minTradingDays).toBe(30);
    expect(result.minRollingSharpe).toBe(1.5);
  });
});

describe("evaluatePaperToDeployReadyPrecondition — boundary matrix", () => {
  it("PASS: exactly at both floors (tradingDays=30, rollingSharpe=1.5)", () => {
    const result = evaluatePaperToDeployReadyPrecondition({ tradingDays: 30, rollingSharpe: 1.5 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("precondition_met");
    expect(result.auditAction).toBeNull();
  });

  it("PASS: comfortably above both floors (tradingDays=45, rollingSharpe=2.1)", () => {
    const result = evaluatePaperToDeployReadyPrecondition({ tradingDays: 45, rollingSharpe: 2.1 });
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });

  it("BLOCK: one day short of the trading-day floor (tradingDays=29, rollingSharpe=2.0)", () => {
    const result = evaluatePaperToDeployReadyPrecondition({ tradingDays: 29, rollingSharpe: 2.0 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("trading_days_or_sharpe_below_threshold");
  });

  it("BLOCK: one hundredth below the Sharpe floor (tradingDays=40, rollingSharpe=1.49)", () => {
    const result = evaluatePaperToDeployReadyPrecondition({ tradingDays: 40, rollingSharpe: 1.49 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("trading_days_or_sharpe_below_threshold");
  });

  it("BLOCK: trading days met but Sharpe far below floor (tradingDays=30, rollingSharpe=0.2)", () => {
    const result = evaluatePaperToDeployReadyPrecondition({ tradingDays: 30, rollingSharpe: 0.2 });
    expect(result.passed).toBe(false);
  });

  it("BLOCK: Sharpe met but trading days far below floor (tradingDays=1, rollingSharpe=3.0)", () => {
    const result = evaluatePaperToDeployReadyPrecondition({ tradingDays: 1, rollingSharpe: 3.0 });
    expect(result.passed).toBe(false);
  });

  it("BLOCK: negative rollingSharpe (a losing strategy) with sufficient trading days", () => {
    const result = evaluatePaperToDeployReadyPrecondition({ tradingDays: 60, rollingSharpe: -0.5 });
    expect(result.passed).toBe(false);
  });
});

describe("evaluatePaperToDeployReadyPrecondition — lifecycleChangedAt missing (cron-parity semantics)", () => {
  it("BLOCKS even when tradingDays/rollingSharpe look sufficient — mirrors cron's `if (!s.lifecycleChangedAt) continue`", () => {
    // The cron sweep never evaluates (let alone promotes) a strategy with no
    // lifecycleChangedAt stamp — its loop skips it outright. The manual path
    // must reach the same outcome, not attempt a 0-day interpretation.
    const result = evaluatePaperToDeployReadyPrecondition({
      tradingDays: 999,
      rollingSharpe: 99,
      lifecycleChangedAtMissing: true,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("lifecycle_changed_at_missing");
    expect(result.auditAction).toBe("lifecycle.paper_to_deploy_ready_precondition_blocked");
  });
});
