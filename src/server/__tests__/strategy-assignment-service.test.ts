/**
 * Strategy Assignment Service Tests — Real-Service (Pass 2.2 refactor)
 *
 * All 12 original shadow tests replaced with real-service equivalents.
 * 17 new real-service tests added = 29 total.
 *
 * Pattern (mirrors broker-router.test.ts):
 *   - Static top-level imports of real services
 *   - vi.mocked(dep.fn).mockReturnValue(...) per test / beforeEach
 *   - Real service logic executes; only DB/SSE/logger mocked at boundary
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (all before static imports) ───────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock("../db/schema.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../db/schema.js");
  return {
    ...actual,
    strategies: { _: { name: "strategies" } },
    brokerAccounts: { _: { name: "broker_accounts" } },
    accountStrategyAssignments: { _: { name: "account_strategy_assignments" } },
    auditLog: { _: { name: "audit_log" } },
    instanceConfig: {
      _: { name: "instance_config" },
      id: { name: "id" },
      enabledFirms: { name: "enabled_firms" },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  desc: vi.fn((col: unknown) => ({ col, op: "desc" })),
  // W23F.A added symbols TEXT[] with sql`ARRAY['MES']::TEXT[]` default in schema.ts.
  // vi.importActual("../db/schema.js") triggers schema.ts which imports sql from drizzle-orm.
  // Must export sql here so the schema module loads successfully under this mock.
  sql: vi.fn(() => ({ _sql: true })),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn().mockResolvedValue({ apiKey: "test-api-key" }),
}));

vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn().mockResolvedValue({ success: true, statusCode: 200, responseBody: {} }),
}));

vi.mock("../integrations/traderspost/webhook-builder.js", () => ({
  buildWebhookPayload: vi.fn().mockReturnValue({ apiKey: "test-key", action: "buy", ticker: "MES" }),
}));

vi.mock("../services/pine-export-service.js", () => ({
  compileDualPineExport: vi.fn().mockResolvedValue({
    status: "success",
    contentHash: "deadbeef1234",
    id: "exp-1",
    studyPath: "/tmp/study.pine",
    strategyPath: "/tmp/strategy.pine",
  }),
}));

// ─── Static imports (after mocks) ────────────────────────────────────────────

import {
  assignStrategyToAccount,
  unassignStrategy,
  releaseStrategyToFamily,
  __resetEnabledFirmsCache,
  CollaborativeTradingBlockedError,
} from "../services/strategy-assignment-service.js";
import { routeOrder } from "../services/broker-router.js";
import { generateRecipientExport } from "../services/pine-export-recipient-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { notifyCritical } from "../services/notification-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { db } from "../db/index.js";
import { compileDualPineExport } from "../services/pine-export-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STRAT_DEPLOYED = { id: "strat-deployed-1", lifecycleState: "DEPLOYED", name: "Strategy One", config: { symbol: "MES", max_contracts: 4 } };
const STRAT_DEPLOYED_2 = { id: "strat-deployed-2", lifecycleState: "DEPLOYED", name: "Strategy Two", config: { symbol: "MNQ", max_contracts: 4 } };
const STRAT_RETIRED = { id: "strat-retired", lifecycleState: "RETIRED", name: "Retired Strategy", config: { symbol: "MES", max_contracts: 6 } };
const STRAT_GRAVEYARD = { id: "strat-graveyard", lifecycleState: "GRAVEYARD", name: "Graveyard", config: { symbol: "MES", max_contracts: 6 } };
const STRAT_TESTING = { id: "strat-testing", lifecycleState: "TESTING", name: "Testing Strategy", config: { symbol: "MES", max_contracts: 6 } };

const ACCT_MFFU_OPERATOR = { accountId: "acct-mffu-operator", firmId: "mffu", enabled: true, brokerType: "traderspost" };
const ACCT_MFFU_ALICE = { accountId: "acct-mffu-alice", firmId: "mffu", enabled: true, brokerType: "traderspost" };
const ACCT_MFFU_BOB = { accountId: "acct-mffu-bob", firmId: "mffu", enabled: true, brokerType: "traderspost" };
const ACCT_TOPSTEP_1 = { accountId: "acct-topstep-1", firmId: "topstep", enabled: true, brokerType: "traderspost" };
const ACCT_TOPSTEP_2 = { accountId: "acct-topstep-2", firmId: "topstep", enabled: true, brokerType: "traderspost" };
const ACCT_DISABLED = { accountId: "acct-disabled", firmId: "mffu", enabled: false, brokerType: "traderspost" };
const ACCT_LEGACY = { accountId: "acct-legacy", firmId: "apex", enabled: true, brokerType: "traderspost" };

let nextId = 1;

function makeAssignmentRow(accountId: string, strategyId: string, opts: Partial<{
  id: number;
  status: string;
  releasedToFamily: boolean;
  familyMemberLabel: string | null;
  assignedBy: string;
  hmacSecret: string | null;
}> = {}) {
  return {
    id: opts.id ?? nextId++,
    accountId,
    strategyId,
    status: opts.status ?? "active",
    releasedToFamily: opts.releasedToFamily ?? false,
    familyMemberLabel: opts.familyMemberLabel ?? null,
    assignedAt: new Date(),
    assignedBy: opts.assignedBy ?? "operator",
    hmacSecret: opts.hmacSecret ?? null,
  };
}

// ─── DB mock helpers ──────────────────────────────────────────────────────────

/** Mock db.select to return rows for any .from().where()...limit() chain. */
function mockSelect(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
        orderBy: vi.fn().mockResolvedValue(rows),
        then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
      }),
      limit: vi.fn().mockResolvedValue(rows),
      orderBy: vi.fn().mockResolvedValue(rows),
      then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as unknown as ReturnType<typeof db.select>);
}

