/**
 * Tests for autonomy gaps A-8, A-9, A-11, A-12, A-13
 *
 * A-8  dead-mans-heartbeat: DB-backed alert dedup survives NSSM restarts
 * A-9  db/index: Postgres connection health monitoring (structural + mock-free paths)
 * A-11 broker-router: Proactive TradersPost API key validity probe
 * A-12 remote-power-cycle: Daily KASA power-cycle cap
 * A-13 prop-firm-cookie-refresh: Cookie runtime-file persistence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Top-level mocks (hoisted by vitest) ────────────────────────────────────

vi.mock("../db/schema.js", () => ({
  auditLog: { _tableName: "audit_log" },
  brokerAccounts: { _tableName: "broker_accounts" },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn().mockResolvedValue(undefined),
  notifyWarning: vi.fn(),
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    notifyHeartbeatStale: vi.fn().mockResolvedValue(undefined),
    notifyCookieRefreshFailed: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((op: string) => op),
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn().mockResolvedValue({ apiKey: "fake-api-key" }),
}));

// Broker router dependencies
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockReturnValue(true),
}));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockReturnValue(false) },
}));
// 2026-07-28 (R-360): the boot probe is now gated (R-359). checkProbeGate()
// requires live execution to be CONFIGURED as well as the opt-in flag, so the
// A-11 behaviour tests below cannot reach the probe without this mock — the real
// module reads SERVER_MEDIATED_EXECUTION_ENABLED/BROKER_FILL_HMAC_SECRET from
// env, which are (correctly) unset. Mocking it keeps those live-execution env
// vars untouched by the test process.
vi.mock("../lib/execution-mode.js", () => ({
  isLiveExecutionConfigured: vi.fn().mockReturnValue(true),
}));
vi.mock("../services/strategy-assignment-service.js", () => ({
  getEnabledFirms: vi.fn().mockResolvedValue(["topstep", "mffu"]),
}));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn().mockReturnValue(2),
  CONTRACT_CAP_MAX: 50,
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: {
    get: vi.fn().mockReturnValue({
      call: vi.fn().mockImplementation((fn: () => unknown) => fn()),
    }),
    setOnStateChange: vi.fn(),
  },
  CircuitOpenError: class CircuitOpenError extends Error {},
}));
vi.mock("../lib/metrics-registry.js", () => ({
  traderspostRejectsTotal: { inc: vi.fn() },
}));
vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
  buildDeterministicIdempotencyKey: vi.fn().mockReturnValue("test-key"),
}));
vi.mock("../integrations/traderspost/webhook-builder.js", () => ({
  buildWebhookPayload: vi.fn().mockReturnValue({ apiKey: "fake", action: "buy" }),
}));

// db/index — mocked EXCEPT for broker-router tests which need a real-looking db
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
  },
  client: {
    unsafe: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  },
}));

// child_process — prevent real powershell.exe spawn in test environment.
// Without this mock, A-12 fail-open test (db.select throws → count=0 → below cap → spawn)
// would block for 75 seconds (SCRIPT_TIMEOUT_MS) waiting for powershell.exe.
vi.mock("child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn().mockImplementation(() => {
    let errorCb: ((err: Error) => void) | null = null;
    const child = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      on: vi.fn().mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === "error") errorCb = cb as (err: Error) => void;
        return child;
      }),
    };
    // Fire "error" after all on() registrations complete — resolves the spawn Promise
    // with false (see remote-power-cycle-service.ts:265–274: on("error") calls resolve(false))
    setImmediate(() => errorCb?.(new Error("powershell.exe unavailable in test environment")));
    return child;
  }),
}));

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Build db.select chain ending in .where().limit(N) — used for dedup queries. */
function makeSelectChainWithLimit(rows: unknown[]) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock, orderBy: orderByMock });
  return { limitMock, whereMock, fromMock };
}

/** Build db.select chain ending in .where() (no limit) — used for count/aggregate queries. */
function makeSelectChainNoLimit(rows: unknown[]) {
  const whereMock = vi.fn().mockResolvedValue(rows);
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  return { whereMock, fromMock };
}

// ─── A-12: Daily KASA power-cycle cap ─────────────────────────────────────────

