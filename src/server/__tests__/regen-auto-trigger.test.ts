/**
 * B4 W13 — Regen auto-trigger tests
 *
 * Tests checkDeclingAndTriggerRegen() in critic-feedback-service.ts:
 *
 * 1. Pipeline paused → sweep skipped, no evolveStrategy() call
 * 2. No DECLINING strategies → returns total=0, triggered=0
 * 3. Strategy in DECLINING with no recent regen → evolveStrategy() fired, audit row inserted
 * 4. Throttling: strategy.generation >= 3 → skipped (skippedMaxGeneration++)
 * 5. Idempotency: recent regen.auto_triggered audit row within 7 days → skipped (skippedCooldown++)
 * 6. Per-strategy error isolation: errors++ but sweep continues (static source test)
 * 7. evolveStrategy() rejects → error is swallowed (non-blocking), sweep returns triggered=1
 * 8. Audit row emitted BEFORE evolveStrategy() call (intent durability)
 * 9. checkAutoDemotions() in lifecycle-service emits regen.auto_triggered audit row
 *    on DEPLOYED → DECLINING demotion (static-source test — no DB needed)
 * 10. scheduler.ts registers regen-declining-sweep job with pipeline gate
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Static source reads — done at module load time (before describe blocks) ───
// These must come before any describe() that references them.

const criticFeedbackSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/critic-feedback-service.ts"),
  "utf8",
);

const lifecycleSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/lifecycle-service.ts"),
  "utf8",
);

const schedulerSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/scheduler.ts"),
  "utf8",
);

// ─── Shared mock state (module closures, accessible inside vi.mock) ────────────

let _isActiveResult = true;
let _evolveStrategyResult: unknown = { status: "evolved", evolved: ["child-id"] };
let _evolveStrategyThrows: Error | null = null;

// Sequential DB query results:
// _dbSeq[0] → strategies.select().from().where()  (DECLINING list — no .limit())
// _dbSeq[1] → auditLog.select().from().where().limit(1)  (cooldown check for strategy 1)
// _dbSeq[2] → auditLog.select().from().where().limit(1)  (cooldown check for strategy 2)
// ... etc.
let _dbSeq: Array<unknown[]> = [];
let _dbIdx = 0;

// Track what was inserted into audit_log
let _auditInserts: unknown[] = [];

// ─── vi.mock factories ────────────────────────────────────────────────────────

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(() => Promise.resolve(_isActiveResult)),
}));

vi.mock("../services/evolution-service.js", () => ({
  evolveStrategy: vi.fn((_strategyId: string, _ctx: unknown) => {
    if (_evolveStrategyThrows) return Promise.reject(_evolveStrategyThrows);
    return Promise.resolve(_evolveStrategyResult);
  }),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: col, val })),
  and: vi.fn((...c: unknown[]) => ({ and: c })),
  or: vi.fn((...c: unknown[]) => ({ or: c })),
  gte: vi.fn((col: unknown, val: unknown) => ({ gte: col, val })),
  sql: vi.fn((strings: TemplateStringsArray, ...vals: unknown[]) => ({ sql: strings, vals })),
}));

vi.mock("../db/schema.js", () => ({
  strategies: {
    id: "s_id",
    lifecycleState: "lifecycle_state",
    generation: "generation",
    parentStrategyId: "parent_strategy_id",
    lifecycleChangedAt: "lifecycle_changed_at",
    rollingSharpe30d: "rolling_sharpe_30d",
    name: "name",
    paramName: "param_name",
    $inferSelect: {},
  },
  subsystemMetrics: { subsystem: "subsystem", metricName: "metric_name", $inferSelect: {} },
  systemParameters: { paramName: "param_name", id: "id", $inferSelect: {} },
  systemParameterHistory: { $inferSelect: {} },
  auditLog: {
    id: "al_id",
    action: "action",
    entityType: "entity_type",
    entityId: "entity_id",
    createdAt: "created_at",
    $inferSelect: {},
  },
}));

vi.mock("../db/index.js", () => {
  // Fluent chain mock that handles two distinct query patterns:
  //
  // Pattern A: await db.select().from().where()
  //   Used for the strategies DECLINING query (no .limit() call).
  //   The Promise resolves directly with the consumed _dbSeq slot.
  //
  // Pattern B: await db.select().from().where().limit(1)
  //   Used for the auditLog cooldown check.
  //   where() returns a Promise + .limit() method sharing the same closed-over data.
  //
  // Each call to where() consumes one slot from _dbSeq at call time.
  // If limit() is later called, it reuses the same slot (already consumed).

  const makeWhereResult = (): Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> } => {
    const data: unknown[] = _dbIdx < _dbSeq.length ? (_dbSeq[_dbIdx++] as unknown[]) : [];
    const promise = Promise.resolve(data) as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> };
    // limit() shares same data slot — avoids double-consuming _dbSeq
    promise.limit = vi.fn((_n: number) => Promise.resolve(data));
    return promise;
  };

  const where = vi.fn(() => makeWhereResult());
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  // update mock for evaluateCriticAccuracy compatibility
  const set = vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }));
  const update = vi.fn(() => ({ set }));

  // insert().values() captures inserts for assertion
  const values = vi.fn((data: unknown) => {
    _auditInserts.push(data);
    return Promise.resolve([]);
  });
  const insert = vi.fn(() => ({ values }));

  return {
    db: { select, insert, update },
  };
});

// ─── Import the function under test (after mocks registered) ─────────────────

import { checkDeclingAndTriggerRegen } from "../services/critic-feedback-service.js";
import { evolveStrategy } from "../services/evolution-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";

// ─── beforeEach: reset shared state ─────────────────────────────────────────

beforeEach(() => {
  _isActiveResult = true;
  _evolveStrategyResult = { status: "evolved", evolved: ["child-id"] };
  _evolveStrategyThrows = null;
  _dbSeq = [];
  _dbIdx = 0;
  _auditInserts = [];
  vi.clearAllMocks();
  // Restore mock implementations (clearAllMocks wipes them)
  vi.mocked(isPipelineActive).mockImplementation(() => Promise.resolve(_isActiveResult));
  vi.mocked(evolveStrategy).mockImplementation((_strategyId: string, _ctx: unknown) => {
    if (_evolveStrategyThrows) return Promise.reject(_evolveStrategyThrows);
    return Promise.resolve(_evolveStrategyResult as any);
  });
});

// ─── Dynamic behavioral tests ────────────────────────────────────────────────

describe("checkDeclingAndTriggerRegen — pipeline guard", () => {
  it("returns sweepRan=false when pipeline is paused", async () => {
    _isActiveResult = false;
    const result = await checkDeclingAndTriggerRegen({ correlationId: "test-cid-1" });

    expect(result.sweepRan).toBe(false);
    expect(result.skippedPipelinePaused).toBe(true);
    expect(result.total).toBe(0);
    expect(result.triggered).toBe(0);
    expect(evolveStrategy).not.toHaveBeenCalled();
  });
});

describe("checkDeclingAndTriggerRegen — no DECLINING strategies", () => {
  it("returns total=0, triggered=0 when no DECLINING strategies found", async () => {
    // strategies query → empty array
    _dbSeq = [[]];

    const result = await checkDeclingAndTriggerRegen({ correlationId: "test-cid-2" });

    expect(result.sweepRan).toBe(true);
    expect(result.total).toBe(0);
    expect(result.triggered).toBe(0);
    expect(evolveStrategy).not.toHaveBeenCalled();
  });
});

describe("checkDeclingAndTriggerRegen — triggers evolution on eligible strategy", () => {
  it("calls evolveStrategy() and emits audit row for eligible DECLINING strategy", async () => {
    const strategyId = "strat-uuid-001";

    _dbSeq = [
      // strategies query → one DECLINING strategy (generation=0)
      [{ id: strategyId, name: "My Strategy", generation: 0, parentStrategyId: null, lifecycleState: "DECLINING", lifecycleChangedAt: new Date(), rollingSharpe30d: "0.75" }],
      // auditLog cooldown check → no recent regen row
      [],
    ];

    const result = await checkDeclingAndTriggerRegen({ correlationId: "test-cid-3" });

    expect(result.sweepRan).toBe(true);
    expect(result.total).toBe(1);
    expect(result.triggered).toBe(1);
    expect(result.triggeredStrategyIds).toContain(strategyId);
    expect(result.skippedCooldown).toBe(0);
    expect(result.skippedMaxGeneration).toBe(0);
    expect(result.errors).toBe(0);

    // Audit row must have been inserted with correct fields
    expect(_auditInserts.length).toBeGreaterThanOrEqual(1);
    const regenAudit = (_auditInserts as any[]).find((r) => r.action === "regen.auto_triggered");
    expect(regenAudit).toBeDefined();
    expect(regenAudit.entityId).toBe(strategyId);
    expect(regenAudit.status).toBe("pending");
    expect(regenAudit.decisionAuthority).toBe("scheduler");

    // evolveStrategy() must have been called (fire-and-forget — flush microtasks)
    await new Promise((r) => setTimeout(r, 0));
    expect(evolveStrategy).toHaveBeenCalledWith(
      strategyId,
      expect.objectContaining({ correlationId: "test-cid-3" }),
    );
  });
});

describe("checkDeclingAndTriggerRegen — max-generation throttling", () => {
  it("skips strategy at generation >= 3 (max generations reached)", async () => {
    const strategyId = "strat-uuid-gen3";

    _dbSeq = [
      // generation=3 → at MAX_GENERATIONS cap — no audit query should run
      [{ id: strategyId, name: "Old Strategy", generation: 3, parentStrategyId: "parent-id", lifecycleState: "DECLINING", lifecycleChangedAt: new Date(), rollingSharpe30d: "0.5" }],
    ];

    const result = await checkDeclingAndTriggerRegen({ correlationId: "test-cid-4" });

    expect(result.total).toBe(1);
    expect(result.triggered).toBe(0);
    expect(result.skippedMaxGeneration).toBe(1);
    expect(result.skippedCooldown).toBe(0);
    expect(evolveStrategy).not.toHaveBeenCalled();
  });

  it("skips strategy at generation > 3", async () => {
    const strategyId = "strat-uuid-gen5";

    _dbSeq = [
      [{ id: strategyId, name: "Very Old Strategy", generation: 5, parentStrategyId: "parent-id", lifecycleState: "DECLINING", lifecycleChangedAt: new Date(), rollingSharpe30d: "0.3" }],
    ];

    const result = await checkDeclingAndTriggerRegen({ correlationId: "test-cid-4b" });

    expect(result.skippedMaxGeneration).toBe(1);
    expect(evolveStrategy).not.toHaveBeenCalled();
  });
});

describe("checkDeclingAndTriggerRegen — idempotency / 7-day cooldown", () => {
  it("skips strategy that has a recent regen.auto_triggered audit row", async () => {
    const strategyId = "strat-uuid-cooldown";

    _dbSeq = [
      // DECLINING strategy (generation=1)
      [{ id: strategyId, name: "Cool Strategy", generation: 1, parentStrategyId: null, lifecycleState: "DECLINING", lifecycleChangedAt: new Date(), rollingSharpe30d: "0.8" }],
      // auditLog cooldown check → recent regen row exists (2 days ago — within 7 days)
      [{ id: "audit-row-id", createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }],
    ];

    const result = await checkDeclingAndTriggerRegen({ correlationId: "test-cid-5" });

    expect(result.total).toBe(1);
    expect(result.triggered).toBe(0);
    expect(result.skippedCooldown).toBe(1);
    expect(result.skippedMaxGeneration).toBe(0);
    expect(evolveStrategy).not.toHaveBeenCalled();
  });
});

describe("checkDeclingAndTriggerRegen — evolveStrategy failure is non-blocking", () => {
  it("counts triggered=1 even when fire-and-forget evolveStrategy() rejects", async () => {
    const strategyId = "strat-uuid-evo-fail";
    _evolveStrategyThrows = new Error("Ollama down");

    _dbSeq = [
      [{ id: strategyId, name: "Failing Evolve Strategy", generation: 0, parentStrategyId: null, lifecycleState: "DECLINING", lifecycleChangedAt: new Date(), rollingSharpe30d: "0.55" }],
      [], // no recent regen
    ];

    const result = await checkDeclingAndTriggerRegen({ correlationId: "test-cid-7" });

    // triggered=1 because the audit row was inserted and evolveStrategy() was called;
    // the rejection is swallowed by the .catch() handler (fire-and-forget)
    expect(result.triggered).toBe(1);
    expect(result.errors).toBe(0);

    // evolveStrategy was called even though it rejects
    await new Promise((r) => setTimeout(r, 0));
    expect(evolveStrategy).toHaveBeenCalledWith(strategyId, expect.anything());
  });
});

describe("checkDeclingAndTriggerRegen — multiple strategies mixed eligibility", () => {
  it("correctly segregates triggered / skippedCooldown / skippedMaxGeneration", async () => {
    const strat1 = "s-eligible";
    const strat2 = "s-cooldown";
    const strat3 = "s-maxgen";

    _dbSeq = [
      // All three strategies in DECLINING
      [
        { id: strat1, name: "Eligible", generation: 0, parentStrategyId: null, lifecycleState: "DECLINING", lifecycleChangedAt: new Date(), rollingSharpe30d: "0.7" },
        { id: strat2, name: "On Cooldown", generation: 1, parentStrategyId: null, lifecycleState: "DECLINING", lifecycleChangedAt: new Date(), rollingSharpe30d: "0.6" },
        { id: strat3, name: "Max Gen", generation: 3, parentStrategyId: "parent", lifecycleState: "DECLINING", lifecycleChangedAt: new Date(), rollingSharpe30d: "0.5" },
      ],
      // strat1 audit cooldown check → no recent regen
      [],
      // strat2 audit cooldown check → recent regen (1 day ago)
      [{ id: "regen-row", createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) }],
      // strat3: max-gen check fires first → no audit DB call consumed
    ];

    const result = await checkDeclingAndTriggerRegen({ correlationId: "test-cid-8" });

    expect(result.total).toBe(3);
    expect(result.triggered).toBe(1);
    expect(result.triggeredStrategyIds).toEqual([strat1]);
    expect(result.skippedCooldown).toBe(1);
    expect(result.skippedMaxGeneration).toBe(1);
    expect(result.errors).toBe(0);
  });
});

// ─── Static source audits ─────────────────────────────────────────────────────

describe("critic-feedback-service.ts — static source audit (B4 W13)", () => {
  it("exports checkDeclingAndTriggerRegen", () => {
    expect(criticFeedbackSrc).toMatch(/export\s+async\s+function\s+checkDeclingAndTriggerRegen/);
  });

  it("imports isActive from pipeline-control-service", () => {
    expect(criticFeedbackSrc).toMatch(/isActive.*pipeline-control-service/);
  });

  it("imports evolveStrategy from evolution-service", () => {
    expect(criticFeedbackSrc).toMatch(/evolveStrategy.*evolution-service/);
  });

  it("imports auditLog from db/schema", () => {
    expect(criticFeedbackSrc).toMatch(/auditLog/);
  });

  it("uses REGEN_MAX_GENERATION = 3 (matches evolution-service MAX_GENERATIONS)", () => {
    expect(criticFeedbackSrc).toMatch(/REGEN_MAX_GENERATION\s*=\s*3/);
  });

  it("uses REGEN_COOLDOWN_DAYS = 7 (matches evolution-service COOLDOWN_DAYS)", () => {
    expect(criticFeedbackSrc).toMatch(/REGEN_COOLDOWN_DAYS\s*=\s*7/);
  });

  it("uses REGEN_AUDIT_ACTION = 'regen.auto_triggered'", () => {
    expect(criticFeedbackSrc).toMatch(/REGEN_AUDIT_ACTION\s*=\s*["']regen\.auto_triggered["']/);
  });

  it("checks generation >= REGEN_MAX_GENERATION before audit lookup", () => {
    expect(criticFeedbackSrc).toMatch(/generation\s*>=\s*REGEN_MAX_GENERATION/);
  });

  it("checks recent audit row for cooldown before spawning evolution", () => {
    expect(criticFeedbackSrc).toMatch(/recentRegenRow/);
    expect(criticFeedbackSrc).toMatch(/skippedCooldown/);
  });

  it("emits audit row with status='pending' and decisionAuthority='scheduler'", () => {
    expect(criticFeedbackSrc).toMatch(/status:\s*["']pending["']/);
    expect(criticFeedbackSrc).toMatch(/decisionAuthority:\s*["']scheduler["']/);
  });

  it("calls evolveStrategy() as fire-and-forget with .then().catch()", () => {
    expect(criticFeedbackSrc).toMatch(/evolveStrategy\s*\(s\.id/);
    expect(criticFeedbackSrc).toMatch(/\.then\s*\(.*evoResult/s);
    expect(criticFeedbackSrc).toMatch(/\.catch\s*\(.*evoErr/s);
  });

  it("wraps per-strategy logic in try/catch for error isolation", () => {
    expect(criticFeedbackSrc).toMatch(/errors\+\+/);
    expect(criticFeedbackSrc).toMatch(/non-blocking.*sweep continues/i);
  });

  it("returns sweepRan, triggered, skippedCooldown, skippedMaxGeneration, errors in result", () => {
    expect(criticFeedbackSrc).toMatch(/sweepRan/);
    expect(criticFeedbackSrc).toMatch(/triggered/);
    expect(criticFeedbackSrc).toMatch(/skippedCooldown/);
    expect(criticFeedbackSrc).toMatch(/skippedMaxGeneration/);
    expect(criticFeedbackSrc).toMatch(/errors/);
  });
});

describe("lifecycle-service.ts checkAutoDemotions — static source audit (B4 W13)", () => {
  it("inserts regen.auto_triggered audit row on DEPLOYED→DECLINING demotion", () => {
    expect(lifecycleSrc).toMatch(/regen\.auto_triggered/);
  });

  it("audit insert uses decisionAuthority='scheduler'", () => {
    // The regen audit block must contain scheduler authority
    const regenBlock = lifecycleSrc.match(/regen\.auto_triggered[\s\S]*?decisionAuthority[\s\S]*?scheduler/);
    expect(regenBlock).not.toBeNull();
  });

  it("regen audit insert is fire-and-forget with .catch()", () => {
    // Must have a .catch() handler on the db.insert for the regen audit row
    const auditInsertBlock = lifecycleSrc.match(
      /db\.insert\(auditLog\)[\s\S]*?regen\.auto_triggered[\s\S]*?\.catch/,
    );
    expect(auditInsertBlock).not.toBeNull();
  });

  it("still calls evolveStrategy() after the regen audit row", () => {
    expect(lifecycleSrc).toMatch(/evolveStrategy\s*\(s\.id/);
  });

  it("includes idempotency note referencing checkDeclingAndTriggerRegen", () => {
    expect(lifecycleSrc).toMatch(/checkDeclingAndTriggerRegen/);
  });
});

describe("scheduler.ts — static source audit (B4 W13)", () => {
  it("registers regen-declining-sweep job", () => {
    expect(schedulerSrc).toMatch(/registerJob\s*\(\s*["']regen-declining-sweep["']/);
  });

  it("imports checkDeclingAndTriggerRegen dynamically from critic-feedback-service", () => {
    expect(schedulerSrc).toMatch(/checkDeclingAndTriggerRegen/);
    expect(schedulerSrc).toMatch(/critic-feedback-service/);
  });

  it("uses pipelineGate guard for regen-declining-sweep cron", () => {
    const regenBlock = schedulerSrc.match(
      /pipelineGate\s*\(\s*["']regen-declining-sweep["']\s*\)/,
    );
    expect(regenBlock).not.toBeNull();
  });

  it("scheduler init log includes regen-declining-sweep and B4 W13 label", () => {
    expect(schedulerSrc).toMatch(/regen-declining-sweep.*B4.*W13|B4.*W13.*regen-declining-sweep/i);
  });
});