/**
 * Mock db.select for a sequence of calls with different return values.
 * Each element in the sequence corresponds to one db.select() call in order.
 */
function mockSelectSequence(sequence: Array<unknown[]>) {
  let callIndex = 0;
  vi.mocked(db.select).mockImplementation(() => {
    const rows = sequence[callIndex] ?? [];
    callIndex++;
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
          orderBy: vi.fn().mockResolvedValue(rows),
          then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
        }),
        limit: vi.fn().mockResolvedValue(rows),
        orderBy: vi.fn().mockResolvedValue(rows),
        then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>;
  });
}

/**
 * Full happy-path select mock for assignStrategyToAccount:
 *   call 1 = strategy lookup
 *   call 2 = broker account lookup
 *   call 3 = instance_config (getEnabledFirms)
 *   call 4 = collision check
 *   call 5 = detectCollaborativeTradingRisk (innerJoin path)
 *
 * existingOnMffu = existing MFFU assignments for collaborative detection
 */
function mockSelectForAssign(opts: {
  strategy?: typeof STRAT_DEPLOYED;
  account?: typeof ACCT_MFFU_OPERATOR;
  instanceConfig?: unknown[];
  existingAssignment?: unknown[];
  existingOnMffu?: unknown[];
}) {
  const strategy = opts.strategy ?? STRAT_DEPLOYED;
  const account = opts.account ?? ACCT_MFFU_OPERATOR;
  const instanceConfig = opts.instanceConfig ?? [];
  const existingAssignment = opts.existingAssignment ?? [];
  const existingOnMffu = opts.existingOnMffu ?? [];

  let callIndex = 0;
  vi.mocked(db.select).mockImplementation(() => {
    const idx = callIndex++;
    let rows: unknown[];
    if (idx === 0) rows = [strategy];                // strategies
    else if (idx === 1) rows = [account];             // brokerAccounts
    else if (idx === 2) rows = instanceConfig;        // instance_config
    else if (idx === 3) rows = existingAssignment;    // collision check
    else rows = [];                                   // fallback

    const innerJoinResult = {
      where: vi.fn().mockResolvedValue(existingOnMffu),
    };

    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
          orderBy: vi.fn().mockResolvedValue(rows),
          then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
        }),
        limit: vi.fn().mockResolvedValue(rows),
        orderBy: vi.fn().mockResolvedValue(rows),
        then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
        innerJoin: vi.fn().mockReturnValue(innerJoinResult),
      }),
    } as unknown as ReturnType<typeof db.select>;
  });
}

/** Mock db.insert to capture audit inserts and return a given assignment row. */
function mockInsertReturning(assignmentRow: unknown) {
  const auditRows: unknown[] = [];
  vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
    values: vi.fn((v: Record<string, unknown>) => {
      if (v.action) {
        auditRows.push(v);
        return Promise.resolve();
      }
      // assignment insert
      return {
        returning: vi.fn().mockResolvedValue([assignmentRow]),
      };
    }),
  } as unknown as ReturnType<typeof db.insert>));
  return auditRows;
}

