/**
 * A+ Market Auditor — Governance, Isolation, and Slumdawg-Safety Tests
 *
 * TDD: these tests were written BEFORE the fixes to confirm failures,
 * then the fixes make them pass.
 *
 * Test categories:
 *   1. Slumdawg-safety invariant: paper-signal-service.ts has NO A+/observation_mode hard gate
 *   2. Honesty (F-2): service docstring must not claim shouldSkip() exists / gates live path
 *   3. Advisory surfacing: runAuditScan broadcasts SSE + returns advisory metadata
 *   4. Enrichment persists real scan when enabled
 *   5. getAdvisoryContext returns advisory metadata (dashboard/observability only)
 *   6. Challenger isolation: no import of a-plus-auditor-service in paper-signal-service
 *   7. Schema stability: AuditorScanResult shape preserved
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Source-code assertion helpers ────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../..");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

// ─── 1. Slumdawg-safety invariant ────────────────────────────────────────────

describe("Slumdawg-safety invariant: A+ auditor does NOT gate live signals", () => {
  it("paper-signal-service.ts does not import from a-plus-auditor-service", () => {
    const source = readSrc("src/server/services/paper-signal-service.ts");
    // Must not import the auditor service at all
    expect(source).not.toContain("a-plus-auditor-service");
    expect(source).not.toContain("a_plus_auditor_service");
  });

  it("paper-signal-service.ts does not call getLatestScan (A+ auditor reader)", () => {
    const source = readSrc("src/server/services/paper-signal-service.ts");
    expect(source).not.toContain("getLatestScan");
  });

  it("paper-signal-service.ts does not gate on observation_mode from the A+ auditor", () => {
    const source = readSrc("src/server/services/paper-signal-service.ts");
    // The string 'observation_mode' could appear in comments; check for gating patterns
    // We look for any block/reject/return pattern combined with observation_mode from the auditor
    // The safe check: paper-signal-service must not import aPlusMarketScans or runAuditScan
    expect(source).not.toContain("runAuditScan");
    expect(source).not.toContain("aPlusMarketScans");
    expect(source).not.toContain("a-plus-auditor");
  });

  it("a-plus-auditor-service.ts does not have an import statement referencing paper-signal-service", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    // Check only import statements (lines that start with 'import')
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line));
    const hasPaperSignalImport = importLines.some((line) =>
      line.includes("paper-signal-service"),
    );
    expect(hasPaperSignalImport).toBe(false);
  });

  it("a-plus-auditor-service.ts does not call routeOrder or any order-routing function", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    expect(source).not.toContain("routeOrder");
    expect(source).not.toContain("TradersPost");
    expect(source).not.toContain("tradersPost");
  });
});

// ─── 2. Honesty (F-2): service header no longer claims shouldSkip gates live path ────────

describe("F-2 honesty: service header is accurate — no false gating claim", () => {
  it("a-plus-auditor-service.ts does not claim 'shouldSkip' gates strategies", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    // The old dangerous lie: "Strategies that call shouldSkip() will see the OBSERVATION_MODE signal"
    // After fix: this claim is removed and replaced with ADVISORY-ONLY wording
    expect(source).not.toContain("Strategies that call shouldSkip()");
  });

  it("a-plus-auditor-service.ts header explicitly states ADVISORY-ONLY", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    // Must contain explicit advisory-only governance statement in the header
    expect(source).toContain("ADVISORY-ONLY");
  });

  it("a-plus-auditor-service.ts header states it does NOT gate the live signal path", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    // The header must make clear the auditor is not consulted by the live signal path
    expect(source).toMatch(/NOT.*gate|not.*consult.*live|live.*signal.*path.*not|advisory.*not.*gate/i);
  });
});

// ─── 3. getAdvisoryContext export exists and is advisory-labelled ─────────────

describe("getAdvisoryContext: advisory-only reader for dashboard/observability", () => {
  it("a-plus-auditor-service.ts exports getAdvisoryContext function", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    expect(source).toContain("getAdvisoryContext");
    expect(source).toContain("export");
  });

  it("getAdvisoryContext has a comment marking it advisory-only with no gate callers", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    // Find the getAdvisoryContext function and verify it has advisory comment
    const idx = source.indexOf("getAdvisoryContext");
    expect(idx).toBeGreaterThan(-1);
    // The surrounding text (200 chars before) must mention advisory
    const context = source.slice(Math.max(0, idx - 500), idx + 200);
    expect(context.toLowerCase()).toMatch(/advisory|observ/);
  });
});

// ─── 4. SSE broadcast fires on scan complete ─────────────────────────────────

const mocks = vi.hoisted(() => ({
  dbExecuteMock: vi.fn(),
  runPythonModuleMock: vi.fn(),
  withCostTrackingMock: vi.fn().mockImplementation((_opts: unknown, fn: () => unknown) => fn()),
  broadcastSSEMock: vi.fn(),
  dbInsertMock: vi.fn(),
  dbUpdateMock: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    execute: (...args: unknown[]) => mocks.dbExecuteMock(...args),
    insert: (...args: unknown[]) => mocks.dbInsertMock(...args),
    update: (...args: unknown[]) => mocks.dbUpdateMock(...args),
  },
}));

vi.mock("../db/schema.js", () => ({
  aPlusMarketScans: {
    scanDate: "scan_date",
    id: "id",
    status: "status",
    $inferSelect: {},
  },
  skipDecisions: { strategyId: "strategy_id", createdAt: "created_at", signals: "signals" },
  strategies: { id: "id", symbol: "symbol" },
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: mocks.runPythonModuleMock,
}));

vi.mock("../lib/quantum-cost-tracker.js", () => ({
  withCostTracking: mocks.withCostTrackingMock,
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: mocks.broadcastSSEMock,
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function setupDbMocks(id = "scan-row-001") {
  mocks.dbInsertMock.mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id }]),
      }),
    }),
  });
  mocks.dbUpdateMock.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

const MOCK_PYTHON_RESULT = {
  winner_market: "MES",
  observation_mode: false,
  edge_scores: {
    MES: {
      vol: 0.80,
      p_target: 0.82,
      noise: null,
      entangle: 0.65,
      composite: 0.77,
      passes_p_target_gate: true,
      passes_noise_gate: true,
    },
    MNQ: {
      vol: 0.60,
      p_target: 0.65,
      noise: null,
      entangle: 0.65,
      composite: 0.61,
      passes_p_target_gate: false,
      passes_noise_gate: true,
    },
  },
  lead_market: null,
  lag_window_minutes: null,
  entanglement_strength: 0.65,
  governance: { authoritative: false, decision_role: "challenger_only", experimental: true },
  scan_duration_ms: 45,
  hardware: "default.qubit",
  seed: 42,
};

describe("runAuditScan: advisory surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
    mocks.runPythonModuleMock.mockResolvedValue(MOCK_PYTHON_RESULT);
    // Enrichment: no skip_decisions for these markets
    mocks.dbExecuteMock.mockResolvedValue([]);
  });

  it("broadcasts SSE 'a-plus-auditor:scan-complete' on successful scan", async () => {
    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";
    try {
      const { runAuditScan } = await import("../services/a-plus-auditor-service.js");
      await runAuditScan({
        marketInputs: {
          MES: { atr_5m: 2.5, atr_8yr_avg: 2.5, vix: 18.0, gap_atr: 0.2, spread: 0.05, p_target_hit: 0.82 },
          MNQ: { atr_5m: 4.0, atr_8yr_avg: 4.0, vix: 18.0, gap_atr: 0.3, spread: 0.04, p_target_hit: 0.65 },
        },
        seed: 42,
      });
      expect(mocks.broadcastSSEMock).toHaveBeenCalledOnce();
      const [eventName, payload] = mocks.broadcastSSEMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(eventName).toBe("a-plus-auditor:scan-complete");
      expect(payload).toHaveProperty("winnerMarket");
      expect(payload).toHaveProperty("observationMode");
      expect(payload).toHaveProperty("scanDate");
    } finally {
      delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    }
  });

  it("SSE payload contains winnerMarket from Python result", async () => {
    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";
    try {
      const { runAuditScan } = await import("../services/a-plus-auditor-service.js");
      await runAuditScan({
        marketInputs: {
          MES: { atr_5m: 2.5, atr_8yr_avg: 2.5, vix: 18.0, gap_atr: 0.2, spread: 0.05, p_target_hit: 0.82 },
        },
        seed: 42,
      });
      const [, payload] = mocks.broadcastSSEMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.winnerMarket).toBe("MES");
      expect(payload.observationMode).toBe(false);
    } finally {
      delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    }
  });

  it("returns advisory result with governance.authoritative=false", async () => {
    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";
    try {
      const { runAuditScan } = await import("../services/a-plus-auditor-service.js");
      const result = await runAuditScan({
        marketInputs: {
          MES: { atr_5m: 2.5, atr_8yr_avg: 2.5, vix: 18.0, gap_atr: 0.2, spread: 0.05, p_target_hit: 0.82 },
        },
        seed: 42,
      });
      expect(result.governance?.authoritative).toBe(false);
    } finally {
      delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    }
  });

  it("skipped result has skipped=true and SSE is NOT broadcast", async () => {
    delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    vi.resetModules();
    const { runAuditScan } = await import("../services/a-plus-auditor-service.js");
    const result = await runAuditScan({
      marketInputs: {
        MES: { atr_5m: 2.5, atr_8yr_avg: 2.5, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
      },
    });
    expect(result.skipped).toBe(true);
    expect(mocks.broadcastSSEMock).not.toHaveBeenCalled();
  });
});

// ─── 5. enrichWithRealAtr: per-market ATR from pre_market_sessions ────────────

describe("enrichWithRealAtr: real pre_market_sessions ATR enrichment", () => {
  it("a-plus-auditor-service.ts exports enrichWithRealAtr", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    expect(source).toContain("enrichWithRealAtr");
    expect(source).toContain("export");
  });

  it("enrichWithRealAtr produces different atr_5m values for different markets", async () => {
    vi.resetModules();
    // Mock: MES has vixProxyAtrPercentile=30 (calm), MNQ has 70 (elevated)
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ overnight_range_points: "4.5", vix_proxy_atr_percentile: "30" }]) // MES
      .mockResolvedValueOnce([{ overnight_range_points: "8.0", vix_proxy_atr_percentile: "70" }]) // MNQ
      .mockResolvedValueOnce([{ overnight_range_points: "0.35", vix_proxy_atr_percentile: "45" }]); // MCL

    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";
    try {
      const { enrichWithRealAtr } = await import("../services/a-plus-auditor-service.js");
      const marketInputs = {
        MES: { atr_5m: 2.5, atr_8yr_avg: 2.5, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
        MNQ: { atr_5m: 4.0, atr_8yr_avg: 4.0, vix: 18.0, gap_atr: 0.3, spread: 0.04 },
        MCL: { atr_5m: 0.3, atr_8yr_avg: 0.3, vix: 18.0, gap_atr: 0.1, spread: 0.10 },
      };
      const enriched = await enrichWithRealAtr(marketInputs);
      // MES and MNQ should have different atr_5m values (driven by overnight_range_points)
      expect(enriched.MES.atr_5m).not.toBeCloseTo(enriched.MNQ.atr_5m as number, 3);
    } finally {
      delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    }
  });

  it("enrichWithRealAtr falls back gracefully when DB returns empty — atr_5m unchanged, atr_8yr_avg uses per-symbol baseline", async () => {
    vi.resetModules();
    mocks.dbExecuteMock.mockResolvedValue([]);
    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";
    try {
      const { enrichWithRealAtr } = await import("../services/a-plus-auditor-service.js");
      const marketInputs = {
        MES: { atr_5m: 2.5, atr_8yr_avg: 2.5, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
      };
      const enriched = await enrichWithRealAtr(marketInputs);
      // On fallback: atr_5m is preserved (no overnight_range_points available)
      expect(enriched.MES.atr_5m).toBe(2.5);
      // atr_8yr_avg is updated to per-symbol historical baseline (F-4 fix — not the same flat constant)
      expect(typeof enriched.MES.atr_8yr_avg).toBe("number");
      expect(enriched.MES.atr_8yr_avg).toBeGreaterThan(0);
      // Non-ATR fields are unchanged
      expect(enriched.MES.vix).toBe(18.0);
      expect(enriched.MES.gap_atr).toBe(0.2);
      expect(enriched.MES.spread).toBe(0.05);
    } finally {
      delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    }
  });
});

// ─── 6. estimatePTargetHit: per-market classical estimate ────────────────────

describe("estimatePTargetHit: data-driven, not flat 0.5", () => {
  it("a-plus-auditor-service.ts exports estimatePTargetHit", () => {
    const source = readSrc("src/server/services/a-plus-auditor-service.ts");
    expect(source).toContain("estimatePTargetHit");
    expect(source).toContain("export");
  });

  it("calm market (low ATR percentile, cross-asset aligned) gets higher p_target_hit than volatile", async () => {
    vi.resetModules();
    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";
    try {
      const { estimatePTargetHit } = await import("../services/a-plus-auditor-service.js");
      const calmEstimate = estimatePTargetHit({
        atrPercentile: 20,        // below median — calm
        crossAssetAligned: true,   // DXY/10Y agrees with bias
        overnightRangePoints: 3.0, // small gap
        vix: 16,
      });
      const volatileEstimate = estimatePTargetHit({
        atrPercentile: 85,         // elevated volatility
        crossAssetAligned: false,  // diverging signals
        overnightRangePoints: 8.0, // large gap
        vix: 28,
      });
      expect(calmEstimate).toBeGreaterThan(volatileEstimate);
    } finally {
      delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    }
  });

  it("estimate returns a number in [0, 1]", async () => {
    vi.resetModules();
    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";
    try {
      const { estimatePTargetHit } = await import("../services/a-plus-auditor-service.js");
      for (const atrPct of [0, 25, 50, 75, 100]) {
        const est = estimatePTargetHit({
          atrPercentile: atrPct,
          crossAssetAligned: true,
          overnightRangePoints: 4.0,
          vix: 18,
        });
        expect(est).toBeGreaterThanOrEqual(0);
        expect(est).toBeLessThanOrEqual(1);
      }
    } finally {
      delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    }
  });
});

// ─── 7. Schema stability ──────────────────────────────────────────────────────

describe("AuditorScanResult schema stability", () => {
  it("runAuditScan returns the expected shape on success", async () => {
    vi.resetModules();
    setupDbMocks("row-schema-test");
    mocks.runPythonModuleMock.mockResolvedValue(MOCK_PYTHON_RESULT);
    mocks.dbExecuteMock.mockResolvedValue([]);
    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";
    try {
      const { runAuditScan } = await import("../services/a-plus-auditor-service.js");
      const result = await runAuditScan({
        marketInputs: {
          MES: { atr_5m: 2.5, atr_8yr_avg: 2.5, vix: 18.0, gap_atr: 0.2, spread: 0.05, p_target_hit: 0.82 },
        },
        seed: 42,
      });
      // All required shape fields must be present
      expect(result).toHaveProperty("scanRowId");
      expect(result).toHaveProperty("winnerMarket");
      expect(result).toHaveProperty("observationMode");
      expect(result).toHaveProperty("edgeScores");
      expect(result).toHaveProperty("leadMarket");
      expect(result).toHaveProperty("lagWindowMinutes");
      expect(result).toHaveProperty("entanglementStrength");
      expect(result).toHaveProperty("governance");
      expect(result).toHaveProperty("scanDurationMs");
      expect(result).toHaveProperty("hardware");
      expect(result).toHaveProperty("seed");
    } finally {
      delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;
    }
  });
});
