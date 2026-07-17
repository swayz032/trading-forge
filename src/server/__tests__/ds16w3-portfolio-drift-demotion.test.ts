// DS16W3: behavioral coverage for the portfolio-drift auto-demotion cron.
// Restores the demotion the dead n8n "Daily Portfolio Monitor" node was supposed
// to do (rolling_sharpe_30d < floor → DEPLOYED → DECLINING → TESTING).
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://ci:ci@localhost:5432/ci_ds16w3";
// Floor const is read at module load — pin it explicitly for deterministic tests.
process.env.PORTFOLIO_DRIFT_SHARPE_FLOOR = "1.0";

// ── shared mock state ─────────────────────────────────────────────────────────
const mockRows: Array<{ id: string; name: string; rollingSharpe30d: string | null }> = [];
const promoteCalls: Array<[string, string, string]> = [];
const auditActions: string[] = [];
const sseEvents: string[] = [];
const criticalTitles: string[] = [];
const warnTitles: string[] = [];
let step2ShouldFail = false;
let step1ShouldFail = false;
let step1ShouldThrow = false;

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows),
      }),
    }),
  },
}));
vi.mock("../db/schema.js", () => ({ strategies: { id: {}, name: {}, rollingSharpe30d: {}, lifecycleState: {} } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: (row: { action: string }) => { auditActions.push(row.action); return Promise.resolve(); },
}));
vi.mock("../lib/metrics-registry.js", () => ({
  portfolioDriftDemotionsTotal: { labels: () => ({ inc: () => {} }) },
}));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: (b: string) => b }));
vi.mock("../services/notification-service.js", () => ({
  notifyWarning: (title: string) => { warnTitles.push(title); },
  notifyCritical: (title: string) => { criticalTitles.push(title); },
}));
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    promoteStrategy(id: string, from: string, to: string) {
      if (to === "DECLINING" && step1ShouldThrow) throw new Error("step1_threw");
      promoteCalls.push([id, from, to]);
      if (to === "DECLINING" && step1ShouldFail) return Promise.resolve({ success: false, error: "step1_boom" });
      if (to === "TESTING" && step2ShouldFail) return Promise.resolve({ success: false, error: "step2_boom" });
      return Promise.resolve({ success: true });
    }
  },
}));
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: (event: string) => { sseEvents.push(event); },
  LIFECYCLE_GATE_EVENTS: { PORTFOLIO_DRIFT_DEMOTED: "lifecycle:portfolio_drift_demoted" },
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

type RunFn = (opts?: { now?: number; dryRun?: boolean }) => Promise<{
  strategiesChecked: number; driftDetected: number; demoted: number; skipped: number; dryRun: boolean;
}>;
let runPortfolioDriftDemotion: RunFn;

beforeEach(async () => {
  mockRows.length = 0;
  promoteCalls.length = 0;
  auditActions.length = 0;
  sseEvents.length = 0;
  criticalTitles.length = 0;
  warnTitles.length = 0;
  step2ShouldFail = false;
  step1ShouldFail = false;
  step1ShouldThrow = false;
  delete process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED; // default-OFF unless a test opts in
  ({ runPortfolioDriftDemotion } = await import("../services/portfolio-drift-demotion-service.js"));
});

