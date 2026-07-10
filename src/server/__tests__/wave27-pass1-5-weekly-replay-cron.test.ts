/**
 * wave27-pass1-5-weekly-replay-cron.test.ts — Wave 27 Pass 1.5 (P1.5.A2)
 *
 * Tests for the weekly quantum replay analysis cron + Discord verdict emitter.
 *
 * Coverage (10 tests):
 *  1. test_weekly_cron_runs_analysis_and_audits
 *     — subprocess resolves with SIGNAL → audit quantum_replay.weekly_verdict_emitted + Discord called
 *  2. test_weekly_cron_failure_audits_warns
 *     — subprocess throws → audit quantum_replay.weekly_analysis_failed + notifyWarning fired
 *  3. test_weekly_cron_timeout_audits
 *     — subprocess timeout → audit quantum_replay.weekly_analysis_timeout + notifyWarning fired
 *  4. test_kill_switch_halts
 *     — auto_patch_loop_enabled=false → audit loop_halted_skip, no subprocess spawn
 *  5. test_no_data_skips_gracefully
 *     — subprocess returns zero replay rows → audit skipped_no_data, no Discord ping
 *  6. test_lock_overlap_protection (scheduler-level)
 *     — scheduler.ts source contains _tryAcquireJobLock for the job
 *  7. test_verdict_template_routing
 *     — parseScriptOutput for each of SIGNAL/INCONCLUSIVE/NO SIGNAL/PRELIMINARY → correct verdict
 *  8. test_pipeline_gate_exempt_registered
 *     — "quantum-replay-weekly-analysis" is in _PIPELINE_GATE_EXEMPT Set in scheduler.ts source
 *  9. test_double_fire_dst_guard
 *     — cron expression "0 23,0 * * 0,1" present; DST guard logic documented in source
 * 10. test_parse_script_output_report_path
 *     — parseScriptOutput extracts report path and all numeric fields correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must be hoisted before imports) ────────────────────────────

// Mock the DB + schema so no real DB connection is needed
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbValues = vi.fn().mockResolvedValue([]);

vi.mock("../db/index.js", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => ({ values: mockDbValues }),
  },
}));

vi.mock("../db/schema.js", () => ({
  systemParameters: { paramName: "paramName", currentValue: "currentValue" },
  auditLog: { action: "action" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

// Mock audit-log-helper
const mockInsertAuditRow = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: (...args: unknown[]) => mockInsertAuditRow(...args),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

// Mock notification-service
const mockNotifyWarning = vi.fn();
const mockNotifyInfo = vi.fn();
vi.mock("../services/notification-service.js", () => ({
  notifyWarning: (...args: unknown[]) => mockNotifyWarning(...args),
  notifyInfo: (...args: unknown[]) => mockNotifyInfo(...args),
  notifyCritical: vi.fn(),
}));

// Mock notification-helpers
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (body: string, what: string, action: string) =>
    `${body}\n--- For family members ---\nWhat this means: ${what}\nWhat to do: ${action}`,
}));

// Mock logger
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock child_process execFile — injectable per test
type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
type ExecFileOptions = {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string | undefined>;
};

const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    _opts: ExecFileOptions,
    cb: ExecFileCallback,
  ) => mockExecFile(_file, _args, _opts, cb),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Script stdout with SIGNAL verdict + valid stats */
function makeSIGNALStdout(sampleSize = 55): string {
  return [
    "=== REPLAY-GRADE-QUANTUM — Wave 27 Pass 1 Statistical Analysis ===",
    "",
    "=== Summary ===",
    `Replay rows analyzed      : ${sampleSize}`,
    `Strategy-folds valid      : ${sampleSize}`,
    "Spearman rho              : 0.3200",
    "Spearman p-value          : 0.0180",
    "Selected threshold (IS)   : 0.15",
    "Binomial rate (OOS)       : 72.5%",
    "Verdict                   : SIGNAL",
    "",
    "[APPLY] Report written to: /path/to/docs/replay-results/2026-05-25-quantum-disagreement.md",
  ].join("\n");
}

function makeVerdictStdout(verdict: string, sampleSize = 60): string {
  return [
    "=== Summary ===",
    `Replay rows analyzed      : ${sampleSize}`,
    `Strategy-folds valid      : ${sampleSize}`,
    "Spearman rho              : 0.1200",
    "Spearman p-value          : 0.0700",
    "Selected threshold (IS)   : 0.10",
    "Binomial rate (OOS)       : 55.0%",
    `Verdict                   : ${verdict}`,
    "[APPLY] Report written to: /path/to/docs/replay-results/2026-05-25-quantum-disagreement.md",
  ].join("\n");
}

