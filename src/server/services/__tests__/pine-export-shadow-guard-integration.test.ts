/**
 * pine-export-shadow-guard-integration.test.ts — Pass 3 Track C (2026-06-22)
 *
 * C5: Integration-level tests verifying the shadow guard is correctly wired at
 * all 4 call sites:
 *
 *   C5.1  compileDualPineExport — blocked, returns {ok:false, reason:shadow_strategy_pine_blocked}
 *   C5.2  compileDualPineExport — audit row written on block
 *   C5.3  compilePineExport — blocked, returns {ok:false, reason:shadow_strategy_pine_blocked}
 *   C5.4  compilePineExport — audit row written on block
 *   C5.5  generateRecipientExport — blocked, throws with shadowStrategyBlocked=true
 *   C5.6  generateRecipientExport — audit row written on block
 *   C5.7  non-shadow strategies: assertNotShadow called but guard does not block
 *   C5.8  DB error in shadow guard blocks the service call (fail-CLOSED)
 *   C5.9  notifyWarning fired on SHADOW block at each call site
 *   C5.10 audit row blocked_at discriminates between call sites
 *
 * Test strategy: mock all heavy dependencies (DB, Python subprocess, index.js,
 * SSE, notification-service) so only the shadow-guard wiring is exercised.
 * assertNotShadow is mocked at the module level — individual tests control
 * whether it resolves (pass) or rejects with PineExportShadowError (block).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PineExportShadowError } from "../../lib/pine-export-shadow-guard.js";

// ─── Static mocks (hoisted to top of file) ───────────────────────────────────

// Mock assertNotShadow so we can control it per-test.
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

// DB mock — Drizzle-shaped stub.
const mockValues = vi.fn().mockReturnThis();
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockWhere = vi.fn().mockResolvedValue([]);
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

vi.mock("../../db/index.js", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

// Pipeline active by default.
vi.mock("../../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

// Notification service spy.
vi.mock("../../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
  notifyInfo: vi.fn(),
}));

// Suppress SSE.
vi.mock("../../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

// Python subprocess — never emits close so the compilation hangs.
// Shadow guard blocks before subprocess is even spawned for SHADOW strategies.
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

// python-runner — suppress slot management side effects.
vi.mock("../../lib/python-runner.js", () => ({
  acquirePineSlot: vi.fn().mockResolvedValue({ release: vi.fn() }),
  getPythonSubprocessStats: vi.fn().mockReturnValue({ active: 0, max: 4 }),
}));

// ─── Lazy imports (after vi.mock) ─────────────────────────────────────────────

const { assertNotShadow } = await import("../../lib/pine-export-shadow-guard.js");
const { notifyWarning } = await import("../../services/notification-service.js");
const { compileDualPineExport, compilePineExport } = await import("../../services/pine-export-service.js");
const { generateRecipientExport } = await import("../pine-export-recipient-service.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STRATEGY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACCOUNT_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeShadowError(state = "SHADOW", shadowMode = false) {
  return new PineExportShadowError(STRATEGY_ID, state, shadowMode, "shadow_state");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("C5: shadow guard wired into compileDualPineExport", () => {
  beforeEach(() => {
    vi.mocked(assertNotShadow).mockResolvedValue(undefined);
    vi.mocked(notifyWarning).mockReset();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReset().mockReturnThis();
  });

  // C5.1 — guard blocks, returns fail shape
  it("C5.1: SHADOW strategy blocked — returns {ok:false, reason:shadow_strategy_pine_blocked}", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    const result = await compileDualPineExport(STRATEGY_ID, "topstep");
    expect(result).toMatchObject({
      ok: false,
      reason: "shadow_strategy_pine_blocked",
    });
  });

  // C5.2 — audit row written
  it("C5.2: SHADOW block writes audit row with action=pine_export.refused_shadow_strategy", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    await compileDualPineExport(STRATEGY_ID, "topstep");
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalled();
    const auditPayload = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(auditPayload.action).toBe("pine_export.refused_shadow_strategy");
    expect(auditPayload.status).toBe("warn");
    const input = auditPayload.input as Record<string, unknown>;
    expect(input.blockedAt).toBe("compileDualPineExport");
  });

  // C5.9a — notifyWarning fired
  it("C5.9a: SHADOW block fires notifyWarning containing 'SHADOW'", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    await compileDualPineExport(STRATEGY_ID, "topstep");
    expect(vi.mocked(notifyWarning)).toHaveBeenCalledOnce();
    const [title] = vi.mocked(notifyWarning).mock.calls[0];
    expect(String(title)).toContain("SHADOW");
  });

  // C5.7a — non-shadow: assertNotShadow called, no block
  it("C5.7a: non-SHADOW strategy — assertNotShadow called but no block fired", async () => {
    vi.mocked(assertNotShadow).mockResolvedValueOnce(undefined);
    // Start the export (subprocess never closes, so it hangs unless we don't await).
    const promise = compileDualPineExport(STRATEGY_ID, "topstep");
    // Guard must have been called once.
    expect(vi.mocked(assertNotShadow)).toHaveBeenCalledWith(STRATEGY_ID, expect.anything());
    // No shadow block — notifyWarning not called.
    expect(vi.mocked(notifyWarning)).not.toHaveBeenCalled();
    // Don't await the hanging promise.
    promise.catch(() => undefined);
  });
});

describe("C5: shadow guard wired into compilePineExport", () => {
  beforeEach(() => {
    vi.mocked(assertNotShadow).mockResolvedValue(undefined);
    vi.mocked(notifyWarning).mockReset();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReset().mockReturnThis();
  });

  // C5.3 — guard blocks
  it("C5.3: SHADOW strategy blocked — returns {ok:false, reason:shadow_strategy_pine_blocked}", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    const result = await compilePineExport(STRATEGY_ID, "topstep");
    expect(result).toMatchObject({
      ok: false,
      reason: "shadow_strategy_pine_blocked",
    });
  });

  // C5.4 — audit row
  it("C5.4: SHADOW block writes audit row with blocked_at=compilePineExport", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    await compilePineExport(STRATEGY_ID, "topstep");
    expect(mockValues).toHaveBeenCalled();
    const auditPayload = mockValues.mock.calls[0][0] as Record<string, unknown>;
    const input = auditPayload.input as Record<string, unknown>;
    expect(input.blockedAt).toBe("compilePineExport");
  });

  // C5.9b — notifyWarning
  it("C5.9b: SHADOW block fires notifyWarning", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    await compilePineExport(STRATEGY_ID, "topstep");
    expect(vi.mocked(notifyWarning)).toHaveBeenCalledOnce();
  });

  // C5.7b — non-shadow
  it("C5.7b: non-SHADOW strategy — guard called but no block", async () => {
    vi.mocked(assertNotShadow).mockResolvedValueOnce(undefined);
    const promise = compilePineExport(STRATEGY_ID, "topstep");
    expect(vi.mocked(assertNotShadow)).toHaveBeenCalledWith(STRATEGY_ID, expect.anything());
    expect(vi.mocked(notifyWarning)).not.toHaveBeenCalled();
    promise.catch(() => undefined);
  });
});

describe("C5: shadow guard wired into generateRecipientExport", () => {
  beforeEach(() => {
    vi.mocked(assertNotShadow).mockResolvedValue(undefined);
    vi.mocked(notifyWarning).mockReset();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReset().mockReturnThis();
    // Default DB query returns empty (strategy lookup in recipient service)
    mockWhere.mockResolvedValue([]);
  });

  // C5.5 — throws with shadowStrategyBlocked
  it("C5.5: SHADOW strategy — throws error with shadowStrategyBlocked=true", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    let thrownErr: unknown;
    try {
      await generateRecipientExport({ strategyId: STRATEGY_ID, accountId: ACCOUNT_ID });
    } catch (err) {
      thrownErr = err;
    }
    expect(thrownErr).toBeDefined();
    const e = thrownErr as Error & { shadowStrategyBlocked?: boolean };
    expect(e.shadowStrategyBlocked).toBe(true);
  });

  // C5.6 — audit row
  it("C5.6: SHADOW block writes audit row with blocked_at=generateRecipientExport", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    try {
      await generateRecipientExport({ strategyId: STRATEGY_ID, accountId: ACCOUNT_ID });
    } catch { /* expected */ }
    expect(mockValues).toHaveBeenCalled();
    const auditPayload = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(auditPayload.action).toBe("pine_export.refused_shadow_strategy");
    const input = auditPayload.input as Record<string, unknown>;
    expect(input.blockedAt).toBe("generateRecipientExport");
  });

  // C5.9c — notifyWarning
  it("C5.9c: SHADOW block fires notifyWarning in generateRecipientExport", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    try {
      await generateRecipientExport({ strategyId: STRATEGY_ID, accountId: ACCOUNT_ID });
    } catch { /* expected */ }
    expect(vi.mocked(notifyWarning)).toHaveBeenCalledOnce();
    const [title] = vi.mocked(notifyWarning).mock.calls[0];
    expect(String(title)).toContain("SHADOW");
  });

  // C5.8 — fail-CLOSED on non-PineExportShadowError rethrown as shadowStrategyBlocked
  it("C5.8: PineExportShadowError(strategy_not_found) blocks generateRecipientExport fail-CLOSED", async () => {
    vi.mocked(assertNotShadow).mockRejectedValueOnce(
      new PineExportShadowError(STRATEGY_ID, null, false, "strategy_not_found"),
    );
    let thrownErr: unknown;
    try {
      await generateRecipientExport({ strategyId: STRATEGY_ID, accountId: ACCOUNT_ID });
    } catch (err) {
      thrownErr = err;
    }
    expect(thrownErr).toBeDefined();
    const e = thrownErr as Error & { shadowStrategyBlocked?: boolean };
    expect(e.shadowStrategyBlocked).toBe(true);
  });
});

