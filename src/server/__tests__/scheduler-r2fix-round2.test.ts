/**
 * R2FIX round-2 deep-scan regression tests (2026-07-16) — 2 CRIT + 1 MED
 * scheduler-reliability fixes, all fail-closed hardening on jobs that were
 * silently never firing (or silently no-op'ing a safety check).
 *
 * CRIT-1 — n8n-data-backup-daily (~scheduler.ts:4650): the ET-hour guard
 *   compared `now.toLocaleString(...)` (a zero-padded STRING, e.g. "03")
 *   against the bare string "3" — `"03" !== "3"` is always true, so the job
 *   returned early on EVERY fire since it was wired. This is the ONLY
 *   recovery net for a bad n8n workflow import (F-4) or a dropped/wiped n8n
 *   Postgres schema. Fixed by Number()-wrapping to match every sibling guard.
 *
 * CRIT-2 — weekly-drift-2sigma-check (~scheduler.ts:4370): the live-capital
 *   auto-HALT drift check's handler called `pipelineGate()`, which the
 *   handler's own comment claimed was "a no-op" because the job was listed in
 *   `_PIPELINE_GATE_EXEMPT` — but `_PIPELINE_GATE_EXEMPT` is consulted ONLY by
 *   `reconcileMissedRuns()` (boot catch-up), never by `pipelineGate()` itself
 *   (which only bypasses `ALWAYS_RUN_JOBS`). So the safety HALT silently
 *   no-op'd during any pipeline pause (PAUSED / VACATION / AUTOPAUSE_DD_VELOCITY)
 *   — exactly when a drifting live strategy needs it most. Fixed by adding the
 *   job to `ALWAYS_RUN_JOBS`, the set `pipelineGate()` actually reads.
 *
 * MED-3 — prompt-ab-resolution (~scheduler.ts:3417): documented "Sunday 11 PM
 *   ET" but scheduled `scheduleUtc("0 23 * * 0")` with no ET-hour guard — that
 *   cron fires Sunday 23:00 UTC, which is 19:00 ET (EDT) / 18:00 ET (EST),
 *   never 23:00 ET, and had no guard to catch the drift. Fixed by rescheduling
 *   to the correct Monday-UTC cross-midnight UTC window + an isSundayAtEtHour
 *   guard mirroring sibling weekly jobs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isSundayAtEtHour } from "../lib/weekly-cron-et-guard.js";

const SCHEDULER_SRC_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scheduler.ts",
);
const schedulerSource = readFileSync(SCHEDULER_SRC_PATH, "utf-8");

describe("R2FIX CRIT-1 — n8n-data-backup-daily ET-hour guard zero-pad bug", () => {
  it("Number(toLocaleString(...)) === 3 at a real 03:00 ET instant (EDT)", () => {
    // 2026-07-16T07:00:00Z = 03:00 ET during EDT (UTC-4).
    const now = new Date("2026-07-16T07:00:00Z");
    const rawEtHour = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    });
    // Demonstrates the bug class: ICU zero-pads to "03", which is NOT the
    // bare string this guard used to compare against.
    expect(rawEtHour).toBe("03");
    expect(rawEtHour === "3").toBe(false); // pre-fix comparison — always false, job always skipped
    expect(Number(rawEtHour)).toBe(3); // post-fix comparison — correctly matches
  });

  it("Number(toLocaleString(...)) === 3 at a real 03:00 ET instant (EST)", () => {
    // 2026-01-16T08:00:00Z = 03:00 ET during EST (UTC-5).
    const now = new Date("2026-01-16T08:00:00Z");
    const rawEtHour = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    });
    expect(rawEtHour).toBe("03");
    expect(Number(rawEtHour)).toBe(3);
  });

  it("source-contract: n8n-data-backup-daily guard is Number()-wrapped, not a bare-string compare", () => {
    const startIdx = schedulerSource.indexOf('scheduleUtc("30 7,8 * * *"');
    expect(startIdx).toBeGreaterThan(-1);
    const block = schedulerSource.slice(startIdx, startIdx + 1100);
    expect(block).toContain("const etHour = Number(");
    expect(block).toContain('if (etHour !== 3) {');
    // The old zero-pad bug pattern must be gone from this block.
    expect(block).not.toContain('if (etHour !== "3")');
  });
});

// ── Mock heavy server dependencies so scheduler can be imported without DB/cron ──
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
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
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

const pipelineMocks = vi.hoisted(() => ({
  isActive: vi.fn(async () => true),
  getMode: vi.fn(async () => "ACTIVE"),
}));
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: pipelineMocks.isActive,
  getMode: pipelineMocks.getMode,
}));

import { _testOnly } from "../scheduler.js";
const isActiveMock = pipelineMocks.isActive;

describe("R2FIX CRIT-2 — weekly-drift-2sigma-check bypasses pipelineGate during pause", () => {
  beforeEach(() => {
    isActiveMock.mockReset();
  });

  it("pipelineGate('weekly-drift-2sigma-check') returns true even when pipeline is PAUSED", async () => {
    isActiveMock.mockResolvedValue(false); // simulates PAUSED / VACATION / AUTOPAUSE_DD_VELOCITY
    const result = await _testOnly.pipelineGateForTest("weekly-drift-2sigma-check");
    expect(result).toBe(true);
  });

  it("pipelineGate('weekly-drift-2sigma-check') returns true when pipeline is ACTIVE too (no regression)", async () => {
    isActiveMock.mockResolvedValue(true);
    const result = await _testOnly.pipelineGateForTest("weekly-drift-2sigma-check");
    expect(result).toBe(true);
  });

  it("control: an ungated job like lifecycle-auto-check still correctly honors PAUSED", async () => {
    isActiveMock.mockResolvedValue(false);
    const result = await _testOnly.pipelineGateForTest("lifecycle-auto-check");
    expect(result).toBe(false);
  });

  it("source-contract: weekly-drift-2sigma-check is in ALWAYS_RUN_JOBS (the set pipelineGate() reads)", () => {
    const startIdx = schedulerSource.indexOf("const ALWAYS_RUN_JOBS = new Set([");
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = schedulerSource.indexOf("]);", startIdx);
    const block = schedulerSource.slice(startIdx, endIdx);
    expect(block).toContain('"weekly-drift-2sigma-check"');
  });
});

describe("R2FIX MED-3 — prompt-ab-resolution fires at the documented Sunday 23:00 ET, not 18:00/19:00 ET", () => {
  it("isSundayAtEtHour(now, 23) is true at the real Sunday-23:00-ET instant during EDT", () => {
    // 2026-07-20T03:00:00Z = Sun 23:00 ET during EDT (UTC-4).
    const now = new Date("2026-07-20T03:00:00Z");
    expect(isSundayAtEtHour(now, 23)).toBe(true);
  });

  it("isSundayAtEtHour(now, 23) is true at the real Sunday-23:00-ET instant during EST", () => {
    // 2026-02-09T04:00:00Z = Sun 23:00 ET during EST (UTC-5).
    const now = new Date("2026-02-09T04:00:00Z");
    expect(isSundayAtEtHour(now, 23)).toBe(true);
  });

  it("isSundayAtEtHour(now, 23) is FALSE at the OLD buggy fire time (Sunday 23:00 UTC = 18:00/19:00 ET)", () => {
    // The pre-fix cron fired at literal Sunday 23:00 UTC with no guard at all.
    // Proves that instant is NOT the documented 23:00 ET moment.
    const now = new Date("2026-07-19T23:00:00Z"); // Sun 19:00 ET (EDT)
    expect(isSundayAtEtHour(now, 23)).toBe(false);
  });

  it("source-contract: prompt-ab-resolution cron fires at the Monday-UTC cross-midnight window with an ET-hour guard", () => {
    const registerIdx = schedulerSource.indexOf('registerJob("prompt-ab-resolution"');
    expect(registerIdx).toBeGreaterThan(-1);
    const block = schedulerSource.slice(registerIdx, registerIdx + 1600);
    expect(block).toContain('scheduleUtc("0 3,4 * * 1"');
    expect(block).toContain("isSundayAtEtHour(now, 23)");
    // The old undoc'd unguarded cron (as an executable scheduleUtc(...) call,
    // not just mentioned in the explanatory comment above) must be gone.
    const executableLines = block
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"));
    expect(executableLines.join("\n")).not.toContain('scheduleUtc("0 23 * * 0"');
  });
});

describe("goalscan-r2 — bias-state-freshness-check canary (0134-class writer-death detector)", () => {
  // Writer-side twin of the schema-contract canary: bias_state persistence was
  // silently dead 2026-05-24 -> 2026-07-17 behind green engine audits. This
  // canary alerts when no bias_state row lands for a trading session. It is
  // pure observability, so it must fire during pipeline pauses (the CRIT-2
  // lesson above: only ALWAYS_RUN_JOBS actually bypasses pipelineGate()).
  beforeEach(() => {
    isActiveMock.mockReset();
  });

  it("pipelineGate('bias-state-freshness-check') returns true even when pipeline is PAUSED", async () => {
    isActiveMock.mockResolvedValue(false);
    const result = await _testOnly.pipelineGateForTest("bias-state-freshness-check");
    expect(result).toBe(true);
  });

  it("source-contract: bias-state-freshness-check is in ALWAYS_RUN_JOBS (the set pipelineGate() reads)", () => {
    const startIdx = schedulerSource.indexOf("const ALWAYS_RUN_JOBS = new Set([");
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = schedulerSource.indexOf("]);", startIdx);
    const block = schedulerSource.slice(startIdx, endIdx);
    expect(block).toContain('"bias-state-freshness-check"');
  });

  it("source-contract: canary is registered, hourly-scheduled, day-deduped, and alerts via audit + Discord WARN", () => {
    // Registered job exists
    expect(schedulerSource).toContain('registerJob("bias-state-freshness-check"');
    // Hourly cron wrapper exists and routes through the real registered handler
    const wrapperIdx = schedulerSource.indexOf('SCHEDULER_JOBS["bias-state-freshness-check"]?.run()');
    expect(wrapperIdx).toBeGreaterThan(-1);
    // Slice the registered handler body for the contract assertions
    const regIdx = schedulerSource.indexOf('registerJob("bias-state-freshness-check"');
    const body = schedulerSource.slice(regIdx, regIdx + 5000);
    // One-alert-per-trading-day dedup keyed on the audit action + entityId
    expect(body).toContain('"bias_state.freshness_stale"');
    expect(body).toContain("auditLog.entityId, todayEt");
    // Alert surfaces: audit row (queryable) + Discord WARN (operator phone)
    expect(body).toContain("notifyWarning(");
    // Freshness reference: today's 09:30 ET session start, not a rolling window
    expect(body).toContain("09:30:00");
  });
});
