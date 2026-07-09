/**
 * pine-export-direct-mode-guard.test.ts — deep-scan #22 Track D, fix D4.
 * REWRITTEN deep-scan #22 (Group-1 residual close): was a MIRROR reimplementation
 * of the guard condition; now drives the ACTUAL exported compile functions in
 * pine-export-service.ts end-to-end.
 *
 * Bug context:
 *   pine-export-service.ts routes gateway mode through deriveGatewayOptions()
 *   (pine-gateway-options.ts). An EXPLICIT gatewayOptions={mode:"direct"} is
 *   treated as a deliberate operator opt-in (shouldAuditFallback=false), so the
 *   F-1 fail-closed live-order-gateway guard NEVER fires for it. That reopens the
 *   closed CRITICAL: a future misconfigured caller could pass mode:"direct" for a
 *   live-order context (paper_account_routing set = the operator's own A/B-routed
 *   sub-account) and silently bypass the kill-switch / compliance gate / firm-cap
 *   clamp / circuit breaker.
 *
 * Fix (D4):
 *   When direct is explicitly requested AND paper_account_routing is set, refuse
 *   it — override to tf_gateway and write an audit row. Family / monitor-only
 *   exports (no paper_account_routing) keep their intentional direct path
 *   (CLAUDE.md §7-§9). The guard is duplicated verbatim at TWO call sites:
 *   compileDualPineExport (~line 708) and compilePineExport (~line 1474).
 *
 * Why this is a REAL integration test, not a mirror:
 *   The old suite hand-copied the guard's `if` condition into a local
 *   `applyD4DirectModeGuard()` function and tested THAT — a future edit to the
 *   real guard in pine-export-service.ts could silently diverge from the mirror
 *   without either suite noticing. This suite instead:
 *     1. Imports the REAL `compileDualPineExport` and `compilePineExport` from
 *        pine-export-service.ts (no guard logic is reimplemented anywhere here).
 *     2. Mocks only the DB/notification/SSE/fs I/O boundaries (same pattern as
 *        deepscan22-fixwave2-track-c-consolidation.test.ts's DB-mock convention).
 *     3. Drives each function with a real strategy row + real explicit
 *        `gatewayOptions={mode:"direct"}` and lets the REAL guard branch execute.
 *     4. Captures the JSON string the real code passes to `writeFileSync` (which
 *        is mocked to throw immediately afterward, forcing each function's own
 *        outer catch to return cleanly WITHOUT ever spawning the Python
 *        subprocess) and asserts the actual resolved `gateway_mode` /
 *        `gateway_url` embedded in it — not a self-reported mirror value.
 *     5. Asserts the real `db.insert(auditLog).values(...)` call carrying
 *        `action: "pine_export.direct_mode_overridden_live_context"` actually
 *        fired (spied via the mocked db module).
 *   Both compile paths are driven independently (not through a shared helper),
 *   so a future edit to either call site's guard — without updating the other —
 *   is caught by its own dedicated test, exactly the drift D4 exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ─────────────────────────────────────────────────────────────────
// Generic thenable/chainable query-builder stand-in. Every `db.select(...)` /
// `db.insert(...)` call pops the next queued response off its own FIFO queue
// at CALL time (not at `.returning()`/await time), so an arbitrarily deep chain
// (`.from().where().orderBy().limit()` vs a bare `.where()`) always resolves to
// the response queued for that logical query — matching how the real code uses
// drizzle regardless of which chain depth a given call site happens to use.
vi.mock("../db/index.js", () => {
  const selectQueue: unknown[] = [];
  const insertQueue: unknown[] = [];
  const insertValuesLog: Array<Record<string, unknown>> = [];
  const updateValuesLog: Array<Record<string, unknown>> = [];

  function makeChain(result: unknown, onValues?: (payload: unknown) => void) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => chain;
    chain.values = (payload: unknown) => {
      onValues?.(payload);
      return chain;
    };
    chain.set = (payload: unknown) => {
      onValues?.(payload);
      return chain;
    };
    chain.returning = () => Promise.resolve(result);
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    chain.catch = (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject);
    return chain;
  }

  const select = () => makeChain(selectQueue.shift() ?? []);
  const insert = () =>
    makeChain(insertQueue.shift() ?? [], (payload) => {
      insertValuesLog.push(payload as Record<string, unknown>);
    });
  const update = () =>
    makeChain(undefined, (payload) => {
      updateValuesLog.push(payload as Record<string, unknown>);
    });

  return {
    db: { select, insert, update },
    __dbTestHooks: { selectQueue, insertQueue, insertValuesLog, updateValuesLog },
  };
});

vi.mock("../db/schema.js", () => ({
  strategies: { id: "strategies.id", lifecycleState: "x", shadowModeEnabled: "x" },
  strategyExports: { id: "strategyExports.id" },
  strategyExportArtifacts: {},
  auditLog: {},
  backtests: { id: "backtests.id", strategyId: "x", createdAt: "x" },
  monteCarloRuns: {},
  quantumMcRuns: {},
  brokerAccounts: { accountId: "x", accountIdExternal: "x", firmId: "x" },
  accountStrategyAssignments: { hmacSecret: "x", accountId: "x", strategyId: "x" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ __op: "eq", args }),
  desc: (col: unknown) => col,
  and: (...args: unknown[]) => ({ __op: "and", args }),
}));

// Avoid pulling in the whole Express app (pine-export-service.ts imports
// `logger` from "../index.js", which is the full server entrypoint).
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

// fs.writeFileSync is mocked to throw IMMEDIATELY once the config JSON is
// serialized. Both compile functions call writeFileSync BEFORE ever spawning
// the Python subprocess and AFTER the D4 guard block, and both wrap the call
// in the function's own outer try/catch — so this forces a fast, deterministic,
// gracefully-caught failure return without touching child_process at all,
// while still letting us capture the exact JSON the real guard produced.
vi.mock("fs", () => ({
  writeFileSync: vi.fn(() => {
    throw new Error("mocked-fs-write-blocked");
  }),
  unlinkSync: vi.fn(),
}));

import * as dbIndexMock from "../db/index.js";
import { writeFileSync } from "fs";
import { compileDualPineExport, compilePineExport } from "../services/pine-export-service.js";

type DbTestHooks = {
  selectQueue: unknown[];
  insertQueue: unknown[];
  insertValuesLog: Array<Record<string, unknown>>;
  updateValuesLog: Array<Record<string, unknown>>;
};
const hooks = (dbIndexMock as unknown as { __dbTestHooks: DbTestHooks }).__dbTestHooks;
const writeFileSyncMock = writeFileSync as unknown as ReturnType<typeof vi.fn>;

const STRATEGY_ID = "22222222-2222-2222-2222-222222222222";

function shadowGuardRow() {
  return [{ lifecycleState: "PAPER", shadowModeEnabled: false }];
}

function strategyRow(paperAccountRouting: string | null) {
  return [
    {
      id: STRATEGY_ID,
      config: { entry_indicator: "archetype:orb_mnq_15m" },
      paperAccountRouting,
    },
  ];
}

/** Extract the JSON payload the real code passed to the (mocked) writeFileSync call. */
function capturedConfig(): Record<string, unknown> {
  const call = writeFileSyncMock.mock.calls[0];
  expect(call, "writeFileSync should have been reached — guard code must run before this").toBeDefined();
  return JSON.parse(call[1] as string);
}

