/**
 * Wave 13 Track B — CF-3: backtest:scored signal + strategies.forgeScore sync
 *
 * Pins the contract that:
 * 1. strategies.forgeScore is updated unconditionally after a completed backtest,
 *    regardless of whether the tier is TIER_1/2/3 or REJECTED.
 * 2. broadcastSSE("backtest:scored") is called with the correct payload.
 * 3. audit_log receives action="backtest.scored" with evidence.
 *
 * The pre-Wave-13 bug: forgeScore was only written to strategies inside the
 * TIER_1/2/3 gate at backtest-service.ts:1386. REJECTED-tier strategies never
 * had their score reflected, so the UI showed 0/null and operators couldn't see
 * "REJECTED at 14/100 — need 50+ to promote".
 */

import { describe, it, expect } from "vitest";

// ─── Minimal shape checks (static code analysis) ─────────────────────────────
// These tests verify the structure of backtest-service.ts without running the
// full service (which requires a live DB + Python engine).

describe("Wave 13 CF-3 — backtest:scored observability", () => {
  it("backtest-service.ts emits backtest:scored unconditionally after completion", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const source = readFileSync(
      resolve(process.cwd(), "src/server/services/backtest-service.ts"),
      "utf-8",
    );

    // Verify that strategies.forgeScore update exists OUTSIDE the TIER gate block
    // The pattern we're looking for: update strategies BEFORE the if-tier-gate
    // The tier gate is: if (!config.suppressAutoPromote && result.tier && ["TIER_1",...])
    const scoredBlockIdx = source.indexOf("backtest:scored");
    const tierGateIdx = source.indexOf('config.suppressAutoPromote && result.tier && ["TIER_1"');

    // backtest:scored must exist
    expect(scoredBlockIdx).toBeGreaterThan(0);

    // backtest:scored emission must come BEFORE the auto-promote tier gate
    // (i.e. it fires for all completed backtests, including REJECTED)
    expect(scoredBlockIdx).toBeLessThan(tierGateIdx);
  });

  it("backtest:scored SSE event is in the frontend type union", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const sseTypes = readFileSync(
      resolve(process.cwd(), "Trading_forge_frontend/amber-vision-main/src/types/sse-events.ts"),
      "utf-8",
    );

    // Type union entry
    expect(sseTypes).toMatch(/type: "backtest:scored"/);
    // Interface definition
    expect(sseTypes).toMatch(/BacktestScoredData/);
    expect(sseTypes).toMatch(/gateRejected: boolean/);
  });

  it("backtest:scored is in the System Map SSE inventory", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const systemMap = readFileSync(
      resolve(process.cwd(), "Trading Forge System Map v2.md"),
      "utf-8",
    );

    const sseSection = systemMap.match(/## §SSE Events Canonical Inventory([\s\S]*)/);
    expect(sseSection).toBeTruthy();

    expect(sseSection![1]).toContain("backtest:scored");
    expect(sseSection![1]).toContain("gateRejected");
  });

  it("backtest.scored audit_log action is written in the scoring block", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const source = readFileSync(
      resolve(process.cwd(), "src/server/services/backtest-service.ts"),
      "utf-8",
    );

    // Audit log entry must include action "backtest.scored"
    expect(source).toMatch(/action: "backtest\.scored"/);
    // Must include forge score in the result evidence
    expect(source).toMatch(/forgeScore: result\.forge_score/);
  });

  it("strategies.forgeScore update is outside the TIER_1/2/3 gate (not gated on tier)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const source = readFileSync(
      resolve(process.cwd(), "src/server/services/backtest-service.ts"),
      "utf-8",
    );

    // The strategies.forgeScore update must appear before the tier gate.
    // Search for the CF-3 comment block which brackets the unconditional update.
    const stratForgeUpdateIdx = source.indexOf(
      'CF-3 Fix: Sync forgeScore',
    );
    const tierGateIdx = source.indexOf(
      'config.suppressAutoPromote && result.tier && ["TIER_1"',
    );

    expect(stratForgeUpdateIdx).toBeGreaterThan(0);
    expect(tierGateIdx).toBeGreaterThan(0);

    // The unconditional update must come BEFORE the tier gate
    expect(stratForgeUpdateIdx).toBeLessThan(tierGateIdx);
  });

  it("backtestScoredTotal Prometheus counter is imported in backtest-service", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const source = readFileSync(
      resolve(process.cwd(), "src/server/services/backtest-service.ts"),
      "utf-8",
    );

    expect(source).toContain("backtestScoredTotal");
    expect(source).toMatch(/backtestScoredTotal\.labels\(/);
  });

  it("metrics-registry exports backtestScoredTotal and cronJobsConcurrent", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const source = readFileSync(
      resolve(process.cwd(), "src/server/lib/metrics-registry.ts"),
      "utf-8",
    );

    expect(source).toContain("backtestScoredTotal");
    expect(source).toContain("cronJobsConcurrent");
    expect(source).toMatch(/tf_backtest_scored_total/);
    expect(source).toMatch(/tf_cron_jobs_concurrent/);
  });
});
