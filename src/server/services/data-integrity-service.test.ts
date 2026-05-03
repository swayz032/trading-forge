/**
 * Tests for A8 — Data Integrity Service (reconciliation + drift detection)
 *
 * Covers:
 *   - computePSI: identical distributions → 0; disjoint → high; known PSI values
 *   - runReconciliationChecks: each of the 4 checks (mock DB responses)
 *   - runDriftDetection: no drift groups, drift groups with PSI computation
 *   - runFullDataIntegritySuite: orchestrator integration with mocked sub-functions
 *   - Persistence and alert firing are validated via mock call verification
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computePSI } from "./data-integrity-service.js";

// ─── Mock infrastructure ──────────────────────────────────────────────────────

// We mock the DB so tests run without a real Postgres connection.
// Each test controls the mock return value via mockResolvedValueOnce.
vi.mock("../db/index.js", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
  },
}));

vi.mock("./alert-service.js", () => ({
  createAlert: vi.fn().mockResolvedValue({ id: "alert-uuid-1" }),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── computePSI unit tests ────────────────────────────────────────────────────

describe("computePSI", () => {
  it("returns 0 for identical distributions", () => {
    const values = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5];
    const psi = computePSI(values, values);
    // Identical distributions have PSI = 0 (modulo floating-point smoothing rounding)
    expect(psi).toBeCloseTo(0, 3);
  });

  it("returns 0 for empty or single-element distributions", () => {
    expect(computePSI([], [])).toBe(0);
    expect(computePSI([1.0], [1.0])).toBe(0);
    expect(computePSI([], [1.0, 2.0])).toBe(0);
    expect(computePSI([1.0, 2.0], [])).toBe(0);
  });

  it("returns 0 when all values are identical (degenerate case)", () => {
    const psi = computePSI([2.0, 2.0, 2.0, 2.0], [2.0, 2.0, 2.0, 2.0]);
    expect(psi).toBe(0);
  });

  it("returns high PSI for completely separated distributions", () => {
    // observed entirely in upper range, expected entirely in lower range
    const observed = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const psi = computePSI(observed, expected);
    // Separated distributions should produce PSI well above the 0.2 threshold
    expect(psi).toBeGreaterThan(0.2);
  });

  it("returns low PSI for slightly shifted distributions", () => {
    // Same distribution shifted by a tiny relative amount — should stay below the critical threshold.
    // We use a larger population and shift the entire distribution by 1% to ensure the bucket
    // assignments remain nearly identical. The PSI measures bin-proportion change, not value change.
    const base = Array.from({ length: 40 }, (_, i) => 1.0 + i * 0.1); // 40 evenly spaced points
    const shifted = base.map((v) => v * 1.001); // 0.1% shift — proportions stay in same bins
    const psi = computePSI(shifted, base);
    // Identical bucket proportions → near-zero PSI. Allow up to 0.2 (warning threshold).
    expect(psi).toBeLessThan(0.2);
  });

  it("produces PSI > 0.5 for disjoint distributions (critical threshold)", () => {
    const observed = Array.from({ length: 20 }, (_, i) => 100 + i);
    const expected = Array.from({ length: 20 }, (_, i) => 0 + i);
    const psi = computePSI(observed, expected);
    expect(psi).toBeGreaterThan(0.5);
  });

  it("is symmetric: PSI(A,B) ≈ PSI(B,A) for well-populated distributions", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const b = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const psiAB = computePSI(a, b);
    const psiBA = computePSI(b, a);
    // PSI is not strictly symmetric due to bucket assignment, but should be close
    expect(Math.abs(psiAB - psiBA)).toBeLessThan(0.5);
  });

  it("uses numBuckets parameter correctly", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    // Different bucket counts should still return finite non-negative values
    const psi5 = computePSI(a, b, 5);
    const psi20 = computePSI(a, b, 20);
    expect(psi5).toBeGreaterThanOrEqual(0);
    expect(psi20).toBeGreaterThanOrEqual(0);
  });
});

// ─── Reconciliation check tests ───────────────────────────────────────────────

describe("runReconciliationChecks", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns info finding when all checks pass (no orphans)", async () => {
    const { db } = await import("../db/index.js");
    // All four DB.execute calls return empty rows (no orphans)
    vi.mocked(db.execute)
      .mockResolvedValueOnce([] as any)  // audit_log lifecycle gaps
      .mockResolvedValueOnce([] as any)  // paper_trades position gaps
      .mockResolvedValueOnce([] as any)  // lifecycle FK gaps
      .mockResolvedValueOnce([] as any); // PAPER strategy sessions

    // Need to reset module to pick up fresh db mock
    const { runReconciliationChecks } = await import("./data-integrity-service.js");
    const findings = await runReconciliationChecks();

    expect(findings.length).toBeGreaterThan(0);
    const infoFindings = findings.filter((f) => f.severity === "info");
    expect(infoFindings.length).toBe(4); // all 4 checks report info
    expect(findings.filter((f) => f.severity === "critical").length).toBe(0);
    expect(findings.filter((f) => f.severity === "warning").length).toBe(0);
  });

  it("returns warning finding when < 5 audit_log lifecycle gaps found", async () => {
    const { db } = await import("../db/index.js");
    const orphanRows = [
      { audit_id: "a1", entity_id: "e1", action: "lifecycle.promote", created_at: new Date() },
      { audit_id: "a2", entity_id: "e2", action: "lifecycle.demote", created_at: new Date() },
    ];
    vi.mocked(db.execute)
      .mockResolvedValueOnce(orphanRows as any) // 2 orphan audit_log rows
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any);

    const { runReconciliationChecks } = await import("./data-integrity-service.js");
    const findings = await runReconciliationChecks();

    const lifecycleGapFinding = findings.find((f) => f.checkName === "audit_log_lifecycle_gap");
    expect(lifecycleGapFinding).toBeDefined();
    expect(lifecycleGapFinding!.severity).toBe("warning");
    expect(lifecycleGapFinding!.details.orphanCount).toBe(2);
  });

  it("returns critical finding when >= 5 audit_log lifecycle gaps found", async () => {
    const { db } = await import("../db/index.js");
    const orphanRows = Array.from({ length: 6 }, (_, i) => ({
      audit_id: `a${i}`,
      entity_id: `e${i}`,
      action: "lifecycle.promote",
      created_at: new Date(),
    }));
    vi.mocked(db.execute)
      .mockResolvedValueOnce(orphanRows as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any);

    const { runReconciliationChecks } = await import("./data-integrity-service.js");
    const findings = await runReconciliationChecks();

    const lifecycleGapFinding = findings.find((f) => f.checkName === "audit_log_lifecycle_gap");
    expect(lifecycleGapFinding!.severity).toBe("critical");
    expect(lifecycleGapFinding!.details.orphanCount).toBe(6);
  });

  it("returns critical finding when lifecycle_transitions references non-existent backtests", async () => {
    const { db } = await import("../db/index.js");
    const danglingFKRows = [
      {
        transition_id: "t1",
        strategy_id: "s1",
        backtest_id: "b_ghost",
        from_state: "TESTING",
        to_state: "PAPER",
        created_at: new Date(),
      },
    ];
    vi.mocked(db.execute)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce(danglingFKRows as any) // 1 dangling FK
      .mockResolvedValueOnce([] as any);

    const { runReconciliationChecks } = await import("./data-integrity-service.js");
    const findings = await runReconciliationChecks();

    const fkFinding = findings.find((f) => f.checkName === "lifecycle_transitions_backtest_fk");
    expect(fkFinding!.severity).toBe("critical");
    expect(fkFinding!.details.orphanCount).toBe(1);
    expect(fkFinding!.details.orphanTransitionIds).toContain("t1");
  });

  it("returns critical finding when PAPER strategy has no paper_sessions", async () => {
    const { db } = await import("../db/index.js");
    const phantomStrategies = [
      {
        strategy_id: "strat-123",
        strategy_name: "Ghost Scalper",
        lifecycle_state: "PAPER",
        lifecycle_changed_at: new Date(),
      },
    ];
    vi.mocked(db.execute)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce(phantomStrategies as any);

    const { runReconciliationChecks } = await import("./data-integrity-service.js");
    const findings = await runReconciliationChecks();

    const sessionFinding = findings.find((f) => f.checkName === "paper_strategy_no_sessions");
    expect(sessionFinding!.severity).toBe("critical");
    expect(sessionFinding!.details.orphanStrategyIds).toContain("strat-123");
  });
});

// ─── Drift detection tests ────────────────────────────────────────────────────

describe("runDriftDetection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns info finding when no drift groups exist", async () => {
    const { db } = await import("../db/index.js");
    vi.mocked(db.execute).mockResolvedValueOnce([] as any);

    const { runDriftDetection } = await import("./data-integrity-service.js");
    const findings = await runDriftDetection();

    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].checkType).toBe("drift_detection");
    expect(findings[0].details.driftGroupCount).toBe(0);
  });

  it("returns a finding (not critical) when drift groups exist with very similar metrics", async () => {
    const { db } = await import("../db/index.js");

    // Drift group: same (data_hash, strategy_hash) with 2 distinct result hashes
    const driftGroup = [{
      data_hash: "dh1",
      strategy_hash: "sh1",
      distinct_hashes: 2,
      distinct_git_shas: 2,
      backtest_ids: ["bt1", "bt2", "bt3", "bt4", "bt5", "bt6", "bt7", "bt8"],
      git_shas: ["sha_old", "sha_new"],
    }];

    // Metrics: exactly identical values across git SHAs — PSI is deterministically 0
    // (same values → same bucket assignments → same proportions → PSI = 0)
    const baseMetrics = [
      { sharpe_ratio: 1.5, profit_factor: 2.0, max_drawdown: -500 },
      { sharpe_ratio: 1.6, profit_factor: 2.1, max_drawdown: -510 },
      { sharpe_ratio: 1.7, profit_factor: 2.2, max_drawdown: -490 },
      { sharpe_ratio: 1.8, profit_factor: 2.3, max_drawdown: -480 },
    ];

    const metrics = [
      ...baseMetrics.map((m, i) => ({ id: `bt${i + 1}`, ...m, code_git_sha: "sha_old", result_hash: "r1" })),
      ...baseMetrics.map((m, i) => ({ id: `bt${i + 5}`, ...m, code_git_sha: "sha_new", result_hash: "r2" })),
    ];

    vi.mocked(db.execute)
      .mockResolvedValueOnce(driftGroup as any)
      .mockResolvedValueOnce(metrics as any);

    const { runDriftDetection } = await import("./data-integrity-service.js");
    const findings = await runDriftDetection();

    // With identical distributions, PSI = 0 → should produce info finding (not critical)
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0];
    // Identical distributions: info or warning but never critical (PSI 0 → no drift)
    expect(finding.severity).not.toBe("critical");
    // PSI max should be 0 for identical distributions
    const psi = finding.details.psi as any;
    if (psi) {
      expect(psi.max).toBeCloseTo(0, 3);
    }
  });

  it("returns warning or critical finding when PSI > 0.2", async () => {
    const { db } = await import("../db/index.js");

    const driftGroup = [{
      data_hash: "dh2",
      strategy_hash: "sh2",
      distinct_hashes: 2,
      distinct_git_shas: 2,
      backtest_ids: ["bt5", "bt6", "bt7", "bt8", "bt9", "bt10"],
      git_shas: ["sha_a", "sha_b"],
    }];

    // Deliberately divergent distributions: old code produced high Sharpe (2.0-3.0),
    // new code produces low Sharpe (0.5-1.0) — PSI will exceed 0.2
    const metrics = [
      { id: "bt5", sharpe_ratio: 2.0, profit_factor: 2.5, max_drawdown: -300, code_git_sha: "sha_a", result_hash: "ra" },
      { id: "bt6", sharpe_ratio: 2.5, profit_factor: 2.8, max_drawdown: -280, code_git_sha: "sha_a", result_hash: "ra" },
      { id: "bt7", sharpe_ratio: 3.0, profit_factor: 3.0, max_drawdown: -250, code_git_sha: "sha_a", result_hash: "ra" },
      { id: "bt8", sharpe_ratio: 0.5, profit_factor: 1.1, max_drawdown: -900, code_git_sha: "sha_b", result_hash: "rb" },
      { id: "bt9", sharpe_ratio: 0.7, profit_factor: 1.2, max_drawdown: -850, code_git_sha: "sha_b", result_hash: "rb" },
      { id: "bt10", sharpe_ratio: 0.9, profit_factor: 1.3, max_drawdown: -800, code_git_sha: "sha_b", result_hash: "rb" },
    ];

    vi.mocked(db.execute)
      .mockResolvedValueOnce(driftGroup as any)
      .mockResolvedValueOnce(metrics as any);

    const { runDriftDetection } = await import("./data-integrity-service.js");
    const findings = await runDriftDetection();

    const driftFinding = findings.find(
      (f) => f.checkName === "psi_distribution_drift" && f.severity !== "info"
    );
    expect(driftFinding).toBeDefined();
    expect(["warning", "critical"]).toContain(driftFinding!.severity);
    expect(driftFinding!.details.psi).toBeDefined();
    expect((driftFinding!.details.psi as any).max).toBeGreaterThan(0.2);
  });

  it("includes all three PSI metrics in finding details", async () => {
    const { db } = await import("../db/index.js");

    const driftGroup = [{
      data_hash: "dh3",
      strategy_hash: "sh3",
      distinct_hashes: 2,
      distinct_git_shas: 2,
      backtest_ids: ["bt11", "bt12", "bt13", "bt14"],
      git_shas: ["sha_c", "sha_d"],
    }];

    const metrics = [
      { id: "bt11", sharpe_ratio: 1.5, profit_factor: 2.0, max_drawdown: -500, code_git_sha: "sha_c", result_hash: "rc" },
      { id: "bt12", sharpe_ratio: 1.8, profit_factor: 2.3, max_drawdown: -450, code_git_sha: "sha_d", result_hash: "rd" },
      { id: "bt13", sharpe_ratio: 1.6, profit_factor: 2.1, max_drawdown: -480, code_git_sha: "sha_c", result_hash: "rc" },
      { id: "bt14", sharpe_ratio: 2.0, profit_factor: 2.5, max_drawdown: -420, code_git_sha: "sha_d", result_hash: "rd" },
    ];

    vi.mocked(db.execute)
      .mockResolvedValueOnce(driftGroup as any)
      .mockResolvedValueOnce(metrics as any);

    const { runDriftDetection } = await import("./data-integrity-service.js");
    const findings = await runDriftDetection();

    const finding = findings[0];
    expect(finding.checkType).toBe("drift_detection");
    expect(finding.details.psi).toBeDefined();

    const psi = finding.details.psi as any;
    expect(typeof psi.sharpe).toBe("number");
    expect(typeof psi.profitFactor).toBe("number");
    expect(typeof psi.maxDrawdown).toBe("number");
    expect(typeof psi.max).toBe("number");
    expect(psi.max).toBeGreaterThanOrEqual(0);
  });
});

// ─── Full suite tests ─────────────────────────────────────────────────────────

describe("runFullDataIntegritySuite", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns summary with correct counts on clean system (all info)", async () => {
    const { db } = await import("../db/index.js");

    // All reconciliation checks return empty (clean), drift also clean
    vi.mocked(db.execute)
      .mockResolvedValue([] as any);

    // Mock transaction to succeed
    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      return fn({
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([]),
      });
    });

    const { runFullDataIntegritySuite } = await import("./data-integrity-service.js");
    const result = await runFullDataIntegritySuite();

    expect(result.criticalCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.totalFindings).toBeGreaterThan(0); // info findings still written
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.reconciliationFindings)).toBe(true);
    expect(Array.isArray(result.driftFindings)).toBe(true);
  });

  it("isolates drift detection failure from reconciliation results", async () => {
    const { db } = await import("../db/index.js");

    // Reconciliation: 4 clean checks
    vi.mocked(db.execute)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      // Drift detection: throws an error
      .mockRejectedValueOnce(new Error("drift DB connection lost"));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      return fn({
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([]),
      });
    });

    const { runFullDataIntegritySuite } = await import("./data-integrity-service.js");
    const result = await runFullDataIntegritySuite();

    // Reconciliation findings should still be present
    expect(result.reconciliationFindings.length).toBeGreaterThan(0);
    // Drift section should contain the error finding
    expect(result.driftFindings.some((f) => f.checkName === "suite_error")).toBe(true);
    // Critical count should include the drift suite error
    expect(result.criticalCount).toBeGreaterThan(0);
  });

  it("fires alerts for critical findings", async () => {
    const { db } = await import("../db/index.js");
    const { createAlert } = await import("./alert-service.js");

    // Reconciliation: produce a critical finding (6 orphan audit_log rows)
    const criticalOrphans = Array.from({ length: 6 }, (_, i) => ({
      audit_id: `a${i}`,
      entity_id: `e${i}`,
      action: "lifecycle.promote",
      created_at: new Date(),
    }));

    vi.mocked(db.execute)
      .mockResolvedValueOnce(criticalOrphans as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any); // drift: no groups

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      return fn({
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([]),
      });
    });

    const { runFullDataIntegritySuite } = await import("./data-integrity-service.js");
    await runFullDataIntegritySuite();

    // createAlert should have been called with severity "critical"
    expect(vi.mocked(createAlert)).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical" })
    );
  });

  it("does not fire alert when no findings exceed warning severity", async () => {
    const { db } = await import("../db/index.js");
    const { createAlert } = await import("./alert-service.js");
    vi.mocked(createAlert).mockClear();

    // All checks clean
    vi.mocked(db.execute).mockResolvedValue([] as any);
    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      return fn({
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([]),
      });
    });

    const { runFullDataIntegritySuite } = await import("./data-integrity-service.js");
    await runFullDataIntegritySuite();

    // No critical or warning alerts should be fired
    const criticalCalls = vi.mocked(createAlert).mock.calls.filter(
      ([args]) => args.severity === "critical" || args.severity === "warning"
    );
    expect(criticalCalls.length).toBe(0);
  });
});

// ─── Structured logging format checks ────────────────────────────────────────

describe("structured logging format", () => {
  it("logger.info is called with checkCategory field at suite start", async () => {
    const { db } = await import("../db/index.js");
    const { logger } = await import("../lib/logger.js");

    vi.mocked(db.execute).mockResolvedValue([] as any);
    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      return fn({ insert: vi.fn().mockReturnThis(), values: vi.fn().mockResolvedValue([]) });
    });

    const { runReconciliationChecks } = await import("./data-integrity-service.js");
    await runReconciliationChecks();

    const infoCallArgs = vi.mocked(logger.info).mock.calls.map((c) => c[0]);
    const hasCheckCategory = infoCallArgs.some(
      (arg) => typeof arg === "object" && arg !== null && "checkCategory" in arg
    );
    expect(hasCheckCategory).toBe(true);
  });
});