function makeZeroRowsStdout(): string {
  return [
    "=== Summary ===",
    "Replay rows analyzed      : 0",
    "Strategy-folds valid      : 0",
    "Spearman rho              : 0.0000",
    "Spearman p-value          : 1.0000",
    "Verdict                   : PRELIMINARY",
  ].join("\n");
}

/** Make execFile succeed with given stdout */
function execFileSucceeds(stdout: string): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: ExecFileOptions, cb: ExecFileCallback) => {
      cb(null, stdout, "");
      return { kill: vi.fn() };
    },
  );
}

/** Make execFile fail with a script error */
function execFileFails(msg = "exit 1"): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: ExecFileOptions, cb: ExecFileCallback) => {
      const err = Object.assign(new Error(msg), { killed: false, status: 1 });
      cb(err, "", "Script error: " + msg);
      return { kill: vi.fn() };
    },
  );
}

/** Make execFile simulate a timeout (killed=true) */
function execFileTimesOut(): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: ExecFileOptions, cb: ExecFileCallback) => {
      const err = Object.assign(new Error("timeout"), { killed: true, status: null });
      cb(err, "", "");
      return { kill: vi.fn() };
    },
  );
}

/** Mock DB to return kill switch value */
function mockKillSwitch(value: string): void {
  // db.select(...).from(...).where(...).limit(1)  returns array
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ currentValue: value }]),
      }),
    }),
  });
}

