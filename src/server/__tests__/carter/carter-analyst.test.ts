/**
 * carter-analyst.test.ts — unit tests for Carter's proactive "Analyst".
 *
 * Two surfaces:
 *   1. runCarterAnalystSweep — gathers signals (fail-soft each), builds the
 *      bounded insight bundle, stores it via insertMemory(kind='insight'), posts
 *      a fail-soft Discord digest, and NEVER throws.
 *   2. get_daily_insights — returns the latest stored bundle parsed, or
 *      { note: "no insights yet" } when none / unparseable.
 *
 * No network, no DB — every dependency is mocked.
 */

// ── Hoisted mutable mock state ────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  // gatherer impls (per-test overridable; default = realistic bounded shapes)
  pipelineImpl: () => Promise.resolve<unknown>({
    stage_counts: { CANDIDATE: 4 },
    recent_blocks: [{ gate_or_action: "lifecycle.block", count: 5, sample_reason: "wfe" }],
    oldest_stuck: [],
    summary: "ok",
  }),
  hardeningImpl: () => Promise.resolve<unknown>({
    recent_errors: [{ action: "x", status: "error", at: "t" }],
    stale_strategies: [{ name: "a" }, { name: "b" }],
    stuck_pre_paper: [{ name: "c" }],
    open_issues: [{ issue_key: "k" }],
    summary: "ok",
  }),
  decisionsImpl: (_p: unknown) => Promise.resolve<unknown>({
    count: 3,
    decisions: [{ strategy: "a", fromState: "TESTING", toState: "PAPER", at: "t" }],
  }),
  // store
  insertMemoryImpl: () => Promise.resolve<number | null>(777),
  queryMemoriesImpl: () => Promise.resolve<Array<Record<string, unknown>>>([]),
  capturedMemory: undefined as unknown,
  capturedQuery: undefined as unknown,
  // side-effect capture
  notifyCalls: [] as unknown[],
  notifyThrows: false,
  auditCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../lib/carter/carter-recommend.js", () => ({
  CARTER_RECOMMEND_HANDLERS: {
    diagnose_pipeline: () => state.pipelineImpl(),
    find_hardening_opportunities: () => state.hardeningImpl(),
  },
}));

vi.mock("../../lib/carter/carter-introspect.js", () => ({
  CARTER_INTROSPECT_HANDLERS: {
    read_recent_decisions: (p: unknown) => state.decisionsImpl(p),
  },
}));

vi.mock("../../lib/carter/carter-memory-store.js", () => ({
  insertMemory: (args: unknown) => {
    state.capturedMemory = args;
    return state.insertMemoryImpl();
  },
  queryMemories: (args: unknown) => {
    state.capturedQuery = args;
    return state.queryMemoriesImpl();
  },
}));

vi.mock("../../services/notification-service.js", () => ({
  notify: (opts: unknown) => {
    state.notifyCalls.push(opts);
    if (state.notifyThrows) throw new Error("discord_down");
  },
}));

vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: async (row: Record<string, unknown>) => {
    state.auditCalls.push(row);
    return true;
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runCarterAnalystSweep,
  _resetAnalystLockForTest,
} from "../../services/carter-analyst-service.js";
import { CARTER_INSIGHTS_READ_HANDLERS } from "../../lib/carter/carter-insights.js";

const getDailyInsights = CARTER_INSIGHTS_READ_HANDLERS.get_daily_insights!;

// 08:00 ET on 2026-06-29 (EDT, UTC-4) = 12:00 UTC — passes the ET-hour guard.
const AS_OF_8ET = new Date("2026-06-29T12:00:00.000Z");
// 09:00 ET (13:00 UTC EDT) — fails the ET-hour guard.
const AS_OF_9ET = new Date("2026-06-29T13:00:00.000Z");

beforeEach(() => {
  _resetAnalystLockForTest();
  state.pipelineImpl = () => Promise.resolve({
    stage_counts: { CANDIDATE: 4 },
    recent_blocks: [{ gate_or_action: "lifecycle.block", count: 5, sample_reason: "wfe" }],
    oldest_stuck: [],
    summary: "ok",
  });
  state.hardeningImpl = () => Promise.resolve({
    recent_errors: [{ action: "x", status: "error", at: "t" }],
    stale_strategies: [{ name: "a" }, { name: "b" }],
    stuck_pre_paper: [{ name: "c" }],
    open_issues: [{ issue_key: "k" }],
    summary: "ok",
  });
  state.decisionsImpl = () => Promise.resolve({
    count: 3,
    decisions: [{ strategy: "a", fromState: "TESTING", toState: "PAPER", at: "t" }],
  });
  state.insertMemoryImpl = () => Promise.resolve(777);
  state.queryMemoriesImpl = () => Promise.resolve([]);
  state.capturedMemory = undefined;
  state.capturedQuery = undefined;
  state.notifyCalls = [];
  state.notifyThrows = false;
  state.auditCalls = [];
});

// ─── runCarterAnalystSweep — happy path ────────────────────────────────────────