function findAuditInsert(action: string) {
  return hooks.insertValuesLog.find((v) => v?.["action"] === action);
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.selectQueue.length = 0;
  hooks.insertQueue.length = 0;
  hooks.insertValuesLog.length = 0;
  hooks.updateValuesLog.length = 0;
  // pending export row insert always needs a `.returning()`-shaped id.
  hooks.insertQueue.push([{ id: "export-row-1" }]);
});

describe("D4 — compileDualPineExport: real guard, driven end-to-end", () => {
  it("OVERRIDES direct -> tf_gateway for a live-order context (paper_account_routing set) + writes the real audit row", async () => {
    hooks.selectQueue.push(
      shadowGuardRow(),          // assertNotShadow
      strategyRow("slumdawg-baseline"), // main strategy load
      [],                        // A/B routing subAccRows lookup (no match — harmless)
    );

    const result = await compileDualPineExport(
      STRATEGY_ID,
      undefined,
      {}, // injectedRiskIntelligence non-null -> skip risk-intelligence DB round trip
      true,
      "corr-dual-override",
      undefined,
      undefined,
      undefined,
      undefined,
      { mode: "direct" },
    );

    // Proves execution actually reached writeFileSync (i.e. ran the real guard
    // block, not an earlier unrelated short-circuit) before the forced failure.
    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toBe("mocked-fs-write-blocked");

    const cfg = capturedConfig();
    const innerGw = (cfg.strategy as Record<string, unknown>).config as Record<string, unknown>;
    expect(innerGw.gateway_mode).toBe("tf_gateway");
    expect(innerGw.gateway_url).toBeUndefined();

    const audit = findAuditInsert("pine_export.direct_mode_overridden_live_context");
    expect(audit).toBeDefined();
    expect((audit!["result"] as Record<string, unknown>).overridden_to).toBe("tf_gateway");
    expect((audit!["input"] as Record<string, unknown>).requestedMode).toBe("direct");
    expect((audit!["input"] as Record<string, unknown>).paperAccountRouting).toBe("slumdawg-baseline");
  });

  it("PRESERVES explicit direct for family / monitor-only exports (no paper_account_routing) — no override, no audit", async () => {
    hooks.selectQueue.push(
      shadowGuardRow(),
      strategyRow(null),
      [],
    );

    const result = await compileDualPineExport(
      STRATEGY_ID,
      undefined,
      {},
      true,
      "corr-dual-no-override",
      undefined,
      undefined,
      undefined,
      undefined,
      { mode: "direct", gatewayUrl: "https://legacy" },
    );

    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toBe("mocked-fs-write-blocked");

    const cfg = capturedConfig();
    const innerGw = (cfg.strategy as Record<string, unknown>).config as Record<string, unknown>;
    expect(innerGw.gateway_mode).toBe("direct");
    expect(innerGw.gateway_url).toBe("https://legacy");

    expect(findAuditInsert("pine_export.direct_mode_overridden_live_context")).toBeUndefined();
  });
});

