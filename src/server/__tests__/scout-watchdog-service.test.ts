/**
 * Tests for scout-watchdog-service.ts (Pass 10 — Scout Observability)
 *
 * Covers:
 *   - runDrainStallCheck:
 *       * fires alert + SSE + audit when backlog has not decreased over 2h
 *         AND pipeline ACTIVE AND backlog > 5
 *       * does NOT fire when pipeline is PAUSED (n8n-never-pauses contract)
 *       * does NOT fire when backlog <= threshold
 *       * does NOT fire when backlog has decreased (drain working)
 *       * does NOT fire when no historical sample yet (cold start)
 *       * does NOT fire when a recent alert already exists (dedupe)
 *       * always appends a sample row (even when not alerting)
 *       * fail-OPEN on DB error in the count query
 *
 *   - runRejectDistributionCheck:
 *       * fires when total > 10 AND any single category > 80%
 *       * does NOT fire on small samples (< 10)
 *       * does NOT fire when distribution is balanced (< 80%)
 *       * does NOT fire when a recent alert exists (dedupe)
 *       * fail-OPEN on DB error
 *       * SSE event broadcast verified
 *
 *   - runRejectSpikeCheck:
 *       * fires when ≥10 rejects of a single type in last 5 min
 *       * does NOT fire when below threshold
 *       * does NOT fire when a recent (per-action) spike alert exists
 *       * fires per-action (multiple types spiking simultaneously)
 *       * fail-OPEN on DB error
 *
 *   - implication mapping for each reject action returns operator-friendly text
 *   - SSE broadcast survives a thrown SSE bus (logged, never propagates)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted spies ──────────────────────────────────────────────────
const broadcastSSESpy = vi.fn();
const notifyCriticalSpy = vi.fn();
const getModeSpy = vi.fn(async () => "ACTIVE");
const loggerSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// db.execute / db.insert mocks — we control the row shape per test.
const dbExecuteSpy = vi.fn();
const dbInsertValuesCatchSpy = vi.fn();
const dbInsertSpy = vi.fn((_table?: unknown) => ({
  values: vi.fn((_v?: unknown) => ({
    catch: dbInsertValuesCatchSpy,
  })),
}));

vi.mock("../db/index.js", () => ({
  db: {
    execute: (arg: unknown) => dbExecuteSpy(arg),
    insert: (arg: unknown) => dbInsertSpy(arg),
  },
}));
vi.mock("../db/schema.js", () => ({
  auditLog: { __tag: "auditLog" },
  scoutDrainSamples: { __tag: "scoutDrainSamples" },
}));
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: (event: string, data: unknown) => broadcastSSESpy(event, data),
}));
vi.mock("./pipeline-control-service.js", () => ({
  getMode: () => getModeSpy(),
}));
vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: () => getModeSpy(),
}));
vi.mock("./notification-service.js", () => ({
  notifyCritical: (title: string, body: string, ctx?: unknown) =>
    notifyCriticalSpy(title, body, ctx),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: (title: string, body: string, ctx?: unknown) =>
    notifyCriticalSpy(title, body, ctx),
}));
vi.mock("../lib/logger.js", () => ({ logger: loggerSpy }));

beforeEach(() => {
  vi.clearAllMocks();
  // Default stubs — each test overrides as needed.
  dbExecuteSpy.mockReset();
  dbInsertValuesCatchSpy.mockReset();
  dbInsertValuesCatchSpy.mockReturnValue(Promise.resolve());
  getModeSpy.mockResolvedValue("ACTIVE");
});

// ─── Helper: queue successive db.execute results in order ──────────
function queueExecuteResults(results: unknown[]): void {
  let i = 0;
  dbExecuteSpy.mockImplementation(async () => {
    const r = results[i] ?? [];
    i += 1;
    return r;
  });
}

describe("implicationFor — operator-friendly mapping", () => {
  it("returns descriptive text for every known reject action", async () => {
    const { __test__ } = await import("../services/scout-watchdog-service.js");
    expect(__test__.implicationFor("scout.rejected_regex")).toMatch(/placeholder/);
    expect(__test__.implicationFor("scout.rejected_auditor")).toMatch(/bouncer|noise/);
    expect(__test__.implicationFor("scout.synthesizer_refused")).toMatch(/synthesizer/);
    expect(__test__.implicationFor("scout.rejected_compile")).toMatch(/malformed|hallucinat/);
    expect(__test__.implicationFor("scout.rejected_critic")).toMatch(/synthesis|critic|prompt/i);
  });
  it("returns a fallback for unknown actions", async () => {
    const { __test__ } = await import("../services/scout-watchdog-service.js");
    expect(__test__.implicationFor("not.a.real.action")).toMatch(/audit_log/);
  });
});

describe("runDrainStallCheck", () => {
  it("does NOT fire when pipeline is PAUSED — appends sample only", async () => {
    getModeSpy.mockResolvedValue("PAUSED");
    queueExecuteResults([
      [{ n: 100 }],     // count query (high backlog)
      [],               // prune
    ]);
    const { runDrainStallCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runDrainStallCheck();
    expect(r.alertFired).toBe(false);
    expect(r.pipelineMode).toBe("PAUSED");
    expect(notifyCriticalSpy).not.toHaveBeenCalled();
    expect(broadcastSSESpy).not.toHaveBeenCalledWith("scout-health:drain-stall", expect.anything());
    // Sample insert should still have run.
    expect(dbInsertSpy).toHaveBeenCalled();
  });

  it("does NOT fire when backlog is <= threshold (5)", async () => {
    queueExecuteResults([
      [{ n: 3 }],       // count
      [],               // prune
    ]);
    const { runDrainStallCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runDrainStallCheck();
    expect(r.alertFired).toBe(false);
    expect(r.scoutedNow).toBe(3);
    expect(notifyCriticalSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire when no historical sample exists (cold start)", async () => {
    queueExecuteResults([
      [{ n: 50 }],      // count
      [],               // prune
      [],               // historical sample query — empty
    ]);
    const { runDrainStallCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runDrainStallCheck();
    expect(r.alertFired).toBe(false);
    expect(r.scoutedThen).toBeNull();
  });

  it("does NOT fire when backlog has decreased (drain working)", async () => {
    queueExecuteResults([
      [{ n: 30 }],                    // count now
      [],                             // prune
      [{ scouted_count: 80 }],        // 2h ago
    ]);
    const { runDrainStallCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runDrainStallCheck();
    expect(r.alertFired).toBe(false);
    expect(r.scoutedNow).toBe(30);
    expect(r.scoutedThen).toBe(80);
  });

  it("does NOT double-alert when a recent drain_stall audit row exists", async () => {
    queueExecuteResults([
      [{ n: 100 }],                   // count now
      [],                             // prune
      [{ scouted_count: 100 }],       // 2h ago — flat
      [{ exists: 1 }],                // recentAlertExists — yes
    ]);
    const { runDrainStallCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runDrainStallCheck();
    expect(r.alertFired).toBe(false);
    expect(notifyCriticalSpy).not.toHaveBeenCalled();
  });

  it("fires alert + SSE + audit when stalled, ACTIVE, and above threshold", async () => {
    queueExecuteResults([
      [{ n: 120 }],                   // count
      [],                             // prune
      [{ scouted_count: 110 }],       // 2h ago — backlog grew (≥, treat as stall)
      [],                             // recentAlertExists — none
      [{ action: "scout.audited", n: 0 }], // synth stats
      [{ last_at: new Date("2026-05-01") }], // last candidate
      [],                             // last reject reasons
    ]);
    const { runDrainStallCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runDrainStallCheck();
    expect(r.alertFired).toBe(true);
    expect(notifyCriticalSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSSESpy).toHaveBeenCalledWith(
      "scout-health:drain-stall",
      expect.objectContaining({ scoutedNow: 120, scoutedThen: 110, pipelineMode: "ACTIVE" }),
    );
  });

  it("fail-OPEN on DB error during count query (no alert, no throw)", async () => {
    dbExecuteSpy.mockRejectedValueOnce(new Error("postgres dropped the connection"));
    const { runDrainStallCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runDrainStallCheck();
    expect(r.alertFired).toBe(false);
    expect(notifyCriticalSpy).not.toHaveBeenCalled();
    expect(loggerSpy.warn).toHaveBeenCalled();
  });
});

describe("runRejectDistributionCheck", () => {
  it("does NOT fire when total < 10", async () => {
    queueExecuteResults([
      [
        { action: "scout.rejected_regex", n: 5 },
        { action: "scout.rejected_auditor", n: 2 },
      ],
    ]);
    const { runRejectDistributionCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectDistributionCheck();
    expect(r.alertFired).toBe(false);
    expect(notifyCriticalSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire when no single category dominates (>80%)", async () => {
    queueExecuteResults([
      [
        { action: "scout.rejected_regex", n: 30 },
        { action: "scout.rejected_auditor", n: 30 },
        { action: "scout.rejected_compile", n: 30 },
      ],
    ]);
    const { runRejectDistributionCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectDistributionCheck();
    expect(r.alertFired).toBe(false);
    expect(r.total).toBe(90);
  });

  it("fires when total > 10 AND a single category > 80%", async () => {
    queueExecuteResults([
      [
        { action: "scout.rejected_auditor", n: 90 },
        { action: "scout.rejected_compile", n: 5 },
      ],
      [],   // recentAlertExists — none
    ]);
    const { runRejectDistributionCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectDistributionCheck();
    expect(r.alertFired).toBe(true);
    expect(r.dominantCategory).toBe("scout.rejected_auditor");
    expect(broadcastSSESpy).toHaveBeenCalledWith(
      "scout-health:reject-skew",
      expect.objectContaining({
        dominantCategory: "scout.rejected_auditor",
        total: 95,
      }),
    );
    expect(notifyCriticalSpy).toHaveBeenCalled();
  });

  it("does NOT double-alert when recent reject_distribution_skewed audit row exists", async () => {
    queueExecuteResults([
      [
        { action: "scout.rejected_auditor", n: 90 },
        { action: "scout.rejected_compile", n: 5 },
      ],
      [{ exists: 1 }],   // recent alert exists
    ]);
    const { runRejectDistributionCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectDistributionCheck();
    expect(r.alertFired).toBe(false);
    expect(notifyCriticalSpy).not.toHaveBeenCalled();
  });

  it("fail-OPEN on DB error", async () => {
    dbExecuteSpy.mockRejectedValueOnce(new Error("connection refused"));
    const { runRejectDistributionCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectDistributionCheck();
    expect(r.alertFired).toBe(false);
    expect(r.total).toBe(0);
  });
});

describe("runRejectSpikeCheck", () => {
  it("does NOT fire when no single type exceeds threshold", async () => {
    queueExecuteResults([
      [
        { action: "scout.rejected_regex", n: 4 },
        { action: "scout.rejected_auditor", n: 7 },
      ],
    ]);
    const { runRejectSpikeCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectSpikeCheck();
    expect(r.alertFired).toBe(false);
    expect(broadcastSSESpy).not.toHaveBeenCalledWith("scout-health:reject-spike", expect.anything());
  });

  it("fires SSE + audit per-action when ≥10 rejects of a single type", async () => {
    queueExecuteResults([
      [{ action: "scout.rejected_auditor", n: 15 }],
      [],   // recentAlertExistsMinutes for that action
    ]);
    const { runRejectSpikeCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectSpikeCheck();
    expect(r.alertFired).toBe(true);
    expect(r.spikedActions).toEqual([{ action: "scout.rejected_auditor", count: 15 }]);
    expect(broadcastSSESpy).toHaveBeenCalledWith(
      "scout-health:reject-spike",
      expect.objectContaining({ action: "scout.rejected_auditor", count: 15 }),
    );
  });

  it("does NOT fire when per-action recent alert exists (dedupe)", async () => {
    queueExecuteResults([
      [{ action: "scout.rejected_auditor", n: 15 }],
      [{ exists: 1 }],   // dedupe hit
    ]);
    const { runRejectSpikeCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectSpikeCheck();
    expect(r.alertFired).toBe(false);
    expect(broadcastSSESpy).not.toHaveBeenCalled();
  });

  it("fires for multiple action types spiking simultaneously", async () => {
    queueExecuteResults([
      [
        { action: "scout.rejected_auditor", n: 15 },
        { action: "scout.rejected_compile", n: 12 },
      ],
      [],   // dedupe miss for auditor
      [],   // dedupe miss for compile
    ]);
    const { runRejectSpikeCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectSpikeCheck();
    expect(r.alertFired).toBe(true);
    expect(r.spikedActions).toHaveLength(2);
    expect(broadcastSSESpy).toHaveBeenCalledTimes(2);
  });

  it("fail-OPEN on DB error", async () => {
    dbExecuteSpy.mockRejectedValueOnce(new Error("db down"));
    const { runRejectSpikeCheck } = await import("../services/scout-watchdog-service.js");
    const r = await runRejectSpikeCheck();
    expect(r.alertFired).toBe(false);
    expect(r.spikedActions).toEqual([]);
  });
});

describe("SSE bus resilience", () => {
  it("a thrown broadcastSSE does not propagate from runDrainStallCheck", async () => {
    broadcastSSESpy.mockImplementation(() => {
      throw new Error("sse closed");
    });
    queueExecuteResults([
      [{ n: 50 }],                    // count
      [],                             // prune
      [{ scouted_count: 50 }],        // 2h ago — flat
      [],                             // dedupe miss
      [],                             // synth stats
      [{ last_at: null }],            // last candidate
      [],                             // last rejects
    ]);
    const { runDrainStallCheck } = await import("../services/scout-watchdog-service.js");
    await expect(runDrainStallCheck()).resolves.toBeDefined();
    // SSE error is logged at warn but does not abort.
    expect(loggerSpy.warn).toHaveBeenCalled();
  });
});
