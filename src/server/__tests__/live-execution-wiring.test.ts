/**
 * Integration wiring tests for the live_execution switch.
 *
 * Sections:
 *   D. Admin GET /switches — live_execution shape in getSwitchStates
 *   E. Admin POST /switch  — fail-closed 503 + successful toggle
 *   F. assembleCribData    — executionMode + executionModeLabel fields
 *
 * execution-mode.ts is MOCKED in this file so tests control the return values
 * without touching DB.  The real unit tests live in execution-mode-unit.test.ts.
 *
 * drizzle-orm is NOT mocked here so that crib-data.ts can use sql`` templates.
 * The db.execute mock intercepts all queries before drizzle actually processes them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // execution-mode.ts stubs
  isLiveExecutionConfigured: vi.fn(() => false),
  getExecutionMode:          vi.fn(async () => "paper" as "paper" | "live"),
  setExecutionMode:          vi.fn(async () => {}),
  // pipeline-control-service.ts stub
  getMode:                   vi.fn(async () => "PAUSED"),
  setMode:                   vi.fn(async () => {}),
  // audit + admin-session stubs
  insertAuditRowSafe:        vi.fn(async () => true),
  adminSessionFromCookie:    vi.fn(() => ({ valid: true, userId: "op-1" })),
  // dead-mans heartbeat
  clearOperatorAbsenceMarkers: vi.fn(async () => []),
  // db
  dbSelect:  vi.fn(),
  dbExecute: vi.fn(),
  dbUpdate:  vi.fn(),
  dbInsert:  vi.fn(),
}));

// ── vi.mock declarations (hoisted by vitest before imports) ───────────────────

vi.mock("../lib/execution-mode.js", () => ({
  isLiveExecutionConfigured: mocks.isLiveExecutionConfigured,
  getExecutionMode:          mocks.getExecutionMode,
  setExecutionMode:          mocks.setExecutionMode,
}));

vi.mock("../db/index.js", () => ({
  db: {
    get select()  { return mocks.dbSelect; },
    get execute() { return mocks.dbExecute; },
    get update()  { return mocks.dbUpdate; },
    get insert()  { return mocks.dbInsert; },
  },
}));

vi.mock("../db/schema.js", () => ({
  systemParameters: {
    paramName:    "paramName",
    currentValue: "currentValue",
    id:           "id",
    updatedAt:    "updatedAt",
  },
  systemState: {
    operatorAbsentSince: "operatorAbsentSince",
    id: "id",
  },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: mocks.getMode,
  setMode: mocks.setMode,
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mocks.insertAuditRowSafe,
}));

vi.mock("../lib/slumhouse/admin-session.js", () => ({
  adminSessionFromCookie:    mocks.adminSessionFromCookie,
  checkPasscode:             vi.fn(),
  isAdminConfigured:         vi.fn(() => true),
  signAdminSession:          vi.fn(),
  adminDiscordUserIdFromCookie: vi.fn(() => undefined),
  ADMIN_COOKIE_NAME:         "slumhouse_admin_sid",
  ADMIN_SESSION_TTL_SEC:     3600,
}));

vi.mock("../services/dead-mans-heartbeat-service.js", () => ({
  clearOperatorAbsenceMarkers: mocks.clearOperatorAbsenceMarkers,
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Chainable drizzle select that resolves .limit() with the given rows. */
function makeSelectChain(rows: unknown[]) {
  const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve(rows) };
  return chain;
}

/**
 * Set up db.select to return responses[i] in order.
 * Used for the learning_loop and vacation_mode reads admin.ts makes in GET.
 */
function setupAdminSelectMock(responses: unknown[][]) {
  let i = 0;
  mocks.dbSelect.mockImplementation(() => makeSelectChain(responses[i++] ?? []));
}

/** Minimal Express-style request with correct headers.cookie shape. */
function makeReq(opts: { body?: Record<string, unknown>; cookie?: string } = {}): unknown {
  return {
    body:    opts.body ?? {},
    headers: { cookie: opts.cookie ?? "slumhouse_admin_sid=test-token" },
  };
}