describe("D4 — compilePineExport: real guard, driven end-to-end (single-artifact path)", () => {
  it("OVERRIDES direct -> tf_gateway for a live-order context (paper_account_routing set) + writes the real audit row", async () => {
    hooks.selectQueue.push(
      shadowGuardRow(),
      strategyRow("slumdawg-rl-challenger"),
    );

    const result = await compilePineExport(
      STRATEGY_ID,
      undefined,
      "pine_indicator",
      {},
      "corr-single-override",
      { mode: "direct" },
    );

    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toBe("mocked-fs-write-blocked");

    const cfg = capturedConfig();
    const innerGw = (cfg.strategy as Record<string, unknown>).config as Record<string, unknown>;
    expect(innerGw.gateway_mode).toBe("tf_gateway");
    expect(innerGw.gateway_url).toBeUndefined();

    const audit = findAuditInsert("pine_export.direct_mode_overridden_live_context");
    expect(audit).toBeDefined();
    expect((audit!["result"] as Record<string, unknown>).overridden_to).toBe("tf_gateway");
    expect((audit!["input"] as Record<string, unknown>).paperAccountRouting).toBe("slumdawg-rl-challenger");
  });

  it("PRESERVES explicit direct for family / monitor-only exports (no paper_account_routing) — no override, no audit", async () => {
    hooks.selectQueue.push(
      shadowGuardRow(),
      strategyRow(null),
    );

    const result = await compilePineExport(
      STRATEGY_ID,
      undefined,
      "pine_indicator",
      {},
      "corr-single-no-override",
      { mode: "direct" },
    );

    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toBe("mocked-fs-write-blocked");

    const cfg = capturedConfig();
    const innerGw = (cfg.strategy as Record<string, unknown>).config as Record<string, unknown>;
    expect(innerGw.gateway_mode).toBe("direct");

    expect(findAuditInsert("pine_export.direct_mode_overridden_live_context")).toBeUndefined();
  });

  it("leaves an explicit tf_gateway opt-in untouched even with routing set (no D4 involvement)", async () => {
    hooks.selectQueue.push(
      shadowGuardRow(),
      strategyRow("slumdawg-baseline"),
    );

    const result = await compilePineExport(
      STRATEGY_ID,
      undefined,
      "pine_indicator",
      {},
      "corr-single-tf-gateway-explicit",
      { mode: "tf_gateway", gatewayUrl: "https://tf-gateway.example" },
    );

    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toBe("mocked-fs-write-blocked");

    const cfg = capturedConfig();
    const innerGw = (cfg.strategy as Record<string, unknown>).config as Record<string, unknown>;
    expect(innerGw.gateway_mode).toBe("tf_gateway");
    expect(innerGw.gateway_url).toBe("https://tf-gateway.example");

    expect(findAuditInsert("pine_export.direct_mode_overridden_live_context")).toBeUndefined();
  });
});
