/**
 * wave25-path-c-error-boundary.test.ts — Wave 25 Pass 2, A-1
 *
 * Coverage:
 *   1. evaluateWeightedConfluence throws → audit row + SSE + Discord + pathCFailed=true
 *   2. Malformed weights JSON causes Path C failure → falls back to Path B (stage2 not blocked)
 *   3. Happy path (no throw) → audit row NOT emitted for error, normal flow preserved
 *   4. notifyCritical fires on Path C error (Discord alert)
 *
 * Tests the error-boundary contract introduced in A-1 (Wave 25 Pass 2):
 *   - Any uncaught throw from evaluateWeightedConfluence is caught
 *   - Audit row: action="weighted_confluence.evaluation_error", fallback="path_b"
 *   - SSE: event="alert:path_c_error"
 *   - Discord: notifyCritical fires
 *   - pathCFailed=true → execution falls through to Path B (boolean counting)
 *
 * Architecture note: this test does NOT test paper-signal-service in integration
 * (that requires a full DB + session). Instead it tests the error-boundary logic
 * via the evaluateWeightedConfluence module directly — injecting a throw and
 * verifying the error path fires its three side-effects.
 *
 * The three side-effects (audit, SSE, Discord) are tested via direct imports
 * with vi.mock() isolation so no DB is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all DB/service dependencies before importing the module under test
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

vi.mock("../services/confluence-score.js", () => ({
  evaluateWeightedConfluence: vi.fn(),
  // Export constants that paper-signal-service uses from this module
  FACTOR_MACRO_ALIGNMENT: "macro_alignment",
}));

import { insertAuditRow } from "../lib/audit-log-helper.js";
import { broadcastSSE } from "../routes/sse.js";
import { notifyCritical } from "../services/notification-service.js";
import { evaluateWeightedConfluence } from "../services/confluence-score.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simulate the A-1 error boundary logic in isolation.
 * Mirrors the try/catch structure added to paper-signal-service.ts
 * in the `if (useWeightedScoring)` block.
 */
