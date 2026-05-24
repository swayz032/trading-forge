/**
 * Wave 25 Pass 2 — R-3: Weekly drift HALT audit action canonical name tests.
 *
 * Verifies:
 * 1. weekly-drift HALT writes action='drift.weekly_2sigma_halt' exactly.
 * 2. grep across src/ finds zero occurrences of 'auto_halt.weekly_drift_2sigma'
 *    (the wrong consumer name that was producing 0 rows on canonical query).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSetMode = vi.fn().mockResolvedValue(undefined);
const mockGetCurrentState = vi.fn().mockResolvedValue({ production_mode: "ACTIVE", kill_reason: null });
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    setMode: mockSetMode,
    getCurrentState: mockGetCurrentState,
    isHaltedForProduction: vi.fn().mockResolvedValue(false),
  },
}));

const mockInsertAuditRow = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: mockInsertAuditRow,
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

const mockNotifyCritical = vi.fn();
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: mockNotifyCritical,
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// DB mock — returns live trades with high z-score to trigger HALT path
const mockDbSelect = vi.fn();
vi.mock("../db/index.js", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: { id: "id", name: "name", lifecycleState: "lifecycle_state" },
  paperTrades: { pnl: "pnl", exitTime: "exit_time", sessionId: "session_id" },
  paperSessions: { id: "id", strategyId: "strategy_id" },
  backtests: { strategyId: "strategy_id", status: "status", resultExtras: "result_extras", createdAt: "created_at" },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChainedSelect(results: unknown[][]) {
  let callIdx = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            const result = results[callIdx] ?? [];
            callIdx++;
            return Promise.resolve(result);
          }),
        }),
        limit: vi.fn().mockImplementation(() => {
          const result = results[callIdx] ?? [];
          callIdx++;
          return Promise.resolve(result);
        }),
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => {
          const result = results[callIdx] ?? [];
          callIdx++;
          return Promise.resolve(result);
        }),
      }),
    }),
  }));
}

function makeTrades(pnls: number[], daysAgo = 0) {
  return pnls.map((pnl, i) => ({
    pnl: String(pnl),
    exitTime: new Date(Date.now() - (daysAgo + i) * 24 * 60 * 60 * 1000),
  }));
}

// ─── Test 1: action name is exactly 'drift.weekly_2sigma_halt' ────────────────

describe("Wave 25 Pass 2 R-3 — Weekly drift action canonical name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes audit_log with action='drift.weekly_2sigma_halt' when z-score > 2σ", async () => {
    // PILOT strategy discovered
    const pilotStrategies = [{ id: "strat-drift-001", name: "TestDriftStrategy" }];
    // Sessions
    const sessions = [{ id: "sess-001" }];
    // High-z live trades (consistently negative vs zero baseline → large z)
    const liveTrades = makeTrades([-500, -600, -550, -700, -650, -580, -620]);
    // Baseline returns: all zero → huge negative z-score
    const baselineResult = [
      {
        resultExtras: {
          metrics: {
            daily_returns: [10, 15, 12, 8, 14, 11, 9, 13, 10, 12],
          },
        },
      },
    ];

    mockDbSelect
      // Call 1: strategies (PILOT + DEPLOYED)
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(Promise.resolve(pilotStrategies)),
        }),
      }))
      // Call 2: DEPLOYED strategies (empty — only PILOT)
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(Promise.resolve([])),
        }),
      }))
      // Call 3: kill-switch state check
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ production_mode: "ACTIVE", kill_reason: null }]),
          }),
        }),
      }))
      // Call 4: paper sessions
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(sessions),
        }),
      }))
      // Call 5: live trades
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(liveTrades),
        }),
      }))
      // Call 6: baseline backtest
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(baselineResult),
            }),
          }),
        }),
      }));

    const { runWeeklyDriftHaltCheck } = await import(
      "../services/weekly-drift-halt-service.js"
    );
    await runWeeklyDriftHaltCheck();

    // Should have written an audit row
    expect(mockInsertAuditRow).toHaveBeenCalled();

    // Find the HALT audit row specifically
    const haltCall = mockInsertAuditRow.mock.calls.find(
      (call) => call[0]?.action === "drift.weekly_2sigma_halt",
    );

    expect(haltCall).toBeDefined();
    expect(haltCall![0].action).toBe("drift.weekly_2sigma_halt");
    expect(haltCall![0].entityType).toBe("strategy");
    expect(haltCall![0].decisionAuthority).toBe("system");
    expect(haltCall![0].status).toBe("success");
  });
});

// ─── Test 2: zero occurrences of 'auto_halt.weekly_drift_2sigma' in src/ ─────

/**
 * Static file-scan test. Reads all .ts and .js files under src/ and verifies
 * that the deprecated consumer name 'auto_halt.weekly_drift_2sigma' does not
 * appear in any of them.
 *
 * This test is the compile-time guard that enforces Test 1's invariant at the
 * call-site level: if any dashboard query, reconciliation script, or service
 * starts querying for the wrong action name, this test fails immediately.
 */

function walkFiles(dir: string, ext: string[]): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
        results.push(...walkFiles(full, ext));
      } else if (entry.isFile() && ext.some((e) => entry.name.endsWith(e))) {
        results.push(full);
      }
    }
  } catch {
    // Non-traversable dir — skip
  }
  return results;
}

describe("Wave 25 Pass 2 R-3 — No consumer uses the deprecated action name", () => {
  it("finds zero occurrences of 'auto_halt.weekly_drift_2sigma' across src/", () => {
    const srcRoot = join(process.cwd(), "src");
    const files = walkFiles(srcRoot, [".ts", ".js", ".mjs", ".cjs"]);

    const DEPRECATED_NAME = "auto_halt.weekly_drift_2sigma";
    const violations: Array<{ file: string; lineNo: number; line: string }> = [];

    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(DEPRECATED_NAME)) {
            violations.push({ file, lineNo: i + 1, line: lines[i].trim() });
          }
        }
      } catch {
        // Unreadable file — skip
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.lineNo}: ${v.line}`)
        .join("\n");
      throw new Error(
        `Found ${violations.length} occurrence(s) of deprecated action name '${DEPRECATED_NAME}':\n${report}\n` +
          `Canonical name is 'drift.weekly_2sigma_halt'. Update all consumers.`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});
