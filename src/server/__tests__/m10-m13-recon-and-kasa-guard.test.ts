/**
 * m10-m13-recon-and-kasa-guard.test.ts
 *
 * Combined test suite for:
 *   M10 — paper-journal-recon scope expansion (shadow-signal, quantum-replay-orphan, A/B routing)
 *   M13 — triggerRemotePowerCycle partial-config guard (fail-CLOSED on incomplete Kasa env)
 *
 * Production mandate: paper trading is the automation-certification gate.
 * These sub-checks surface silent failures BEFORE they contaminate promotion inputs.
 *
 * File location: src/server/__tests__/ (one level above src/server/production/)
 * Mock paths are relative to THIS file:
 *   ../db/index.js  → src/server/db/index.js  (same target as production/paper-journal-recon.ts)
 *   ../db/schema.js → src/server/db/schema.js
 *   ../lib/logger.js → src/server/lib/logger.js
 *   ../services/notification-service.js → src/server/services/notification-service.js
 *   ../lib/notification-helpers.js → src/server/lib/notification-helpers.js
 *   ../services/remote-power-cycle-service.js → for M13
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Shared state ─────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  callIdx: 0,
  responses: [] as unknown[][],
  throwOnCallIdx: -1,
  auditRows: [] as Array<Record<string, unknown>>,
  warningAlerts: [] as Array<{ title: string; body: string }>,
  criticalAlerts: [] as Array<{ title: string; body: string }>,
}));

// ─── Mocks (declared before any imports) ─────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => {
      const idx = state.callIdx++;
      if (idx === state.throwOnCallIdx) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => { throw new Error("db_error_injected"); }),
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => { throw new Error("db_error_injected"); }),
            })),
          })),
        };
      }
      const response = state.responses[idx] ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(async () => response),
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => response),
          })),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        if (typeof vals.action === "string") {
          state.auditRows.push({
            action: vals.action,
            status: vals.status,
            ...(vals.result as Record<string, unknown> ?? {}),
          });
        }
        return {
          catch: vi.fn(() => Promise.resolve()),
          then: vi.fn((fn: (v: unknown) => unknown) => Promise.resolve().then(fn)),
        };
      }),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: {
    tableName: "strategies",
    id: { name: "id" },
    name: { name: "name" },
    symbol: { name: "symbol" },
    lifecycleState: { name: "lifecycle_state" },
    paperAccountRouting: { name: "paper_account_routing" },
  },
  paperTrades: {
    tableName: "paper_trades",
    id: { name: "id" },
    pnl: { name: "pnl" },
    contracts: { name: "contracts" },
    exitTime: { name: "exit_time" },
    entryTime: { name: "entry_time" },
    sessionId: { name: "session_id" },
  },
  paperSessions: {
    tableName: "paper_sessions",
    id: { name: "id" },
    strategyId: { name: "strategy_id" },
    closedAt: { name: "closed_at" },
  },
  paperSignalLogs: {
    tableName: "paper_signal_logs",
    id: { name: "id" },
    sessionId: { name: "session_id" },
    createdAt: { name: "created_at" },
  },
  productionTrades: {
    tableName: "production_trades",
    barTimestamp: { name: "bar_timestamp" },
    expectedPnl: { name: "expected_pnl" },
  },
  tradingviewMarkers: {
    tableName: "tradingview_markers",
    strategyId: { name: "strategy_id" },
    barTimestamp: { name: "bar_timestamp" },
  },
  auditLog: { tableName: "audit_log" },
  lifecycleShadowSignals: {
    tableName: "lifecycle_shadow_signals",
    strategyId: { name: "strategy_id" },
    signalTs: { name: "signal_ts" },
  },
  backtests: {
    tableName: "backtests",
    id: { name: "id" },
    status: { name: "status" },
    createdAt: { name: "created_at" },
  },
  quantumMcRuns: {
    tableName: "quantum_mc_runs",
    backtestId: { name: "backtest_id" },
    governanceLabels: { name: "governance_labels" },
  },
  brokerAccounts: {
    tableName: "broker_accounts",
    accountId: { name: "account_id" },
    accountIdExternal: { name: "account_id_external" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq:       vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  and:      vi.fn((...args: unknown[]) => ({ op: "and", args })),
  gte:      vi.fn((a: unknown, b: unknown) => ({ op: "gte", a, b })),
  lt:       vi.fn((a: unknown, b: unknown) => ({ op: "lt", a, b })),
  inArray:  vi.fn((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
  isNull:   vi.fn((a: unknown) => ({ op: "isNull", a })),
  sql:      vi.fn(() => ({ isSql: true })),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn((title: string, body: string) => {
    state.criticalAlerts.push({ title, body });
  }),
  notifyWarning: vi.fn((title: string, body: string) => {
    state.warningAlerts.push({ title, body });
  }),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn(
    (body: string) => `${body} [family-postscript]`
  ),
}));

// ─── M13 — child_process mock ─────────────────────────────────────────────────
const spawnMock = vi.fn();
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: spawnMock };
});

function makeFakeProc(exitCode: number) {
  const proc = {
    stdout: {
      on: (ev: string, cb: (...args: unknown[]) => void) => {
        // no data events needed for partial-config tests
        void ev; void cb;
      },
    },
    stderr: {
      on: (ev: string, cb: (...args: unknown[]) => void) => {
        void ev; void cb;
      },
    },
    on: (ev: string, cb: (...args: unknown[]) => void) => {
      if (ev === "close") setImmediate(() => cb(exitCode));
    },
    kill: vi.fn(),
  };
  return proc;
}

// ─── Imports under test (AFTER mocks) ────────────────────────────────────────

import { runPaperJournalRecon } from "../production/paper-journal-recon.js";

// ─── Setup / teardown ─────────────────────────────────────────────────────────

function setResponses(...responses: unknown[][]) {
  state.responses = responses;
}

beforeEach(() => {
  state.callIdx = 0;
  state.responses = [];
  state.throwOnCallIdx = -1;
  state.auditRows = [];
  state.warningAlerts = [];
  state.criticalAlerts = [];
  vi.clearAllMocks();
  delete process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"];
});

afterEach(() => {
  delete process.env["KASA_DEVICE_IP"];
  delete process.env["KASA_USERNAME"];
  delete process.env["KASA_PASSWORD"];
  delete process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"];
});

// ─────────────────────────────────────────────────────────────────────────────
// M10 — shadow-signal recon
// ─────────────────────────────────────────────────────────────────────────────
//
// Call order for runPaperJournalRecon with 1 deployed strategy + sub-checks:
//   [0] DEPLOYED+ strategies
//   [1] paper_trades for deployed strategy  (none → skip to sub-checks)
//   Sub-checks run in parallel via Promise.all:
//     shadow:
//       [N+0] SHADOW strategies
//       [N+1] lifecycle_shadow_signals count
//       [N+2] paperSessions for shadow strategies
//       [N+3] paper_signal_logs count
//     quantum:
//       [N+4] completed backtests in 24h
//       [N+5] quantum_mc_runs replay rows (only when backtests exist)
//     ab_routing:
//       [N+6] AB strategies
//       [N+7] broker_accounts (per AB strategy; only when AB strategies exist)
//       [N+8] paper_sessions active (per AB strategy; only when broker account found)
//
// Because Promise.all runs sub-checks concurrently and each has its own sequential
// internal DB calls, the exact interleaving depends on the runtime order. To avoid
// ordering issues we set responses more generously than strictly needed.

describe("M10 — shadow-signal recon", () => {
  it("shadow-signal recon detects delta > 5% on SHADOW-state strategy", async () => {
    process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"] = "true";

    const deployedStrat = { id: "d-strat-1", name: "deployed_one", symbol: "MES" };
    const shadowStrat = { id: "s-strat-1" };
    const shadowSession = { id: "sess-shadow-1" };

    // We need to supply responses in the order they'll be consumed.
    // The sub-checks run via Promise.all which executes them concurrently,
    // but each individual sub-check's await calls are sequential.
    // Order: deployed strategies, paper_trades (0 → early exit in evaluateStrategy),
    // then Promise.all starts 3 sub-checks simultaneously.
    // Within shadow sub-check sequential: SHADOW strategies, shadow_signals, sessions, signal_logs.
    // Within quantum sub-check sequential: completed backtests, replay rows.
    // Within ab_routing sub-check sequential: AB strategies.
    // Because Promise.all interleaves awaits, we use a generous response array
    // and the db.select mock returns `state.responses[callIdx++]`.

    // We set up enough responses to cover all three sub-checks.
    // Positions 0-1: main loop
    // Positions 2-onwards: sub-checks (interleaved by Promise.all scheduling)
    setResponses(
      [deployedStrat],     // [0] DEPLOYED+ strategies
      [],                  // [1] paper_trades → 0 trades, evaluateStrategy returns early
      // Sub-checks (Promise.all – order follows call ordering within each sub-check):
      [shadowStrat],       // [2] SHADOW strategies (shadow sub-check call 1)
      [],                  // [3] completed backtests (quantum sub-check call 1)
      [],                  // [4] AB strategies (ab_routing sub-check call 1)
      [{ cnt: "15" }],     // [5] lifecycle_shadow_signals count (shadow call 2)
      [shadowSession],     // [6] paperSessions for shadow strategy (shadow call 3)
      [{ cnt: "20" }],     // [7] paper_signal_logs count (shadow call 4)
    );

    const result = await runPaperJournalRecon(new Date("2026-06-24"));

    // Shadow sub-check should detect a delta: |15-20|/20 = 0.25 > 0.05
    expect(result.shadowSignalSubcheck.deltaExceedsThreshold).toBe(true);
    expect(result.shadowSignalSubcheck.totalShadowSignals).toBe(15);
    expect(result.shadowSignalSubcheck.totalSignalLogs).toBe(20);
    expect(result.shadowSignalSubcheck.deltaPct).toBeCloseTo(0.25, 3);

    // Warn audit emitted
    const warnRow = state.auditRows.find(
      (r) => r.action === "paper_recon.shadow_signal_delta_detected"
    );
    expect(warnRow).toBeDefined();

    // Discord WARN emitted (via notifyWarning)
    expect(state.warningAlerts).toHaveLength(1);
    expect(state.warningAlerts[0]!.title).toContain("Shadow-signal delta");
  });

  it("shadow-signal recon stays silent on delta = 0", async () => {
    process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"] = "true";

    const deployedStrat = { id: "d-strat-2", name: "deployed_two", symbol: "MNQ" };
    const shadowStrat = { id: "s-strat-2" };
    const shadowSession = { id: "sess-shadow-2" };

    setResponses(
      [deployedStrat],     // [0] DEPLOYED+
      [],                  // [1] paper_trades → 0 → evaluateStrategy early exit
      [shadowStrat],       // [2] SHADOW strategies (shadow call 1)
      [],                  // [3] completed backtests (quantum call 1)
      [],                  // [4] AB strategies (ab_routing call 1)
      [{ cnt: "25" }],     // [5] shadow_signals count
      [shadowSession],     // [6] paperSessions
      [{ cnt: "25" }],     // [7] signal_logs count → exact match, delta = 0
    );

    const result = await runPaperJournalRecon(new Date("2026-06-24"));

    expect(result.shadowSignalSubcheck.deltaExceedsThreshold).toBe(false);
    expect(result.shadowSignalSubcheck.deltaPct).toBeCloseTo(0, 5);

    // No warn audit for shadow delta
    const warnRow = state.auditRows.find(
      (r) => r.action === "paper_recon.shadow_signal_delta_detected"
    );
    expect(warnRow).toBeUndefined();

    // No Discord WARN for shadow
    expect(state.warningAlerts).toHaveLength(0);

    // Info audit written for shadow sub-check clean result
    const infoRow = state.auditRows.find(
      (r) => r.action === "paper_recon.shadow_signal_recon"
    );
    expect(infoRow).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M10 — quantum-replay orphan recon
// ─────────────────────────────────────────────────────────────────────────────

describe("M10 — quantum-replay orphan recon", () => {
  it("finds completed backtests with no replay row — emits warn audit with orphan ids", async () => {
    process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"] = "true";

    const deployedStrat = { id: "d-strat-3", name: "deployed_three", symbol: "MCL" };
    const orphanBacktestId = "backtest-orphan-uuid-001";

    setResponses(
      [deployedStrat],                    // [0] DEPLOYED+
      [],                                 // [1] paper_trades → 0 → early exit
      [],                                 // [2] SHADOW strategies (shadow call 1) → none → skip
      [{ id: orphanBacktestId }],         // [3] completed backtests in 24h (quantum call 1)
      [],                                 // [4] AB strategies (ab_routing call 1) → none
      [],                                 // [5] quantum_mc_runs replay rows (quantum call 2) → NONE → orphan
    );

    const result = await runPaperJournalRecon(new Date("2026-06-24"));

    expect(result.quantumReplaySubcheck.checked).toBe(true);
    expect(result.quantumReplaySubcheck.skipped).toBe(false);
    expect(result.quantumReplaySubcheck.orphanCount).toBe(1);
    expect(result.quantumReplaySubcheck.orphanBacktestIds).toContain(orphanBacktestId);

    // Warn audit emitted
    const warnRow = state.auditRows.find(
      (r) => r.action === "paper_recon.quantum_replay_orphans_detected"
    );
    expect(warnRow).toBeDefined();
  });

  it("quantum-replay recon SKIPS when QUANTUM_REPLAY_AUTO_FIRE_ENABLED=false — info audit only", async () => {
    process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"] = "false";

    const deployedStrat = { id: "d-strat-4", name: "deployed_four", symbol: "MES" };

    setResponses(
      [deployedStrat],   // [0] DEPLOYED+
      [],                // [1] paper_trades → 0
      [],                // [2] SHADOW strategies → none
      [],                // [3] AB strategies → none (quantum is skipped, no DB calls from it)
    );

    const result = await runPaperJournalRecon(new Date("2026-06-24"));

    expect(result.quantumReplaySubcheck.checked).toBe(false);
    expect(result.quantumReplaySubcheck.skipped).toBe(true);
    expect(result.quantumReplaySubcheck.orphanCount).toBe(0);

    // Info audit emitted for skip
    const skipRow = state.auditRows.find(
      (r) => r.action === "paper_recon.quantum_replay_check_disabled"
    );
    expect(skipRow).toBeDefined();

    // No warn audit for orphan
    const warnRow = state.auditRows.find(
      (r) => r.action === "paper_recon.quantum_replay_orphans_detected"
    );
    expect(warnRow).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M10 — A/B account session recon
// ─────────────────────────────────────────────────────────────────────────────

describe("M10 — A/B routing recon", () => {
  it("detects missing broker_account row — emits per-orphan warn audit", async () => {
    process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"] = "true";

    const deployedStrat = { id: "d-strat-5", name: "deployed_five", symbol: "MES" };
    const abStratId = "ab-strat-uuid-001";

    setResponses(
      [deployedStrat],                                          // [0] DEPLOYED+
      [],                                                       // [1] paper_trades → 0
      [],                                                       // [2] SHADOW strategies → none
      [],                                                       // [3] completed backtests → none
      [{ id: abStratId, paperAccountRouting: "slumdawg-baseline" }],  // [4] AB strategies
      [],                                                       // [5] quantum_mc_runs → (backtests empty, no call N+5 for quantum)
                                                                // Note: when backtests=[], quantum returns early before [5]
                                                                // So [5] is actually broker_accounts for AB strategy
      [],                                                       // broker_accounts → MISSING → orphan
    );

    const result = await runPaperJournalRecon(new Date("2026-06-24"));

    expect(result.abRoutingSubcheck.checked).toBe(true);
    expect(result.abRoutingSubcheck.orphanCount).toBe(1);
    expect(result.abRoutingSubcheck.orphanStrategyIds).toContain(abStratId);

    // Per-orphan warn audit
    const warnRow = state.auditRows.find(
      (r) => r.action === "paper_recon.ab_routing_orphan_detected"
    );
    expect(warnRow).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M10 — summary count shape (all 4 sub-checks in final audit row)
// ─────────────────────────────────────────────────────────────────────────────

describe("M10 — recon cron summary includes all 4 sub-checks", () => {
  it("result object includes all 4 sub-check fields and summary audit row is written", async () => {
    process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"] = "false";

    const deployedStrat = { id: "d-strat-6", name: "deployed_six", symbol: "MES" };

    setResponses(
      [deployedStrat],  // [0] DEPLOYED+
      [],               // [1] paper_trades → 0
      [],               // [2] SHADOW strategies → none
      [],               // [3] AB strategies → none (quantum skipped, so no call from quantum here)
    );

    const result = await runPaperJournalRecon(new Date("2026-06-24"));

    // Result must carry all 4 sub-check summaries
    expect(result).toHaveProperty("strategiesEvaluated");
    expect(result).toHaveProperty("shadowSignalSubcheck");
    expect(result).toHaveProperty("quantumReplaySubcheck");
    expect(result).toHaveProperty("abRoutingSubcheck");

    // quantum was skipped
    expect(result.quantumReplaySubcheck.skipped).toBe(true);

    // ab_routing was checked and found clean
    expect(result.abRoutingSubcheck.orphanCount).toBe(0);

    // Final evaluated audit row must be written
    const evalRow = state.auditRows.find(
      (r) => r.action === "paper_reconciliation.evaluated"
    );
    expect(evalRow).toBeDefined();
    expect(evalRow?.action).toBe("paper_reconciliation.evaluated");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M13 — triggerRemotePowerCycle partial-config guard
// ─────────────────────────────────────────────────────────────────────────────

describe("M13 — triggerRemotePowerCycle partial-config guard", () => {
  it("throws when KASA_DEVICE_IP is unset but USERNAME+PASSWORD are set", async () => {
    process.env["KASA_USERNAME"] = "test@example.com";
    process.env["KASA_PASSWORD"] = "testpass";
    delete process.env["KASA_DEVICE_IP"];

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );

    await expect(
      triggerRemotePowerCycle("test_reason", "parent-uuid-m13-1")
    ).rejects.toThrow("remote_power_cycle_partial_config");
  });

  it("throws when KASA_USERNAME is unset but IP+PASSWORD are set", async () => {
    process.env["KASA_DEVICE_IP"] = "192.168.1.42";
    process.env["KASA_PASSWORD"]  = "testpass";
    delete process.env["KASA_USERNAME"];

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );

    await expect(
      triggerRemotePowerCycle("test_reason", "parent-uuid-m13-2")
    ).rejects.toThrow("remote_power_cycle_partial_config");
  });

  it("throws when KASA_PASSWORD is unset but IP+USERNAME are set", async () => {
    process.env["KASA_DEVICE_IP"] = "192.168.1.42";
    process.env["KASA_USERNAME"]  = "test@example.com";
    delete process.env["KASA_PASSWORD"];

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );

    await expect(
      triggerRemotePowerCycle("test_reason", "parent-uuid-m13-3")
    ).rejects.toThrow("remote_power_cycle_partial_config");
  });

  it("emits recovery.remote_power_cycle_partial_config audit BEFORE throwing", async () => {
    process.env["KASA_DEVICE_IP"] = "192.168.1.42";
    process.env["KASA_PASSWORD"]  = "testpass";
    delete process.env["KASA_USERNAME"];

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );

    // The function throws; the audit must be written first.
    // db.insert is called inside the guard before the throw.
    const { db } = await import("../db/index.js") as unknown as { db: { insert: ReturnType<typeof vi.fn> } };

    let caught = false;
    try {
      await triggerRemotePowerCycle("test_reason_audit_check", "parent-uuid-m13-4");
    } catch (err) {
      caught = true;
      expect((err as Error).message).toContain("remote_power_cycle_partial_config");
      expect((err as Error).message).toContain("KASA_USERNAME");
    }

    expect(caught).toBe(true);
    // db.insert was called (audit row written) before the throw
    expect(db.insert).toHaveBeenCalled();
  });

  it("proceeds normally (no throw) when all 3 vars are set — regression", async () => {
    process.env["KASA_DEVICE_IP"] = "192.168.1.42";
    process.env["KASA_USERNAME"]  = "test@example.com";
    process.env["KASA_PASSWORD"]  = "testpass";

    spawnMock.mockReturnValue(makeFakeProc(0));

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );

    // Must NOT throw — resolves to true (script exit 0)
    await expect(
      triggerRemotePowerCycle("test_all_set", "parent-uuid-m13-5")
    ).resolves.toBe(true);
  });

  it("proceeds normally (no throw) when all 3 vars are absent — noneSet path", async () => {
    delete process.env["KASA_DEVICE_IP"];
    delete process.env["KASA_USERNAME"];
    delete process.env["KASA_PASSWORD"];

    spawnMock.mockReturnValue(makeFakeProc(1));  // Script fails (no real plug)

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );

    // Guard is satisfied when all-absent; no throw from the guard
    await expect(
      triggerRemotePowerCycle("test_none_set", "parent-uuid-m13-6")
    ).resolves.toBe(false);
  });
});