describe("runCarterAnalystSweep — builds + stores + posts", () => {
  it("gathers signals, stores a kind='insight' bundle, posts Discord, audits success", async () => {
    const r = await runCarterAnalystSweep({ asOf: AS_OF_8ET });

    expect(r.status).toBe("completed");
    expect(r.memoryId).toBe(777);
    expect(typeof r.headline).toBe("string");
    expect(r.headline!.length).toBeGreaterThan(0);

    // stored as an insight memory with the analyst source
    const mem = state.capturedMemory as Record<string, unknown>;
    expect(mem.kind).toBe("insight");
    expect(mem.source).toBe("analyst");

    // bundle content round-trips with all 5 keys
    const bundle = JSON.parse(mem.content as string) as Record<string, unknown>;
    expect(bundle).toHaveProperty("generated_at_iso", AS_OF_8ET.toISOString());
    expect(bundle).toHaveProperty("pipeline");
    expect(bundle).toHaveProperty("hardening");
    expect(bundle).toHaveProperty("recent_decisions");
    expect(bundle.headline).toBe(r.headline);

    // headline composed from counts (no LLM)
    expect(bundle.headline).toContain("2 strategies stale");
    expect(bundle.headline).toContain("3 recent decisions");

    // Discord posted once
    expect(state.notifyCalls).toHaveLength(1);

    // success audit row
    const completed = state.auditCalls.find((a) => a.action === "carter_analyst.sweep_completed");
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("success");
  });

  it("suppresses the Discord post in dryRun but still stores + audits", async () => {
    const r = await runCarterAnalystSweep({ asOf: AS_OF_8ET, dryRun: true });
    expect(r.status).toBe("completed");
    expect(state.capturedMemory).toBeDefined();
    expect(state.notifyCalls).toHaveLength(0);
    expect(state.auditCalls.some((a) => a.action === "carter_analyst.sweep_completed")).toBe(true);
  });
});

// ─── runCarterAnalystSweep — fail-soft ─────────────────────────────────────────

describe("runCarterAnalystSweep — fail-soft", () => {
  it("still builds + stores when a gatherer throws (envelopes the error)", async () => {
    state.pipelineImpl = () => Promise.reject(new Error("boom"));

    const r = await runCarterAnalystSweep({ asOf: AS_OF_8ET });
    expect(r.status).toBe("completed");

    const bundle = JSON.parse((state.capturedMemory as Record<string, unknown>).content as string) as Record<string, unknown>;
    expect(bundle.pipeline).toEqual({ error: "diagnose_pipeline_failed" });
    // other gatherers still present
    expect(bundle.hardening).toHaveProperty("stale_strategies");
    expect(r.status).toBe("completed");
  });

  it("does NOT fail the sweep when the Discord post throws", async () => {
    state.notifyThrows = true;
    const r = await runCarterAnalystSweep({ asOf: AS_OF_8ET });
    expect(r.status).toBe("completed");
    expect(r.memoryId).toBe(777);
    // a warning completion audit is written when Discord fails
    const completed = state.auditCalls.find((a) => a.action === "carter_analyst.sweep_completed");
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("warning");
  });

  it("skips (no store, no Discord) when the ET-hour guard fails", async () => {
    const r = await runCarterAnalystSweep({ asOf: AS_OF_9ET });
    expect(r.status).toBe("skipped_dst_guard");
    expect(state.capturedMemory).toBeUndefined();
    expect(state.notifyCalls).toHaveLength(0);
    expect(state.auditCalls.some((a) => a.action === "carter_analyst.sweep_skipped_dst_guard")).toBe(true);
  });

  it("composes a quiet headline when every count is empty", async () => {
    state.pipelineImpl = () => Promise.resolve({ stage_counts: {}, recent_blocks: [], oldest_stuck: [], summary: "" });
    state.hardeningImpl = () => Promise.resolve({ recent_errors: [], stale_strategies: [], stuck_pre_paper: [], summary: "" });
    state.decisionsImpl = () => Promise.resolve({ count: 0, decisions: [] });

    const r = await runCarterAnalystSweep({ asOf: AS_OF_8ET });
    expect(r.status).toBe("completed");
    expect(r.headline).toContain("Nothing notable");
  });
});

// ─── get_daily_insights ────────────────────────────────────────────────────────

describe("get_daily_insights — read latest bundle", () => {
  it("returns the parsed latest bundle", async () => {
    const bundle = {
      generated_at_iso: "2026-06-29T12:00:00.000Z",
      headline: "2 strategies stale.",
      pipeline: { stage_counts: { CANDIDATE: 4 } },
      hardening: { stale_strategies: [{ name: "a" }] },
      recent_decisions: { count: 3 },
    };
    state.queryMemoriesImpl = () => Promise.resolve([
      { id: 1, kind: "insight", topic: null, content: JSON.stringify(bundle), createdAt: new Date("2026-06-29T12:00:00Z") },
    ]);

    const r = (await getDailyInsights({})) as Record<string, unknown>;
    expect(r.generated_at).toBe("2026-06-29T12:00:00.000Z");
    expect(r.headline).toBe("2 strategies stale.");
    expect(r.pipeline).toEqual({ stage_counts: { CANDIDATE: 4 } });
    expect(r.hardening).toEqual({ stale_strategies: [{ name: "a" }] });
    expect(r.recent_decisions).toEqual({ count: 3 });

    // queried with the insight kind, limit 1
    const q = state.capturedQuery as Record<string, unknown>;
    expect(q.kind).toBe("insight");
    expect(q.limit).toBe(1);
  });

  it("returns { note: 'no insights yet' } when none exist", async () => {
    state.queryMemoriesImpl = () => Promise.resolve([]);
    const r = (await getDailyInsights({})) as Record<string, unknown>;
    expect(r).toEqual({ note: "no insights yet" });
  });

  it("returns { note: 'no insights yet' } when the stored content is unparseable", async () => {
    state.queryMemoriesImpl = () => Promise.resolve([
      { id: 1, kind: "insight", topic: null, content: "{not json", createdAt: new Date() },
    ]);
    const r = (await getDailyInsights({})) as Record<string, unknown>;
    expect(r).toEqual({ note: "no insights yet" });
  });
});
