/**
 * wave-a-critic-pattern-aggregator.test.ts
 *
 * Wave A Critic Fix 3 — dryRun / kill-switch interaction regression suite.
 *
 * Finding MED: pattern-aggregator-service.ts evaluated the kill-switch BEFORE
 * checking dryRun.  `dryRun=true` callers (replay harness) got `{status:"halted"}`
 * even when the operator had engaged the kill switch for production reasons —
 * making the replay harness return empty results useless for grading.
 *
 * Fix: when `dryRun===true`, skip the kill-switch check entirely and emit
 * logger.warn({killSwitchParam}, "pattern-aggregator: dryRun bypasses kill switch").
 * Non-dryRun production path retains kill-switch semantics unchanged.
 *
 * Tests (triplet):
 *   A. dryRun=true  + kill switch OFF → NOT halted (kill switch bypassed)
 *   B. dryRun=true  + kill switch ON  → NOT halted (kill switch bypassed)
 *   C. dryRun=false + kill switch OFF → halted (production path unchanged)
 *
 * Supporting tests:
 *   D. dryRun=false + kill switch ON  → NOT halted (production normal-run)
 *   E. non-dryRun halt emits auto_patch.loop_halted_skip; dryRun=true does NOT
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must be hoisted before any import) ─────────────────────────

vi.mock("../db/index.js", () => ({
  db: {},
}));

vi.mock("../db/schema.js", () => ({
  tradeCritique:   { id: "id", grade: "grade", technicalDiagnosis: "td", critiquedAt: "ca" },
  systemParameters: { paramName: "paramName", currentValue: "currentValue" },
  auditLog:        { action: "action" },
  promptVersions:  { id: "id", promptType: "promptType", version: "version", content: "content", isActive: "isActive" },
  promptAbTests:   { id: "id", promptType: "promptType", versionAId: "versionAId", versionBId: "versionBId", startedAt: "startedAt", status: "status" },
}));

vi.mock("../services/model-router.js", () => ({
  callOpenAI: vi.fn(),
  getFallback: vi.fn(() => ({ provider: "ollama", model: "deepseek-r1:14b" })),
  loadSystemPrompt: vi.fn(() => "You are the pattern aggregator."),
  setAppendixCache: vi.fn(),
  getAppendixCacheSize: vi.fn(() => 0),
  warmAppendixCache: vi.fn(async () => undefined),
  __clearAppendixCacheForTests: vi.fn(),
  selectModel: vi.fn(),
}));

vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn(),
  })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────
// Static imports only — no dynamic imports / vi.resetModules() pattern.
// vi.mock() hoists above, so these see the mocked modules.
// db is the same object reference the service module receives.

import { db } from "../db/index.js";
import { callOpenAI } from "../services/model-router.js";
import { runPatternAggregator } from "../services/pattern-aggregator-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChain(responseProvider: () => unknown): unknown {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    from:    (..._a) => chain,
    where:   (..._a) => chain,
    orderBy: (..._a) => chain,
    limit:   (..._a) => Promise.resolve(responseProvider()),
  };
  return chain;
}

/**
 * Build a DB mock where every `.select()...limit()` call returns the next response
 * in the given array.  Kill-switch check is always the FIRST select in a non-dryRun call.
 */
function buildSelectSequence(responses: unknown[][]): void {
  let callIdx = 0;
  (db as any).select = vi.fn().mockImplementation(() => {
    const idx = callIdx++;
    return makeChain(() => responses[idx] ?? []);
  });
}

function buildInsertMock(): void {
  (db as any).insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "new-v" }]),
    }),
  }));
}

const KILL_SWITCH_DISABLED = [{ currentValue: "false" }];  // kill switch OFF  → halts prod
const KILL_SWITCH_ENABLED  = [{ currentValue: "true" }];   // kill switch ON   → proceeds
const FIVE_CRITIQUES = Array.from({ length: 5 }, (_, i) => ({
  id: `crit-${i}`, grade: "A",
  technicalDiagnosis: {
    entry_quality_score: 8.0,
    exit_execution_delta_r: 0.1,
    confluence_factors_missed: [],
    parameter_hint: null,
    regime_mismatch: false,
    realized_r: 1.5,
  },
  critiquedAt: new Date("2026-05-24T10:00:00Z"),
}));