/** Captured-response mock. getBody() returns `any` for flexible property access in tests. */
function makeRes() {
  let statusCode = 200;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let capturedBody: any = null;
  const res = {
    status: vi.fn().mockImplementation((c: number) => { statusCode = c; return res; }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json:      vi.fn().mockImplementation((b: any) => { capturedBody = b; }),
    getStatus: () => statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getBody:   (): any => capturedBody,
  };
  return res;
}

// ── D. Admin GET /switches — live_execution shape ─────────────────────────────

describe("Admin GET /switches — live_execution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.adminSessionFromCookie.mockReturnValue({ valid: true, userId: "op-1" });
    mocks.getMode.mockResolvedValue("PAUSED");
  });

  afterEach(() => { vi.resetAllMocks(); });

  it("returns needsSetup:true, wired:false, on:false when not configured", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(false);
    mocks.getExecutionMode.mockResolvedValue("paper");
    setupAdminSelectMock([[{ val: "0" }], [{ ts: null }]]);

    const { getSwitchStates } = await import("../routes/slumhouse/admin.js");
    const req = makeReq();
    const res = makeRes();
    await getSwitchStates(req as any, res as any);

    expect(res.getBody().switches.live_execution).toMatchObject({
      on: false,
      wired: false,
      needsSetup: true,
      status: "NEEDS SETUP",
    });
  });

  it("returns wired:true, on:false, status:PAPER when configured but mode=paper", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(true);
    mocks.getExecutionMode.mockResolvedValue("paper");
    setupAdminSelectMock([[{ val: "0" }], [{ ts: null }]]);

    const { getSwitchStates } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await getSwitchStates(makeReq() as any, res as any);

    expect(res.getBody().switches.live_execution).toMatchObject({
      on: false,
      wired: true,
      needsSetup: false,
      status: "PAPER",
    });
  });

  it("returns on:true, state:running, status:LIVE when configured and mode=live", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(true);
    mocks.getExecutionMode.mockResolvedValue("live");
    setupAdminSelectMock([[{ val: "1" }], [{ ts: null }]]);

    const { getSwitchStates } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await getSwitchStates(makeReq() as any, res as any);

    expect(res.getBody().switches.live_execution).toMatchObject({
      on: true,
      state: "running",
      wired: true,
      status: "LIVE",
    });
  });

  it("fails closed to paper when getExecutionMode throws (DB down)", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(true);
    mocks.getExecutionMode.mockRejectedValue(new Error("db down"));
    setupAdminSelectMock([[{ val: "0" }], [{ ts: null }]]);

    const { getSwitchStates } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await getSwitchStates(makeReq() as any, res as any);

    expect(res.getBody().switches.live_execution.on).toBe(false);
    expect(res.getBody().switches.live_execution.status).not.toBe("LIVE");
  });
});

// ── E. Admin POST /switch — live_execution handler ────────────────────────────

describe("Admin POST /switch — live_execution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.adminSessionFromCookie.mockReturnValue({ valid: true, userId: "op-1" });
  });

  afterEach(() => { vi.resetAllMocks(); });

  it("returns 503 when not configured (fail-closed)", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(false);

    const { postSwitch } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "live_execution", on: true } }) as any, res as any);

    expect(res.getStatus()).toBe(503);
    expect(res.getBody().error).toBe("live_execution_not_configured");
    expect(mocks.setExecutionMode).not.toHaveBeenCalled();
  });

  it("returns 503 and hint message when go-live setup is incomplete", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(false);

    const { postSwitch } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "live_execution", on: true } }) as any, res as any);

    expect(res.getBody().hint).toBeTruthy();
  });

  it("calls setExecutionMode(true) and returns on:true, status:LIVE when configured", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(true);
    mocks.setExecutionMode.mockResolvedValue(undefined);

    const { postSwitch } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "live_execution", on: true } }) as any, res as any);

    expect(mocks.setExecutionMode).toHaveBeenCalledWith(true);
    expect(res.getBody()).toMatchObject({ ok: true, on: true, status: "LIVE" });
  });

  it("calls setExecutionMode(false) and returns on:false, status:PAPER", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(true);
    mocks.setExecutionMode.mockResolvedValue(undefined);

    const { postSwitch } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "live_execution", on: false } }) as any, res as any);

    expect(mocks.setExecutionMode).toHaveBeenCalledWith(false);
    expect(res.getBody()).toMatchObject({ ok: true, on: false, status: "PAPER" });
  });

  it("emits an audit row on successful toggle", async () => {
    mocks.isLiveExecutionConfigured.mockReturnValue(true);
    mocks.setExecutionMode.mockResolvedValue(undefined);

    const { postSwitch } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "live_execution", on: true } }) as any, res as any);

    expect(mocks.insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "slumhouse_admin.live_execution_toggled" }),
    );
  });

  it("returns 400 for an unknown switch id", async () => {
    const { postSwitch } = await import("../routes/slumhouse/admin.js");
    const res = makeRes();
    await postSwitch(makeReq({ body: { id: "mystery_switch", on: true } }) as any, res as any);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().error).toBe("unknown_switch");
  });
});

// ── F. assembleCribData — executionMode + executionModeLabel ──────────────────

// crib-data uses db.execute (not db.select) for all its queries.
//
// PAPER mode executes 8 queries in order:
//   today, open, pot, kill, sparkPnl, discord, potRows, crew
//
// LIVE mode skips account-scoped queries (today / open / sparkPnl) — 5 calls:
//   pot, kill, discord, potRows, crew
//
// The mock must be set up to match whichever order is active for the test.