/** Mock db.insert to capture ALL inserts (audit + assignment). */
function mockInsertCapture() {
  const allInserts: unknown[] = [];
  vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
    values: vi.fn((v: Record<string, unknown>) => {
      allInserts.push(v);
      if (v.action) return Promise.resolve();
      return {
        returning: vi.fn().mockResolvedValue([v]),
      };
    }),
  } as unknown as ReturnType<typeof db.insert>));
  return allInserts;
}

/** Mock db.update().set().where().returning() */
function mockUpdateReturning(updatedRow: unknown) {
  vi.mocked(db.update).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([updatedRow]),
      }),
    }),
  } as unknown as ReturnType<typeof db.update>);
}

// ─── Tests: refactored shadow → real-service (12 tests) ──────────────────────

describe("strategy-assignment-service (real-service)", () => {
  beforeEach(() => {
    nextId = 1;
    vi.clearAllMocks();
    __resetEnabledFirmsCache();
    vi.mocked(isPipelineActive).mockResolvedValue(true);
  });

  // ─── Test 1: Happy path assign ─────────────────────────────────────────────

  it("1. creates assignment on happy path — real service returns correct record", async () => {
    const newRow = makeAssignmentRow("acct-mffu-operator", "strat-deployed-1", { assignedBy: "operator" });
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_MFFU_OPERATOR });
    mockInsertReturning(newRow);
    vi.mocked(db.update).mockReturnValue({ set: vi.fn() } as unknown as ReturnType<typeof db.update>);

    const result = await assignStrategyToAccount("acct-mffu-operator", "strat-deployed-1", { assignedBy: "operator" });

    expect(result.accountId).toBe("acct-mffu-operator");
    expect(result.strategyId).toBe("strat-deployed-1");
    expect(result.status).toBe("active");
    expect(result.releasedToFamily).toBe(false);
    expect(result.assignedBy).toBe("operator");
  });

  // ─── Test 2: Unassign happy path ───────────────────────────────────────────

  it("2. unassignStrategy archives the assignment (real DB update called)", async () => {
    const existingRow = makeAssignmentRow("acct-mffu-operator", "strat-deployed-1", { id: 42 });
    // Select for unassign: find existing assignment by id
    mockSelectSequence([[existingRow]]);
    const archivedRow = { ...existingRow, status: "archived" };
    mockUpdateReturning(archivedRow);
    mockInsertCapture();

    await unassignStrategy(42);

    expect(vi.mocked(db.update)).toHaveBeenCalled();
    const setCall = vi.mocked(db.update).mock.results[0]?.value?.set;
    expect(setCall).toBeDefined();
  });

  // ─── Test 3: UNIQUE collision returns existing row ─────────────────────────

  it("3. UNIQUE collision — existing row returned with same id (no DB insert)", async () => {
    const existingRow = makeAssignmentRow("acct-mffu-operator", "strat-deployed-1", { id: 99 });
    // Call 1: strategy; call 2: account; call 3: instance_config; call 4: collision check (RETURNS existing)
    mockSelectForAssign({
      strategy: STRAT_DEPLOYED,
      account: ACCT_MFFU_OPERATOR,
      existingAssignment: [existingRow],
    });
    const capturedInserts = mockInsertCapture();
    vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>);

    const result = await assignStrategyToAccount("acct-mffu-operator", "strat-deployed-1");

    expect(result.id).toBe(99);
    // No assignment insert should happen (collision short-circuit)
    const assignInserts = (capturedInserts as Record<string, unknown>[]).filter((r) => !r.action);
    expect(assignInserts.length).toBe(0);
  });

  // ─── Test 4: releaseToFamily toggle true ──────────────────────────────────

  it("4. releaseStrategyToFamily sets releasedToFamily=true and familyMemberLabel", async () => {
    const existingRow = makeAssignmentRow("acct-mffu-alice", "strat-deployed-1", { id: 55, familyMemberLabel: "Alice" });
    const updatedRow = { ...existingRow, releasedToFamily: true, familyMemberLabel: "Alice" };
    mockSelectSequence([[existingRow]]);
    mockUpdateReturning(updatedRow);
    mockInsertCapture();

    const result = await releaseStrategyToFamily(55, true, "Alice");

    expect(result.releasedToFamily).toBe(true);
    expect(result.familyMemberLabel).toBe("Alice");
  });

  // ─── Test 5: releaseToFamily retract ──────────────────────────────────────

  it("5. releaseStrategyToFamily retract sets releasedToFamily=false", async () => {
    const existingRow = makeAssignmentRow("acct-mffu-alice", "strat-deployed-1", { id: 56, releasedToFamily: true, familyMemberLabel: "Alice" });
    const updatedRow = { ...existingRow, releasedToFamily: false };
    mockSelectSequence([[existingRow]]);
    mockUpdateReturning(updatedRow);
    mockInsertCapture();

    const result = await releaseStrategyToFamily(56, false);

    expect(result.releasedToFamily).toBe(false);
  });

  // ─── Test 6: Pipeline-pause guard on assign ────────────────────────────────

  it("6. assignStrategyToAccount throws PipelinePausedError when pipeline is paused", async () => {
    vi.mocked(isPipelineActive).mockResolvedValue(false);

    await expect(
      assignStrategyToAccount("acct-mffu-operator", "strat-deployed-1")
    ).rejects.toThrow("Pipeline is paused");
  });

  // ─── Test 7: Pipeline-pause guard on unassign ─────────────────────────────

  it("7. unassignStrategy throws PipelinePausedError when pipeline is paused", async () => {
    vi.mocked(isPipelineActive).mockResolvedValue(false);

    await expect(unassignStrategy(42)).rejects.toThrow("Pipeline is paused");
  });

  // ─── Test 8: audit_log row written on assign ───────────────────────────────

  it("8. audit_log row written on assign with action=strategy_assignment.assigned", async () => {
    const newRow = makeAssignmentRow("acct-mffu-operator", "strat-deployed-1");
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_MFFU_OPERATOR });
    const allInserts = mockInsertCapture();
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        allInserts.push(v);
        if (v.action) return Promise.resolve();
        return { returning: vi.fn().mockResolvedValue([newRow]) };
      }),
    } as unknown as ReturnType<typeof db.insert>));
    mockUpdateReturning(newRow);

    await assignStrategyToAccount("acct-mffu-operator", "strat-deployed-1");

    const auditInserts = (allInserts as Record<string, unknown>[]).filter((r) => r.action);
    const assignAudit = auditInserts.find((a) => a.action === "strategy_assignment.assigned");
    expect(assignAudit).toBeDefined();
    expect(assignAudit?.entityId).toBe("strat-deployed-1");
  });

  // ─── Test 9: Legacy firm rejection ────────────────────────────────────────

  it("9. rejects assignment for account on legacy firm (apex) not in enabled_firms", async () => {
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_LEGACY });

    await expect(
      assignStrategyToAccount("acct-legacy", "strat-deployed-1")
    ).rejects.toThrow("not in instance_config.enabled_firms");
  });

  // ─── Test 10: MFFU collaborative-trading warning ──────────────────────────

  it("10. MFFU collaborative-trading risk BLOCKS assignment (fail-closed) + fires blocked SSE", async () => {
    // Deep-scan fix D (2026-07-06): MFFU collaborative-trading is a HARD ban
    // boundary (§6). The service now REFUSES the assignment (throws) instead of
    // insert-and-warn, and broadcasts compliance:collaborative_trading_blocked.
    const aliceRow = makeAssignmentRow("acct-mffu-alice", "strat-deployed-1", { familyMemberLabel: "Alice" });
    const existingOnMffu = [
      { accountId: "acct-mffu-alice", familyMemberLabel: "Alice", firmId: "mffu" },
    ];
    mockSelectForAssign({
      strategy: STRAT_DEPLOYED,
      account: ACCT_MFFU_BOB,
      existingOnMffu,
    });
    const allInserts: unknown[] = [];
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        allInserts.push(v);
        if (v.action) return Promise.resolve();
        return { returning: vi.fn().mockResolvedValue([aliceRow]) };
      }),
    } as unknown as ReturnType<typeof db.insert>));

    vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>).mockClear();

    // The assignment must be REFUSED, not silently inserted.
    await expect(
      assignStrategyToAccount("acct-mffu-bob", "strat-deployed-1", { familyMemberLabel: "Bob" })
    ).rejects.toBeInstanceOf(CollaborativeTradingBlockedError);

    const blockedSSE = (vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>)
      .filter(([event]) => event === "compliance:collaborative_trading_blocked");
    expect(blockedSSE.length).toBeGreaterThan(0);
    // No assignment row was inserted — only the blocked audit row (has `action`).
    const assignmentInserts = (allInserts as Record<string, unknown>[]).filter((v) => !v.action);
    expect(assignmentInserts.length).toBe(0);
  });

  // ─── Test 11: Topstep multi-account exception ─────────────────────────────

  it("11. Topstep multi-account: collaborative warning does NOT fire for Topstep accounts", async () => {
    const topstep1Row = makeAssignmentRow("acct-topstep-1", "strat-deployed-1");
    // Topstep: detectCollaborativeTradingRisk returns null immediately (no DB call needed)
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_TOPSTEP_2, existingOnMffu: [] });
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        if (v.action) return Promise.resolve();
        return { returning: vi.fn().mockResolvedValue([topstep1Row]) };
      }),
    } as unknown as ReturnType<typeof db.insert>));

    vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>).mockClear();

    await assignStrategyToAccount("acct-topstep-2", "strat-deployed-1", { familyMemberLabel: "FamilyMember2" });

    const warningSSE = (vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>)
      .filter(([event]) => event === "compliance:collaborative_trading_warning");
    expect(warningSSE.length).toBe(0);
  });

  // ─── Test 12: SSE events ──────────────────────────────────────────────────

  it("12. SSE events broadcast on assign, release, unassign (real broadcastSSE called)", async () => {
    const newRow = makeAssignmentRow("acct-mffu-operator", "strat-deployed-1", { id: 77 });
    const releasedRow = { ...newRow, releasedToFamily: true, familyMemberLabel: "Operator" };
    const archivedRow = { ...newRow, status: "archived" };

    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_MFFU_OPERATOR });
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        if (v.action) return Promise.resolve();
        return { returning: vi.fn().mockResolvedValue([newRow]) };
      }),
    } as unknown as ReturnType<typeof db.insert>));
    vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>).mockClear();

    await assignStrategyToAccount("acct-mffu-operator", "strat-deployed-1");
    const allSSEAfterAssign = (vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>).map(([e]) => e);
    expect(allSSEAfterAssign).toContain("strategy:assigned");

    // Release
    mockSelectSequence([[newRow]]);
    mockUpdateReturning(releasedRow);
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => { if (v.action) return Promise.resolve(); return { returning: vi.fn().mockResolvedValue([releasedRow]) }; }),
    } as unknown as ReturnType<typeof db.insert>));

    await releaseStrategyToFamily(77, true, "Operator");
    const allSSEAfterRelease = (vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>).map(([e]) => e);
    expect(allSSEAfterRelease).toContain("strategy:released_to_family");

    // Unassign
    mockSelectSequence([[newRow]]);
    mockUpdateReturning(archivedRow);
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => { if (v.action) return Promise.resolve(); return { returning: vi.fn().mockResolvedValue([archivedRow]) }; }),
    } as unknown as ReturnType<typeof db.insert>));

    await unassignStrategy(77);
    const allSSEAfterUnassign = (vi.mocked(broadcastSSE as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>).map(([e]) => e);
    expect(allSSEAfterUnassign).toContain("strategy:unassigned");
  });
});

