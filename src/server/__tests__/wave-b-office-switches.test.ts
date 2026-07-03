/**
 * wave-b-office-switches.test.ts
 *
 * TDD coverage for the 3 newly-wired Slumhouse Office switches:
 *   - learning_loop  (auto_patch_loop_enabled in system_parameters, numeric 1/0)
 *   - vacation_mode  (operator_absent_since in system_state)
 *   - recovery       (momentary — clears AUTOPAUSE_DD_VELOCITY pipeline mode)
 *
 * All tests exercise getSwitchStates / postSwitch directly via their exported
 * handles — no HTTP layer needed, consistent with the service-level test pattern
 * used throughout this suite.
 *
 * Auth guard tests verify requireAdminSession enforces 401 before any DB work.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted by vitest before imports) ─────────────────────────────────

vi.mock("../db/index.js", () => ({ db: {} }));

vi.mock("../db/schema.js", () => ({
  systemParameters: {
    currentValue: "currentValue",
    paramName:    "paramName",
    id:           "id",
    updatedAt:    "updatedAt",
  },
  systemState: {
    operatorAbsentSince: "operatorAbsentSince",
    id: "id",
  },
  // deep-scan #12 Track S: admin.ts now threads actor identity + revocation.
  slumhouseUsers: { discordUserId: "discordUserId", sessionEpoch: "sessionEpoch" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "__eq__"),
  sql: vi.fn(() => "__sql__"),
}));

// deep-scan #12 Track S: postSwitch now checks Origin allowlist; allow in unit
// tests (the real checkSlumhouseOrigin has dedicated coverage in the auth suite).
vi.mock("../lib/slumhouse/require-session.js", () => ({
  checkSlumhouseOrigin: vi.fn(() => true),
}));

vi.mock("../lib/slumhouse/session.js", () => ({
  verifySession: vi.fn(() => null),
  COOKIE_NAME: "slumhouse_sid",
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: vi.fn(),
  setMode: vi.fn(),
}));

vi.mock("../lib/slumhouse/admin-session.js", () => ({
  ADMIN_COOKIE_NAME:    "slumhouse_admin_sid",
  ADMIN_SESSION_TTL_SEC: 3600,
  checkPasscode:        vi.fn(),
  isAdminConfigured:    vi.fn(() => true),
  signAdminSession:     vi.fn(),
  adminSessionFromCookie: vi.fn(),
  adminDiscordUserIdFromCookie: vi.fn(() => null),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));

vi.mock("../services/dead-mans-heartbeat-service.js", () => ({
  clearOperatorAbsenceMarkers: vi.fn(async () => ({ clearedSince: null, clearedPending: null })),
}));

// V-3 (deepscan7): vacation_mode now reads the TRUE effective state via
// operatorAbsentModeActive() (env override OR operator_absent_since) instead of
// selecting system_state directly. Mock the service so the switch tests drive
// it explicitly (this test previously fed a raw ts row that the route no longer
// reads — mock-drift fixed 2026-07-02, layer4-office pass).
vi.mock("../services/operator-absent-mode-service.js", () => ({
  operatorAbsentModeActive: vi.fn(async () => false),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    error: vi.fn(),
    warn:  vi.fn(),
    info:  vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Imports (after mocks are registered) ─────────────────────────────────────

import { db } from "../db/index.js";
import { getMode, setMode } from "../services/pipeline-control-service.js";
import { adminSessionFromCookie } from "../lib/slumhouse/admin-session.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { clearOperatorAbsenceMarkers } from "../services/dead-mans-heartbeat-service.js";
import { operatorAbsentModeActive } from "../services/operator-absent-mode-service.js";
import { getSwitchStates, postSwitch } from "../routes/slumhouse/admin.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Fluent drizzle chain that resolves `.limit()` with the provider's return value. */
function makeChain(responseProvider: () => unknown): unknown {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    from:  (..._a) => chain,
    where: (..._a) => chain,
    limit: (..._a) => Promise.resolve(responseProvider()),
  };
  return chain;
}

/**
 * Install a db.select mock that returns each response array in order.
 * Extra calls beyond `responses.length` return `[]`.
 */
function buildSelectMock(responses: unknown[][]): void {
  let callIdx = 0;
  (db as any).select = vi.fn().mockImplementation(() => {
    const idx = callIdx++;
    return makeChain(() => responses[idx] ?? []);
  });
}