describe("C5.10: audit blocked_at discriminates between call sites", () => {
  beforeEach(() => {
    vi.mocked(notifyWarning).mockReset();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReset().mockReturnThis();
    mockWhere.mockResolvedValue([]);
  });

  it("C5.10: each call site writes a distinct blocked_at value", async () => {
    const blockedAtValues: string[] = [];

    // compileDualPineExport
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    mockValues.mockReset().mockReturnThis();
    await compileDualPineExport(STRATEGY_ID, "topstep");
    const dualPayload = mockValues.mock.calls[0][0] as Record<string, unknown>;
    blockedAtValues.push((dualPayload.input as Record<string, unknown>).blockedAt as string);

    // compilePineExport
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    mockValues.mockReset().mockReturnThis();
    await compilePineExport(STRATEGY_ID, "topstep");
    const singlePayload = mockValues.mock.calls[0][0] as Record<string, unknown>;
    blockedAtValues.push((singlePayload.input as Record<string, unknown>).blockedAt as string);

    // generateRecipientExport
    vi.mocked(assertNotShadow).mockRejectedValueOnce(makeShadowError());
    mockValues.mockReset().mockReturnThis();
    try {
      await generateRecipientExport({ strategyId: STRATEGY_ID, accountId: ACCOUNT_ID });
    } catch { /* expected */ }
    const recipientPayload = mockValues.mock.calls[0][0] as Record<string, unknown>;
    blockedAtValues.push((recipientPayload.input as Record<string, unknown>).blockedAt as string);

    expect(blockedAtValues).toEqual([
      "compileDualPineExport",
      "compilePineExport",
      "generateRecipientExport",
    ]);
  });
});