// ─── Tests: 17 new real-service tests ─────────────────────────────────────────

describe("strategy-assignment: new real-service coverage (4 tests)", () => {
  beforeEach(() => {
    nextId = 1;
    vi.clearAllMocks();
    __resetEnabledFirmsCache();
    vi.mocked(isPipelineActive).mockResolvedValue(true);
  });

  // Test 13: Topstep multi-account → notifyCritical NOT called
  it("13. Topstep multi-account: notifyCritical NOT called for Topstep same-strategy", async () => {
    const newRow = makeAssignmentRow("acct-topstep-2", "strat-deployed-1");
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_TOPSTEP_2, existingOnMffu: [] });
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        if (v.action) return Promise.resolve();
        return { returning: vi.fn().mockResolvedValue([newRow]) };
      }),
    } as unknown as ReturnType<typeof db.insert>));

    await assignStrategyToAccount("acct-topstep-2", "strat-deployed-1", { familyMemberLabel: "Topstep2" });

    expect(vi.mocked(notifyCritical as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  // Test 14: UNIQUE collision — DB insert NOT called for collision path
  it("14. UNIQUE collision: DB insert not called when existing row returned", async () => {
    const existingRow = makeAssignmentRow("acct-mffu-operator", "strat-deployed-1", { id: 99 });
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_MFFU_OPERATOR, existingAssignment: [existingRow] });
    const insertCalls: unknown[] = [];
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        insertCalls.push(v);
        return Promise.resolve();
      }),
    } as unknown as ReturnType<typeof db.insert>));

    const result = await assignStrategyToAccount("acct-mffu-operator", "strat-deployed-1");

    expect(result.id).toBe(99);
    // No non-audit insert should have happened
    const assignInsert = (insertCalls as Record<string, unknown>[]).find((v) => !v.action);
    expect(assignInsert).toBeUndefined();
  });

  // Test 15: Archived strategy rejection
  it("15. archived strategy rejection: RETIRED strategy throws", async () => {
    mockSelectForAssign({ strategy: STRAT_RETIRED, account: ACCT_MFFU_OPERATOR });

    await expect(
      assignStrategyToAccount("acct-mffu-operator", "strat-retired")
    ).rejects.toThrow("archived/retired strategies cannot be assigned");
  });

  it("15b. archived strategy rejection: GRAVEYARD strategy throws", async () => {
    mockSelectForAssign({ strategy: STRAT_GRAVEYARD, account: ACCT_MFFU_OPERATOR });

    await expect(
      assignStrategyToAccount("acct-mffu-operator", "strat-graveyard")
    ).rejects.toThrow("archived/retired strategies cannot be assigned");
  });

  // Test 16: instance_config.enabled_firms=['mffu'] rejects topstep
  it("16. instance_config.enabled_firms=['mffu'] rejects topstep account", async () => {
    __resetEnabledFirmsCache();
    // instance_config returns mffu only
    mockSelectForAssign({
      strategy: STRAT_DEPLOYED,
      account: ACCT_TOPSTEP_1,
      instanceConfig: [{ enabledFirms: ["mffu"] }],
    });

    await expect(
      assignStrategyToAccount("acct-topstep-1", "strat-deployed-1")
    ).rejects.toThrow("not in instance_config.enabled_firms");
  });
});