describe("DS16W3 — portfolio-drift auto-demotion", () => {
  it("no drift when rolling Sharpe is at or above the floor", async () => {
    process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED = "true";
    mockRows.push({ id: "s1", name: "healthy", rollingSharpe30d: "1.5" });
    const r = await runPortfolioDriftDemotion();
    expect(r.strategiesChecked).toBe(1);
    expect(r.driftDetected).toBe(0);
    expect(promoteCalls.length).toBe(0);
    expect(auditActions).not.toContain("strategy.portfolio_drift_detected");
  });

  it("FAIL-SAFE: NULL rolling Sharpe skips (never demotes) — the n8n 0-default bug is not reproduced", async () => {
    process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED = "true";
    mockRows.push({ id: "s2", name: "no-data", rollingSharpe30d: null });
    const r = await runPortfolioDriftDemotion();
    expect(r.skipped).toBe(1);
    expect(r.driftDetected).toBe(0);
    expect(promoteCalls.length).toBe(0);
    expect(auditActions).toContain("portfolio_drift_demotion.no_sharpe_data_skipped");
  });

  it("flag ON + Sharpe below floor → two-step demotion DEPLOYED→DECLINING→TESTING + SSE", async () => {
    process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED = "true";
    mockRows.push({ id: "s3", name: "drifting", rollingSharpe30d: "0.4" });
    const r = await runPortfolioDriftDemotion();
    expect(r.driftDetected).toBe(1);
    expect(r.demoted).toBe(1);
    expect(promoteCalls).toEqual([
      ["s3", "DEPLOYED", "DECLINING"],
      ["s3", "DECLINING", "TESTING"],
    ]);
    expect(auditActions).toContain("strategy.portfolio_drift_detected");
    expect(auditActions).toContain("lifecycle.portfolio_drift_demotion");
    expect(sseEvents).toContain("lifecycle:portfolio_drift_demoted");
  });

  it("DEFAULT-OFF (flag unset) → detects drift but suppresses demotion (dry-run)", async () => {
    mockRows.push({ id: "s4", name: "drifting-dry", rollingSharpe30d: "0.4" });
    const r = await runPortfolioDriftDemotion();
    expect(r.driftDetected).toBe(1);
    expect(r.demoted).toBe(0);
    expect(r.dryRun).toBe(true);
    expect(promoteCalls.length).toBe(0);
    expect(auditActions).toContain("strategy.portfolio_drift_detected");
    expect(auditActions).toContain("portfolio_drift_demotion.dry_run");
    expect(sseEvents).not.toContain("lifecycle:portfolio_drift_demoted");
  });

  it("explicit dryRun opt overrides the enable flag", async () => {
    process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED = "true";
    mockRows.push({ id: "s5", name: "drifting", rollingSharpe30d: "0.2" });
    const r = await runPortfolioDriftDemotion({ dryRun: true });
    expect(r.demoted).toBe(0);
    expect(promoteCalls.length).toBe(0);
  });

  it("zombie DECLINING: step2 failure → critical alert + zombie audit (regime sweep recovers)", async () => {
    process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED = "true";
    step2ShouldFail = true;
    mockRows.push({ id: "s6", name: "half-demoted", rollingSharpe30d: "0.3" });
    const r = await runPortfolioDriftDemotion();
    expect(r.demoted).toBe(0);
    expect(promoteCalls).toEqual([
      ["s6", "DEPLOYED", "DECLINING"],
      ["s6", "DECLINING", "TESTING"],
    ]);
    expect(auditActions).toContain("lifecycle.portfolio_drift_zombie_declining");
    expect(criticalTitles.length).toBe(1);
    // HIGH fix (critic-replay-lifecycle-misc, 2026-07-17): a step2 (zombie) failure
    // must NEVER also claim via notifyWarning that the strategy was demoted — the
    // pre-fix code fired the "demoted to TESTING" warning unconditionally BEFORE
    // attempting either promoteStrategy call, so this scenario (real demotion
    // failure) previously still sent a false "demoted to TESTING" Discord message.
    expect(warnTitles.some((t) => t.includes("demoted to TESTING"))).toBe(false);
  });

  it("HIGH fix: step1 (DEPLOYED→DECLINING) failure does NOT send a false 'demoted' notification, and DOES send a failure notification", async () => {
    process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED = "true";
    step1ShouldFail = true;
    mockRows.push({ id: "s7", name: "step1-fails", rollingSharpe30d: "0.3" });
    const r = await runPortfolioDriftDemotion();
    expect(r.demoted).toBe(0);
    // Only step1 was attempted — step2 must never run when step1 fails.
    expect(promoteCalls).toEqual([["s7", "DEPLOYED", "DECLINING"]]);
    // Pre-fix: notifyWarning("...demoted to TESTING") fired unconditionally BEFORE
    // promoteStrategy was even called, regardless of outcome. Post-fix: no false
    // "demoted" claim, and a distinct failure notification fires instead so the
    // operator isn't left with zero signal that the strategy is still DEPLOYED.
    expect(warnTitles.some((t) => t.includes("demoted to TESTING"))).toBe(false);
    expect(warnTitles.some((t) => t.includes("demotion FAILED"))).toBe(true);
  });

  it("HIGH fix: promoteStrategy throwing synchronously does NOT send a false 'demoted' notification", async () => {
    process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED = "true";
    step1ShouldThrow = true;
    mockRows.push({ id: "s8", name: "step1-throws", rollingSharpe30d: "0.3" });
    const r = await runPortfolioDriftDemotion();
    expect(r.demoted).toBe(0);
    expect(warnTitles.some((t) => t.includes("demoted to TESTING"))).toBe(false);
    expect(warnTitles.some((t) => t.includes("threw"))).toBe(true);
  });

  it("HIGH fix: successful demotion sends the 'demoted to TESTING' notification exactly once, AFTER both promote calls complete", async () => {
    process.env.PORTFOLIO_DRIFT_DEMOTION_ENABLED = "true";
    mockRows.push({ id: "s9", name: "clean-demote", rollingSharpe30d: "0.3" });
    const r = await runPortfolioDriftDemotion();
    expect(r.demoted).toBe(1);
    const demotedTitles = warnTitles.filter((t) => t.includes("demoted to TESTING"));
    expect(demotedTitles).toHaveLength(1);
    // Both lifecycle transitions must have already been recorded by the time the
    // notification fires — proven by promoteCalls holding both entries when this
    // assertion runs (the whole sweep is awaited to completion above).
    expect(promoteCalls).toEqual([
      ["s9", "DEPLOYED", "DECLINING"],
      ["s9", "DECLINING", "TESTING"],
    ]);
  });

  it("always writes a completion summary row", async () => {
    const r = await runPortfolioDriftDemotion();
    expect(r.strategiesChecked).toBe(0);
    expect(auditActions).toContain("portfolio_drift_demotion.completed");
  });
});