const CRIB_ORDER_PAPER = ["today", "open", "pot", "kill", "sparkPnl", "discord", "potRows", "crew"] as const;
const CRIB_ORDER_LIVE  = ["pot", "kill", "discord", "potRows", "crew"] as const;

function freshCribPaperData() {
  return {
    today:    [{ today_pnl: 500, trades_today: 3, wins: 2, losses: 1 }] as unknown[],
    open:     [{ open_now: 1 }] as unknown[],
    pot:      [{ in_pot: 5 }] as unknown[],
    kill:     [{ value: "true" }] as unknown[],
    sparkPnl: [] as unknown[],
    discord:  [] as unknown[],
    potRows:  [] as unknown[],
    crew:     [] as unknown[],
  };
}

function freshCribLiveData() {
  return {
    pot:      [{ in_pot: 5 }] as unknown[],
    kill:     [{ value: "true" }] as unknown[],
    discord:  [] as unknown[],
    potRows:  [] as unknown[],
    crew:     [] as unknown[],
  };
}

function setupCribExecutePaper() {
  const data = freshCribPaperData();
  let i = 0;
  mocks.dbExecute.mockImplementation(() =>
    Promise.resolve((data as any)[CRIB_ORDER_PAPER[i++]] ?? [])
  );
}

function setupCribExecuteLive() {
  const data = freshCribLiveData();
  let i = 0;
  mocks.dbExecute.mockImplementation(() =>
    Promise.resolve((data as any)[CRIB_ORDER_LIVE[i++]] ?? [])
  );
}

describe("assembleCribData — executionMode fields", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("returns executionMode='paper' and executionModeLabel='PAPER · practice' by default", async () => {
    mocks.getExecutionMode.mockResolvedValue("paper");
    setupCribExecutePaper();

    const { assembleCribData } = await import("../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-aaa000000001" });

    expect(data.executionMode).toBe("paper");
    expect(data.executionModeLabel).toBe("PAPER · practice");
  });

  it("returns executionMode='live' and executionModeLabel='LIVE' in live mode", async () => {
    mocks.getExecutionMode.mockResolvedValue("live");
    setupCribExecuteLive();

    const { assembleCribData } = await import("../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-aaa000000002" });

    expect(data.executionMode).toBe("live");
    expect(data.executionModeLabel).toBe("LIVE");
  });

  it("zeroes account-scoped banner stats in live mode (never paper numbers while claiming live)", async () => {
    mocks.getExecutionMode.mockResolvedValue("live");
    setupCribExecuteLive();

    const { assembleCribData } = await import("../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-aaa000000003" });

    // Paper data from DB must not leak into live view
    expect(data.banner.todayBagRaw).toBe(0);
    expect(data.banner.todayBag).toBe("+$0");
    expect(data.banner.tradesToday.count).toBe(0);
    expect(data.banner.tradesToday.wins).toBe(0);
    expect(data.banner.tradesToday.losses).toBe(0);
    expect(data.banner.openNow).toBe(0);
    expect(data.banner.todayBagSpark).toEqual([]);
    expect(data.banner.tradesSpark).toEqual([]);
  });

  it("still returns global stats (inPot, killSwitch) in live mode", async () => {
    mocks.getExecutionMode.mockResolvedValue("live");
    // Live mode skips today/open/sparkPnl — first execute call is pot
    setupCribExecuteLive();

    const { assembleCribData } = await import("../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-aaa000000004" });

    expect(data.banner.inPot).toBe(5);
    expect(data.banner.killSwitch).toBe("green");
  });

  it("fails closed to paper when getExecutionMode() throws — assembleCribData never throws", async () => {
    mocks.getExecutionMode.mockRejectedValue(new Error("mode-fetch-exploded"));
    setupCribExecutePaper(); // falls back to paper — runs paper order

    const { assembleCribData } = await import("../lib/slumhouse/crib-data.js");
    // Must not throw
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-aaa000000005" });

    expect(data.executionMode).toBe("paper");
    expect(data.executionModeLabel).toBe("PAPER · practice");
  });

  it("paper mode returns real account-scoped stats (normal behavior unchanged)", async () => {
    mocks.getExecutionMode.mockResolvedValue("paper");
    setupCribExecutePaper();

    const { assembleCribData } = await import("../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-aaa000000006" });

    // paper mode: today_pnl=500 from fresh crib data should come through
    expect(data.banner.todayBagRaw).toBe(500);
    expect(data.banner.todayBag).toBe("+$500");
    expect(data.banner.tradesToday.count).toBe(3);
    expect(data.banner.tradesToday.wins).toBe(2);
  });
});