describe("broker-router: real-service coverage (3 tests)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPipelineActive).mockResolvedValue(true);
  });

  // Test 17: account.enabled=false returns account_not_found
  it("17. disabled account returns account_not_found reason (security mask)", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([ACCT_DISABLED]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.insert>);

    const result = await routeOrder("acct-disabled", { ticker: "MES", action: "enter_long" as const, orderType: "market" });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("account_not_found");
  });

  // Test 18: concurrent routeOrder calls both write audit rows
  it("18. concurrent routeOrder calls both write audit rows (no corruption)", async () => {
    const auditRows: unknown[] = [];
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([ACCT_MFFU_OPERATOR]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: unknown) => {
        auditRows.push(v);
        return Promise.resolve([]);
      }),
    } as unknown as ReturnType<typeof db.insert>));
    const signal = { ticker: "MES", action: "enter_long" as const, orderType: "market" as const };

    await Promise.all([
      routeOrder("acct-mffu-operator", signal),
      routeOrder("acct-mffu-operator", signal),
    ]);

    expect(auditRows.length).toBe(2);
  });

  // Test 19: DB failure path returns internal_error + audit row
  it("19. DB select failure returns internal_error reason and audit row still written", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("DB connection failure")),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);
    const auditRows: unknown[] = [];
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: unknown) => { auditRows.push(v); return Promise.resolve([]); }),
    } as unknown as ReturnType<typeof db.insert>));

    const result = await routeOrder("acct-mffu-operator", { ticker: "MES", action: "enter_long" as const, orderType: "market" });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("internal_error");
    expect(auditRows.length).toBeGreaterThan(0);
  });
});

