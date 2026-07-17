/**
 * fixwave2-scheduler-health-monitoring.test.ts — source-contract regression
 * tests (2026-07-17) proving scheduler.ts's three cron bodies actually WIRE
 * the new pure classifiers in, at the correct branch, rather than merely
 * having the classifier modules exist unused. Mirrors the established
 * source-inspection pattern this repo uses for scheduler.ts (see
 * scheduler-r2fix-round2.test.ts, wave25-n8n-drift-cron.test.ts) because
 * booting the full ~9k-line scheduler.ts via initScheduler() to invoke one
 * cron body directly is impractical here (see those files' own comments).
 *
 * Findings closed:
 *   HIGH-1 — n8n-health-check (~scheduler.ts "n8n-health-check" registerJob):
 *     empty execution-log stats no longer silently reports "all healthy".
 *   MED-2  — n8n drift detector (_runN8nDriftAudit): API-unreachable exit
 *     code no longer fires the same CRITICAL alert as genuine drift.
 *   MED-3  — comparePaperToBacktest: a zero/null backtest baseline no longer
 *     silently skips that metric's comparison.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schedulerSrc = readFileSync(join(process.cwd(), "src/server/scheduler.ts"), "utf-8");

describe("HIGH-1 — n8n-health-check wires classifyN8nHealthCheck (not the old failing.length>0/else pattern)", () => {
  it("imports classifyN8nHealthCheck from the new pure leaf", () => {
    expect(schedulerSrc).toContain('import { classifyN8nHealthCheck } from "./lib/n8n-health-classifier.js";');
  });

  it("the n8n-health-check job body calls classifyN8nHealthCheck and reads getLastN8nScrapeState", () => {
    const idx = schedulerSrc.indexOf('registerJob("n8n-health-check"');
    expect(idx).toBeGreaterThan(-1);
    const body = schedulerSrc.slice(idx, idx + 4000);
    expect(body).toContain("getLastN8nScrapeState");
    expect(body).toContain("classifyN8nHealthCheck(stats, getLastN8nScrapeState())");
    // The 'indeterminate' branch must exist and must NOT fall into the
    // generic debug-log "all workflows healthy" path.
    expect(body).toContain('check.status === "indeterminate"');
    expect(body).toContain("n8n health check inconclusive");
    // notifyWarning (not notifyCritical) is used for the indeterminate case —
    // "can't verify" is a different severity than "confirmed failures".
    const indeterminateIdx = body.indexOf('check.status === "indeterminate"');
    const indeterminateBlock = body.slice(indeterminateIdx, indeterminateIdx + 1500);
    expect(indeterminateBlock).toContain("notifyWarning(");
  });

  it("the old bare 'all workflows healthy' unconditional else-branch string is gone", () => {
    const idx = schedulerSrc.indexOf('registerJob("n8n-health-check"');
    const body = schedulerSrc.slice(idx, idx + 4000);
    // Old code: `} else { logger.debug({ workflowCount: stats.length }, "n8n health check: all workflows healthy"); }`
    // with no other branch. The literal string should no longer be a
    // hardcoded fixed message with nothing else in the else-chain.
    expect(body).not.toMatch(/else \{\s*logger\.debug\(\{ workflowCount: stats\.length \}, "n8n health check: all workflows healthy"\);\s*\}/);
  });
});

describe("MED-2 — n8n drift detector wires classifyN8nDriftAuditExit and a distinct 'unreachable' path", () => {
  it("imports classifyN8nDriftAuditExit from the new pure leaf", () => {
    expect(schedulerSrc).toContain('import { classifyN8nDriftAuditExit } from "./lib/n8n-drift-audit-classifier.js";');
  });

  it("_runN8nDriftAudit branches on classifyN8nDriftAuditExit(...) === 'unreachable' before the genuine-drift branch", () => {
    const fnIdx = schedulerSrc.indexOf("async function _runN8nDriftAudit");
    expect(fnIdx).toBeGreaterThan(-1);
    const body = schedulerSrc.slice(fnIdx, fnIdx + 9000);
    const unreachableIdx = body.indexOf('classifyN8nDriftAuditExit(resolvedExitCode, false) === "unreachable"');
    const driftIdx = body.indexOf('"n8n.drift_detected"');
    expect(unreachableIdx).toBeGreaterThan(-1);
    expect(driftIdx).toBeGreaterThan(-1);
    // The unreachable branch must be checked BEFORE the code falls into the
    // genuine-drift branch (else-if ordering).
    expect(unreachableIdx).toBeLessThan(driftIdx);
  });

  it("the unreachable branch writes a distinct audit action and uses notifyWarning, not notifyCritical", () => {
    const fnIdx = schedulerSrc.indexOf("async function _runN8nDriftAudit");
    const body = schedulerSrc.slice(fnIdx, fnIdx + 9000);
    const unreachableIdx = body.indexOf('classifyN8nDriftAuditExit(resolvedExitCode, false) === "unreachable"');
    const driftIdx = body.indexOf('"n8n.drift_detected"');
    const unreachableBlock = body.slice(unreachableIdx, driftIdx);
    expect(unreachableBlock).toContain('"n8n.drift_check_unreachable"');
    expect(unreachableBlock).toContain("notifyWarning(");
    expect(unreachableBlock).not.toContain("notifyCritical(");
    // Message must explicitly disclaim that this is NOT a drift finding.
    expect(unreachableBlock).toContain("NOT a drift finding");
  });

  it("the genuine-drift branch (exit 1) still uses notifyCritical with the original remediation text (no regression)", () => {
    const fnIdx = schedulerSrc.indexOf("async function _runN8nDriftAudit");
    const body = schedulerSrc.slice(fnIdx, fnIdx + 9000);
    const driftIdx = body.indexOf('"n8n.drift_detected"');
    const driftBlock = body.slice(driftIdx, driftIdx + 1500);
    expect(driftBlock).toContain("notifyCritical(");
    expect(driftBlock).toContain("DGEk1D478xWJClKD");
  });
});

describe("MED-3 — comparePaperToBacktest wires computeMetricDeviation/maxAvailableDeviation (raw fields, not coerced)", () => {
  it("imports the paper-backtest-deviation pure leaf", () => {
    expect(schedulerSrc).toContain(
      'import { computeMetricDeviation, maxAvailableDeviation, type MetricDeviation } from "./lib/paper-backtest-deviation.js";',
    );
  });

  it("comparePaperToBacktest passes the RAW backtest.* fields (not Number(x ?? 0)) into computeMetricDeviation", () => {
    const fnIdx = schedulerSrc.indexOf("async function comparePaperToBacktest");
    expect(fnIdx).toBeGreaterThan(-1);
    const body = schedulerSrc.slice(fnIdx, fnIdx + 4500);
    expect(body).toContain('computeMetricDeviation("Sharpe", paperSharpe, backtest.sharpeRatio,');
    expect(body).toContain('computeMetricDeviation("WinRate", paperWinRate, backtest.winRate,');
    expect(body).toContain('computeMetricDeviation("AvgDailyPnL", paperAvgDailyPnl, backtest.avgDailyPnl,');
    expect(body).toContain("maxAvailableDeviation(deviations)");
  });

  it("the old '!== 0' skip-gate pattern is gone from the metric-comparison block", () => {
    const fnIdx = schedulerSrc.indexOf("async function comparePaperToBacktest");
    const body = schedulerSrc.slice(fnIdx, fnIdx + 4500);
    expect(body).not.toContain("if (btSharpe !== 0)");
    expect(body).not.toContain("if (btWinRate !== 0)");
    expect(body).not.toContain("if (btAvgDailyPnl !== 0)");
  });

  it("unavailable metrics are surfaced (logged + persisted), not silently dropped", () => {
    const fnIdx = schedulerSrc.indexOf("async function comparePaperToBacktest");
    const body = schedulerSrc.slice(fnIdx, fnIdx + 4500);
    expect(body).toContain("unavailableMetrics");
    expect(body).toContain("baseline unavailable for one or more metrics");
  });
});