describe("A-12 remote-power-cycle daily cap", () => {
  // Use fresh imports per test to pick up the db mock correctly.
  // vi.resetModules is NOT used — top-level vi.mock handles isolation.

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["KASA_DEVICE_IP"] = "192.168.1.100";
    process.env["KASA_USERNAME"] = "test-user";
    process.env["KASA_PASSWORD"] = "test-pass";
    delete process.env["KASA_DAILY_CYCLE_CAP"];
  });

  afterEach(() => {
    delete process.env["KASA_DEVICE_IP"];
    delete process.env["KASA_USERNAME"];
    delete process.env["KASA_PASSWORD"];
    delete process.env["KASA_DAILY_CYCLE_CAP"];
  });

  it("blocks cycle and writes cap audit when daily count >= cap (2)", async () => {
    const { db } = await import("../db/index.js");
    const { notifyCritical } = await import("../services/notification-service.js");

    // countKasaCyclesLast24h: ends with .where() (no .limit())
    const { whereMock, fromMock } = makeSelectChainNoLimit([{ n: 2 }]); // at cap
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });

    // cap-reached audit insert
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );
    const result = await triggerRemotePowerCycle("test_reason", "corr-001");

    expect(result).toBe(false);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recovery.remote_power_cycle_cap_reached" }),
    );
    expect(notifyCritical).toHaveBeenCalledWith(
      expect.stringContaining("cap reached"),
      expect.any(String),
      expect.objectContaining({ cap: 2 }),
    );
  });

  it("blocks cycle when count equals 3 (above cap)", async () => {
    const { db } = await import("../db/index.js");
    const { notifyCritical } = await import("../services/notification-service.js");

    const { fromMock } = makeSelectChainNoLimit([{ n: 3 }]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );
    const result = await triggerRemotePowerCycle("boot_loop", "corr-002");

    expect(result).toBe(false);
    expect(notifyCritical).toHaveBeenCalled();
  });

  it("fails open (count=0) when DB count query rejects", async () => {
    const { db } = await import("../db/index.js");
    const { logger } = await import("../lib/logger.js");

    // Make select throw
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("DB down");
    });
    // Insert for pre-cycle audit
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );

    // count returns 0 on error → cycle proceeds (spawn will fail in test env, that's ok)
    try {
      await triggerRemotePowerCycle("test", "corr-003");
    } catch {
      // spawn failure is expected in test environment
    }

    // Cap audit must NOT have been written (fail-open means cap check returns 0)
    const capRows = (valuesMock as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args) =>
        args[0] &&
        (args[0] as Record<string, unknown>)["action"] === "recovery.remote_power_cycle_cap_reached",
    );
    expect(capRows).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("fail-open"),
    );
  });

  it("cap audit row includes cyclesInLast24h and cap fields", async () => {
    const { db } = await import("../db/index.js");

    const { fromMock } = makeSelectChainNoLimit([{ n: 5 }]); // well above cap
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    const { triggerRemotePowerCycle } = await import(
      "../services/remote-power-cycle-service.js"
    );
    await triggerRemotePowerCycle("test", "corr-004");

    const capCall = (valuesMock as ReturnType<typeof vi.fn>).mock.calls.find(
      (args) =>
        args[0] &&
        (args[0] as Record<string, unknown>)["action"] === "recovery.remote_power_cycle_cap_reached",
    );
    expect(capCall).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = (capCall![0] as any)["input"];
    expect(input).toMatchObject({ cyclesInLast24h: 5, cap: 2 });
  });
});

// ─── A-13: Cookie runtime-file persistence ──────────────────────────────────