function buildUpdateMock(): void {
  (db as any).update = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }));
}

function buildInsertMock(): void {
  (db as any).insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockResolvedValue([]),
  }));
}

/** Minimal mock request — typed `any` to avoid express.Request 94-property shape check. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(opts: { body?: Record<string, unknown>; cookie?: string } = {}): any {
  return {
    body:    opts.body ?? {},
    headers: { cookie: opts.cookie ?? "" },
  };
}

/** Captured-response mock — track status + body without chaining complexity. */
function makeRes() {
  let capturedStatus = 200;
  let capturedBody: unknown = null;
  const res = {
    status: vi.fn().mockImplementation((code: number) => {
      capturedStatus = code;
      return res; // return self so res.status(401).json(...) works
    }),
    json: vi.fn().mockImplementation((body: unknown) => { capturedBody = body; }),
    cookie:      vi.fn(),
    clearCookie: vi.fn(),
    getStatus:   () => capturedStatus,
    getBody:     () => capturedBody as Record<string, unknown>,
  };
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard — 401 without admin session
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth guard — 401 without admin session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(false);
  });

  it("GET /switches returns 401 with no DB access when session absent", async () => {
    const req = makeReq();
    const res = makeRes();
    await getSwitchStates(req, res as any);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "locked" });
    expect((db as any).select).toBeUndefined(); // no DB access at all
  });

  it("POST /switch returns 401 when session absent", async () => {
    const req = makeReq({ body: { id: "learning_loop", on: true } });
    const res = makeRes();
    await postSwitch(req, res as any);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "locked" });
  });

  it("POST /switch returns 401 for vacation_mode when session absent", async () => {
    const req = makeReq({ body: { id: "vacation_mode", on: true } });
    const res = makeRes();
    await postSwitch(req, res as any);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("POST /switch returns 401 for recovery when session absent", async () => {
    const req = makeReq({ body: { id: "recovery" } });
    const res = makeRes();
    await postSwitch(req, res as any);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// vacation_mode — env-forced-on honesty (deep-scan #12 F-1)
// ─────────────────────────────────────────────────────────────────────────────

describe("vacation_mode OFF refused when env forces ON (deep-scan #12 F-1)", () => {
  const prevEnv = process.env["OPERATOR_ABSENT_AUTOPROMOTE"];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    buildInsertMock();
    buildUpdateMock();
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env["OPERATOR_ABSENT_AUTOPROMOTE"];
    else process.env["OPERATOR_ABSENT_AUTOPROMOTE"] = prevEnv;
  });

  it("returns 409 (not silent success) when OFF-toggled while OPERATOR_ABSENT_AUTOPROMOTE=true", async () => {
    process.env["OPERATOR_ABSENT_AUTOPROMOTE"] = "true";
    const req = makeReq({ body: { id: "vacation_mode", on: false } });
    const res = makeRes();
    await postSwitch(req, res as any);
    expect(res.getStatus()).toBe(409);
    expect(res.getBody().error).toBe("env_forces_vacation_on");
    // Must NOT have cleared the DB marker (no silent revert)
    expect((db as any).update).not.toHaveBeenCalled();
  });

  it("allows OFF toggle normally when env is unset", async () => {
    delete process.env["OPERATOR_ABSENT_AUTOPROMOTE"];
    buildUpdateMock();
    const req = makeReq({ body: { id: "vacation_mode", on: false } });
    const res = makeRes();
    await postSwitch(req, res as any);
    expect(res.getStatus()).not.toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// learning_loop — GET state reading
// ─────────────────────────────────────────────────────────────────────────────

describe("learning_loop GET — numeric state reading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    vi.mocked(getMode).mockResolvedValue("PAUSED");
  });

  it("numeric '1' (OBSERVE) → mode:1, label:OBSERVE, advisory_on:true, autonomous_on:false", async () => {
    buildSelectMock([
      [{ val: "1" }],   // learning_loop row
      [{ ts: null }],   // vacation_mode row
    ]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.learning_loop.mode).toBe(1);
    expect(sw.learning_loop.label).toBe("OBSERVE");
    expect(sw.learning_loop.advisory_on).toBe(true);
    expect(sw.learning_loop.autonomous_on).toBe(false);
    expect(sw.learning_loop.on).toBe(true); // dial not at OFF
    expect(sw.learning_loop.state).toBe("running");
    expect(sw.learning_loop.status).toBe("OBSERVE");
    expect(sw.learning_loop.wired).toBe(true);
    expect(sw.learning_loop.dangerOn).toBe(true);
  });

  it("numeric '2' (AUTOPILOT) → mode:2, label:AUTOPILOT, autonomous_on:true", async () => {
    buildSelectMock([
      [{ val: "2" }],   // learning_loop row
      [{ ts: null }],   // vacation_mode row
    ]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.learning_loop.mode).toBe(2);
    expect(sw.learning_loop.label).toBe("AUTOPILOT");
    expect(sw.learning_loop.advisory_on).toBe(true);
    expect(sw.learning_loop.autonomous_on).toBe(true);
    expect(sw.learning_loop.on).toBe(true);
    expect(sw.learning_loop.status).toBe("AUTOPILOT");
  });

  it("numeric '0' (OFF) → mode:0, label:OFF, on:false, state:paused", async () => {
    buildSelectMock([
      [{ val: "0" }],   // learning_loop row
      [{ ts: null }],   // vacation_mode row
    ]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.learning_loop.mode).toBe(0);
    expect(sw.learning_loop.label).toBe("OFF");
    expect(sw.learning_loop.on).toBe(false);
    expect(sw.learning_loop.advisory_on).toBe(false);
    expect(sw.learning_loop.autonomous_on).toBe(false);
    expect(sw.learning_loop.state).toBe("paused");
    expect(sw.learning_loop.status).toBe("OFF");
  });

  it("absent row → on:false (fail-closed)", async () => {
    buildSelectMock([
      [],             // no kill-switch row
      [{ ts: null }], // vacation_mode row
    ]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.learning_loop.on).toBe(false);
  });

  it("DB error on learning_loop read → on:false (fail-closed, no route crash)", async () => {
    (db as any).select = vi.fn().mockImplementationOnce(() => {
      throw new Error("db_down");
    }).mockImplementationOnce(() => makeChain(() => [{ ts: null }]));
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    expect(res.status).not.toHaveBeenCalledWith(500); // route must not crash
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.learning_loop.on).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// learning_loop — POST toggle
// ─────────────────────────────────────────────────────────────────────────────

describe("learning_loop POST — toggle persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    buildUpdateMock();
    buildInsertMock();
  });

  it("LEGACY on:true with existing row → db.update sets '2' (AUTOPILOT)", async () => {
    // Legacy {on:true} preserves the old "Learning Loop ON = full autonomous"
    // meaning by mapping to AUTOPILOT (mode 2).
    buildSelectMock([[{ id: "existing-uuid" }]]); // existing row found
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "learning_loop", on: true } }), res as any);
    expect((db as any).update).toHaveBeenCalled();
    const setCall = (db as any).update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "2" }));
    const body = res.getBody();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe(2);
    expect(body.status).toBe("AUTOPILOT");
    expect(body.autonomous_on).toBe(true);
    expect(body.state).toBe("running");
  });

  it("LEGACY on:false with existing row → db.update sets '0' (OFF)", async () => {
    buildSelectMock([[{ id: "existing-uuid" }]]);
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "learning_loop", on: false } }), res as any);
    const setCall = (db as any).update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "0" }));
    const body = res.getBody();
    expect(body.mode).toBe(0);
    expect(body.status).toBe("OFF");
    expect(body.state).toBe("paused");
  });

  it("mode:1 (OBSERVE) with existing row → db.update sets '1', status OBSERVE, autonomous_on:false", async () => {
    buildSelectMock([[{ id: "existing-uuid" }]]);
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "learning_loop", mode: 1 } }), res as any);
    const setCall = (db as any).update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "1" }));
    const body = res.getBody();
    expect(body.mode).toBe(1);
    expect(body.status).toBe("OBSERVE");
    expect(body.advisory_on).toBe(true);
    expect(body.autonomous_on).toBe(false);
    expect(body.state).toBe("running");
  });

  it("mode:2 (AUTOPILOT) with existing row → db.update sets '2', autonomous_on:true", async () => {
    buildSelectMock([[{ id: "existing-uuid" }]]);
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "learning_loop", mode: 2 } }), res as any);
    const setCall = (db as any).update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "2" }));
    const body = res.getBody();
    expect(body.mode).toBe(2);
    expect(body.status).toBe("AUTOPILOT");
    expect(body.autonomous_on).toBe(true);
  });

  it("mode:0 (OFF) with existing row → db.update sets '0'", async () => {
    buildSelectMock([[{ id: "existing-uuid" }]]);
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "learning_loop", mode: 0 } }), res as any);
    const setCall = (db as any).update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "0" }));
    const body = res.getBody();
    expect(body.mode).toBe(0);
    expect(body.status).toBe("OFF");
  });

  it("explicit mode wins over legacy on (mode:1 + on:true → '1', not '2')", async () => {
    buildSelectMock([[{ id: "existing-uuid" }]]);
    const res = makeRes();
    await postSwitch(
      makeReq({ body: { id: "learning_loop", mode: 1, on: true } }),
      res as any,
    );
    const setCall = (db as any).update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "1" }));
    expect(res.getBody().mode).toBe(1);
  });

  it("out-of-range mode:5 clamps to '2' (AUTOPILOT)", async () => {
    buildSelectMock([[{ id: "existing-uuid" }]]);
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "learning_loop", mode: 5 } }), res as any);
    const setCall = (db as any).update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "2" }));
  });

  it("LEGACY on:true with no existing row → db.insert with '2'", async () => {
    buildSelectMock([[]]); // no existing row
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "learning_loop", on: true } }), res as any);
    expect((db as any).insert).toHaveBeenCalled();
    const valuesCall = (db as any).insert.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "2" }));
  });

  it("mode:1 with no existing row → db.insert with '1'", async () => {
    buildSelectMock([[]]);
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "learning_loop", mode: 1 } }), res as any);
    const valuesCall = (db as any).insert.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(expect.objectContaining({ currentValue: "1" }));
  });

  it("audit record emitted with switch:learning_loop + mode", async () => {
    buildSelectMock([[{ id: "x" }]]);
    await postSwitch(makeReq({ body: { id: "learning_loop", mode: 2 } }), makeRes() as any);
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "slumhouse_admin.switch_toggled",
        result: expect.objectContaining({ value: "2", mode: 2 }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// vacation_mode — GET state reading
// ─────────────────────────────────────────────────────────────────────────────

describe("vacation_mode GET — operator_absent_since state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    vi.mocked(getMode).mockResolvedValue("ACTIVE");
  });

  it("operatorAbsentSince non-null → on:true, state:running, status:AWAY, dangerOn:true", async () => {
    vi.mocked(operatorAbsentModeActive).mockResolvedValue(true);
    buildSelectMock([
      [{ val: "0" }],                         // learning_loop
    ]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.vacation_mode.on).toBe(true);
    expect(sw.vacation_mode.state).toBe("running");
    expect(sw.vacation_mode.status).toBe("AWAY");
    expect(sw.vacation_mode.dangerOn).toBe(true);
  });

  it("operatorAbsentSince null → on:false, state:paused, status:HOME", async () => {
    vi.mocked(operatorAbsentModeActive).mockResolvedValue(false);
    buildSelectMock([
      [{ val: "0" }],
    ]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.vacation_mode.on).toBe(false);
    expect(sw.vacation_mode.state).toBe("paused");
    expect(sw.vacation_mode.status).toBe("HOME");
  });

  it("absent system_state row → on:false (fail-closed)", async () => {
    vi.mocked(operatorAbsentModeActive).mockRejectedValue(new Error("db_down")); // fail-closed path
    buildSelectMock([[{ val: "0" }], []]); // no system_state row
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.vacation_mode.on).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// vacation_mode — POST toggle
// ─────────────────────────────────────────────────────────────────────────────

describe("vacation_mode POST — set / clear absence marker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    buildUpdateMock();
  });

  it("on:true → db.update(systemState).set({ operatorAbsentSince }) called", async () => {
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "vacation_mode", on: true } }), res as any);
    expect((db as any).update).toHaveBeenCalled();
    const setCall = (db as any).update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(
      expect.objectContaining({ operatorAbsentSince: expect.any(Date) }),
    );
    const body = res.getBody();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("AWAY");
    expect(body.state).toBe("running");
  });

  it("on:false → clearOperatorAbsenceMarkers called (not db.update)", async () => {
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "vacation_mode", on: false } }), res as any);
    expect(clearOperatorAbsenceMarkers).toHaveBeenCalled();
    expect((db as any).update).not.toHaveBeenCalled();
    const body = res.getBody();
    expect(body.status).toBe("HOME");
    expect(body.state).toBe("paused");
  });

  it("audit record emitted for vacation_mode toggle", async () => {
    await postSwitch(makeReq({ body: { id: "vacation_mode", on: true } }), makeRes() as any);
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "slumhouse_admin.switch_toggled" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recovery — GET state reading
// ─────────────────────────────────────────────────────────────────────────────

describe("recovery GET — reflects live halt state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
  });

  it("AUTOPAUSE_DD_VELOCITY → state:alert, status:HALTED, momentary:true, confirmAction:true, on:false", async () => {
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");
    buildSelectMock([[{ val: "0" }], [{ ts: null }]]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.recovery.state).toBe("alert");
    expect(sw.recovery.status).toBe("HALTED");
    expect(sw.recovery.on).toBe(false);
    expect(sw.recovery.momentary).toBe(true);
    expect(sw.recovery.confirmAction).toBe(true);
    expect(sw.recovery.wired).toBe(true);
  });

  it("ACTIVE → state:paused, status:ALL CLEAR, momentary:true, no confirmAction", async () => {
    vi.mocked(getMode).mockResolvedValue("ACTIVE");
    buildSelectMock([[{ val: "0" }], [{ ts: null }]]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.recovery.state).toBe("paused");
    expect(sw.recovery.status).toBe("ALL CLEAR");
    expect(sw.recovery.momentary).toBe(true);
    expect(sw.recovery.confirmAction).toBeUndefined();
  });

  it("PAUSED → state:paused, status:ALL CLEAR", async () => {
    vi.mocked(getMode).mockResolvedValue("PAUSED");
    buildSelectMock([[{ val: "0" }], [{ ts: null }]]);
    const res = makeRes();
    await getSwitchStates(makeReq(), res as any);
    const sw = res.getBody().switches as Record<string, Record<string, unknown>>;
    expect(sw.recovery.state).toBe("paused");
    expect(sw.recovery.status).toBe("ALL CLEAR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recovery — POST trigger
// ─────────────────────────────────────────────────────────────────────────────

describe("recovery POST — momentary trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    vi.mocked(setMode).mockResolvedValue(undefined as any);
  });

  it("AUTOPAUSE_DD_VELOCITY active → setMode(ACTIVE) called + returns status:CLEARED", async () => {
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "recovery" } }), res as any);
    expect(setMode).toHaveBeenCalledWith("ACTIVE", "slumhouse Office recovery clear", null);
    const body = res.getBody();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("CLEARED");
    expect(body.state).toBe("paused");
    expect(body.id).toBe("recovery");
  });

  it("no halt active → setMode NOT called + returns status:ALL CLEAR", async () => {
    vi.mocked(getMode).mockResolvedValue("ACTIVE");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "recovery" } }), res as any);
    expect(setMode).not.toHaveBeenCalled();
    const body = res.getBody();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ALL CLEAR");
  });

  it("VACATION active → setMode NOT called (only AUTOPAUSE_DD_VELOCITY is cleared)", async () => {
    vi.mocked(getMode).mockResolvedValue("VACATION");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "recovery" } }), res as any);
    expect(setMode).not.toHaveBeenCalled();
    expect(res.getBody().status).toBe("ALL CLEAR");
  });

  it("audit record slumhouse_admin.recovery_triggered emitted always", async () => {
    vi.mocked(getMode).mockResolvedValue("ACTIVE");
    await postSwitch(makeReq({ body: { id: "recovery" } }), makeRes() as any);
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "slumhouse_admin.recovery_triggered" }),
    );
  });

  it("setMode error → fail-soft: route returns ok:true (never crash), warning status in audit", async () => {
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");
    vi.mocked(setMode).mockRejectedValue(new Error("db_fail"));
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "recovery" } }), res as any);
    // Route must NOT respond with 500 — fail-soft is mandatory.
    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.getBody();
    expect(body.ok).toBe(true);
    // Audit should reflect the failure.
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ status: "warning" }),
    );
  });
});