// ─── Fix 3 — dryRun / kill-switch triplet ─────────────────────────────────────

describe("Fix 3 — dryRun bypasses kill switch (Finding MED)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("A. dryRun=true + kill switch OFF → NOT halted (kill switch bypassed)", async () => {
    // Kill switch is DISABLED (would halt a non-dryRun call).
    // With dryRun=true, we expect the function to skip the kill-switch check
    // and proceed (returning insufficient_samples since critiques < MIN=10).
    buildSelectSequence([
      KILL_SWITCH_DISABLED,   // would halt if read — but dryRun skips this
      FIVE_CRITIQUES,          // critiques (below min → insufficient_samples)
    ]);
    buildInsertMock();

    const result = await runPatternAggregator(true);

    // Must NOT be halted — the kill switch was bypassed
    expect(result.status).not.toBe("halted");
    // Should return insufficient_samples (5 < MIN_CRITIQUES=10)
    expect(result.status).toBe("insufficient_samples");
  });

  it("B. dryRun=true + kill switch ON → NOT halted (kill switch still bypassed for dryRun)", async () => {
    // Kill switch is ENABLED (would normally proceed).
    // dryRun also bypasses the kill-switch check entirely — same outcome.
    buildSelectSequence([
      KILL_SWITCH_ENABLED,   // skipped for dryRun
      FIVE_CRITIQUES,
    ]);
    buildInsertMock();

    const result = await runPatternAggregator(true);

    expect(result.status).not.toBe("halted");
  });

  it("C. dryRun=false + kill switch OFF → halted (production path unchanged)", async () => {
    // Non-dryRun with kill switch DISABLED → production halt behavior preserved.
    buildSelectSequence([
      KILL_SWITCH_DISABLED,   // kill switch read → disabled → halt
    ]);
    buildInsertMock();

    const result = await runPatternAggregator(false);

    expect(result.status).toBe("halted");
    // No LLM call should happen
    expect(vi.mocked(callOpenAI)).not.toHaveBeenCalled();
  });

  it("D. dryRun=false + kill switch ON → NOT halted (normal production run)", async () => {
    // Non-dryRun with kill switch ENABLED → proceeds normally to insufficient_samples.
    buildSelectSequence([
      KILL_SWITCH_ENABLED,   // kill switch → enabled
      FIVE_CRITIQUES,         // below min → insufficient_samples
    ]);
    buildInsertMock();

    const result = await runPatternAggregator(false);

    expect(result.status).not.toBe("halted");
    expect(result.status).toBe("insufficient_samples");
  });

  it("E. non-dryRun halt emits auto_patch.loop_halted_skip audit; dryRun=true emits no halt audit", async () => {
    // ── Part 1: non-dryRun halt should emit the audit row ────────────────────
    const auditInserts: Record<string, unknown>[] = [];

    buildSelectSequence([
      KILL_SWITCH_DISABLED,  // non-dryRun → kill switch check → disabled → halt
    ]);
    (db as any).insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        auditInserts.push(row);
        return { returning: vi.fn().mockResolvedValue([{ id: "new-a" }]) };
      }),
    }));

    await runPatternAggregator(false);

    const haltAudit = auditInserts.find((r) => r.action === "auto_patch.loop_halted_skip");
    expect(haltAudit).toBeTruthy();
    expect((haltAudit!.result as Record<string, unknown>).reason).toBe("kill_switch");

    // ── Part 2: dryRun=true should NOT emit a halt audit ─────────────────────
    vi.clearAllMocks();
    const auditInsertsB: Record<string, unknown>[] = [];

    buildSelectSequence([
      KILL_SWITCH_DISABLED,  // dryRun bypasses this entirely
      FIVE_CRITIQUES,
    ]);
    (db as any).insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        auditInsertsB.push(row);
        return { returning: vi.fn().mockResolvedValue([{ id: "new-b" }]) };
      }),
    }));

    await runPatternAggregator(true);

    const haltAuditDry = auditInsertsB.find((r) => r.action === "auto_patch.loop_halted_skip");
    // dryRun=true: the kill-switch is bypassed so no halt audit should fire
    expect(haltAuditDry).toBeUndefined();
  });
});