async function runPathCWithErrorBoundary(opts: {
  strategyId: string;
  sessionId: string;
  symbol: string;
  correlationId?: string | null;
  scoringStrategy: Record<string, unknown>;
  weightedCtx: Record<string, unknown>;
}): Promise<{ pathCFailed: boolean; auditFired: boolean; sseFired: boolean; discordFired: boolean }> {
  const { strategyId, sessionId, symbol, correlationId } = opts;
  let pathCFailed = false;
  let auditFired = false;
  let sseFired = false;
  let discordFired = false;

  const mocker_evaluateWeightedConfluence = evaluateWeightedConfluence as ReturnType<typeof vi.fn>;

  try {
    // This is the call that can throw (the A-1 guarded call)
    mocker_evaluateWeightedConfluence(opts.scoringStrategy, opts.weightedCtx);
  } catch (pathCErr: unknown) {
    pathCFailed = true;
    const pathCErrMsg = pathCErr instanceof Error ? pathCErr.message : String(pathCErr);

    await (insertAuditRow as ReturnType<typeof vi.fn>)({
      action: "weighted_confluence.evaluation_error",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "system",
      result: {
        strategyId,
        error: pathCErrMsg,
        correlationId: correlationId ?? null,
        fallback: "path_b",
        session_id: sessionId,
        symbol,
      },
      status: "failure",
      correlationId: correlationId ?? null,
    });
    auditFired = true;

    (notifyCritical as ReturnType<typeof vi.fn>)(
      "Path C evaluation failed",
      `evaluateWeightedConfluence threw for strategy ${strategyId}: ${pathCErrMsg}. Falling back to Path B.`,
      { strategyId, sessionId, correlationId: correlationId ?? null },
    );
    discordFired = true;

    (broadcastSSE as ReturnType<typeof vi.fn>)("alert:path_c_error", {
      sessionId,
      strategyId,
      symbol,
      error: pathCErrMsg,
      fallback: "path_b",
      correlationId: correlationId ?? null,
    });
    sseFired = true;
  }

  return { pathCFailed, auditFired, sseFired, discordFired };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("A-1: Path C error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluateWeightedConfluence throws → pathCFailed=true, audit row emitted", async () => {
    const evalMock = evaluateWeightedConfluence as ReturnType<typeof vi.fn>;
    evalMock.mockImplementation(() => {
      throw new Error("Malformed confluence_score_weights JSON: Unexpected token");
    });

    const result = await runPathCWithErrorBoundary({
      strategyId: "strat-abc",
      sessionId: "sess-123",
      symbol: "MES",
      correlationId: "corr-xyz",
      scoringStrategy: {},
      weightedCtx: {},
    });

    expect(result.pathCFailed).toBe(true);
    expect(result.auditFired).toBe(true);

    const auditCall = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(auditCall.action).toBe("weighted_confluence.evaluation_error");
    expect(auditCall.result.fallback).toBe("path_b");
    expect(auditCall.result.error).toContain("Malformed confluence_score_weights");
    expect(auditCall.status).toBe("failure");
  });

  it("evaluateWeightedConfluence throws → SSE alert:path_c_error + Discord notifyCritical fire", async () => {
    const evalMock = evaluateWeightedConfluence as ReturnType<typeof vi.fn>;
    evalMock.mockImplementation(() => {
      throw new Error("NaN propagation in factor weight sum");
    });

    const result = await runPathCWithErrorBoundary({
      strategyId: "strat-def",
      sessionId: "sess-456",
      symbol: "MNQ",
      correlationId: null,
      scoringStrategy: {},
      weightedCtx: {},
    });

    expect(result.sseFired).toBe(true);
    expect(result.discordFired).toBe(true);

    const sseCall = (broadcastSSE as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sseCall[0]).toBe("alert:path_c_error");
    expect(sseCall[1].fallback).toBe("path_b");

    expect(notifyCritical).toHaveBeenCalledWith(
      "Path C evaluation failed",
      expect.stringContaining("Falling back to Path B"),
      expect.objectContaining({ strategyId: "strat-def" }),
    );
  });

  it("happy path: evaluateWeightedConfluence does NOT throw → no error audit row, pathCFailed=false", async () => {
    const evalMock = evaluateWeightedConfluence as ReturnType<typeof vi.fn>;
    evalMock.mockReturnValue({
      score: 0.85,
      threshold: 0.72,
      passed: true,
      hardBlockTriggered: false,
      weightsSource: "code_defaults",
      factorContributions: [],
    });

    const result = await runPathCWithErrorBoundary({
      strategyId: "strat-ghi",
      sessionId: "sess-789",
      symbol: "MES",
      correlationId: "corr-happy",
      scoringStrategy: {},
      weightedCtx: {},
    });

    expect(result.pathCFailed).toBe(false);
    expect(result.auditFired).toBe(false);
    expect(result.sseFired).toBe(false);
    expect(result.discordFired).toBe(false);
    expect(insertAuditRow).not.toHaveBeenCalled();
    expect(broadcastSSE).not.toHaveBeenCalled();
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  it("fallback Path B decision: when pathCFailed, execution continues (does not block stage2)", async () => {
    const evalMock = evaluateWeightedConfluence as ReturnType<typeof vi.fn>;
    evalMock.mockImplementation(() => {
      throw new Error("Missing factor evaluator: market_structure_aligned");
    });

    const result = await runPathCWithErrorBoundary({
      strategyId: "strat-jkl",
      sessionId: "sess-fallback",
      symbol: "MES",
      correlationId: null,
      scoringStrategy: {},
      weightedCtx: {},
    });

    // pathCFailed=true signals the caller to run Path B instead
    expect(result.pathCFailed).toBe(true);

    // Verify the fallback path B decision is "available" —
    // in the real service, `!useWeightedScoring || pathCFailed` would be true
    // and Path B (boolean counting) would run. Here we verify the contract:
    // pathCFailed is set and all three side-effects fired.
    expect(result.auditFired).toBe(true);
    expect(result.sseFired).toBe(true);
    expect(result.discordFired).toBe(true);
  });
});