describe("pine-export-recipient-service: real-service coverage (3 tests)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPipelineActive).mockResolvedValue(true);
  });

  // Test 20: generateRecipientExport is exported
  it("20. generateRecipientExport is a function (production export exists)", () => {
    expect(typeof generateRecipientExport).toBe("function");
  });

  // Test 21: qtyOverride passes qty to compileDualPineExport
  it("21. qtyOverride=7 passes qty=7 to compileDualPineExport", async () => {
    // Strategy lookup
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: (v: unknown) => void) => Promise.resolve([
            { id: "strat-for-export", lifecycleState: "DEPLOYED", name: "Test Strategy", config: { symbol: "MES", max_contracts: 4 } }
          ]).then(resolve),
          limit: vi.fn().mockResolvedValue([
            { id: "strat-for-export", lifecycleState: "DEPLOYED", name: "Test Strategy", config: { symbol: "MES", max_contracts: 4 } }
          ]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);
    // broker account lookup via execute()
    vi.mocked(db.execute).mockResolvedValue({
      rows: [{ firm_id: "mffu", broker_type: "traderspost", account_id_external: "EXT-123" }],
    } as unknown as Awaited<ReturnType<typeof db.execute>>);
    const auditRows: unknown[] = [];
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: unknown) => { auditRows.push(v); return Promise.resolve(); }),
    } as unknown as ReturnType<typeof db.insert>));

    const result = await generateRecipientExport({
      strategyId: "strat-for-export",
      accountId: "acct-mffu-operator",
      qtyOverride: 7,
    });

    expect(result.qty).toBe(7);
    // compileDualPineExport arg index 5 = qty
    const callArgs = (vi.mocked(compileDualPineExport as ReturnType<typeof vi.fn>)).mock.calls[0] as unknown[];
    expect(callArgs[5]).toBe(7);
  });

  // Test 22: audit_log row written on export
  it("22. audit_log row with pine-export action written on generateRecipientExport", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: (v: unknown) => void) => Promise.resolve([
            { id: "strat-for-export", lifecycleState: "DEPLOYED", name: "Test Strategy", config: { symbol: "MES", max_contracts: 4 } }
          ]).then(resolve),
          limit: vi.fn().mockResolvedValue([
            { id: "strat-for-export", lifecycleState: "DEPLOYED", name: "Test Strategy", config: { symbol: "MES", max_contracts: 4 } }
          ]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.execute).mockResolvedValue({
      rows: [{ firm_id: "mffu", broker_type: "traderspost", account_id_external: "EXT-123" }],
    } as unknown as Awaited<ReturnType<typeof db.execute>>);
    const auditRows: unknown[] = [];
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: unknown) => { auditRows.push(v); return Promise.resolve(); }),
    } as unknown as ReturnType<typeof db.insert>));

    await generateRecipientExport({
      strategyId: "strat-for-export",
      accountId: "acct-mffu-operator",
      qtyOverride: 4,
    });

    const exportAudit = (auditRows as Record<string, unknown>[]).find(
      (a) => typeof a.action === "string" && a.action.includes("pine")
    );
    expect(exportAudit).toBeDefined();
  });
});

