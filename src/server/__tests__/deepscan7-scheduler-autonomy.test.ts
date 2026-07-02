/**
 * Deep-scan #7 fix wave — Track A scheduler/autonomy regression tests.
 *
 * A1 (DS7-C1): "db-backup" is in NEVER_DISABLE_JOBS — 5 consecutive nightly
 *   pg_dump failures must NOT permanently auto-disable the only backup job.
 * A2 (DS7-H1): "pre-trading-day-health-check" is in NEVER_DISABLE_JOBS —
 *   Windows health probing must never go dark.
 * A3 (M1): for NEVER_DISABLE_JOBS the CRITICAL alert now actually fires when
 *   consecutiveFailures crosses FAILURE_DISABLE_THRESHOLD (it previously sat
 *   inside the disable branch and never fired), deduped to the crossing +
 *   every 10th failure thereafter.
 * A4 (L2): db-backup cron uses withRetry(..., 3) like other jobs (source scan).
 * A5 (DS7-H3): autonomous-scout fire-and-forget failures are tracked; after 3
 *   consecutive failures a deduped Discord WARN + audit row fires (≤1 / 24h).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Mock heavy server dependencies so scheduler can be imported without a DB ──
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    execute: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })),
  },
  client: { end: vi.fn() },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const notifyMocks = vi.hoisted(() => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../services/notification-service.js", () => notifyMocks);

const auditMocks = vi.hoisted(() => ({
  insertAuditRow: vi.fn(async (_row?: unknown) => undefined),
  insertAuditRowSafe: vi.fn(async (_row?: unknown) => true),
}));
vi.mock("../lib/audit-log-helper.js", () => auditMocks);

vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: vi.fn().mockImplementation(() => ({
    checkAutoPromotions: vi.fn(() => Promise.resolve([])),
    checkAutoDemotions: vi.fn(() => Promise.resolve([])),
  })),
}));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { circuitOpen: vi.fn() } }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: vi.fn(),
  stopStream: vi.fn(),
  isStreaming: vi.fn(() => false),
  getActiveStreams: vi.fn(() => []),
}));
vi.mock("../services/paper-signal-service.js", () => ({
  restorePositionState: vi.fn(),
  cleanupSession: vi.fn(),
}));
vi.mock("../services/deepar-service.js", () => ({
  trainDeepAR: vi.fn(() => Promise.resolve({})),
  predictRegime: vi.fn(() => Promise.resolve({})),
  validatePastForecasts: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { setOnStateChange: vi.fn(), statusAll: vi.fn(() => ({})) },
}));

import { getAllJobHealth, _testOnly } from "../scheduler.js";

const _filename = fileURLToPath(import.meta.url);
const SCHEDULER_SRC = path.resolve(path.dirname(_filename), "..", "scheduler.ts");

describe("A1/A2 — db-backup + pre-trading-day-health-check are NEVER_DISABLE_JOBS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testOnly.resetJobHealth();
  });

  for (const jobName of ["db-backup", "pre-trading-day-health-check"]) {
    it(`does NOT disable "${jobName}" after 5 consecutive failures`, () => {
      _testOnly.registerJob(jobName, 60_000, async () => { throw new Error("fail"); });
      const err = new Error("nightly failure");
      for (let i = 0; i < 5; i++) {
        _testOnly.recordJobFailure(jobName, err);
      }
      const health = getAllJobHealth().get(jobName);
      expect(health).toBeDefined();
      expect(health?.consecutiveFailures).toBe(5);
      expect(health?.disabled).toBe(false);
    });
  }
});

describe("A3 (M1) — never-disable jobs fire the CRITICAL at the threshold crossing, deduped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testOnly.resetJobHealth();
  });

  it("db-backup at 5 failures: NOT disabled AND critical fired exactly once", () => {
    const err = new Error("pg_dump exploded");
    for (let i = 0; i < 5; i++) {
      _testOnly.recordJobFailure("db-backup", err);
    }
    const health = getAllJobHealth().get("db-backup");
    expect(health?.disabled).toBe(false);
    // notifyWarning fires once at 3 (FAILURE_WARN_THRESHOLD); the CRITICAL
    // fires exactly once at the disable-threshold crossing (5).
    const criticalCalls = notifyMocks.notifyCritical.mock.calls;
    expect(criticalCalls.length).toBe(1);
    expect(String(criticalCalls[0]?.[0])).toContain("db-backup");
    expect(String(criticalCalls[0]?.[0])).not.toContain("AUTO-DISABLED");
  });

  it("6th failure does NOT duplicate the critical", () => {
    const err = new Error("pg_dump exploded");
    for (let i = 0; i < 6; i++) {
      _testOnly.recordJobFailure("db-backup", err);
    }
    expect(getAllJobHealth().get("db-backup")?.disabled).toBe(false);
    expect(notifyMocks.notifyCritical).toHaveBeenCalledTimes(1);
  });

  it("re-fires every 10th failure (15th, 25th) — persistent outage stays visible", () => {
    const err = new Error("still down");
    for (let i = 0; i < 25; i++) {
      _testOnly.recordJobFailure("db-backup", err);
    }
    // Fired at 5, 15, 25 — never at any other tick.
    expect(notifyMocks.notifyCritical).toHaveBeenCalledTimes(3);
  });

  it("unprotected job: disabled at 5 with the AUTO-DISABLED critical (unchanged behavior)", () => {
    const jobName = "some-unprotected-research-job";
    const err = new Error("fail");
    for (let i = 0; i < 5; i++) {
      _testOnly.recordJobFailure(jobName, err);
    }
    const health = getAllJobHealth().get(jobName);
    expect(health?.disabled).toBe(true);
    expect(notifyMocks.notifyCritical).toHaveBeenCalledTimes(1);
    expect(String(notifyMocks.notifyCritical.mock.calls[0]?.[0])).toContain("AUTO-DISABLED");
  });
});

describe("A4 (L2) — db-backup cron retries 3 times like other jobs", () => {
  it("scheduler.ts invokes withRetry for db-backup with maxRetries=3", () => {
    const src = fs.readFileSync(SCHEDULER_SRC, "utf-8");
    expect(src).toMatch(/withRetry\("db-backup", SCHEDULER_JOBS\["db-backup"\]\.run, 3\)/);
    expect(src).not.toMatch(/withRetry\("db-backup", SCHEDULER_JOBS\["db-backup"\]\.run, 1\)/);
  });
});

describe("A5 (DS7-H3) — autonomous-scout consecutive-failure Discord WARN + audit, deduped 24h", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testOnly.resetScoutFailureTracker();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not alert before 3 consecutive failures", async () => {
    await _testOnly.recordScoutRunFailure(new Error("boom 1"));
    await _testOnly.recordScoutRunFailure(new Error("boom 2"));
    expect(notifyMocks.notifyWarning).not.toHaveBeenCalled();
    expect(auditMocks.insertAuditRowSafe).not.toHaveBeenCalled();
    expect(_testOnly.getScoutFailureState().consecutiveFailures).toBe(2);
  });

  it("fires WARN + scout.consecutive_failure_alert audit (status warning) at the 3rd failure", async () => {
    for (let i = 0; i < 3; i++) {
      await _testOnly.recordScoutRunFailure(new Error("ollama dead"));
    }
    expect(notifyMocks.notifyWarning).toHaveBeenCalledTimes(1);
    expect(String(notifyMocks.notifyWarning.mock.calls[0]?.[0])).toContain("scout");
    // Family-grade postscript is appended (real helper runs — body carries the marker text)
    expect(String(notifyMocks.notifyWarning.mock.calls[0]?.[1])).toContain("ollama dead");

    expect(auditMocks.insertAuditRowSafe).toHaveBeenCalledTimes(1);
    const row = auditMocks.insertAuditRowSafe.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.action).toBe("scout.consecutive_failure_alert");
    expect(row.status).toBe("warning");
    expect((row.input as Record<string, unknown>).consecutiveFailures).toBe(3);
    expect(row.correlationId).toBeTruthy();
  });

  it("dedups within 24h — 4th and 5th failures do not re-notify", async () => {
    for (let i = 0; i < 5; i++) {
      await _testOnly.recordScoutRunFailure(new Error("still dead"));
      vi.advanceTimersByTime(60 * 60 * 1000); // 1h between daily-ish ticks
    }
    expect(notifyMocks.notifyWarning).toHaveBeenCalledTimes(1);
    expect(auditMocks.insertAuditRowSafe).toHaveBeenCalledTimes(1);
  });

  it("re-notifies after 24h of continued failure", async () => {
    for (let i = 0; i < 3; i++) {
      await _testOnly.recordScoutRunFailure(new Error("dead"));
    }
    expect(notifyMocks.notifyWarning).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    await _testOnly.recordScoutRunFailure(new Error("dead day 4"));
    expect(notifyMocks.notifyWarning).toHaveBeenCalledTimes(2);
    expect(auditMocks.insertAuditRowSafe).toHaveBeenCalledTimes(2);
  });

  it("a successful run resets the consecutive-failure counter", async () => {
    await _testOnly.recordScoutRunFailure(new Error("boom"));
    await _testOnly.recordScoutRunFailure(new Error("boom"));
    _testOnly.recordScoutRunSuccess();
    expect(_testOnly.getScoutFailureState().consecutiveFailures).toBe(0);
    await _testOnly.recordScoutRunFailure(new Error("boom"));
    expect(notifyMocks.notifyWarning).not.toHaveBeenCalled();
  });
});
