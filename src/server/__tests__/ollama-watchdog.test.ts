/**
 * ollama-watchdog.test.ts
 *
 * Tests for:
 *   - alert-dedup.ts: shouldEmitAlert, markAlertEmitted, clearAlertKey, severity escalation
 *   - ollama-keepwarm-watchdog-service.ts: probeOllamaHealth classification,
 *     recovery-ladder ordering (stops on first HEALTHY), auto-close calls recheckOllamaHealth,
 *     Step C sets OLLAMA_HEALTHY=false, deduped alert only fires once per window
 *
 * Vitest 3.2.4 note: vi.clearAllMocks() strips factory defaults.
 * ALL mocked resolve values MUST be re-established in beforeEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../server/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../server/db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../server/db/schema.js", () => ({
  auditLog: { $inferInsert: {} },
}));

vi.mock("../../server/lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../server/services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

vi.mock("../../server/services/model-router.js", () => ({
  recheckOllamaHealth: vi.fn().mockResolvedValue({ healthy: true }),
  setOllamaUnhealthy: vi.fn(),
  __setOllamaHealthyForTests: vi.fn(),
  __getOllamaHealthyForTests: vi.fn().mockReturnValue(true),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  shouldEmitAlert,
  markAlertEmitted,
  clearAlertKey,
  getAlertEntry,
  _resetDedupForTests,
} from "../../server/lib/alert-dedup.js";

import {
  probeOllamaHealth,
  runOllamaKeepaliveWatchdogTick,
  _resetConsecutiveUnhealthyForTests,
  _getConsecutiveUnhealthyForTests,
} from "../../server/services/ollama-keepwarm-watchdog-service.js";

import { insertAuditRowSafe } from "../../server/lib/audit-log-helper.js";
import { notifyCritical, notifyInfo } from "../../server/services/notification-service.js";
import { recheckOllamaHealth, setOllamaUnhealthy } from "../../server/services/model-router.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFetchMock(opts: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throwError?: Error;
}) {
  if (opts.throwError) {
    return vi.fn().mockRejectedValue(opts.throwError);
  }
  return vi.fn().mockResolvedValue({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: vi.fn().mockResolvedValue(opts.body ?? { message: { content: "pong" } }),
    text: vi.fn().mockResolvedValue(""),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: alert-dedup.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("alert-dedup", () => {
  beforeEach(() => {
    _resetDedupForTests();
    // Re-establish all mocked resolve values (Vitest 3.2.4: clearAllMocks strips them)
    vi.mocked(insertAuditRowSafe).mockResolvedValue(true);
    vi.mocked(recheckOllamaHealth).mockResolvedValue({ healthy: true });
    vi.mocked(setOllamaUnhealthy).mockImplementation(() => {});
    vi.mocked(notifyCritical).mockImplementation(() => {});
    vi.mocked(notifyInfo).mockImplementation(() => {});
  });

  afterEach(() => {
    _resetDedupForTests();
    vi.clearAllMocks();
  });

  it("first fire always returns true (no entry)", () => {
    expect(shouldEmitAlert("test.key", "CRITICAL", 1000)).toBe(true);
  });

  it("second fire within window returns false (suppressed)", () => {
    const now = 1_000_000;
    markAlertEmitted("test.key", "CRITICAL", now);
    // 30 seconds later — well within default 1h window
    expect(shouldEmitAlert("test.key", "CRITICAL", now + 30_000)).toBe(false);
  });

  it("fire after window elapsed returns true", () => {
    const now = 1_000_000;
    const windowMs = 3_600_000; // default 1h
    markAlertEmitted("test.key", "CRITICAL", now);
    expect(shouldEmitAlert("test.key", "CRITICAL", now + windowMs + 1)).toBe(true);
  });

  it("severity escalation (WARNING → CRITICAL) bypasses window", () => {
    const now = 1_000_000;
    markAlertEmitted("test.key", "WARNING", now);
    // 5 seconds later but escalating to CRITICAL — must fire
    expect(shouldEmitAlert("test.key", "CRITICAL", now + 5_000)).toBe(true);
  });

  it("same severity within window is suppressed even after partial escalation check", () => {
    const now = 1_000_000;
    markAlertEmitted("test.key", "CRITICAL", now);
    // Same CRITICAL severity — not an escalation
    expect(shouldEmitAlert("test.key", "CRITICAL", now + 1_000)).toBe(false);
  });

  it("de-escalation (CRITICAL → WARNING) within window is suppressed", () => {
    const now = 1_000_000;
    markAlertEmitted("test.key", "CRITICAL", now);
    // WARNING is lower severity — no escalation → suppressed
    expect(shouldEmitAlert("test.key", "WARNING", now + 1_000)).toBe(false);
  });

  it("clearAlertKey removes entry — next fire returns true", () => {
    const now = 1_000_000;
    markAlertEmitted("test.key", "CRITICAL", now);
    clearAlertKey("test.key");
    expect(shouldEmitAlert("test.key", "CRITICAL", now + 1_000)).toBe(true);
  });

  it("getAlertEntry returns null when no entry", () => {
    expect(getAlertEntry("no.such.key")).toBeNull();
  });

  it("getAlertEntry returns entry after markAlertEmitted", () => {
    const now = 1_500_000;
    markAlertEmitted("some.key", "WARNING", now);
    const entry = getAlertEntry("some.key");
    expect(entry).not.toBeNull();
    expect(entry!.lastEmittedAt).toBe(now);
    expect(entry!.lastSeverity).toBe("WARNING");
  });

  it("different keys are independent", () => {
    const now = 1_000_000;
    markAlertEmitted("key.one", "CRITICAL", now);
    // key.two has no entry — should fire
    expect(shouldEmitAlert("key.two", "CRITICAL", now + 1_000)).toBe(true);
  });

  it("respects ALERT_DEDUP_WINDOW_MS env override", () => {
    const origEnv = process.env.ALERT_DEDUP_WINDOW_MS;
    process.env.ALERT_DEDUP_WINDOW_MS = "10000"; // 10s window
    try {
      const now = 1_000_000;
      markAlertEmitted("env.key", "CRITICAL", now);
      // 5s later — within 10s window → suppressed
      expect(shouldEmitAlert("env.key", "CRITICAL", now + 5_000)).toBe(false);
      // 11s later — beyond 10s window → fires
      expect(shouldEmitAlert("env.key", "CRITICAL", now + 11_000)).toBe(true);
    } finally {
      if (origEnv === undefined) {
        delete process.env.ALERT_DEDUP_WINDOW_MS;
      } else {
        process.env.ALERT_DEDUP_WINDOW_MS = origEnv;
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: probeOllamaHealth classification
// ─────────────────────────────────────────────────────────────────────────────

describe("probeOllamaHealth", () => {
  const base = "http://localhost:11434";
  const model = "gemma4:e2b";

  beforeEach(() => {
    vi.mocked(insertAuditRowSafe).mockResolvedValue(true);
    vi.mocked(recheckOllamaHealth).mockResolvedValue({ healthy: true });
    vi.mocked(setOllamaUnhealthy).mockImplementation(() => {});
    vi.mocked(notifyCritical).mockImplementation(() => {});
    vi.mocked(notifyInfo).mockImplementation(() => {});
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("classifies HEALTHY when response has message field", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ body: { message: { content: "pong" } } }));
    const result = await probeOllamaHealth(base, model, 5_000);
    expect(result.healthClass).toBe("HEALTHY");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("classifies DEGRADED when response has no message field", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ body: {} }));
    const result = await probeOllamaHealth(base, model, 5_000);
    expect(result.healthClass).toBe("DEGRADED");
    expect(result.reason).toBe("empty_or_missing_message");
  });

  it("classifies DEGRADED when JSON parse fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error("JSON parse error")),
    }));
    const result = await probeOllamaHealth(base, model, 5_000);
    expect(result.healthClass).toBe("DEGRADED");
    expect(result.reason).toBe("invalid_json_response");
  });

  it("classifies DOWN on HTTP non-OK", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ ok: false, status: 503 }));
    const result = await probeOllamaHealth(base, model, 5_000);
    expect(result.healthClass).toBe("DOWN");
    expect(result.reason).toBe("HTTP 503");
  });

  it("classifies DOWN on connection refused (TypeError)", async () => {
    const err = new TypeError("fetch failed");
    vi.stubGlobal("fetch", makeFetchMock({ throwError: err }));
    const result = await probeOllamaHealth(base, model, 5_000);
    expect(result.healthClass).toBe("DOWN");
    expect(result.reason).toBe("connection_refused");
  });

  it("classifies DOWN on timeout (AbortError)", async () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    vi.stubGlobal("fetch", makeFetchMock({ throwError: err }));
    const result = await probeOllamaHealth(base, model, 5_000);
    expect(result.healthClass).toBe("DOWN");
    expect(result.reason).toBe("timeout");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: watchdog tick — HEALTHY path
// ─────────────────────────────────────────────────────────────────────────────

describe("runOllamaKeepaliveWatchdogTick — HEALTHY path", () => {
  beforeEach(() => {
    vi.mocked(insertAuditRowSafe).mockResolvedValue(true);
    vi.mocked(recheckOllamaHealth).mockResolvedValue({ healthy: true });
    vi.mocked(setOllamaUnhealthy).mockImplementation(() => {});
    vi.mocked(notifyCritical).mockImplementation(() => {});
    vi.mocked(notifyInfo).mockImplementation(() => {});
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    process.env.OLLAMA_WATCHDOG_ENABLED = "true";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    delete process.env.OLLAMA_WATCHDOG_ENABLED;
  });

  it("HEALTHY tick: writes ollama_watchdog.healthy audit row and returns", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ body: { message: { content: "pong" } } }));
    await runOllamaKeepaliveWatchdogTick();

    const calls = vi.mocked(insertAuditRowSafe).mock.calls;
    const healthyCall = calls.find((c) => c[0].action === "ollama_watchdog.healthy");
    expect(healthyCall).toBeDefined();
    expect(healthyCall![0].status).toBe("success");
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();
    expect(vi.mocked(setOllamaUnhealthy)).not.toHaveBeenCalled();
  });

  it("HEALTHY tick: resets consecutive unhealthy counter", async () => {
    _resetConsecutiveUnhealthyForTests();
    // Simulate 2 prior unhealthy ticks
    vi.stubGlobal("fetch", makeFetchMock({ throwError: new TypeError("fetch failed") }));
    await runOllamaKeepaliveWatchdogTick();
    await runOllamaKeepaliveWatchdogTick();
    expect(_getConsecutiveUnhealthyForTests()).toBeGreaterThan(0);

    // Now healthy
    vi.stubGlobal("fetch", makeFetchMock({ body: { message: { content: "pong" } } }));
    await runOllamaKeepaliveWatchdogTick();
    expect(_getConsecutiveUnhealthyForTests()).toBe(0);
  });

  it("disabled watchdog skips all work", async () => {
    process.env.OLLAMA_WATCHDOG_ENABLED = "false";
    vi.stubGlobal("fetch", vi.fn());
    await runOllamaKeepaliveWatchdogTick();
    expect(vi.mocked(insertAuditRowSafe)).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: recovery ladder — Step A heals
// ─────────────────────────────────────────────────────────────────────────────

describe("runOllamaKeepaliveWatchdogTick — recovery ladder Step A heals", () => {
  beforeEach(() => {
    vi.mocked(insertAuditRowSafe).mockResolvedValue(true);
    vi.mocked(recheckOllamaHealth).mockResolvedValue({ healthy: true });
    vi.mocked(setOllamaUnhealthy).mockImplementation(() => {});
    vi.mocked(notifyCritical).mockImplementation(() => {});
    vi.mocked(notifyInfo).mockImplementation(() => {});
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    process.env.OLLAMA_WATCHDOG_ENABLED = "true";
    process.env.OLLAMA_WATCHDOG_PROBE_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_A_TIMEOUT_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_B_UNLOAD_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_B_WARM_MS = "5000";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    delete process.env.OLLAMA_WATCHDOG_ENABLED;
    delete process.env.OLLAMA_WATCHDOG_PROBE_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_A_TIMEOUT_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_B_UNLOAD_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_B_WARM_MS;
  });

  it("Step A heals: calls recheckOllamaHealth and writes recovered audit row", async () => {
    // Sequence: DOWN probe → Step A warm succeeds → verification probe HEALTHY → recovered
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Initial probe → DOWN
        return Promise.reject(new TypeError("fetch failed"));
      }
      // Step A warm and verification probe → success
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ message: { content: "warm" } }),
      });
    }));

    await runOllamaKeepaliveWatchdogTick();

    expect(vi.mocked(recheckOllamaHealth)).toHaveBeenCalled();
    const recoveredCall = vi.mocked(insertAuditRowSafe).mock.calls.find(
      (c) => c[0].action === "ollama_watchdog.recovered"
    );
    expect(recoveredCall).toBeDefined();
    expect(recoveredCall![0].result).toMatchObject({ recovery_step: "A" });

    // Step C must NOT have been triggered
    expect(vi.mocked(setOllamaUnhealthy)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();
  });

  it("Step A heals: clears alert dedup key (next failure fires immediately)", async () => {
    // Pre-set a dedup entry as if a prior alert was fired
    markAlertEmitted("ollama.circuit_open", "CRITICAL", Date.now());

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ message: { content: "warm" } }),
      });
    }));

    await runOllamaKeepaliveWatchdogTick();

    // After recovery, dedup key should be cleared
    expect(getAlertEntry("ollama.circuit_open")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: recovery ladder — Step A fails, Step B heals
// ─────────────────────────────────────────────────────────────────────────────

describe("runOllamaKeepaliveWatchdogTick — recovery ladder Step B heals", () => {
  beforeEach(() => {
    vi.mocked(insertAuditRowSafe).mockResolvedValue(true);
    vi.mocked(recheckOllamaHealth).mockResolvedValue({ healthy: true });
    vi.mocked(setOllamaUnhealthy).mockImplementation(() => {});
    vi.mocked(notifyCritical).mockImplementation(() => {});
    vi.mocked(notifyInfo).mockImplementation(() => {});
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    process.env.OLLAMA_WATCHDOG_ENABLED = "true";
    process.env.OLLAMA_WATCHDOG_PROBE_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_A_TIMEOUT_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_B_UNLOAD_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_B_WARM_MS = "5000";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    delete process.env.OLLAMA_WATCHDOG_ENABLED;
    delete process.env.OLLAMA_WATCHDOG_PROBE_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_A_TIMEOUT_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_B_UNLOAD_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_B_WARM_MS;
  });

  it("Step B heals: stopped at B (Step C not triggered)", async () => {
    // Sequence:
    //   Call 1: initial probe → DOWN
    //   Call 2: Step A warm → fail (rejected)
    //   Call 3: Step A verification probe → not reached (warm failed)
    //   Call 4: Step B unload → ok
    //   Call 5: Step B warm → ok
    //   Call 6: Step B verification probe → HEALTHY
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Initial probe → DOWN
        return Promise.reject(new TypeError("connection refused"));
      }
      if (callCount === 2) {
        // Step A patient warm → also fails
        return Promise.reject(new TypeError("still down"));
      }
      // callCount 3+ → Step B unload + re-warm + verification → all succeed
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ message: { content: "recovered" } }),
      });
    }));

    await runOllamaKeepaliveWatchdogTick();

    // Recovery should have happened at Step B
    const recoveredCall = vi.mocked(insertAuditRowSafe).mock.calls.find(
      (c) => c[0].action === "ollama_watchdog.recovered"
    );
    expect(recoveredCall).toBeDefined();
    expect(recoveredCall![0].result).toMatchObject({ recovery_step: "B" });

    // Step C must NOT have been triggered
    expect(vi.mocked(setOllamaUnhealthy)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: recovery ladder — exhausted → Step C
// ─────────────────────────────────────────────────────────────────────────────

describe("runOllamaKeepaliveWatchdogTick — recovery exhausted (Step C)", () => {
  beforeEach(() => {
    vi.mocked(insertAuditRowSafe).mockResolvedValue(true);
    vi.mocked(recheckOllamaHealth).mockResolvedValue({ healthy: true });
    vi.mocked(setOllamaUnhealthy).mockImplementation(() => {});
    vi.mocked(notifyCritical).mockImplementation(() => {});
    vi.mocked(notifyInfo).mockImplementation(() => {});
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    process.env.OLLAMA_WATCHDOG_ENABLED = "true";
    process.env.OLLAMA_WATCHDOG_PROBE_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_A_TIMEOUT_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_B_UNLOAD_MS = "5000";
    process.env.OLLAMA_WATCHDOG_STEP_B_WARM_MS = "5000";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    delete process.env.OLLAMA_WATCHDOG_ENABLED;
    delete process.env.OLLAMA_WATCHDOG_PROBE_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_A_TIMEOUT_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_B_UNLOAD_MS;
    delete process.env.OLLAMA_WATCHDOG_STEP_B_WARM_MS;
  });

  it("Step C: setOllamaUnhealthy called when all recovery steps fail", async () => {
    // All fetch calls fail → initial probe DOWN, Step A warm fail, Step B unload fail, Step B warm fail
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("persistent connection refused")));

    await runOllamaKeepaliveWatchdogTick();

    expect(vi.mocked(setOllamaUnhealthy)).toHaveBeenCalledWith("watchdog_recovery_exhausted");
    const exhaustedCall = vi.mocked(insertAuditRowSafe).mock.calls.find(
      (c) => c[0].action === "ollama_watchdog.recovery_exhausted"
    );
    expect(exhaustedCall).toBeDefined();
    expect(exhaustedCall![0].status).toBe("error");
  });

  it("Step C: deduped CRITICAL alert fires once", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("persistent connection refused")));

    await runOllamaKeepaliveWatchdogTick();

    expect(vi.mocked(notifyCritical)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyCritical).mock.calls[0][0]).toContain("DOWN");
  });

  it("Step C: second tick within dedup window does NOT re-fire CRITICAL alert", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("persistent connection refused")));

    await runOllamaKeepaliveWatchdogTick();
    vi.mocked(notifyCritical).mockClear();

    // Second tick — same conditions, but dedup key is now set
    await runOllamaKeepaliveWatchdogTick();

    // notifyCritical should NOT have been called again (within dedup window)
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();
  });

  it("recheckOllamaHealth is NOT called on Step C (no recovery happened)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("persistent connection refused")));

    await runOllamaKeepaliveWatchdogTick();

    // recheckOllamaHealth should not be called — model is still down
    expect(vi.mocked(recheckOllamaHealth)).not.toHaveBeenCalled();
  });

  it("audit recovery_attempt rows written for both Step A and Step B", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("persistent connection refused")));

    await runOllamaKeepaliveWatchdogTick();

    const attemptCalls = vi.mocked(insertAuditRowSafe).mock.calls.filter(
      (c) => c[0].action === "ollama_watchdog.recovery_attempt"
    );
    const steps = attemptCalls.map((c) => (c[0].result as Record<string, unknown>)["step"]);
    expect(steps).toContain("A");
    expect(steps).toContain("B");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7: fail-soft guarantee
// ─────────────────────────────────────────────────────────────────────────────

describe("runOllamaKeepaliveWatchdogTick — fail-soft guarantee", () => {
  beforeEach(() => {
    vi.mocked(insertAuditRowSafe).mockResolvedValue(true);
    vi.mocked(recheckOllamaHealth).mockResolvedValue({ healthy: true });
    vi.mocked(setOllamaUnhealthy).mockImplementation(() => {});
    vi.mocked(notifyCritical).mockImplementation(() => {});
    vi.mocked(notifyInfo).mockImplementation(() => {});
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    process.env.OLLAMA_WATCHDOG_ENABLED = "true";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _resetDedupForTests();
    _resetConsecutiveUnhealthyForTests();
    delete process.env.OLLAMA_WATCHDOG_ENABLED;
  });

  it("does not throw even when fetch throws an unexpected error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unexpected internal error")));

    // Must resolve without throwing
    await expect(runOllamaKeepaliveWatchdogTick()).resolves.toBeUndefined();
  });

  it("does not throw when insertAuditRowSafe rejects", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ body: { message: { content: "ok" } } }));
    vi.mocked(insertAuditRowSafe).mockRejectedValue(new Error("DB write failed"));

    await expect(runOllamaKeepaliveWatchdogTick()).resolves.toBeUndefined();
  });
});
