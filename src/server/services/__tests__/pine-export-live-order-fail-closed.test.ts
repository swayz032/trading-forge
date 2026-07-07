/**
 * pine-export-live-order-fail-closed.test.ts
 *
 * Regression tests for two deep-scan findings fixed in pine-export-service.ts
 * (2026-07-06):
 *
 *   F-1 CRITICAL (money-movement safety bypass) — when LIVE_ORDER_GATEWAY_URL is
 *   unset, compileDualPineExport() / compilePineExport() used to fall back to
 *   gateway_mode="direct" and PROCEED, posting the Pine alert straight to
 *   TradersPost and bypassing the kill-switch, compliance gate, firm-cap clamp,
 *   and circuit breaker. Fix: when the fallback would apply to a live-order
 *   production context (archetype Pine + the operator's own paper_account_routing
 *   set) the export now REFUSES (ok:false, status:"failed") instead of silently
 *   degrading. Family / monitor-only exports (no archetype prefix, no
 *   paper_account_routing) are NOT blocked — their direct-to-TradersPost path is
 *   the documented, intentional path (CLAUDE.md §7-§9) and must keep working.
 *
 *   F-2 HIGH (live_order_token placeholder leak) — the live_order_token lookup
 *   against account_strategy_assignments was fail-soft: a missing row or a query
 *   error just logged a warning and let compilation proceed, so a resolved
 *   account_id + tf_gateway mode could ship an artifact whose live_order_token
 *   is the literal "<live-order-token-placeholder>" string — silently dropping
 *   every live alert at /api/live-order. Fix: token resolution failure now
 *   REFUSES the export (ok:false, status:"failed") before compilation runs.
 *
 * Test strategy mirrors pine-export-shadow-guard-integration.test.ts: mock DB,
 * notification-service, index.js logger, SSE, and child_process/python-runner so
 * only the fail-closed wiring under test is exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Static mocks (hoisted to top of file) ───────────────────────────────────

// Shadow guard always resolves (not a SHADOW strategy) — irrelevant to this fix.
vi.mock("../../lib/pine-export-shadow-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pine-export-shadow-guard.js")>();
  return {
    ...actual,
    assertNotShadow: vi.fn().mockResolvedValue(undefined),
  };
});

// Express server bootstrap must never load in tests.
vi.mock("../../index.js", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  app: {},
  server: {},
}));

// ─── Chainable DB mock ────────────────────────────────────────────────────────
// Real Drizzle usage in pine-export-service.ts sometimes awaits `.where(...)`
// directly (no `.limit()`) and sometimes chains `.where(...).limit(1)`. This
// helper returns an object that is BOTH directly awaitable (via `.then`) AND
// exposes a `.limit()` that resolves to the same rows, so a single mock queue
// can serve every select call site in call order.
function makeChainable(rows: unknown[]) {
  return {
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    catch: (reject: (e: unknown) => void) => Promise.resolve(rows).catch(reject),
  };
}

const mockValues = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
const mockWhere = vi.fn((): ReturnType<typeof makeChainable> => makeChainable([]));
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

vi.mock("../../db/index.js", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

// Notification service spy — notifyCritical is the F-1/F-2 refusal signal.
vi.mock("../../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
  notifyInfo: vi.fn(),
}));

// Suppress SSE.
vi.mock("../../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

// child_process — only reached by tests that expect compilation to proceed
// past the gateway/token guards (never-closing EventEmitter, matching the
// shadow-guard-integration.test.ts convention: those promises are not awaited).
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }),
  };
});

vi.mock("../../lib/python-runner.js", () => ({
  acquirePineSlot: vi.fn().mockResolvedValue({ release: vi.fn() }),
  getPythonSubprocessStats: vi.fn().mockReturnValue({ active: 0, max: 4 }),
}));

// pine-export-service.ts reads PINE_MAX_SUBPROCESSES into a module-level constant
// at import time to cap concurrent Pine-compiler subprocess slots. Several tests
// below deliberately let the mocked subprocess "hang" (never emits close/exit) to
// verify progression past the gateway/token guards without waiting for a real
// compile — each of those leaks one semaphore slot for the file's lifetime. Raise
// the cap well above this file's "proceeds to compilation" test count so later
// tests aren't starved by earlier ones' abandoned slots.
process.env["PINE_MAX_SUBPROCESSES"] = "50";

// ─── Lazy imports (after vi.mock) ─────────────────────────────────────────────

const { notifyCritical, notifyWarning } = await import("../../services/notification-service.js");
const { compileDualPineExport, compilePineExport } = await import("../../services/pine-export-service.js");
const childProcess = await import("child_process");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STRATEGY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACCOUNT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EXPORT_ROW_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function archetypeProductionStrategyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STRATEGY_ID,
    config: { entry_indicator: "archetype:ema_crossover" },
    paperAccountRouting: "baseline",
    ...overrides,
  };
}

function familyMonitorOnlyStrategyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STRATEGY_ID,
    config: { entry_indicator: "ema_crossover" }, // NOT "archetype:" prefixed
    paperAccountRouting: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env["LIVE_ORDER_GATEWAY_URL"];
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockImplementation(() => makeChainable([]));
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReset().mockReturnThis();
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-1: LIVE_ORDER_GATEWAY_URL unset → live-order production context REFUSED
// ─────────────────────────────────────────────────────────────────────────────

describe("F-1: compileDualPineExport refuses direct-mode fallback for live-order production context", () => {
  it("archetype strategy + paper_account_routing set + LIVE_ORDER_GATEWAY_URL unset → export REFUSED (ok:false)", async () => {
    // Strategy select (call #1) → archetype + paperAccountRouting production context.
    // exportRow insert (persist=true default) returns an id via .returning().
    mockWhere.mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    const result = await compileDualPineExport(
      STRATEGY_ID,
      "topstep",
      {}, // injectedRiskIntelligence: truthy non-null object skips the MC/backtest select block
      true, // persist
    ) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("live_order_gateway_unavailable_fail_closed");
    // Must NOT have proceeded to spawn the Python compiler subprocess.
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("writes a blocked audit row with action=pine_export.live_order_gateway_refused", async () => {
    mockWhere.mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    await compileDualPineExport(STRATEGY_ID, "topstep", {}, true);

    const refusalAuditCall = mockValues.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)?.action === "pine_export.live_order_gateway_refused",
    );
    expect(refusalAuditCall).toBeDefined();
    const payload = refusalAuditCall![0] as Record<string, unknown>;
    expect(payload.status).toBe("blocked");
  });

  it("fires notifyCritical (not notifyWarning) on refusal", async () => {
    mockWhere.mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    await compileDualPineExport(STRATEGY_ID, "topstep", {}, true);

    expect(vi.mocked(notifyCritical)).toHaveBeenCalledOnce();
    const [title] = vi.mocked(notifyCritical).mock.calls[0];
    expect(String(title)).toContain("REFUSED");
    expect(vi.mocked(notifyWarning)).not.toHaveBeenCalled();
  });

  it("family / non-archetype strategy (no paper_account_routing) is NOT refused — legacy direct path keeps working", async () => {
    // Family / monitor-only export: entry_indicator has no "archetype:" prefix
    // and paper_account_routing is null. LIVE_ORDER_GATEWAY_URL is still unset.
    // This MUST proceed to compilation (the documented Pine -> TradersPost direct
    // path for family distribution, CLAUDE.md §7-§9) rather than being blocked.
    mockWhere.mockImplementationOnce(() => makeChainable([familyMonitorOnlyStrategyRow()]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    // Don't await to completion — the mocked subprocess never closes (matches
    // the shadow-guard-integration.test.ts convention for "proceeds" cases).
    const promise = compileDualPineExport(STRATEGY_ID, "topstep", {}, true);

    // Give the microtask queue a tick to reach the subprocess spawn.
    await new Promise((r) => setTimeout(r, 10));

    expect(childProcess.spawn).toHaveBeenCalled();
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();
    const refusalAuditCall = mockValues.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)?.action === "pine_export.live_order_gateway_refused",
    );
    expect(refusalAuditCall).toBeUndefined();
    // Legacy warn-only fallback audit still fires (existing, non-refusing behavior preserved).
    const fallbackAuditCall = mockValues.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)?.action === "pine_export.fallback_direct_path",
    );
    expect(fallbackAuditCall).toBeDefined();

    promise.catch(() => undefined);
  });

  it("explicit gatewayOptions={mode:'direct'} opt-in is NOT refused even for archetype+routing context (deliberate operator choice)", async () => {
    mockWhere.mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    const promise = compileDualPineExport(
      STRATEGY_ID,
      "topstep",
      {},
      true,
      undefined, undefined, undefined, undefined, undefined,
      { mode: "direct" }, // explicit opt-in — deriveGatewayOptions never flags this as a fallback
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(childProcess.spawn).toHaveBeenCalled();
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();

    promise.catch(() => undefined);
  });
});

describe("F-1: compilePineExport (single-artifact path) mirrors the same fail-closed guard", () => {
  it("archetype strategy + paper_account_routing set + LIVE_ORDER_GATEWAY_URL unset → export REFUSED (ok:false)", async () => {
    mockWhere.mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    const result = await compilePineExport(
      STRATEGY_ID,
      "topstep",
      "pine_indicator",
      {}, // injectedRiskIntelligence: skip MC/backtest select block
    ) as Record<string, unknown>;

    expect(result.status).toBe("failed");
    expect(result.error).toBe("live_order_gateway_unavailable_fail_closed");
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("family / non-archetype strategy is NOT refused — legacy direct path keeps working", async () => {
    mockWhere.mockImplementationOnce(() => makeChainable([familyMonitorOnlyStrategyRow()]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    const promise = compilePineExport(STRATEGY_ID, "topstep", "pine_indicator", {});
    await new Promise((r) => setTimeout(r, 10));

    expect(childProcess.spawn).toHaveBeenCalled();
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();

    promise.catch(() => undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-2: live_order_token resolution failure → export FAILS (no placeholder ship)
// ─────────────────────────────────────────────────────────────────────────────

describe("F-2: compileDualPineExport refuses to ship when live_order_token cannot resolve", () => {
  it("tf_gateway mode + resolved account_id + NO account_strategy_assignments row → export FAILS", async () => {
    // Call #1: strategy select. Call #2: account_strategy_assignments lookup
    // (via .limit(1)) returns empty — simulating "no assignment row found".
    mockWhere
      .mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]))
      .mockImplementationOnce(() => makeChainable([])); // account_strategy_assignments: no row
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    const result = await compileDualPineExport(
      STRATEGY_ID,
      "topstep",
      {},
      true,
      undefined, undefined, undefined,
      undefined, // hmacSecret not pre-supplied — force the DB lookup path
      ACCOUNT_ID, // accountId explicitly resolved (skips A/B routing select entirely)
      { mode: "tf_gateway" }, // explicit tf_gateway — bypasses the F-1 gateway-refusal branch
    ) as Record<string, unknown>;

    expect(result.status).toBe("failed");
    expect(result.error).toBe("live_order_token_unresolved_fail_closed");
    expect(result.ok).toBe(false);
    // Must NOT have proceeded to compile — no placeholder-carrying artifact is ever produced.
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("writes a blocked audit row with action=pine_export.live_order_token_refused", async () => {
    mockWhere
      .mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]))
      .mockImplementationOnce(() => makeChainable([]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    await compileDualPineExport(
      STRATEGY_ID, "topstep", {}, true,
      undefined, undefined, undefined, undefined,
      ACCOUNT_ID,
      { mode: "tf_gateway" },
    );

    const refusalAuditCall = mockValues.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)?.action === "pine_export.live_order_token_refused",
    );
    expect(refusalAuditCall).toBeDefined();
    expect((refusalAuditCall![0] as Record<string, unknown>).status).toBe("blocked");
  });

  it("fires notifyCritical on token-resolution failure", async () => {
    mockWhere
      .mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]))
      .mockImplementationOnce(() => makeChainable([]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    await compileDualPineExport(
      STRATEGY_ID, "topstep", {}, true,
      undefined, undefined, undefined, undefined,
      ACCOUNT_ID,
      { mode: "tf_gateway" },
    );

    expect(vi.mocked(notifyCritical)).toHaveBeenCalledOnce();
    const [title] = vi.mocked(notifyCritical).mock.calls[0];
    expect(String(title)).toContain("REFUSED");
    expect(String(title)).toContain("live_order_token");
  });

  it("token resolves successfully → export proceeds to compilation (no false-positive refusal)", async () => {
    mockWhere
      .mockImplementationOnce(() => makeChainable([archetypeProductionStrategyRow()]))
      .mockImplementationOnce(() => makeChainable([{ hmacSecret: "real-resolved-hmac-secret" }]));
    mockValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: EXPORT_ROW_ID }]) });

    const promise = compileDualPineExport(
      STRATEGY_ID, "topstep", {}, true,
      undefined, undefined, undefined, undefined,
      ACCOUNT_ID,
      { mode: "tf_gateway" },
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(childProcess.spawn).toHaveBeenCalled();
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();

    promise.catch(() => undefined);
  });
});
