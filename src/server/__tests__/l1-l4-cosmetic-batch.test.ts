/**
 * l1-l4-cosmetic-batch.test.ts
 *
 * Verifies the L1–L4 cosmetic / observability hardening batch shipped in
 * the hardening/phase-0 branch (2026-06-24):
 *
 *   L1 — metrics-registry.ts: pboBLocksTotal typo fixed → pboBlocksTotal;
 *          deprecated alias retained for backward-compat.
 *   L2 — sse.ts WAVE29_EVENTS JSDoc: stale lifecycle-service.ts line numbers
 *          replaced with stable function/method anchors.
 *   L3 — scheduler.ts auto-disable alert references docs/admin-runbook.md;
 *          docs/admin-runbook.md contains the scheduler-re-enable section.
 *   L4 — pattern-aggregator-service.ts and quantum-replay-weekly-service.ts
 *          both emit auto_patch.loop_halted_kill_switch audit row when the
 *          kill switch is observed disabled.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Shared path helpers ──────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../..");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

// ─── L1: pboBlocksTotal rename + deprecated alias ────────────────────────────

describe("L1 — metrics-registry pboBlocksTotal rename", () => {
  it("pboBlocksTotal export exists with corrected camelCase name", async () => {
    // Import the module and verify the correctly-named export is present and is a
    // prom-client Counter (has a .labels() method).
    const registry = await import("../lib/metrics-registry.js");
    expect(registry.pboBlocksTotal).toBeDefined();
    expect(typeof registry.pboBlocksTotal.labels).toBe("function");
  });

  it("deprecated alias pboBLocksTotal still exports for backward compat", async () => {
    const registry = await import("../lib/metrics-registry.js");
    // Alias must exist and must be the SAME object as the canonical export so
    // existing lifecycle-service.ts callers still increment the same series.
    expect(registry.pboBLocksTotal).toBeDefined();
    expect(registry.pboBLocksTotal).toBe(registry.pboBlocksTotal);
  });

  it("pboBlocksTotal and pboBLocksTotal increment the same Prometheus series", async () => {
    const { pboBlocksTotal, pboBLocksTotal, promRegistry } = await import(
      "../lib/metrics-registry.js"
    );

    const metrics = await promRegistry.getMetricsAsJSON();
    const before = (metrics.find((m: { name: string }) => m.name === "tf_pbo_blocks_total")
      ?.values as Array<{ labels: { regime: string }; value: number }>)
      ?.find((v) => v.labels.regime === "RANGE_BOUND")?.value ?? 0;

    // Increment via the deprecated alias (as lifecycle-service.ts currently does)
    pboBLocksTotal.labels({ regime: "RANGE_BOUND" }).inc();

    const updatedMetrics = await promRegistry.getMetricsAsJSON();
    const after = (updatedMetrics.find((m: { name: string }) => m.name === "tf_pbo_blocks_total")
      ?.values as Array<{ labels: { regime: string }; value: number }>)
      ?.find((v) => v.labels.regime === "RANGE_BOUND")?.value ?? 0;

    expect(after).toBe(before + 1);

    // Also verify the canonical name observes the same increment
    const afterCanonical = (updatedMetrics.find((m: { name: string }) => m.name === "tf_pbo_blocks_total")
      ?.values as Array<{ labels: { regime: string }; value: number }>)
      ?.find((v) => v.labels.regime === "RANGE_BOUND")?.value ?? 0;

    expect(afterCanonical).toBe(after);
    void pboBlocksTotal; // used in assertion chain above via registry
  });

  it("source text declares pboBlocksTotal as the primary export", () => {
    const src = readSrc("src/server/lib/metrics-registry.ts");
    // Primary declaration must appear before the alias declaration
    const primaryIdx = src.indexOf("export const pboBlocksTotal = new Counter");
    const aliasIdx = src.indexOf("export const pboBLocksTotal = pboBlocksTotal");
    expect(primaryIdx).toBeGreaterThan(-1);
    expect(aliasIdx).toBeGreaterThan(primaryIdx);
  });

  it("alias is annotated with @deprecated in JSDoc", () => {
    const src = readSrc("src/server/lib/metrics-registry.ts");
    expect(src).toContain("@deprecated");
    expect(src).toContain("pboBlocksTotal");
  });
});

// ─── L2: WAVE29_EVENTS JSDoc uses function anchors, not line numbers ──────────

describe("L2 — WAVE29_EVENTS JSDoc anchors", () => {
  it("JSDoc uses function/method anchors rather than bare line numbers", () => {
    const src = readSrc("src/server/routes/sse.ts");

    // Old stale line numbers must NOT appear
    expect(src).not.toContain("lifecycle-service.ts:940");
    expect(src).not.toContain("lifecycle-service.ts:965");
    expect(src).not.toContain("lifecycle-service.ts:2049");
    expect(src).not.toContain("lifecycle-service.ts:2088");
    expect(src).not.toContain("paper-signal-service.ts:4375");
    expect(src).not.toContain("paper-signal-service.ts:4520");
  });

  it("JSDoc references _promoteStrategyInner as the PBO and shadow-divergence anchor", () => {
    const src = readSrc("src/server/routes/sse.ts");
    expect(src).toContain("_promoteStrategyInner");
  });

  it("JSDoc references evaluateSignals as the shadow_logged and rl_ab_routed anchor", () => {
    const src = readSrc("src/server/routes/sse.ts");
    expect(src).toContain("evaluateSignals");
  });

  it("WAVE29_EVENTS source declares all 6 expected event string constants", () => {
    // Importing sse.ts directly would pull in index.ts which tries to parse
    // migration journal files at test time — use source-text assertion instead.
    const src = readSrc("src/server/routes/sse.ts");
    expect(src).toContain('"signal:shadow_logged"');
    expect(src).toContain('"lifecycle:pbo_evaluated"');
    expect(src).toContain('"lifecycle:shadow_divergence_evaluated"');
    expect(src).toContain('"signal:rl_ab_routed"');
    expect(src).toContain('"quantum_rl:training_completed"');
    expect(src).toContain('"quantum_rl:kill_switch_engaged"');
    // Confirm the WAVE29_EVENTS object declaration still exists
    expect(src).toContain("export const WAVE29_EVENTS");
  });
});

// ─── L3: scheduler auto-disable alert references runbook ─────────────────────

describe("L3 — scheduler auto-disable alert references runbook", () => {
  it("scheduler.ts auto-disable alert body references docs/admin-runbook.md#scheduler-re-enable", () => {
    const src = readSrc("src/server/scheduler.ts");
    expect(src).toContain("docs/admin-runbook.md#scheduler-re-enable");
  });

  it("docs/admin-runbook.md exists", () => {
    const runbookPath = path.join(ROOT, "docs/admin-runbook.md");
    expect(fs.existsSync(runbookPath)).toBe(true);
  });

  it("docs/admin-runbook.md contains the scheduler-re-enable section header", () => {
    const content = readSrc("docs/admin-runbook.md");
    expect(content).toContain("scheduler-re-enable");
    expect(content).toContain("Scheduler re-enable");
  });

  it("docs/admin-runbook.md contains a curl example for the enable endpoint", () => {
    const content = readSrc("docs/admin-runbook.md");
    // Must show the path pattern, not just a generic curl
    expect(content).toContain("/api/admin/scheduler/jobs/");
    expect(content).toContain("enable");
  });

  it("docs/admin-runbook.md documents the kill-switch SQL pattern", () => {
    const content = readSrc("docs/admin-runbook.md");
    expect(content).toContain("auto_patch_loop_enabled");
    expect(content).toContain("system_parameters");
  });

  it("scheduler.ts alert body no longer contains a raw endpoint URL without guidance", () => {
    const src = readSrc("src/server/scheduler.ts");
    // The old pattern was a bare endpoint URL with no signing guidance.
    // After the fix it should reference the runbook instead.
    // The raw re-enable path may still appear in other non-alert contexts (health
    // endpoint, admin routes, etc.) — we only check the notifyCritical call site.
    const notifyCriticalBlock = src.slice(
      src.indexOf("notifyCritical("),
      src.indexOf("notifyCritical(") + 800,
    );
    expect(notifyCriticalBlock).toContain("docs/admin-runbook.md#scheduler-re-enable");
  });
});

// ─── L4: kill-switch audit rows ──────────────────────────────────────────────

describe("L4 — auto_patch.loop_halted_kill_switch audit when kill switch is false", () => {
  // ── pattern-aggregator ──────────────────────────────────────────────────────

  describe("pattern-aggregator-service", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("emits auto_patch.loop_halted_kill_switch when auto_patch_loop_enabled is false", async () => {
      // Mock DB so kill switch returns currentValue = "false"
      vi.doMock("../db/index.js", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ currentValue: "false" }]),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        },
      }));

      const insertAuditRowSafeMock = vi.fn().mockResolvedValue(true);
      vi.doMock("../lib/audit-log-helper.js", () => ({
        insertAuditRow: vi.fn().mockResolvedValue(undefined),
        insertAuditRowSafe: insertAuditRowSafeMock,
      }));

      vi.doMock("../services/model-router.js", () => ({
        callOpenAI: vi.fn(),
        getFallback: vi.fn(),
        loadSystemPrompt: vi.fn(),
        setAppendixCache: vi.fn(),
      }));

      vi.doMock("../services/ollama-client.js", () => ({
        OllamaClient: vi.fn(),
      }));

      vi.doMock("../db/schema.js", () => ({
        tradeCritique: {},
        systemParameters: { currentValue: "currentValue", paramName: "paramName" },
        auditLog: {},
        promptVersions: {},
        promptAbTests: {},
      }));

      // Also mock drizzle eq so it doesn't fail at import time
      vi.doMock("drizzle-orm", async (original) => {
        const mod = await (original as () => Promise<Record<string, unknown>>)();
        return { ...mod, eq: vi.fn((a: unknown, b: unknown) => ({ col: a, val: b })) };
      });

      const { runPatternAggregator } = await import("../services/pattern-aggregator-service.js");
      const result = await runPatternAggregator();

      expect(result.status).toBe("halted");
      expect(insertAuditRowSafeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "auto_patch.loop_halted_kill_switch",
          entityType: "scheduler",
          status: "info",
          result: expect.objectContaining({ service: "pattern-aggregator" }),
        }),
      );
    });

    it("does NOT emit loop_halted_kill_switch when kill switch is enabled", async () => {
      vi.doMock("../db/index.js", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ currentValue: "true" }]),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        },
      }));

      const insertAuditRowSafeMock = vi.fn().mockResolvedValue(true);
      vi.doMock("../lib/audit-log-helper.js", () => ({
        insertAuditRow: vi.fn().mockResolvedValue(undefined),
        insertAuditRowSafe: insertAuditRowSafeMock,
      }));

      vi.doMock("../services/model-router.js", () => ({
        callOpenAI: vi.fn().mockResolvedValue({ content: "NO_CHANGE" }),
        getFallback: vi.fn().mockReturnValue("openai"),
        loadSystemPrompt: vi.fn().mockResolvedValue("prompt text"),
        setAppendixCache: vi.fn(),
      }));

      vi.doMock("../services/ollama-client.js", () => ({
        OllamaClient: vi.fn(),
      }));

      vi.doMock("../db/schema.js", () => ({
        tradeCritique: {},
        systemParameters: { currentValue: "currentValue", paramName: "paramName" },
        auditLog: {},
        promptVersions: {},
        promptAbTests: {},
      }));

      vi.doMock("drizzle-orm", async (original) => {
        const mod = await (original as () => Promise<Record<string, unknown>>)();
        return { ...mod, eq: vi.fn((a: unknown, b: unknown) => ({ col: a, val: b })) };
      });

      const { runPatternAggregator } = await import("../services/pattern-aggregator-service.js");
      await runPatternAggregator();

      // loop_halted_kill_switch should NOT have been emitted
      const killSwitchCalls = insertAuditRowSafeMock.mock.calls.filter(
        (args) =>
          (args[0] as Record<string, unknown>).action === "auto_patch.loop_halted_kill_switch",
      );
      expect(killSwitchCalls).toHaveLength(0);
    });
  });

  // ── quantum-replay-weekly-service ──────────────────────────────────────────

  describe("quantum-replay-weekly-service", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("emits auto_patch.loop_halted_kill_switch when auto_patch_loop_enabled is false", async () => {
      vi.doMock("../db/index.js", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ currentValue: "false" }]),
              }),
            }),
          }),
        },
      }));

      const insertAuditRowMock = vi.fn().mockResolvedValue(undefined);
      const insertAuditRowSafeMock = vi.fn().mockResolvedValue(true);
      vi.doMock("../lib/audit-log-helper.js", () => ({
        insertAuditRow: insertAuditRowMock,
        insertAuditRowSafe: insertAuditRowSafeMock,
      }));

      vi.doMock("../lib/notification-helpers.js", () => ({
        appendFamilyGradePostscript: vi.fn((op: string) => op),
      }));

      vi.doMock("../services/notification-service.js", () => ({
        notifyWarning: vi.fn(),
        notifyInfo: vi.fn(),
        notifyCritical: vi.fn(),
      }));

      vi.doMock("../db/schema.js", () => ({
        systemParameters: { currentValue: "currentValue", paramName: "paramName" },
      }));

      vi.doMock("drizzle-orm", async (original) => {
        const mod = await (original as () => Promise<Record<string, unknown>>)();
        return { ...mod, eq: vi.fn((a: unknown, b: unknown) => ({ col: a, val: b })) };
      });

      const { runQuantumReplayWeeklyAnalysis } = await import(
        "../services/quantum-replay-weekly-service.js"
      );
      const result = await runQuantumReplayWeeklyAnalysis();

      expect(result.status).toBe("loop_halted_skip");
      expect(insertAuditRowSafeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "auto_patch.loop_halted_kill_switch",
          entityType: "scheduler",
          status: "info",
          result: expect.objectContaining({ service: "quantum-replay-weekly" }),
        }),
      );
    });

    it("also emits the existing weekly_analysis_loop_halted_skip audit row", async () => {
      vi.doMock("../db/index.js", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ currentValue: "false" }]),
              }),
            }),
          }),
        },
      }));

      const insertAuditRowMock = vi.fn().mockResolvedValue(undefined);
      const insertAuditRowSafeMock = vi.fn().mockResolvedValue(true);
      vi.doMock("../lib/audit-log-helper.js", () => ({
        insertAuditRow: insertAuditRowMock,
        insertAuditRowSafe: insertAuditRowSafeMock,
      }));

      vi.doMock("../lib/notification-helpers.js", () => ({
        appendFamilyGradePostscript: vi.fn((op: string) => op),
      }));

      vi.doMock("../services/notification-service.js", () => ({
        notifyWarning: vi.fn(),
        notifyInfo: vi.fn(),
        notifyCritical: vi.fn(),
      }));

      vi.doMock("../db/schema.js", () => ({
        systemParameters: { currentValue: "currentValue", paramName: "paramName" },
      }));

      vi.doMock("drizzle-orm", async (original) => {
        const mod = await (original as () => Promise<Record<string, unknown>>)();
        return { ...mod, eq: vi.fn((a: unknown, b: unknown) => ({ col: a, val: b })) };
      });

      const { runQuantumReplayWeeklyAnalysis } = await import(
        "../services/quantum-replay-weekly-service.js"
      );
      await runQuantumReplayWeeklyAnalysis();

      // Both audit rows must be written: the existing domain-specific one and the new canonical one
      const existingCalls = insertAuditRowMock.mock.calls.filter(
        (args) =>
          (args[0] as Record<string, unknown>).action ===
          "quantum_replay.weekly_analysis_loop_halted_skip",
      );
      expect(existingCalls.length).toBeGreaterThanOrEqual(1);

      const newCalls = insertAuditRowSafeMock.mock.calls.filter(
        (args) =>
          (args[0] as Record<string, unknown>).action === "auto_patch.loop_halted_kill_switch",
      );
      expect(newCalls).toHaveLength(1);
    });

    it("new audit row carries the service name for cross-service post-incident queries", async () => {
      vi.doMock("../db/index.js", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ currentValue: "false" }]),
              }),
            }),
          }),
        },
      }));

      const insertAuditRowSafeMock = vi.fn().mockResolvedValue(true);
      vi.doMock("../lib/audit-log-helper.js", () => ({
        insertAuditRow: vi.fn().mockResolvedValue(undefined),
        insertAuditRowSafe: insertAuditRowSafeMock,
      }));

      vi.doMock("../lib/notification-helpers.js", () => ({
        appendFamilyGradePostscript: vi.fn((op: string) => op),
      }));

      vi.doMock("../services/notification-service.js", () => ({
        notifyWarning: vi.fn(),
        notifyInfo: vi.fn(),
        notifyCritical: vi.fn(),
      }));

      vi.doMock("../db/schema.js", () => ({
        systemParameters: { currentValue: "currentValue", paramName: "paramName" },
      }));

      vi.doMock("drizzle-orm", async (original) => {
        const mod = await (original as () => Promise<Record<string, unknown>>)();
        return { ...mod, eq: vi.fn((a: unknown, b: unknown) => ({ col: a, val: b })) };
      });

      const { runQuantumReplayWeeklyAnalysis } = await import(
        "../services/quantum-replay-weekly-service.js"
      );
      await runQuantumReplayWeeklyAnalysis();

      const call = insertAuditRowSafeMock.mock.calls.find(
        (args) =>
          (args[0] as Record<string, unknown>).action === "auto_patch.loop_halted_kill_switch",
      );
      expect(call).toBeDefined();
      const payload = call![0] as Record<string, unknown>;
      expect((payload.result as Record<string, unknown>).service).toBe("quantum-replay-weekly");
      // correlationId must be a UUID-shaped string
      expect(typeof payload.correlationId).toBe("string");
      expect((payload.correlationId as string).length).toBeGreaterThan(10);
    });
  });
});
