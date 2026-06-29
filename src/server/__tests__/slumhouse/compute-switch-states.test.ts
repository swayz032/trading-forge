/**
 * compute-switch-states.test.ts
 *
 * Unit tests for the extracted computeSwitchStates() function in admin.ts.
 * Verifies the function returns the correct switch shape without a
 * Request/Response pair — it's the Carter-accessible extraction.
 *
 * Tests:
 *   1. Returns expected switch keys.
 *   2. bot_power.on = true when mode is ACTIVE.
 *   3. bot_power.state = "alert" when mode is AUTOPAUSE_DD_VELOCITY.
 *   4. bot_power.on = false when mode is PAUSED.
 *   5. recovery.confirmAction present when pipeline halted.
 *   6. vacation_mode.status = "AWAY" when vmOn = true.
 *   7. Fail-closed to mode 0 when DB throws on learning_loop read.
 */

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

vi.mock("../../db/index.js", () => ({ db: {} }));

vi.mock("../../db/schema.js", () => ({
  systemParameters: { currentValue: "currentValue", paramName: "paramName", id: "id", updatedAt: "updatedAt" },
  systemState: { operatorAbsentSince: "operatorAbsentSince", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "__eq__"),
}));

vi.mock("../../services/pipeline-control-service.js", () => ({
  getMode: vi.fn(),
  setMode: vi.fn(),
}));

vi.mock("../../lib/slumhouse/admin-session.js", () => ({
  ADMIN_COOKIE_NAME: "slumhouse_admin_sid",
  ADMIN_SESSION_TTL_SEC: 3600,
  checkPasscode: vi.fn(),
  isAdminConfigured: vi.fn(() => true),
  signAdminSession: vi.fn(),
  adminSessionFromCookie: vi.fn(),
}));

vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));

vi.mock("../../services/dead-mans-heartbeat-service.js", () => ({
  clearOperatorAbsenceMarkers: vi.fn(async () => ({ clearedSince: null, clearedPending: null })),
}));

vi.mock("../../services/operator-absent-mode-service.js", () => ({
  operatorAbsentModeActive: vi.fn(async () => false),
}));

vi.mock("../../lib/execution-mode.js", () => ({
  isLiveExecutionConfigured: vi.fn(() => false),
  getExecutionMode: vi.fn(async () => "paper"),
  setExecutionMode: vi.fn(),
}));