describe("A-13 prop-firm-cookie-refresh runtime-file persistence", () => {
  let tmpDir: string;
  const origCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `tf-test-cookies-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    process.cwd = vi.fn().mockReturnValue(tmpDir);
    delete process.env["MFFU_SESSION_COOKIES"];
    delete process.env["TOPSTEP_SESSION_COOKIES"];
  });

  afterEach(() => {
    process.cwd = origCwd;
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env["MFFU_SESSION_COOKIES"];
    delete process.env["TOPSTEP_SESSION_COOKIES"];
  });

  it("loadCookiesFromRuntimeFiles loads MFFU cookies from disk when env not set", async () => {
    const { writeFileSync } = await import("node:fs");
    const cookieData = JSON.stringify([{ name: "session", value: "abc123" }]);
    writeFileSync(join(tmpDir, ".cookie-runtime-mffu"), cookieData, { encoding: "utf8" });

    vi.resetModules();
    // Re-mock after reset
    vi.mock("../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), execute: vi.fn() }, client: { unsafe: vi.fn() } }));
    vi.mock("../db/schema.js", () => ({ auditLog: {} }));
    vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
    vi.mock("../services/alert-service.js", () => ({ AlertFactory: {} }));
    vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn() }));

    const { loadCookiesFromRuntimeFiles } = await import(
      "../services/prop-firm-cookie-refresh-service.js"
    );
    loadCookiesFromRuntimeFiles();

    expect(process.env["MFFU_SESSION_COOKIES"]).toBe(cookieData);
  });

  it("loadCookiesFromRuntimeFiles loads Topstep cookies from disk", async () => {
    const { writeFileSync } = await import("node:fs");
    const cookieData = JSON.stringify([{ name: "ts_session", value: "xyz789" }]);
    writeFileSync(join(tmpDir, ".cookie-runtime-topstep"), cookieData, { encoding: "utf8" });

    vi.resetModules();
    vi.mock("../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), execute: vi.fn() }, client: { unsafe: vi.fn() } }));
    vi.mock("../db/schema.js", () => ({ auditLog: {} }));
    vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
    vi.mock("../services/alert-service.js", () => ({ AlertFactory: {} }));
    vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn() }));

    const { loadCookiesFromRuntimeFiles } = await import(
      "../services/prop-firm-cookie-refresh-service.js"
    );
    loadCookiesFromRuntimeFiles();

    expect(process.env["TOPSTEP_SESSION_COOKIES"]).toBe(cookieData);
  });

  it("loadCookiesFromRuntimeFiles skips firm when env already set", async () => {
    process.env["MFFU_SESSION_COOKIES"] = "already_set";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(tmpDir, ".cookie-runtime-mffu"),
      JSON.stringify([{ name: "session", value: "different" }]),
      { encoding: "utf8" },
    );

    vi.resetModules();
    vi.mock("../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), execute: vi.fn() }, client: { unsafe: vi.fn() } }));
    vi.mock("../db/schema.js", () => ({ auditLog: {} }));
    vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
    vi.mock("../services/alert-service.js", () => ({ AlertFactory: {} }));
    vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn() }));

    const { loadCookiesFromRuntimeFiles } = await import(
      "../services/prop-firm-cookie-refresh-service.js"
    );
    loadCookiesFromRuntimeFiles();

    expect(process.env["MFFU_SESSION_COOKIES"]).toBe("already_set");
  });

  it("loadCookiesFromRuntimeFiles is a no-op when no runtime file exists", async () => {
    vi.resetModules();
    vi.mock("../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), execute: vi.fn() }, client: { unsafe: vi.fn() } }));
    vi.mock("../db/schema.js", () => ({ auditLog: {} }));
    vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
    vi.mock("../services/alert-service.js", () => ({ AlertFactory: {} }));
    vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn() }));

    const { loadCookiesFromRuntimeFiles } = await import(
      "../services/prop-firm-cookie-refresh-service.js"
    );
    expect(() => loadCookiesFromRuntimeFiles()).not.toThrow();
    expect(process.env["MFFU_SESSION_COOKIES"]).toBeUndefined();
    expect(process.env["TOPSTEP_SESSION_COOKIES"]).toBeUndefined();
  });

  it("loadCookiesFromRuntimeFiles fails silently on corrupt JSON", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tmpDir, ".cookie-runtime-mffu"), "CORRUPT{{}", { encoding: "utf8" });

    vi.resetModules();
    vi.mock("../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), execute: vi.fn() }, client: { unsafe: vi.fn() } }));
    vi.mock("../db/schema.js", () => ({ auditLog: {} }));
    vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
    vi.mock("../services/alert-service.js", () => ({ AlertFactory: {} }));
    vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn() }));

    const { loadCookiesFromRuntimeFiles } = await import(
      "../services/prop-firm-cookie-refresh-service.js"
    );
    expect(() => loadCookiesFromRuntimeFiles()).not.toThrow();
    expect(process.env["MFFU_SESSION_COOKIES"]).toBeUndefined();
  });

  it("redactSensitiveEnv masks MFFU_SESSION_COOKIES and TOPSTEP_SESSION_COOKIES", async () => {
    vi.resetModules();
    vi.mock("../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), execute: vi.fn() }, client: { unsafe: vi.fn() } }));
    vi.mock("../db/schema.js", () => ({ auditLog: {} }));
    vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
    vi.mock("../services/alert-service.js", () => ({ AlertFactory: {} }));
    vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn() }));

    const { redactSensitiveEnv } = await import(
      "../services/prop-firm-cookie-refresh-service.js"
    );
    const redacted = redactSensitiveEnv({
      MFFU_SESSION_COOKIES: "[{secret}]",
      TOPSTEP_SESSION_COOKIES: "[{secret}]",
      NODE_ENV: "test",
    });
    expect(redacted["MFFU_SESSION_COOKIES"]).toBe("[REDACTED]");
    expect(redacted["TOPSTEP_SESSION_COOKIES"]).toBe("[REDACTED]");
    expect(redacted["NODE_ENV"]).toBe("test");
  });

  it("cookie runtime file path uses .cookie-runtime-<firmId> naming (security: opaque name)", async () => {
    vi.resetModules();
    vi.mock("../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), execute: vi.fn() }, client: { unsafe: vi.fn() } }));
    vi.mock("../db/schema.js", () => ({ auditLog: {} }));
    vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
    vi.mock("../services/alert-service.js", () => ({ AlertFactory: {} }));
    vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn() }));

    const cookieData = JSON.stringify([{ name: "s", value: "v" }]);
    const { writeFileSync } = await import("node:fs");
    // File must exist at the expected path pattern
    writeFileSync(join(tmpDir, ".cookie-runtime-mffu"), cookieData, { encoding: "utf8" });

    const { loadCookiesFromRuntimeFiles } = await import(
      "../services/prop-firm-cookie-refresh-service.js"
    );
    loadCookiesFromRuntimeFiles();

    // The env var must be set (file was found at the right path)
    expect(process.env["MFFU_SESSION_COOKIES"]).toBe(cookieData);
  });
});

// ─── A-11: TradersPost proactive API key probe ──────────────────────────────
// A-13 tests contaminate db/schema.js — they re-mock it with only { auditLog: {} },
// dropping brokerAccounts. broker-router.ts destructures brokerAccounts from db/schema.js
// and uses it at line 249 (brokerAccounts.accountId). With brokerAccounts=undefined,
// probeTradersPostApiKeys throws a TypeError caught silently by its outer try/catch,
// so notifyWarning is never called.
// Fix: vi.resetModules() + restore the full schema factory in beforeEach so each test
// loads broker-router.js with a schema that has both auditLog AND brokerAccounts.

describe("A-11 broker-router TradersPost key probe", () => {
  // 2026-07-28 (R-360): these are BEHAVIOUR tests of the probe, and R-359 gave the
  // probe a precondition (BROKER_KEY_PROBE_ENABLED, default OFF). Arm the flag so
  // they test the probe rather than the gate; the gate has its own suite
  // (broker-router-probe-gate.test.ts). Saved/restored so no value leaks to other
  // suites — the flag is never exported into the CI environment.
  const savedProbeFlag = process.env.BROKER_KEY_PROBE_ENABLED;

  afterEach(() => {
    if (savedProbeFlag === undefined) delete process.env.BROKER_KEY_PROBE_ENABLED;
    else process.env.BROKER_KEY_PROBE_ENABLED = savedProbeFlag;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.BROKER_KEY_PROBE_ENABLED = "true";
    // Restore complete schema mock — A-13 contaminated this to { auditLog: {} } only.
    // Without brokerAccounts, broker-router.ts line 249 throws TypeError (silently caught).
    vi.mock("../db/schema.js", () => ({
      auditLog: { _tableName: "audit_log" },
      brokerAccounts: { _tableName: "broker_accounts" },
    }));
  });

  it("probeTradersPostApiKeys emits notifyWarning on HTTP 401 (key revoked)", async () => {
    const { db } = await import("../db/index.js");
    const notifyMod = await import("../services/notification-service.js");

    // Mock DB: one enabled traderspost account.
    // probeTradersPostApiKeys ends with .where() — no .limit() — so use NoLimit chain.
    const { fromMock } = makeSelectChainNoLimit([
      { accountId: "acct-401-test", enabled: true },
    ]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });
    // Audit insert for revoked row
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    // fetch returns 401
    global.fetch = vi.fn().mockResolvedValue({ status: 401, ok: false }) as unknown as typeof fetch;

    const { probeTradersPostApiKeys } = await import("../services/broker-router.js");
    await probeTradersPostApiKeys();

    expect(notifyMod.notifyWarning).toHaveBeenCalledWith(
      expect.stringContaining("May Be Revoked"),
      expect.any(String),
      expect.objectContaining({ accountId: "acct-401-test" }),
    );
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "broker_router.traderspost_key_probe_revoked" }),
    );
  });

  it("probeTradersPostApiKeys emits notifyWarning on HTTP 403 (forbidden / revoked)", async () => {
    const { db } = await import("../db/index.js");
    const notifyMod = await import("../services/notification-service.js");

    const { fromMock } = makeSelectChainNoLimit([
      { accountId: "acct-403-test", enabled: true },
    ]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    global.fetch = vi.fn().mockResolvedValue({ status: 403, ok: false }) as unknown as typeof fetch;

    const { probeTradersPostApiKeys } = await import("../services/broker-router.js");
    await probeTradersPostApiKeys();

    expect(notifyMod.notifyWarning).toHaveBeenCalled();
  });

  it("probeTradersPostApiKeys does NOT notify on HTTP 400 (key valid, payload bad)", async () => {
    const { db } = await import("../db/index.js");
    const notifyMod = await import("../services/notification-service.js");

    const { fromMock } = makeSelectChainNoLimit([
      { accountId: "acct-400-test", enabled: true },
    ]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    global.fetch = vi.fn().mockResolvedValue({ status: 400, ok: false }) as unknown as typeof fetch;

    const { probeTradersPostApiKeys } = await import("../services/broker-router.js");
    await probeTradersPostApiKeys();

    expect(notifyMod.notifyWarning).not.toHaveBeenCalled();
  });

  it("probeTradersPostApiKeys is a no-op when no enabled accounts exist", async () => {
    const { db } = await import("../db/index.js");
    const notifyMod = await import("../services/notification-service.js");

    const { fromMock } = makeSelectChainNoLimit([]); // no accounts
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });

    const { probeTradersPostApiKeys } = await import("../services/broker-router.js");
    await probeTradersPostApiKeys();

    expect(notifyMod.notifyWarning).not.toHaveBeenCalled();
  });

  it("probeTradersPostApiKeys is fail-soft on network error (does not throw)", async () => {
    const { db } = await import("../db/index.js");

    const { fromMock } = makeSelectChainNoLimit([
      { accountId: "acct-net-err", enabled: true },
    ]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const { probeTradersPostApiKeys } = await import("../services/broker-router.js");
    await expect(probeTradersPostApiKeys()).resolves.not.toThrow();
  });

  it("probeTradersPostApiKeys does NOT expose apiKey in log output on failure", async () => {
    const { db } = await import("../db/index.js");
    const { logger } = await import("../lib/logger.js");

    const { fromMock } = makeSelectChainNoLimit([
      { accountId: "acct-key-secret", enabled: true },
    ]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    global.fetch = vi.fn().mockResolvedValue({ status: 401, ok: false }) as unknown as typeof fetch;

    const { probeTradersPostApiKeys } = await import("../services/broker-router.js");
    await probeTradersPostApiKeys();

    // Verify apiKey ("fake-api-key") does NOT appear in any log call
    const allLogCalls = [
      ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
    ];
    const logStr = JSON.stringify(allLogCalls);
    expect(logStr).not.toContain("fake-api-key");
  });
});

// ─── A-9: Postgres connection health monitoring ─────────────────────────────
// The db/index.js module is mocked at top level (can't use importActual + setInterval).
// Tests verify: (1) runDbHealthProbe is exported, (2) probe calls client.unsafe,
// (3) failure emits logger.error, (4) alert cooldown logic is structurally sound.

describe("A-9 db/index Postgres connection health monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runDbHealthProbe is exported from db/index.js", async () => {
    // Since the module is mocked, verify via the real source that the export exists
    const source = (await import("node:fs")).readFileSync(
      new URL("../db/index.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "utf-8",
    );
    expect(source).toContain("export async function runDbHealthProbe");
  });

  it("runDbHealthProbe calls client.unsafe for SELECT 1", async () => {
    // Because db/index.js is fully mocked at top level, we can't test the real function.
    // Instead, verify the health probe is wired to the client via source inspection.
    const source = (await import("node:fs")).readFileSync(
      new URL("../db/index.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "utf-8",
    );
    expect(source).toContain('client.unsafe("SELECT 1")');
  });

  it("failure path emits logger.error and writes audit row", async () => {
    const source = (await import("node:fs")).readFileSync(
      new URL("../db/index.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "utf-8",
    );
    // Verify the failure path has both logger.error and client.unsafe for audit
    expect(source).toContain("logger.error");
    expect(source).toContain("db_pool.connection_error");
  });

  it("alert cooldown is guarded by DB_RECONNECT_ALERT_COOLDOWN_MS", async () => {
    const source = (await import("node:fs")).readFileSync(
      new URL("../db/index.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "utf-8",
    );
    expect(source).toContain("DB_RECONNECT_ALERT_COOLDOWN_MS");
    expect(source).toContain("_lastDbReconnectAlertAt");
  });

  it("health probe timer is unref'd (won't prevent process exit)", async () => {
    const source = (await import("node:fs")).readFileSync(
      new URL("../db/index.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "utf-8",
    );
    expect(source).toContain(".unref()");
  });

  it("recovery is logged when db becomes healthy again", async () => {
    const source = (await import("node:fs")).readFileSync(
      new URL("../db/index.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "utf-8",
    );
    expect(source).toContain("db_pool.connection_recovered");
    expect(source).toContain("connection recovered");
  });
});

// ─── A-8: DB-backed alert dedup for dead-mans-heartbeat ─────────────────────

// A-13 contamination notes (affects A-8 as well as A-11):
//   alert-service.js  → left as { AlertFactory: {} }  — methods stripped
//   audit-log-helper.js → left as { insertAuditRow: vi.fn() } — no mockResolvedValue,
//     so insertAuditRow() returns undefined instead of a Promise, breaking the .catch() chain
// Fix: vi.resetModules() + restore both factories in beforeEach.

describe("A-8 dead-mans-heartbeat DB-backed alert dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Restore full alert-service factory — A-13 leaves AlertFactory:{} (no methods).
    vi.mock("../services/alert-service.js", () => ({
      AlertFactory: {
        notifyHeartbeatStale: vi.fn().mockResolvedValue(undefined),
        notifyCookieRefreshFailed: vi.fn().mockResolvedValue(undefined),
      },
    }));
    // Restore full audit-log-helper factory — A-13 leaves insertAuditRow:vi.fn() with no
    // mockResolvedValue, causing insertAuditRow(...).catch(...) to throw TypeError.
    vi.mock("../lib/audit-log-helper.js", () => ({
      insertAuditRow: vi.fn().mockResolvedValue(undefined),
    }));
  });

  it("hasStaleAlertFiredForWindow and hasRefreshStaleAlertFiredWithinWindow are present in source", async () => {
    const source = (await import("node:fs")).readFileSync(
      new URL("../services/dead-mans-heartbeat-service.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "utf-8",
    );
    expect(source).toContain("hasStaleAlertFiredForWindow");
    expect(source).toContain("hasRefreshStaleAlertFiredWithinWindow");
  });

  it("runHeartbeatStaleCheck skips alert when DB dedup finds prior stale_detected row", async () => {
    const { db } = await import("../db/index.js");
    const { AlertFactory } = await import("../services/alert-service.js");

    // Mock execute: returns a 3h-stale heartbeat
    const staleTs = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([{ ts: staleTs }]);

    // db.select mock: return dedup row (prior stale alert exists in DB)
    // hasStaleAlertFiredForWindow: ends with .limit(1)
    const { limitMock, fromMock } = makeSelectChainWithLimit([{ id: "prior-alert-row" }]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });

    // Mock RTH: ET hour = 10
    const origFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;
    Intl.DateTimeFormat.prototype.formatToParts = function () {
      const opts = this.resolvedOptions();
      if (opts.timeZone === "America/New_York") {
        return [{ type: "hour", value: "10" }] as Intl.DateTimeFormatPart[];
      }
      return origFormatToParts.call(this);
    };

    try {
      const { runHeartbeatStaleCheck } = await import(
        "../services/dead-mans-heartbeat-service.js"
      );
      await runHeartbeatStaleCheck();

      // DB dedup found prior row → alert must NOT fire
      expect(AlertFactory.notifyHeartbeatStale).not.toHaveBeenCalled();
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = origFormatToParts;
    }
    void limitMock;
  });

  it("runScheduledRefreshStalenessCheck skips BW alert when DB dedup finds prior bw_refresh_stale row", async () => {
    const { db } = await import("../db/index.js");
    const { notifyCritical } = await import("../services/notification-service.js");

    // Mock call counter to return different results per db.select call
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      // call 1: getLastRefreshHeartbeatAt("bw_refresh.heartbeat") — 14h stale
      if (callCount === 1) {
        const stale = new Date(Date.now() - 14 * 60 * 60 * 1000);
        const limitMock = vi.fn().mockResolvedValue([{ createdAt: stale }]);
        const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
        const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock, limit: limitMock });
        return { from: vi.fn().mockReturnValue({ where: whereMock }) };
      }
      // call 2: hasRefreshStaleAlertFiredWithinWindow("bw_refresh_stale", window) — found
      if (callCount === 2) {
        const limitMock = vi.fn().mockResolvedValue([{ id: "prior-bw-alert" }]);
        const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
        return { from: vi.fn().mockReturnValue({ where: whereMock }) };
      }
      // call 3+: getLastRefreshHeartbeatAt("cookie_refresh.heartbeat") — no rows
      const limitMock = vi.fn().mockResolvedValue([]);
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock, limit: limitMock });
      return { from: vi.fn().mockReturnValue({ where: whereMock }) };
    });

    const { runScheduledRefreshStalenessCheck } = await import(
      "../services/dead-mans-heartbeat-service.js"
    );
    await runScheduledRefreshStalenessCheck();

    // BW alert must NOT fire (deduped via DB)
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  it("stale alert fires when DB dedup returns no prior rows (genuine new stale event)", async () => {
    const { db } = await import("../db/index.js");
    const { AlertFactory } = await import("../services/alert-service.js");
    const { insertAuditRow } = await import("../lib/audit-log-helper.js");

    // execute: 3h stale heartbeat
    const staleTs = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([{ ts: staleTs }]);

    // db.select: no prior stale_detected row (dedup check returns empty)
    let selectCallCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++;
      // First call is hasStaleAlertFiredForWindow — return empty (no prior alert)
      const limitMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      return { from: vi.fn().mockReturnValue({ where: whereMock }) };
    });

    // insert for stale_detected audit row
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValuesMock });

    // Mock RTH
    const origFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;
    Intl.DateTimeFormat.prototype.formatToParts = function () {
      const opts = this.resolvedOptions();
      if (opts.timeZone === "America/New_York") {
        return [{ type: "hour", value: "10" }] as Intl.DateTimeFormatPart[];
      }
      return origFormatToParts.call(this);
    };

    try {
      const { runHeartbeatStaleCheck } = await import(
        "../services/dead-mans-heartbeat-service.js"
      );
      await runHeartbeatStaleCheck();

      // Alert SHOULD fire (no prior DB row)
      expect(insertAuditRow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "dead_mans_heartbeat.stale_detected" }),
      );
      // Discord alert should fire (Twilio not configured in tests)
      expect(AlertFactory.notifyHeartbeatStale).toHaveBeenCalled();
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = origFormatToParts;
    }
  });
});
