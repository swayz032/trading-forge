/**
 * Deep-scan #7 fix wave — A6 (DS7-C2): windows-health-check reboot-pending
 * pause auto-resume with strict provenance.
 *
 * Contract under test (maybeAutoResumeAfterReboot):
 *   1. paused-by-service + RebootPending flag CLEAR → auto-resume (setMode
 *      ACTIVE), provenance cleared, windows_health.auto_resumed_after_reboot
 *      audit row, Discord INFO with family postscript.
 *   2. paused-by-operator (latest pipeline.mode_change is NOT our reboot
 *      pause) → NO resume; provenance cleared so we never steal ownership.
 *   3. flag still set → the healthy branch is never reached, so the pause
 *      stays; verified via the pending_reboot pause path recording provenance
 *      WITHOUT any resume side effects.
 *   4. no provenance → no-op.
 *   5. pipeline no longer PAUSED → no resume, provenance cleared.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted spies ──────────────────────────────────────────────────────────────
const pipelineMocks = vi.hoisted(() => ({
  getMode: vi.fn(async () => "PAUSED" as string),
  setMode: vi.fn(async (_mode?: unknown, _reason?: unknown) => ({ previousMode: "PAUSED", newMode: "ACTIVE", n8n: {} })),
  isActive: vi.fn(async () => false),
}));
vi.mock("../services/pipeline-control-service.js", () => pipelineMocks);

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

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

// db mock — two select chains are used by maybeAutoResumeAfterReboot:
//   select().from().where().limit(1)            → provenance row
//   select().from().where().orderBy().limit(1)  → latest pipeline.mode_change
// A FIFO queue serves results in call order (provenance first, audit second).
const dbMocks = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const nextResult = async () => selectQueue.shift() ?? [];
  const chain = () => ({
    from: () => ({
      where: () => ({
        limit: nextResult,
        orderBy: () => ({ limit: nextResult }),
      }),
    }),
  });
  return {
    selectQueue,
    insertCalls,
    db: {
      select: vi.fn(chain),
      insert: vi.fn(() => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoUpdate: async (opts: Record<string, unknown>) => {
            insertCalls.push({ ...v, _onConflictSet: (opts as { set?: unknown }).set });
          },
        }),
      })),
    },
  };
});
vi.mock("../db/index.js", () => ({ db: dbMocks.db, client: { end: vi.fn() } }));
vi.mock("../db/schema.js", () => ({
  systemParameters: { paramName: "param_name", currentValue: "current_value" },
  auditLog: { action: "action", input: "input", createdAt: "created_at" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  desc: vi.fn((c: unknown) => ({ c })),
}));

import {
  maybeAutoResumeAfterReboot,
  setRebootPauseProvenance,
  REBOOT_PAUSE_PROVENANCE_PARAM,
} from "../services/windows-health-check-service.js";
import { broadcastSSE } from "../routes/sse.js";

const OUR_PAUSE_INPUT = {
  newMode: "PAUSED",
  reason: "pre-market-health-check: windows-pending-reboot — reboot required before trading",
};
const OPERATOR_PAUSE_INPUT = {
  newMode: "PAUSED",
  reason: "operator paused manually from dashboard",
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.selectQueue.length = 0;
  dbMocks.insertCalls.length = 0;
  pipelineMocks.getMode.mockResolvedValue("PAUSED");
});

describe("A6 — auto-resume after reboot-pending pause", () => {
  it("paused-by-service + flag clear → resumes, clears provenance, audits, Discord INFO", async () => {
    dbMocks.selectQueue.push([{ currentValue: "1" }]); // provenance row
    dbMocks.selectQueue.push([{ input: OUR_PAUSE_INPUT }]); // latest mode change = ours

    // deep-scan 2026-07-11: inject a HEALTHY (exit 0) re-check so this stays a deterministic unit test.
    // Without the injection maybeAutoResumeAfterReboot spawns the real pre-trading-day-health-check.ps1
    // against this tower — an accidental integration test that only passes when no reboot is pending.
    const result = await maybeAutoResumeAfterReboot({ _runHealthCheckForTest: async () => 0 });

    expect(result.resumed).toBe(true);
    expect(result.outcome).toBe("resumed");
    expect(pipelineMocks.setMode).toHaveBeenCalledTimes(1);
    expect(pipelineMocks.setMode.mock.calls[0]?.[0]).toBe("ACTIVE");
    expect(String(pipelineMocks.setMode.mock.calls[0]?.[1])).toContain("auto_resumed_after_reboot");

    // Provenance cleared (upsert with "0")
    const clearCall = dbMocks.insertCalls.find((c) => c.paramName === REBOOT_PAUSE_PROVENANCE_PARAM);
    expect(clearCall).toBeDefined();
    expect(clearCall?.currentValue).toBe("0");

    // Audit row
    expect(auditMocks.insertAuditRowSafe).toHaveBeenCalledTimes(1);
    const row = auditMocks.insertAuditRowSafe.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.action).toBe("windows_health.auto_resumed_after_reboot");
    expect(row.status).toBe("success");
    expect(row.correlationId).toBeTruthy();

    // Discord INFO with family-grade postscript body
    expect(notifyMocks.notifyInfo).toHaveBeenCalledTimes(1);
    expect(String(notifyMocks.notifyInfo.mock.calls[0]?.[1])).toContain("automatically resumed");

    expect(broadcastSSE).toHaveBeenCalledWith(
      "windows:health-check-auto-resumed",
      expect.objectContaining({ reason: "reboot_pending_flag_cleared" }),
    );
  });

  // deep-scan 2026-07-11 HIGH regression: the DECLINE branch. When called directly (weekend cron /
  // boot path — no healthAlreadyVerified) and the re-check reports NOT healthy (reboot still pending),
  // the resume MUST be declined and the pipeline MUST stay PAUSED (never setMode ACTIVE). Pre-fix this
  // path had no re-check and would have resumed with a reboot pending (C8 bypass).
  it("all guards pass but reboot still pending (exit 1) → DECLINE, pipeline stays PAUSED", async () => {
    dbMocks.selectQueue.push([{ currentValue: "1" }]); // provenance row
    dbMocks.selectQueue.push([{ input: OUR_PAUSE_INPUT }]); // latest mode change = ours

    const result = await maybeAutoResumeAfterReboot({ _runHealthCheckForTest: async () => 1 }); // 1 = pending_reboot

    expect(result.resumed).toBe(false);
    expect(result.outcome).toBe("reboot_still_pending");
    expect(pipelineMocks.setMode).not.toHaveBeenCalled(); // never resumes
    expect(notifyMocks.notifyInfo).not.toHaveBeenCalled();
  });

  it("paused-by-operator + flag clear → NO resume; provenance cleared (ownership transferred)", async () => {
    dbMocks.selectQueue.push([{ currentValue: "1" }]); // provenance says we paused once
    dbMocks.selectQueue.push([{ input: OPERATOR_PAUSE_INPUT }]); // but operator paused after us

    const result = await maybeAutoResumeAfterReboot();

    expect(result.resumed).toBe(false);
    expect(result.outcome).toBe("operator_owns_pause");
    expect(pipelineMocks.setMode).not.toHaveBeenCalled();
    expect(notifyMocks.notifyInfo).not.toHaveBeenCalled();
    expect(auditMocks.insertAuditRowSafe).not.toHaveBeenCalled();
    // Provenance cleared so a later healthy pass never resumes the operator's pause
    const clearCall = dbMocks.insertCalls.find((c) => c.paramName === REBOOT_PAUSE_PROVENANCE_PARAM);
    expect(clearCall?.currentValue).toBe("0");
  });

  it("no provenance → no-op (never resumes an arbitrary pause)", async () => {
    dbMocks.selectQueue.push([]); // no provenance row

    const result = await maybeAutoResumeAfterReboot();

    expect(result.resumed).toBe(false);
    expect(result.outcome).toBe("no_provenance");
    expect(pipelineMocks.setMode).not.toHaveBeenCalled();
    expect(dbMocks.insertCalls.length).toBe(0);
  });

  it("provenance set to 0 (cleared) → no-op", async () => {
    dbMocks.selectQueue.push([{ currentValue: "0" }]);

    const result = await maybeAutoResumeAfterReboot();

    expect(result.resumed).toBe(false);
    expect(result.outcome).toBe("no_provenance");
    expect(pipelineMocks.setMode).not.toHaveBeenCalled();
  });

  it("pipeline no longer PAUSED → no resume, stale provenance cleared", async () => {
    dbMocks.selectQueue.push([{ currentValue: "1" }]);
    pipelineMocks.getMode.mockResolvedValue("ACTIVE");

    const result = await maybeAutoResumeAfterReboot();

    expect(result.resumed).toBe(false);
    expect(result.outcome).toBe("not_paused");
    expect(pipelineMocks.setMode).not.toHaveBeenCalled();
    const clearCall = dbMocks.insertCalls.find((c) => c.paramName === REBOOT_PAUSE_PROVENANCE_PARAM);
    expect(clearCall?.currentValue).toBe("0");
  });
});

describe("A6 — provenance writer", () => {
  it("setRebootPauseProvenance(true) upserts the numeric-1 system_parameters row", async () => {
    await setRebootPauseProvenance(true);
    expect(dbMocks.insertCalls.length).toBe(1);
    expect(dbMocks.insertCalls[0]?.paramName).toBe(REBOOT_PAUSE_PROVENANCE_PARAM);
    expect(dbMocks.insertCalls[0]?.currentValue).toBe("1");
    expect(dbMocks.insertCalls[0]?.domain).toBe("scheduler");
  });

  it("setRebootPauseProvenance(false) upserts 0", async () => {
    await setRebootPauseProvenance(false);
    expect(dbMocks.insertCalls[0]?.currentValue).toBe("0");
  });
});

// Flag-still-set case: when RebootPending is STILL set the script exits 1 →
// status=pending_reboot → the healthy branch (and therefore auto-resume) is
// never reached; the service re-pauses and re-records provenance. Verified via
// the real runPreTradingDayHealthCheck against stub PowerShell scripts on
// win32 hosts (skipped elsewhere — the service is Windows-specific).
describe.runIf(process.platform === "win32")("A6 — pending_reboot path records provenance, never resumes", () => {
  it("exit-1 stub → pipeline paused + provenance=1 + NO setMode(ACTIVE) / notifyInfo", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-ds7-"));
    const stub = path.join(dir, "pending-reboot-stub.ps1");
    fs.writeFileSync(stub, "exit 1\n");

    const { runPreTradingDayHealthCheck } = await import("../services/windows-health-check-service.js");
    const result = await runPreTradingDayHealthCheck({ scriptPath: stub });

    expect(result.status).toBe("pending_reboot");
    expect(result.pipelinePaused).toBe(true);
    // Paused (setMode PAUSED) but never resumed (no ACTIVE call)
    const modes = pipelineMocks.setMode.mock.calls.map((c) => c[0]);
    expect(modes).toContain("PAUSED");
    expect(modes).not.toContain("ACTIVE");
    expect(notifyMocks.notifyInfo).not.toHaveBeenCalled();
    // Durable provenance recorded
    const prov = dbMocks.insertCalls.find((c) => c.paramName === REBOOT_PAUSE_PROVENANCE_PARAM);
    expect(prov?.currentValue).toBe("1");

    fs.rmSync(dir, { recursive: true, force: true });
  }, 90_000);

  it("healthy stub with our provenance → full resume through the healthy branch", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-ds7-"));
    const stub = path.join(dir, "healthy-stub.ps1");
    fs.writeFileSync(stub, "Write-Output '{\"checks\":[]}'\nexit 0\n");

    dbMocks.selectQueue.push([{ currentValue: "1" }]); // provenance = ours
    dbMocks.selectQueue.push([{ input: OUR_PAUSE_INPUT }]); // latest mode change = ours

    const { runPreTradingDayHealthCheck } = await import("../services/windows-health-check-service.js");
    const result = await runPreTradingDayHealthCheck({ scriptPath: stub });

    expect(result.status).toBe("healthy");
    expect(result.pipelinePaused).toBe(false);
    expect(pipelineMocks.setMode).toHaveBeenCalledTimes(1);
    expect(pipelineMocks.setMode.mock.calls[0]?.[0]).toBe("ACTIVE");
    expect(notifyMocks.notifyInfo).toHaveBeenCalledTimes(1);

    fs.rmSync(dir, { recursive: true, force: true });
  }, 90_000);
});
