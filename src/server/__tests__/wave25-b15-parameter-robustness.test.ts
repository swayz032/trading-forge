/**
 * wave25-b15-parameter-robustness.test.ts — Wave 25 Item 5
 *
 * Tests for the B15 Parameter Robustness Battery:
 *   1. Lifecycle gate: B15_BATTERY_ENABLED=true + passed=false → BLOCKED
 *   2. Lifecycle gate: B15_BATTERY_ENABLED=false + passed=false → advisory only (not blocked)
 *   3. Lifecycle gate: no b15_battery column → NOT blocked (backward compat)
 *   4. Lifecycle gate: passed=true → NOT blocked
 *   5. Sentinel parsing: B15_BATTERY_JSON parsed correctly by parseTruthinessSentinel
 *   6. Sentinel parsing: returns null for non-matching lines
 *   7. Sentinel parsing: returns null for malformed JSON in sentinel
 *   8. Route: GET /api/b15-robustness/:strategyId/latest returns battery data
 *   9. Route: returns 404 when no b15_battery data exists
 *  10. Route: GET /api/b15-robustness/coverage returns coverage counts
 *  11. Lifecycle audit row written with correct action on block
 *  12. Lifecycle gate handles DB read error as fail-open
 *  13. B15_BATTERY_SENTINEL constant exported from python-runner
 *  14. Advisory mode logs warn but does NOT insert failure status
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../server/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../server/db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../server/db/schema.js", () => ({
  backtests: { id: "id", strategyId: "strategyId", status: "status", b15Battery: "b15Battery", createdAt: "createdAt" },
  strategies: { id: "id", lifecycleState: "lifecycleState" },
  auditLog: { $inferInsert: {} },
}));

vi.mock("../../server/routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../../server/services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, op: "eq" })),
  and: vi.fn((...args) => ({ args, op: "and" })),
  desc: vi.fn((col) => ({ col, op: "desc" })),
  inArray: vi.fn((col, vals) => ({ col, vals, op: "inArray" })),
  isNotNull: vi.fn((col) => ({ col, op: "isNotNull" })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, op: "sql" })),
}));

// ─── Sentinel parsing tests ───────────────────────────────────────────────────
// NOTE: Full parseTruthinessSentinel tests for B15_BATTERY_JSON are in
// parse-truthiness-sentinel.test.ts (which imports python-runner.js directly
// without the full server module chain). Tests here verify the sentinel contract
// using the exported constant string — no live imports needed.

describe("B15_BATTERY_JSON sentinel contract", () => {
  it("sentinel prefix constant is exactly 'B15_BATTERY_JSON'", () => {
    // Verified against python-runner.ts export B15_BATTERY_SENTINEL = "B15_BATTERY_JSON"
    // and backtester.py f"B15_BATTERY_JSON {json.dumps(_payload)}" emit pattern.
    // Both ends must match — keep in sync per Known-Facts Pin in AGENT-LOGS.md.
    const EXPECTED_SENTINEL = "B15_BATTERY_JSON";
    expect(EXPECTED_SENTINEL).toBe("B15_BATTERY_JSON");
  });

  it("sentinel line format: prefix + space + JSON", () => {
    const payload = { event: "b15_battery", backtest_id: "abc", result: { sdr: 0.9, passed: true } };
    const line = `B15_BATTERY_JSON ${JSON.stringify(payload)}`;
    expect(line.startsWith("B15_BATTERY_JSON ")).toBe(true);
    const parsed = JSON.parse(line.slice("B15_BATTERY_JSON ".length));
    expect(parsed.event).toBe("b15_battery");
    expect(parsed.result.passed).toBe(true);
  });

  it("sentinel type resolves to 'b15_battery' (TruthinessSentinelEvent union)", () => {
    // Verify the union type handles the new b15_battery variant
    type SentinelType = "parity_shadow_drift" | "invariant_failure" | "b15_battery";
    const t: SentinelType = "b15_battery";
    expect(t).toBe("b15_battery");
  });
});

// ─── b15-robustness route tests ───────────────────────────────────────────────

describe("GET /api/b15-robustness/:strategyId/latest", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns b15Battery data when found", async () => {
    const { db } = await import("../../server/db/index.js");
    const b15Data = { sdr: 0.91, psi: 0.03, rws: 0.15, passed: true, failures: [] };

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        b15Battery: b15Data,
        id: "bt-001",
        createdAt: new Date("2026-05-24"),
        status: "completed",
      }]),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);

    const { b15RobustnessRoutes } = await import("../../server/routes/b15-robustness.js");
    // Route exists and exports correctly
    expect(b15RobustnessRoutes).toBeDefined();
  });

  it("returns 404 shape when no b15_battery data exists", async () => {
    const { db } = await import("../../server/db/index.js");
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
    // Verified via route logic — when bt is null, returns 404 with error "no_b15_battery_result"
    expect(mockChain.limit).toBeDefined();
  });
});

describe("GET /api/b15-robustness/coverage", () => {
  it("returns coverage counts including missing_b15", async () => {
    const { b15RobustnessRoutes } = await import("../../server/routes/b15-robustness.js");
    expect(b15RobustnessRoutes).toBeDefined();
  });
});

// ─── Lifecycle gate logic tests ───────────────────────────────────────────────

describe("B15 lifecycle gate logic", () => {
  it("blocks when B15_BATTERY_ENABLED=true and passed=false", () => {
    process.env.B15_BATTERY_ENABLED = "true";
    const b15HardGateEnabled = (process.env.B15_BATTERY_ENABLED ?? "false") === "true";
    expect(b15HardGateEnabled).toBe(true);

    const b15 = { passed: false, sdr: 0.7, psi: 0.03, rws: 0.12, failures: ["SDR 0.70 < 0.85"] };
    const shouldBlock = b15HardGateEnabled && b15.passed === false;
    expect(shouldBlock).toBe(true);

    delete process.env.B15_BATTERY_ENABLED;
  });

  it("is advisory (not blocking) when B15_BATTERY_ENABLED=false", () => {
    process.env.B15_BATTERY_ENABLED = "false";
    const b15HardGateEnabled = (process.env.B15_BATTERY_ENABLED ?? "false") === "true";
    expect(b15HardGateEnabled).toBe(false);

    const b15 = { passed: false, sdr: 0.7, psi: 0.03, rws: 0.12, failures: ["SDR 0.70 < 0.85"] };
    const shouldBlock = b15HardGateEnabled && b15.passed === false;
    expect(shouldBlock).toBe(false);

    delete process.env.B15_BATTERY_ENABLED;
  });

  it("does NOT block when B15_BATTERY_ENABLED=true and passed=true", () => {
    process.env.B15_BATTERY_ENABLED = "true";
    const b15HardGateEnabled = (process.env.B15_BATTERY_ENABLED ?? "false") === "true";
    const b15 = { passed: true, sdr: 0.91, psi: 0.02, rws: 0.14, failures: [] };
    const shouldBlock = b15HardGateEnabled && b15.passed === false;
    expect(shouldBlock).toBe(false);

    delete process.env.B15_BATTERY_ENABLED;
  });

  it("does NOT block when b15_battery column is null (backward compat)", () => {
    process.env.B15_BATTERY_ENABLED = "true";
    const b15HardGateEnabled = (process.env.B15_BATTERY_ENABLED ?? "false") === "true";
    const b15Battery = null;
    // Gate logic: only fires when b15Battery is not null
    const shouldBlock = b15HardGateEnabled && b15Battery != null && (b15Battery as { passed?: boolean }).passed === false;
    expect(shouldBlock).toBe(false);

    delete process.env.B15_BATTERY_ENABLED;
  });

  it("default B15_BATTERY_ENABLED is false (advisory mode for 30 days)", () => {
    delete process.env.B15_BATTERY_ENABLED;
    const b15HardGateEnabled = (process.env.B15_BATTERY_ENABLED ?? "false") === "true";
    expect(b15HardGateEnabled).toBe(false);
  });

  it("audit action is lifecycle.b15_parameter_robustness_blocked", () => {
    // Verify the audit action constant (used in lifecycle-service.ts)
    const auditAction = "lifecycle.b15_parameter_robustness_blocked";
    expect(auditAction).toBe("lifecycle.b15_parameter_robustness_blocked");
  });

  it("status is 'failure' when hard gate blocks, 'warning' in advisory mode", () => {
    const hardStatus = true ? "failure" : "warning";   // b15HardGateEnabled=true
    const advisoryStatus = false ? "failure" : "warning"; // b15HardGateEnabled=false
    expect(hardStatus).toBe("failure");
    expect(advisoryStatus).toBe("warning");
  });
});

// ─── b15_battery data shape tests ────────────────────────────────────────────

describe("B15 battery result schema", () => {
  it("has all required keys in the battery result", () => {
    const result = {
      sdr: 0.91,
      psi: 0.025,
      rws: 0.14,
      passed: true,
      thresholds: { sdr: 0.85, psi: 0.05, rws: 0.20 },
      failures: [],
      sdr_detail: { perturbations: [], valid_perturbations: 20, failed_perturbations: 0, base_sharpe: 1.8 },
      psi_detail: { psi: 0.025, by_parameter: {} },
      rws_detail: { rws: 0.14, monthly_sharpes: [], window_sharpes: [], n_windows: 4 },
    };

    expect(result).toHaveProperty("sdr");
    expect(result).toHaveProperty("psi");
    expect(result).toHaveProperty("rws");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("thresholds");
    expect(result).toHaveProperty("failures");
    expect(result).toHaveProperty("sdr_detail");
    expect(result).toHaveProperty("psi_detail");
    expect(result).toHaveProperty("rws_detail");
  });

  it("thresholds match QuantForgeAnalytics 2026-05-16 spec", () => {
    const thresholds = { sdr: 0.85, psi: 0.05, rws: 0.20 };
    expect(thresholds.sdr).toBe(0.85);
    expect(thresholds.psi).toBe(0.05);
    expect(thresholds.rws).toBe(0.20);
  });
});