vi.mock("../../lib/learning-loop-mode.js", () => ({
  parseLearningLoopMode: vi.fn((val: unknown) => {
    const n = Number(val);
    if (n === 2) return 2;
    if (n === 1) return 1;
    return 0;
  }),
  learningLoopModeLabel: vi.fn((mode: number) => {
    if (mode === 2) return "AUTOPILOT";
    if (mode === 1) return "OBSERVE";
    return "OFF";
  }),
  LEARNING_LOOP_MODE_PARAM: "auto_patch_loop_enabled",
  MODE_OBSERVE: 1,
  MODE_AUTOPILOT: 2,
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../db/index.js";
import { getMode } from "../../services/pipeline-control-service.js";
import { operatorAbsentModeActive } from "../../services/operator-absent-mode-service.js";
import { isLiveExecutionConfigured, getExecutionMode } from "../../lib/execution-mode.js";
import { computeSwitchStates } from "../../routes/slumhouse/admin.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLlChain(returnVal: unknown): unknown {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    select: (..._a) => chain,
    from:   (..._a) => chain,
    where:  (..._a) => chain,
    limit:  (..._a) => Promise.resolve(returnVal),
  };
  return chain;
}

function mockDbLearningLoop(val: string | null): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
(db as any).select = vi.fn(() =>
    makeLlChain(val === null ? [] : [{ val }])
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("computeSwitchStates()", () => {
  beforeEach(() => {
    vi.mocked(getMode).mockResolvedValue("ACTIVE" as never);
    vi.mocked(operatorAbsentModeActive).mockResolvedValue(false);
    vi.mocked(isLiveExecutionConfigured).mockReturnValue(false);
    vi.mocked(getExecutionMode).mockResolvedValue("paper");
    mockDbLearningLoop("0");
  });

  it("returns all expected switch keys", async () => {
    const result = await computeSwitchStates();
    expect(result).toHaveProperty("bot_power");
    expect(result).toHaveProperty("learning_loop");
    expect(result).toHaveProperty("vacation_mode");
    expect(result).toHaveProperty("recovery");
    expect(result).toHaveProperty("live_execution");
  });

  it("bot_power.on = true and state = running when mode = ACTIVE", async () => {
    vi.mocked(getMode).mockResolvedValue("ACTIVE" as never);
    const result = await computeSwitchStates();
    expect(result.bot_power.on).toBe(true);
    expect(result.bot_power.state).toBe("running");
    expect(result.bot_power.status).toBe("RUNNING");
  });

  it("bot_power.state = alert and status = AUTO-PAUSED when mode = AUTOPAUSE_DD_VELOCITY", async () => {
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY" as never);
    const result = await computeSwitchStates();
    expect(result.bot_power.on).toBe(false);
    expect(result.bot_power.state).toBe("alert");
    expect(result.bot_power.status).toBe("AUTO-PAUSED");
  });

  it("bot_power.on = false and state = paused when mode = PAUSED", async () => {
    vi.mocked(getMode).mockResolvedValue("PAUSED" as never);
    const result = await computeSwitchStates();
    expect(result.bot_power.on).toBe(false);
    expect(result.bot_power.state).toBe("paused");
    expect(result.bot_power.status).toBe("PAUSED");
  });

  it("recovery.confirmAction present when pipeline AUTOPAUSE_DD_VELOCITY", async () => {
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY" as never);
    const result = await computeSwitchStates();
    expect(result.recovery.state).toBe("alert");
    expect(result.recovery.status).toBe("HALTED");
    expect(result.recovery.confirmAction).toBe(true);
  });

  it("recovery.confirmAction absent when pipeline not halted", async () => {
    vi.mocked(getMode).mockResolvedValue("ACTIVE" as never);
    const result = await computeSwitchStates();
    expect(result.recovery.state).toBe("paused");
    expect(result.recovery.status).toBe("ALL CLEAR");
    expect(result.recovery.confirmAction).toBeUndefined();
  });

  it("vacation_mode.status = AWAY when operatorAbsentModeActive = true", async () => {
    vi.mocked(operatorAbsentModeActive).mockResolvedValue(true);
    const result = await computeSwitchStates();
    expect(result.vacation_mode.on).toBe(true);
    expect(result.vacation_mode.status).toBe("AWAY");
  });

  it("vacation_mode.status = HOME when operatorAbsentModeActive = false", async () => {
    vi.mocked(operatorAbsentModeActive).mockResolvedValue(false);
    const result = await computeSwitchStates();
    expect(result.vacation_mode.on).toBe(false);
    expect(result.vacation_mode.status).toBe("HOME");
  });

  it("fail-closed to learning_loop mode 0 when DB throws", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
(db as any).select = vi.fn(() => {
      throw new Error("db_failure");
    });
    const result = await computeSwitchStates();
    expect(result.learning_loop.mode).toBe(0);
    expect(result.learning_loop.on).toBe(false);
    expect(result.learning_loop.label).toBe("OFF");
  });

  it("live_execution.wired = false and needsSetup = true when not configured", async () => {
    vi.mocked(isLiveExecutionConfigured).mockReturnValue(false);
    vi.mocked(getExecutionMode).mockResolvedValue("paper");
    const result = await computeSwitchStates();
    expect(result.live_execution.wired).toBe(false);
    expect(result.live_execution.needsSetup).toBe(true);
    expect(result.live_execution.on).toBe(false);
    expect(result.live_execution.status).toBe("NEEDS SETUP");
  });

  it("live_execution.on = true when configured and liveMode = live", async () => {
    vi.mocked(isLiveExecutionConfigured).mockReturnValue(true);
    vi.mocked(getExecutionMode).mockResolvedValue("live");
    const result = await computeSwitchStates();
    expect(result.live_execution.on).toBe(true);
    expect(result.live_execution.wired).toBe(true);
    expect(result.live_execution.status).toBe("LIVE");
  });

  it("recovery.on is always false (momentary switch, never persistent)", async () => {
    vi.mocked(getMode).mockResolvedValue("ACTIVE" as never);
    const result = await computeSwitchStates();
    expect(result.recovery.on).toBe(false);
    expect(result.recovery.momentary).toBe(true);
  });
});