/** Mock DB to return kill switch as missing (fail-open = enabled) */
function mockKillSwitchMissing(): void {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 27 Pass 1.5 A2 — quantum-replay-weekly-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertAuditRow.mockResolvedValue(undefined);
    mockNotifyWarning.mockReturnValue(undefined);
    mockNotifyInfo.mockReturnValue(undefined);
  });

  // Test 1 ─────────────────────────────────────────────────────────────────────
  it("test_weekly_cron_runs_analysis_and_audits: SIGNAL verdict → audit emitted + Discord called", async () => {
    mockKillSwitch("2"); // AUTOPILOT — autonomous cron runs
    execFileSucceeds(makeSIGNALStdout(55));

    const { runQuantumReplayWeeklyAnalysis } = await import(
      "../services/quantum-replay-weekly-service.js"
    );
    const result = await runQuantumReplayWeeklyAnalysis();

    // Status + verdict
    expect(result.status).toBe("success");
    expect(result.verdict).toBe("SIGNAL");
    expect(result.sampleSize).toBe(55);
    expect(result.spearmanRho).toBeCloseTo(0.32, 3);
    expect(result.spearmanPValue).toBeCloseTo(0.018, 3);
    expect(result.reportPath).toContain("quantum-disagreement.md");

    // Audit row emitted with correct action
    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quantum_replay.weekly_verdict_emitted",
        status: "success",
      }),
    );

    // Discord notifyInfo called (not notifyWarning — not a failure)
    expect(mockNotifyInfo).toHaveBeenCalledTimes(1);
    const [title, body] = mockNotifyInfo.mock.calls[0] as [string, string, unknown];
    expect(title).toContain("SIGNAL");
    expect(body).toContain("🟢");
    expect(body).toContain("For family members");
    expect(body).toContain("No action needed");

    expect(mockNotifyWarning).not.toHaveBeenCalled();
  });

  // Test 2 ─────────────────────────────────────────────────────────────────────
  it("test_weekly_cron_failure_audits_warns: script error → audit failed + notifyWarning fired", async () => {
    mockKillSwitch("2"); // AUTOPILOT — autonomous cron runs
    execFileFails("DB connection refused");

    const { runQuantumReplayWeeklyAnalysis } = await import(
      "../services/quantum-replay-weekly-service.js"
    );
    const result = await runQuantumReplayWeeklyAnalysis();

    expect(result.status).toBe("failed");
    expect(result.verdict).toBeNull();
    expect(result.errorMsg).toContain("DB connection refused");

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quantum_replay.weekly_analysis_failed",
        status: "failed",
      }),
    );

    expect(mockNotifyWarning).toHaveBeenCalledTimes(1);
    const [title, body] = mockNotifyWarning.mock.calls[0] as [string, string, unknown];
    expect(title).toContain("FAILED");
    expect(body).toContain("🔴");
    expect(body).toContain("For family members");

    expect(mockNotifyInfo).not.toHaveBeenCalled();
  });

  // Test 3 ─────────────────────────────────────────────────────────────────────
  it("test_weekly_cron_timeout_audits: subprocess timeout → audit timeout + notifyWarning fired", async () => {
    mockKillSwitch("2"); // AUTOPILOT — autonomous cron runs
    execFileTimesOut();

    const { runQuantumReplayWeeklyAnalysis } = await import(
      "../services/quantum-replay-weekly-service.js"
    );
    const result = await runQuantumReplayWeeklyAnalysis();

    expect(result.status).toBe("timeout");
    expect(result.verdict).toBeNull();
    expect(result.errorMsg).toContain("timed out");

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quantum_replay.weekly_analysis_timeout",
        status: "failed",
      }),
    );

    expect(mockNotifyWarning).toHaveBeenCalledTimes(1);
    const [title] = mockNotifyWarning.mock.calls[0] as [string, ...unknown[]];
    expect(title).toContain("TIMED OUT");

    expect(mockNotifyInfo).not.toHaveBeenCalled();
  });

  // Test 4 ─────────────────────────────────────────────────────────────────────
  it("test_kill_switch_halts: auto_patch_loop_enabled=false → returns early, audit loop_halted_skip, no subprocess", async () => {
    mockKillSwitch("false");

    const { runQuantumReplayWeeklyAnalysis } = await import(
      "../services/quantum-replay-weekly-service.js"
    );
    const result = await runQuantumReplayWeeklyAnalysis();

    expect(result.status).toBe("loop_halted_skip");
    expect(result.verdict).toBeNull();
    expect(result.sampleSize).toBeNull();

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quantum_replay.weekly_analysis_loop_halted_skip",
        status: "success",
      }),
    );

    // subprocess must NOT have been spawned
    expect(mockExecFile).not.toHaveBeenCalled();

    // no Discord pings
    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockNotifyWarning).not.toHaveBeenCalled();
  });

  // Test 4b ────────────────────────────────────────────────────────────────────
  it("test_observe_mode_halts: auto_patch_loop_enabled=1 (OBSERVE) → halts, no subprocess (advisory-only)", async () => {
    // SAFETY CRUX: OBSERVE (mode 1) runs nightly ADVISORY intelligence only and
    // must NOT wake this autonomous cron. Only AUTOPILOT (2) proceeds.
    mockKillSwitch("1");

    const { runQuantumReplayWeeklyAnalysis } = await import(
      "../services/quantum-replay-weekly-service.js"
    );
    const result = await runQuantumReplayWeeklyAnalysis();

    expect(result.status).toBe("loop_halted_skip");
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockNotifyWarning).not.toHaveBeenCalled();
  });

  // Test 5 ─────────────────────────────────────────────────────────────────────
  it("test_no_data_skips_gracefully: zero replay rows → audit skipped_no_data, no Discord ping", async () => {
    mockKillSwitch("2"); // AUTOPILOT — autonomous cron runs
    execFileSucceeds(makeZeroRowsStdout());

    const { runQuantumReplayWeeklyAnalysis } = await import(
      "../services/quantum-replay-weekly-service.js"
    );
    const result = await runQuantumReplayWeeklyAnalysis();

    expect(result.status).toBe("skipped_no_data");
    expect(result.verdict).toBeNull();
    expect(result.sampleSize).toBe(0);

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quantum_replay.weekly_analysis_skipped_no_data",
        status: "success",
      }),
    );

    // No Discord notification when there is no data (don't spam empty weeks)
    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockNotifyWarning).not.toHaveBeenCalled();
  });

  // Test 6 ─────────────────────────────────────────────────────────────────────
  it("test_lock_overlap_protection: scheduler.ts source contains _tryAcquireJobLock for the job", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // Job must be registered
    expect(schedulerSrc).toContain('"quantum-replay-weekly-analysis"');

    // Lock must be acquired
    expect(schedulerSrc).toContain('_tryAcquireJobLock("quantum-replay-weekly-analysis")');

    // Lock must be released
    expect(schedulerSrc).toContain('_releaseJobLock("quantum-replay-weekly-analysis")');
  });

  // Test 7 ─────────────────────────────────────────────────────────────────────
  it("test_verdict_template_routing: each verdict routes to correct Discord template", async () => {
    const { parseScriptOutput } = await import(
      "../services/quantum-replay-weekly-service.js"
    );

    const signalOut = parseScriptOutput(makeVerdictStdout("SIGNAL"));
    expect(signalOut.verdict).toBe("SIGNAL");

    const inconclusiveOut = parseScriptOutput(makeVerdictStdout("INCONCLUSIVE"));
    expect(inconclusiveOut.verdict).toBe("INCONCLUSIVE");

    const noSignalOut = parseScriptOutput(makeVerdictStdout("NO SIGNAL"));
    expect(noSignalOut.verdict).toBe("NO SIGNAL");

    const preliminaryOut = parseScriptOutput(makeVerdictStdout("PRELIMINARY"));
    expect(preliminaryOut.verdict).toBe("PRELIMINARY");
  });

  // Test 8 ─────────────────────────────────────────────────────────────────────
  it("test_pipeline_gate_exempt_registered: quantum-replay-weekly-analysis is in _PIPELINE_GATE_EXEMPT", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // Must appear in _PIPELINE_GATE_EXEMPT Set literal (static declaration or dynamic .add())
    expect(schedulerSrc).toContain('"quantum-replay-weekly-analysis"');

    // Verify the job is within the _PIPELINE_GATE_EXEMPT block (either in the static Set
    // initializer or as a .add() call). A simple check: both the Set definition and the
    // job name are present in the same file — the static Set at ~line 335 includes it.
    const gateExemptIdx = schedulerSrc.indexOf("_PIPELINE_GATE_EXEMPT = new Set");
    const jobIdx = schedulerSrc.indexOf('"quantum-replay-weekly-analysis"');
    expect(gateExemptIdx).toBeGreaterThan(-1);
    expect(jobIdx).toBeGreaterThan(-1);
    // The job name must appear AFTER the _PIPELINE_GATE_EXEMPT declaration (sanity check)
    // but could be in the static Set body or a nearby _PIPELINE_GATE_EXEMPT.add() call
    const closingBracket = schedulerSrc.indexOf("]);", gateExemptIdx);
    // The static Set ends with "])" — job must be before the closing bracket
    // OR there is a _PIPELINE_GATE_EXEMPT.add() call after it
    const inStaticSet = jobIdx > gateExemptIdx && jobIdx < closingBracket;
    const hasDynamicAdd = schedulerSrc.includes(`_PIPELINE_GATE_EXEMPT.add("quantum-replay-weekly-analysis")`);
    expect(inStaticSet || hasDynamicAdd).toBe(true);
  });

  // Test 9 ─────────────────────────────────────────────────────────────────────
  it("test_double_fire_dst_guard: cron uses 23,0 expression + ET day/hour guard in source", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // Double-fire cron expression for Sunday 19:00 ET DST coverage
    // 23:00 UTC (EDT) and 00:00 UTC+1day (EST)
    expect(schedulerSrc).toContain("0 23,0 * * 0,1");

    // ET day + hour guard must be present — filter to Sunday 19
    expect(schedulerSrc).toContain('etStr.includes("Sun")');
    expect(schedulerSrc).toContain('etStr.includes("19")');
  });

  // Test 10 ────────────────────────────────────────────────────────────────────
  it("test_parse_script_output_report_path: parseScriptOutput extracts all fields correctly", async () => {
    const { parseScriptOutput } = await import(
      "../services/quantum-replay-weekly-service.js"
    );

    const stdout = [
      "=== Summary ===",
      "Replay rows analyzed      : 72",
      "Strategy-folds valid      : 68",
      "Spearman rho              : 0.2850",
      "Spearman p-value          : 0.0189",
      "Selected threshold (IS)   : 0.20",
      "Binomial rate (OOS)       : 68.0%",
      "Verdict                   : SIGNAL",
      "",
      "[APPLY] Report written to: /home/tony/projects/trading-forge/docs/replay-results/2026-05-25-quantum-disagreement.md",
    ].join("\n");

    const parsed = parseScriptOutput(stdout);
    expect(parsed.replayRowsAnalyzed).toBe(72);
    expect(parsed.sampleSize).toBe(68);
    expect(parsed.spearmanRho).toBeCloseTo(0.285, 3);
    expect(parsed.spearmanPValue).toBeCloseTo(0.0189, 4);
    expect(parsed.verdict).toBe("SIGNAL");
    expect(parsed.reportPath).toBe(
      "/home/tony/projects/trading-forge/docs/replay-results/2026-05-25-quantum-disagreement.md",
    );
  });
});
