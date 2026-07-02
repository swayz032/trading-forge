// deepscan6 R2: behavioral coverage for the strategy-age re-validation gate.
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://ci:ci@localhost:5432/ci_deepscan6";
process.env.STRATEGY_REVALIDATION_WARN_DAYS = "365";
process.env.STRATEGY_REVALIDATION_FORCE_DAYS = "548";

// ── mocks ────────────────────────────────────────────────────────────────────
const mockRows: Array<{ id: string; name: string; frozenPolicySetAt: Date | null }> = [];
const promoteCalls: Array<[string, string, string]> = [];
const auditActions: string[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows),
      }),
    }),
  },
}));
vi.mock("../db/schema.js", () => ({ strategies: { id: {}, name: {}, frozenPolicySetAt: {}, lifecycleState: {} } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: (row: { action: string }) => { auditActions.push(row.action); return Promise.resolve(); },
}));
vi.mock("../services/notification-service.js", () => ({ notifyWarning: () => {} }));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: (b: string) => b }));
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    promoteStrategy(id: string, from: string, to: string) {
      promoteCalls.push([id, from, to]);
      return Promise.resolve({ success: true });
    }
  },
}));
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}), isNotNull: () => ({}) }));

const NOW = new Date("2026-07-02T00:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000);

let runStrategyAgeRevalidation: (opts?: { now?: number; dryRun?: boolean }) => Promise<{ scanned: number; due: number; forced: number; demotionFailures: number }>;

beforeEach(async () => {
  mockRows.length = 0;
  promoteCalls.length = 0;
  auditActions.length = 0;
  ({ runStrategyAgeRevalidation } = await import("../services/strategy-revalidation-service.js"));
});

describe("deepscan6 R2 — strategy-age re-validation", () => {
  it("does nothing for a freshly-validated strategy (< 365d)", async () => {
    mockRows.push({ id: "s1", name: "fresh", frozenPolicySetAt: daysAgo(100) });
    const r = await runStrategyAgeRevalidation({ now: NOW });
    expect(r.scanned).toBe(1);
    expect(r.due).toBe(0);
    expect(r.forced).toBe(0);
    expect(promoteCalls.length).toBe(0);
    expect(auditActions).not.toContain("strategy.revalidation_due");
  });

  it("WARNs (due, no demotion) between 365d and 548d", async () => {
    mockRows.push({ id: "s2", name: "aging", frozenPolicySetAt: daysAgo(400) });
    const r = await runStrategyAgeRevalidation({ now: NOW });
    expect(r.due).toBe(1);
    expect(r.forced).toBe(0);
    expect(promoteCalls.length).toBe(0);
    expect(auditActions).toContain("strategy.revalidation_due");
  });

  it("FORCES two-step demotion (DEPLOYED→DECLINING→TESTING) beyond 548d", async () => {
    mockRows.push({ id: "s3", name: "stale", frozenPolicySetAt: daysAgo(600) });
    const r = await runStrategyAgeRevalidation({ now: NOW });
    expect(r.forced).toBe(1);
    expect(promoteCalls).toEqual([
      ["s3", "DEPLOYED", "DECLINING"],
      ["s3", "DECLINING", "TESTING"],
    ]);
    expect(auditActions).toContain("strategy.revalidation_forced");
  });

  it("dryRun forces the WARN/audit but skips the demotion", async () => {
    mockRows.push({ id: "s4", name: "stale-dry", frozenPolicySetAt: daysAgo(600) });
    const r = await runStrategyAgeRevalidation({ now: NOW, dryRun: true });
    expect(r.forced).toBe(1);
    expect(promoteCalls.length).toBe(0);
  });

  it("always writes a completion summary row", async () => {
    const r = await runStrategyAgeRevalidation({ now: NOW });
    expect(r.scanned).toBe(0);
    expect(auditActions).toContain("strategy_revalidation.completed");
  });
});