describe("Pass 1 Track 1: mini guard contract tests (2 tests)", () => {
  beforeEach(() => {
    nextId = 1;
    vi.clearAllMocks();
    __resetEnabledFirmsCache();
    vi.mocked(isPipelineActive).mockResolvedValue(true);
  });

  // Test 23: TESTING strategy rejection
  it("23. TESTING strategy rejected — only DEPLOYED strategies can be assigned", async () => {
    mockSelectForAssign({ strategy: STRAT_TESTING, account: ACCT_MFFU_OPERATOR });

    await expect(
      assignStrategyToAccount("acct-mffu-operator", "strat-testing")
    ).rejects.toThrow("only DEPLOYED strategies can be assigned");
  });

  // Test 24: Missing strategy throws
  it("24. missing strategy throws not-found error", async () => {
    // Strategy lookup returns empty
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: (v: unknown) => void) => Promise.resolve([]).then(resolve),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    await expect(
      assignStrategyToAccount("acct-mffu-operator", "strat-nonexistent")
    ).rejects.toThrow("not found");
  });
});

describe("cross-cutting real-service tests (4 tests)", () => {
  beforeEach(() => {
    nextId = 1;
    vi.clearAllMocks();
    __resetEnabledFirmsCache();
    vi.mocked(isPipelineActive).mockResolvedValue(true);
  });

  // Test 25: Discord alert fires when the MFFU collaborative-trading BLOCK trips
  it("25. Discord alert (notifyCritical) fires when MFFU collaborative-trading assignment is BLOCKED", async () => {
    const newRow = makeAssignmentRow("acct-mffu-bob", "strat-deployed-1", { familyMemberLabel: "Bob" });
    const existingOnMffu = [
      { accountId: "acct-mffu-alice", familyMemberLabel: "Alice", firmId: "mffu" },
    ];
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_MFFU_BOB, existingOnMffu });
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        if (v.action) return Promise.resolve();
        return { returning: vi.fn().mockResolvedValue([newRow]) };
      }),
    } as unknown as ReturnType<typeof db.insert>));

    await expect(
      assignStrategyToAccount("acct-mffu-bob", "strat-deployed-1", { familyMemberLabel: "Bob" })
    ).rejects.toBeInstanceOf(CollaborativeTradingBlockedError);

    expect(vi.mocked(notifyCritical as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const callArgs = (vi.mocked(notifyCritical as ReturnType<typeof vi.fn>)).mock.calls[0] as [string, ...unknown[]];
    expect(callArgs[0]).toContain("BLOCKED");
  });

  // Test 26: Per-firm independence — mffu-only rejects topstep, accepts mffu
  it("26. per-firm independence: enabled_firms=['mffu'] rejects topstep, accepts mffu", async () => {
    // First call: mffu should work
    __resetEnabledFirmsCache();
    const mffuRow = makeAssignmentRow("acct-mffu-operator", "strat-deployed-1");
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_MFFU_OPERATOR, instanceConfig: [{ enabledFirms: ["mffu"] }] });
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        if (v.action) return Promise.resolve();
        return { returning: vi.fn().mockResolvedValue([mffuRow]) };
      }),
    } as unknown as ReturnType<typeof db.insert>));

    await expect(
      assignStrategyToAccount("acct-mffu-operator", "strat-deployed-1")
    ).resolves.toBeDefined();

    // Second call: topstep should fail (cache is now set to ["mffu"])
    mockSelectForAssign({ strategy: STRAT_DEPLOYED_2, account: ACCT_TOPSTEP_1, instanceConfig: [{ enabledFirms: ["mffu"] }] });

    await expect(
      assignStrategyToAccount("acct-topstep-1", "strat-deployed-2")
    ).rejects.toThrow("not in instance_config.enabled_firms");
  });

  // Test 27: Pipeline paused blocks releaseStrategyToFamily
  it("27. pipeline paused: releaseStrategyToFamily also throws PipelinePausedError", async () => {
    vi.mocked(isPipelineActive).mockResolvedValue(false);

    await expect(
      releaseStrategyToFamily(42, true, "Alice")
    ).rejects.toThrow("Pipeline is paused");
  });

  // Test 28: Collaborative-trading BLOCK audit row has correct shape
  it("28. collaborative-trading BLOCK writes audit row with correct action, severity, and failure status", async () => {
    const newRow = makeAssignmentRow("acct-mffu-bob", "strat-deployed-1", { familyMemberLabel: "Bob" });
    const existingOnMffu = [
      { accountId: "acct-mffu-alice", familyMemberLabel: "Alice", firmId: "mffu" },
    ];
    mockSelectForAssign({ strategy: STRAT_DEPLOYED, account: ACCT_MFFU_BOB, existingOnMffu });
    const auditRows: unknown[] = [];
    vi.mocked(db.insert).mockImplementation((_table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        auditRows.push(v);
        if (v.action) return Promise.resolve();
        return { returning: vi.fn().mockResolvedValue([newRow]) };
      }),
    } as unknown as ReturnType<typeof db.insert>));

    await expect(
      assignStrategyToAccount("acct-mffu-bob", "strat-deployed-1", { familyMemberLabel: "Bob" })
    ).rejects.toBeInstanceOf(CollaborativeTradingBlockedError);

    const blockedAudit = (auditRows as Record<string, unknown>[]).find(
      (a) => a.action === "strategy_assignment.collaborative_trading_blocked"
    );
    expect(blockedAudit).toBeDefined();
    expect(blockedAudit?.status).toBe("failure");
    expect((blockedAudit?.result as Record<string, unknown>)?.severity).toBe("blocked");
    expect((blockedAudit?.result as Record<string, unknown>)?.rule).toBe("mffu_no_collaborative_trading");
  });

  // Test 29: broker-router pipeline_paused when pipeline is paused
  it("29. broker-router returns pipeline_paused reason when pipeline is paused", async () => {
    vi.mocked(isPipelineActive).mockResolvedValue(false);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.insert>);

    const result = await routeOrder("acct-mffu-operator", { ticker: "MES", action: "enter_long" as const, orderType: "market" });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("pipeline_paused");
  });
});
