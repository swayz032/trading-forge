/**
 * failure-injection-dead-mans-heartbeat-kasa-escalation.test.ts
 *
 * FAILURE-INJECTION coverage for incident class #4 of the autonomous-readiness
 * fault-injection campaign (2026-07-12): dead-man's heartbeat sustained
 * silence -> auto-restart attempt sequence -> after 3 failed restarts within
 * 24h, the KASA remote-power-cycle escape valve is invoked (or, when KASA is
 * unset, the terminal Discord CRITICAL fires so a human must physically
 * intervene — the vacation-mode contract's honest fallback).
 *
 * Gap this file closes: the existing suite
 * (src/server/__tests__/dead-mans-heartbeat.test.ts, "blocks the 4th attempt
 * when 3 audit rows exist in last 24h") proves the auto-restart CAP blocks a
 * 4th self-restart POST — but it does NOT set KASA_DEVICE_IP, so it never
 * exercises the branch in attemptAutoRestart() (dead-mans-heartbeat-
 * service.ts ~lines 722-767) that imports remote-power-cycle-service.ts and
 * calls triggerRemotePowerCycle(). That branch is the actual hands-off
 * recovery path this campaign must prove FIRES, not just exist.
 *
 * Injects: sustained stale-heartbeat state (>2h old) + 3 prior 24h auto-
 * restart attempts (the cap-reached state), with KASA_DEVICE_IP/USERNAME/
 * PASSWORD all set, and asserts triggerRemotePowerCycle() is ACTUALLY CALLED
 * — then the negative control: same stale state with KASA unset, asserting
 * the terminal Discord CRITICAL fires INSTEAD (never both, never neither).
 *
 * DO NOT EDIT SOURCE FROM THIS FILE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (mirrors dead-mans-heartbeat.test.ts's established pattern) ───────

vi.mock("../db/index.js", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  },
}));
vi.mock("../db/schema.js", () => ({
  auditLog: { _tableName: "audit_log" },
}));
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    notifyHeartbeatStale: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn().mockResolvedValue(undefined),
  notifyWarning: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The escape-valve module under test — this is the OBSERVABLE SIDE EFFECT
// we assert on. We do not want the real spawn(powershell.exe, ...) to run in
// CI, so we mock the module boundary, not the decision to call it.
vi.mock("../services/remote-power-cycle-service.js", () => ({
  triggerRemotePowerCycle: vi.fn().mockResolvedValue(true),
}));

import { db } from "../db/index.js";
import { notifyCritical } from "../services/notification-service.js";
import { triggerRemotePowerCycle } from "../services/remote-power-cycle-service.js";

// ─── ET hour control (copied convention from dead-mans-heartbeat.test.ts) ────

let _etHour = 13;
const _origFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;

function setupDateMock() {
  Intl.DateTimeFormat.prototype.formatToParts = function (
    date?: Date | number,
  ): Intl.DateTimeFormatPart[] {
    const resolvedOptions = this.resolvedOptions();
    if (
      (resolvedOptions.timeZone === "America/New_York" && resolvedOptions.hourCycle === "h23") ||
      (resolvedOptions.hour !== undefined && resolvedOptions.timeZone === "America/New_York")
    ) {
      return [{ type: "hour", value: String(_etHour) }] as Intl.DateTimeFormatPart[];
    }
    return _origFormatToParts.call(this, date);
  };
}
function teardownDateMock() {
  Intl.DateTimeFormat.prototype.formatToParts = _origFormatToParts;
}

let _staleOffsetMs = 0;
function uniqueStaleTs(): string {
  _staleOffsetMs += 10_000;
  return new Date(Date.now() - 3 * 60 * 60 * 1000 - _staleOffsetMs).toISOString();
}

describe("FAILURE-INJECTION: dead-man's heartbeat -> 3 failed restarts -> KASA escape valve (incident class #4)", () => {
  let origFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _etHour = 13;
    setupDateMock();
    (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([]);
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    });
    origFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    process.env["ADMIN_RESTART_HMAC_SECRET"] = "test-secret-32-chars-xxxxxxxxxxxx";
  });

  afterEach(() => {
    teardownDateMock();
    globalThis.fetch = origFetch;
    delete process.env["ADMIN_RESTART_HMAC_SECRET"];
    delete process.env["KASA_DEVICE_IP"];
    delete process.env["KASA_USERNAME"];
    delete process.env["KASA_PASSWORD"];
  });

  /**
   * Wires db.select so every *dedup* query (hasStaleAlertFiredForWindow,
   * hasAutoRestartAttemptedForWindow — both project `{ id: auditLog.id }` and
   * chain `.limit(1)`) returns "no prior row", while the *count* query
   * (countAutoRestartAttemptsLast24h, projects `{ n: count() }`, no
   * `.limit()`) returns the injected 24h attempt count. Routed by inspecting
   * the actual field-projection object each call site passes to
   * `db.select(...)` — this is ROBUST to call ORDER (unlike an index-based
   * mock), which matters here because hasStaleAlertFiredForWindow's dedup
   * check is ALSO a db.select() call that runs before the auto-restart path
   * on a fresh (no prior _lastAlertedForTs) run, shifting naive index-based
   * assumptions.
   */
  function injectAutoRestartAttemptsLast24h(n: number) {
    (db as typeof db & { select?: ReturnType<typeof vi.fn> }).select = vi.fn().mockImplementation(
      (fields?: Record<string, unknown>) => {
        const isCountQuery = fields != null && Object.prototype.hasOwnProperty.call(fields, "n");
        if (isCountQuery) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue([{ n }]) }) };
        }
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) };
      },
    );
  }

  it("INJECTED: sustained stale heartbeat + 3 prior 24h auto-restart attempts + KASA fully configured -> triggerRemotePowerCycle() is ACTUALLY CALLED (not just 'cap reached' logged)", async () => {
    process.env["KASA_DEVICE_IP"] = "192.168.1.42";
    process.env["KASA_USERNAME"] = "test@example.com";
    process.env["KASA_PASSWORD"] = "test-password";

    const staleTs = uniqueStaleTs();
    (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: staleTs }]);
    const insertValues = vi.fn().mockResolvedValue([]);
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({ values: insertValues });

    // Inject the failure STATE: 3 auto-restart attempts already fired in the
    // last 24h (the documented cap per CLAUDE.md §15a / A-1 guard rails).
    injectAutoRestartAttemptsLast24h(3);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
    await runHeartbeatStaleCheck();

    // RESPONSE: the self-restart HTTP path must NOT fire again (cap reached)...
    const selfRestartCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("/api/admin/self-restart"),
    );
    expect(selfRestartCalls.length).toBe(0);
    // ...AND the hands-off physical-recovery escape valve MUST have actually
    // been invoked — this is the assertion a "cap reached, alert fired" test
    // would miss (it would pass even if the KASA call were dead code).
    expect(triggerRemotePowerCycle).toHaveBeenCalledTimes(1);
    const [reasonArg, correlationIdArg] = vi.mocked(triggerRemotePowerCycle).mock.calls[0];
    expect(String(reasonArg)).toContain("heartbeat_stale_auto_restart_cap_reached");
    expect(typeof correlationIdArg).toBe("string");
    expect((correlationIdArg as string).length).toBeGreaterThan(0);
  });

  it("NEGATIVE CONTROL: identical stale + cap-reached state but KASA_DEVICE_IP UNSET -> triggerRemotePowerCycle() is NEVER called; terminal Discord CRITICAL fires instead", async () => {
    // Deliberately leave KASA_* unset (afterEach already clears them, this is
    // explicit for readability of the injected state).
    delete process.env["KASA_DEVICE_IP"];
    delete process.env["KASA_USERNAME"];
    delete process.env["KASA_PASSWORD"];

    const staleTs = uniqueStaleTs();
    (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: staleTs }]);
    const insertValues = vi.fn().mockResolvedValue([]);
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({ values: insertValues });

    injectAutoRestartAttemptsLast24h(3);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
    await runHeartbeatStaleCheck();

    // The escape valve must NEVER be invoked when KASA is not configured —
    // calling it with undefined creds would be a silent no-op-that-looks-like
    // a real attempt (worse than not calling it — false confidence).
    expect(triggerRemotePowerCycle).not.toHaveBeenCalled();

    // The FALLBACK must be a real, human-actionable terminal alert — this is
    // the "explicit accepted trade-off" the autonomous-readiness charter
    // requires when no auto-remediation path exists.
    const criticalCalls = vi.mocked(notifyCritical).mock.calls;
    const capReachedCall = criticalCalls.find((c) => String(c[0]).includes("cap reached"));
    expect(capReachedCall).toBeDefined();
    // Family-grade plain-English action must be present in the message body
    // (appendFamilyGradePostscript convention — "Call Tony").
    const messageBody = String(capReachedCall?.[1] ?? "");
    expect(messageBody).toMatch(/Call Tony/i);
  });

  it("INJECTED: only 2 prior attempts (below cap) -> neither the terminal alert NOR the KASA escape valve fires; a normal 3rd self-restart attempt proceeds instead", async () => {
    process.env["KASA_DEVICE_IP"] = "192.168.1.42";
    process.env["KASA_USERNAME"] = "test@example.com";
    process.env["KASA_PASSWORD"] = "test-password";

    const staleTs = uniqueStaleTs();
    (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: staleTs }]);
    const insertValues = vi.fn().mockResolvedValue([]);
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({ values: insertValues });

    injectAutoRestartAttemptsLast24h(2); // below the 3-attempt cap
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
    await runHeartbeatStaleCheck();

    // The normal (3rd) self-restart attempt proceeds — the ladder has not yet
    // exhausted its retries, so KASA must not fire prematurely.
    const selfRestartCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("/api/admin/self-restart"),
    );
    expect(selfRestartCalls.length).toBeGreaterThanOrEqual(1);
    expect(triggerRemotePowerCycle).not.toHaveBeenCalled();
  });

  it("GAP-FOUND-CHECK: when triggerRemotePowerCycle() itself throws (e.g. PowerShell spawn failure), the code falls through to the terminal Discord alert rather than silently swallowing the error", async () => {
    process.env["KASA_DEVICE_IP"] = "192.168.1.42";
    process.env["KASA_USERNAME"] = "test@example.com";
    process.env["KASA_PASSWORD"] = "test-password";

    const staleTs = uniqueStaleTs();
    (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: staleTs }]);
    const insertValues = vi.fn().mockResolvedValue([]);
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({ values: insertValues });

    injectAutoRestartAttemptsLast24h(3);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.mocked(triggerRemotePowerCycle).mockRejectedValueOnce(new Error("PowerShell spawn ENOENT"));

    const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
    await expect(runHeartbeatStaleCheck()).resolves.not.toThrow();

    expect(triggerRemotePowerCycle).toHaveBeenCalledTimes(1);
    const criticalCalls = vi.mocked(notifyCritical).mock.calls;
    const throwFallbackCall = criticalCalls.find((c) =>
      String(c[0]).includes("remote power-cycle threw") || String(c[1]).includes("threw an error"),
    );
    expect(throwFallbackCall).toBeDefined();
  });
});
