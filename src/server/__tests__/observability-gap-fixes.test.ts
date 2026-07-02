/**
 * observability-gap-fixes.test.ts — Wave 4 Track 4B observability gap fixes
 *
 * Tests for all five observability gap fixes applied in one session:
 *
 *   GAP 1 (MED) — leak-detection-service.ts: insertAuditRowSafe fires with
 *     action:"layer15.run_failed" when the strategy-ID-resolution DB query throws.
 *     Previously: HTTP 200 {strategies_scanned:0} was indistinguishable from clean.
 *
 *   GAP 2 (MED) — critic-optimizer-service.ts: notifyWarning called at R8
 *     (precommit_incomplete) and R3 (lookahead_violation) governance block sites.
 *     Verified via source-code assertion (function is not exported; governance
 *     pure-function unit tests are in critic-optimizer-service.governance.test.ts).
 *
 *   GAP 3 (MED) — lifecycle-service.ts: bifGateEvaluationsTotal counter incremented
 *     with correct outcome label (clean|warn|blocked|legacy_null). Verified by unit-
 *     testing the outcome-mapping logic independently from the lifecycle service.
 *
 *   GAP 4 (LOW) — metrics-registry.ts: layer15LeakDetectionsTotal zero-initialized
 *     for all 6 categories × 3 severities (18 combos) so Prometheus never shows "no
 *     data" for a label set that hasn't fired yet. Verified via source-code assertion.
 *
 *   GAP 5 (LOW) — admin.ts GET /kill-switch: insertAuditRowSafe fires with
 *     action:"kill_switch.autonomous_loop_read" on every read, enabling incident
 *     reconstruction. Verified via ephemeral-port express route test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import type { Express } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Shared hoisted mocks state (must be declared before vi.mock calls below)
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
  layer15LeakDetectionsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  layer15RunDurationMs: { observe: vi.fn() },
  bifGateEvaluationsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
  appendFamilyGradePostscript: vi.fn((body: string) => body + "\n--- family note ---"),
  dbSelect: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// ─── GAP 1 section mocks ─────────────────────────────────────────────────────

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mocks.insertAuditRowSafe,
  insertAuditRow: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  layer15LeakDetectionsTotal: mocks.layer15LeakDetectionsTotal,
  layer15RunDurationMs: mocks.layer15RunDurationMs,
  bifGateEvaluationsTotal: mocks.bifGateEvaluationsTotal,
  strategyPromotions: { inc: vi.fn() },
  pboBlocksTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  lifecycleShadowPromotionsTotal: { inc: vi.fn() },
  autoGraveyardTotal: { inc: vi.fn() },
  candidateConveyorEnqueuedTotal: { inc: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: mocks.notifyWarning,
  notifyCritical: mocks.notifyCritical,
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: mocks.appendFamilyGradePostscript,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
    debug: vi.fn(),
  },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startActiveSpan: vi.fn((_name: string, cb: (s: any) => any) =>
      cb({ setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() }),
    ),
  },
}));

// ─── DB mock — configurable per test ─────────────────────────────────────────
//
// The kill-switch route chains: db.select({val:...}).from(...).where(...).limit(1)
// The leak-detection route chains: db.select({...}).from(...).where(...) [no .limit()]
//
// To support both patterns, where() must return an object that:
//   - is awaitable (thenable) — so `await where(...)` works for leak-detection
//   - has a .limit() method that returns a Promise — for the admin kill-switch route
//
// We use a "thenable chainable" helper so both call sites work from the same mock.

let _dbSelectBehavior: "throw" | "empty" | "row" = "empty";
let _killSwitchRow: null | { val: string | null } = null;

function _makeWhereResult(data: unknown[]): {
  then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) => Promise<unknown>;
  catch: (reject: (e: unknown) => void) => Promise<unknown>;
  limit: (n: number) => Promise<unknown[]>;
  innerJoin: (...args: unknown[]) => any;
  orderBy: (...args: unknown[]) => any;
} {
  // Use a lazy getter so each call reads the current value of `data`
  const p = Promise.resolve(data);
  return {
    then: (resolve: any, reject?: any) => p.then(resolve, reject),
    catch: (reject: any) => p.catch(reject),
    limit: vi.fn().mockImplementation(() => Promise.resolve(data)),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
  };
}

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => {
          if (_dbSelectBehavior === "throw") {
            throw new Error("simulated DB error");
          }
          const data = _killSwitchRow !== null ? [_killSwitchRow] : [];
          return _makeWhereResult(data);
        }),
        innerJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => {
          const data = _killSwitchRow !== null ? [_killSwitchRow] : [];
          return Promise.resolve(data);
        }),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn(() => Promise.resolve(undefined)),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: {
    id: "id",
    name: "name",
    lifecycleState: "lifecycleState",
    preferredRegimes: "preferredRegimes",
    regimeTrainedOn: "regimeTrainedOn",
    symbol: "symbol",
    config: "config",
    forgeScore: "forgeScore",
  },
  auditLog: { id: "id" },
  systemParameters: {
    currentValue: "currentValue",
    paramName: "paramName",
  },
  systemState: {},
  agentHealthReports: {},
  dataIntegrityFindings: {},
  liquidityLevels: {},
  needsArchetypeQueue: {},
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: vi.fn(async () => "ACTIVE"),
  setMode: vi.fn(async () => {}),
}));

vi.mock("../services/harsh-regime-phase-service.js", () => ({
  getPhaseRecord: vi.fn(async () => ({ phase: "A" })),
  setPhaseOverride: vi.fn(),
}));

vi.mock("../lib/strategy-source-resolver.js", () => ({
  getStrategySourceUrls: vi.fn(async () => ({})),
}));

vi.mock("../services/agent-service.js", () => ({
  AgentService: { getAll: vi.fn(async () => []) },
}));

// ─────────────────────────────────────────────────────────────────────────────
// File path helpers (source-code assertion tests)
// ─────────────────────────────────────────────────────────────────────────────

const SRC_ROOT = join(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(SRC_ROOT, relPath), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset helpers
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertAuditRowSafe.mockResolvedValue(true);
  _dbSelectBehavior = "empty";
  _killSwitchRow = null;
});

afterEach(() => {
  _dbSelectBehavior = "empty";
  _killSwitchRow = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1 — layer15.run_failed audit row on DB error
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 1 — leak-detection-service: layer15.run_failed audit on DB error", () => {
  it("calls insertAuditRowSafe with action:layer15.run_failed when strategy-ID DB throws", async () => {
    _dbSelectBehavior = "throw";

    const { runLeakDetection } = await import("../services/leak-detection-service.js");
    const result = await runLeakDetection(undefined);

    expect(mocks.insertAuditRowSafe).toHaveBeenCalled();
    const call = mocks.insertAuditRowSafe.mock.calls.find(
      (args: any[]) => args[0]?.action === "layer15.run_failed",
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      action: "layer15.run_failed",
      entityType: "system",
      status: "failure",
      result: expect.objectContaining({
        error: expect.stringContaining("simulated DB error"),
        phase: "strategy_id_resolution",
      }),
    });
  });

  it("returns {strategies_scanned:0, leaks:[]} on DB error (response shape preserved)", async () => {
    _dbSelectBehavior = "throw";

    const { runLeakDetection } = await import("../services/leak-detection-service.js");
    const result = await runLeakDetection(undefined);

    expect(result.strategies_scanned).toBe(0);
    expect(result.leaks).toEqual([]);
    expect(result.run_id).toBeDefined();
    expect(result.started_at).toBeDefined();
    expect(result.completed_at).toBeDefined();
  });

  it("does NOT call insertAuditRowSafe with layer15.run_failed when DB returns empty rows (no strategies)", async () => {
    // Empty DB = clean scan of 0 strategies; must NOT fire run_failed
    _dbSelectBehavior = "empty";

    const { runLeakDetection } = await import("../services/leak-detection-service.js");
    await runLeakDetection(undefined);

    const failedCall = mocks.insertAuditRowSafe.mock.calls.find(
      (args: any[]) => args[0]?.action === "layer15.run_failed",
    );
    expect(failedCall).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 2 — critic governance blocks: notifyWarning at R8 + R3
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 2 — critic-optimizer-service: notifyWarning wired at R8 + R3 block sites", () => {
  it("R8 block site contains notifyWarning call with precommit_incomplete identifier", () => {
    const src = readSrc("services/critic-optimizer-service.ts");

    // Verify the R8 block contains a notifyWarning call with the correct title
    expect(src).toContain("R8: Critic governance block — candidate skipped (precommit_incomplete)");
    expect(src).toContain("notifyWarning");
  });

  it("R3 block site contains notifyWarning call with lookahead_violation identifier", () => {
    const src = readSrc("services/critic-optimizer-service.ts");

    expect(src).toContain("R3: Critic governance block — candidate skipped (lookahead_violation)");
    expect(src).toContain("notifyWarning");
  });

  it("notifyWarning import is present in critic-optimizer-service.ts", () => {
    const src = readSrc("services/critic-optimizer-service.ts");

    expect(src).toContain(`import { notifyWarning } from "./notification-service.js"`);
  });

  it("appendFamilyGradePostscript import is present in critic-optimizer-service.ts", () => {
    const src = readSrc("services/critic-optimizer-service.ts");

    expect(src).toContain(`import { appendFamilyGradePostscript } from "../lib/notification-helpers.js"`);
  });

  it("R8 notifyWarning call uses void (fire-and-forget, non-blocking)", () => {
    const src = readSrc("services/critic-optimizer-service.ts");

    // Verify the R8 Discord notify is fire-and-forget (void prefix)
    // The pattern should be: void notifyWarning( immediately after the R8 broadcastSSE
    const r8Section = src.slice(
      src.indexOf("precommit_incomplete)"),
      src.indexOf("precommit_incomplete)") + 2000,
    );
    expect(r8Section).toContain("void notifyWarning(");
  });

  it("R3 notifyWarning call uses void (fire-and-forget, non-blocking)", () => {
    const src = readSrc("services/critic-optimizer-service.ts");

    const r3Section = src.slice(
      src.indexOf("lookahead_violation_blocked"),
      src.indexOf("lookahead_violation_blocked") + 2000,
    );
    expect(r3Section).toContain("void notifyWarning(");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 3 — bifGateEvaluationsTotal counter: outcome-mapping logic
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 3 — bifGateEvaluationsTotal: outcome label mapping logic", () => {
  // These tests verify the outcome-mapping logic that was added to lifecycle-service.ts.
  // We unit-test the logic inline since lifecycle-service.ts is too complex to
  // integration-test here (deep DB wiring). The source-code check below confirms
  // the same logic is present in the production file.

  function mapBifOutcome(result: {
    passed: boolean;
    legacyNull: boolean;
    reason: string;
  }): string {
    return !result.passed
      ? "blocked"
      : result.legacyNull
        ? "legacy_null"
        : result.reason === "bif.warn_above_warn_threshold"
          ? "warn"
          : "clean";
  }

  it("maps passed:false → 'blocked'", () => {
    expect(
      mapBifOutcome({ passed: false, legacyNull: false, reason: "bif.blocked_exceeds_threshold" }),
    ).toBe("blocked");
  });

  it("maps passed:true + legacyNull:true → 'legacy_null'", () => {
    expect(
      mapBifOutcome({ passed: true, legacyNull: true, reason: "bif.legacy_null_pre_wave3" }),
    ).toBe("legacy_null");
  });

  it("maps passed:true + legacyNull:false + warn reason → 'warn'", () => {
    expect(
      mapBifOutcome({
        passed: true,
        legacyNull: false,
        reason: "bif.warn_above_warn_threshold",
      }),
    ).toBe("warn");
  });

  it("maps passed:true + legacyNull:false + clean reason → 'clean'", () => {
    expect(
      mapBifOutcome({ passed: true, legacyNull: false, reason: "bif.clean" }),
    ).toBe("clean");
  });

  it("outcome logic is present in lifecycle-service.ts with correct outcome labels", () => {
    const src = readSrc("services/lifecycle-service.ts");

    // Verify all 4 outcome labels appear at the counter increment site
    expect(src).toContain('"blocked"');
    expect(src).toContain('"legacy_null"');
    expect(src).toContain('"warn"');
    expect(src).toContain('"clean"');
    expect(src).toContain("bifGateEvaluationsTotal");
    expect(src).toContain("bifOutcome");
  });

  it("bifGateEvaluationsTotal is exported from metrics-registry.ts", () => {
    const src = readSrc("lib/metrics-registry.ts");

    expect(src).toContain("export const bifGateEvaluationsTotal");
    expect(src).toContain("tf_bif_gate_evaluations_total");
    expect(src).toContain('"outcome"');
  });

  it("bifGateEvaluationsTotal is imported in lifecycle-service.ts", () => {
    const src = readSrc("services/lifecycle-service.ts");

    expect(src).toContain("bifGateEvaluationsTotal");
    expect(src).toContain("metrics-registry.js");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 4 — layer15LeakDetectionsTotal: zero-init for all 18 label combos
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP 4 — layer15LeakDetectionsTotal: 18-combo zero-init at startup", () => {
  const EXPECTED_CATEGORIES = [
    "execution_slippage",
    "allocation_drift",
    "regime",
    "attribution_opacity",
    "subsystem_consensus",
    "mc_distribution_breach",
  ] as const;

  const EXPECTED_SEVERITIES = ["info", "warning", "high"] as const;

  it("metrics-registry.ts declares all 6 categories in the zero-init IIFE", () => {
    const src = readSrc("lib/metrics-registry.ts");

    for (const cat of EXPECTED_CATEGORIES) {
      expect(src).toContain(`"${cat}"`);
    }
  });

  it("metrics-registry.ts declares all 3 severities in the zero-init IIFE", () => {
    const src = readSrc("lib/metrics-registry.ts");

    for (const sev of EXPECTED_SEVERITIES) {
      expect(src).toContain(`"${sev}"`);
    }
  });

  it("metrics-registry.ts contains the zero-init IIFE calling .inc(0) for each combo", () => {
    const src = readSrc("lib/metrics-registry.ts");

    // The IIFE uses a nested loop — verify the structure is present
    expect(src).toContain("_zeroInitLayer15Labels");
    expect(src).toContain("LAYER15_CATEGORIES");
    expect(src).toContain("LAYER15_SEVERITIES");
    expect(src).toContain(".inc(0)");
  });

  it("comment in metrics-registry.ts updated to 6 categories (not 5)", () => {
    const src = readSrc("lib/metrics-registry.ts");

    // Comment should say 6 categories, not 5
    expect(src).toContain("6 Layer 15 taxonomy buckets");
    // The old "5 categories" comment should not appear
    expect(src).not.toContain("5 Layer 15 taxonomy buckets");
  });

  it("mc_distribution_breach is listed in the 6-category comment", () => {
    const src = readSrc("lib/metrics-registry.ts");

    expect(src).toContain('"mc_distribution_breach"');
    // Should appear in the comment too
    expect(src).toContain("mc_distribution_breach");
  });

  it("declares 18 = 6×3 time series in the comment (not 15)", () => {
    const src = readSrc("lib/metrics-registry.ts");

    expect(src).toContain("18 time series");
    // Old "15 time series" comment should be gone
    expect(src).not.toContain("15 time series");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 5 — GET /kill-switch: audit row on read
// ─────────────────────────────────────────────────────────────────────────────

async function buildAdminApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  // Wire req.id and req.log expected by admin.ts
  app.use((req: any, _res: any, next: any) => {
    req.id = "test-correlation-id";
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  const { adminRoutes } = await import("../routes/admin.js");
  app.use("/api/admin", adminRoutes);
  return app;
}

async function getKillSwitch(
  app: Express,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch`);
        const json = (await res.json()) as Record<string, unknown>;
        resolve({ status: res.status, body: json });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
    server.on("error", reject);
  });
}

describe("GAP 5 — GET /api/admin/kill-switch: insertAuditRowSafe on read", () => {
  it("calls insertAuditRowSafe with action:kill_switch.autonomous_loop_read on successful read", async () => {
    // DB returns no row → enabled=false
    _dbSelectBehavior = "empty";
    _killSwitchRow = null;

    const app = await buildAdminApp();
    const { status } = await getKillSwitch(app);

    expect(status).toBe(200);
    expect(mocks.insertAuditRowSafe).toHaveBeenCalled();

    const call = mocks.insertAuditRowSafe.mock.calls.find(
      (args: any[]) => args[0]?.action === "kill_switch.autonomous_loop_read",
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      action: "kill_switch.autonomous_loop_read",
      entityType: "system",
      status: "info",
      result: expect.objectContaining({
        key: "auto_patch_loop_enabled",
        enabled: false,
      }),
    });
  });

  it("reports enabled:true (AUTOPILOT) in audit row when DB row has value '2'", async () => {
    _killSwitchRow = { val: "2" };

    const app = await buildAdminApp();
    const { status, body } = await getKillSwitch(app);

    expect(status).toBe(200);
    // backward-compat: enabled === autonomous_on (mode >= 2)
    expect(body.enabled).toBe(true);
    expect(body.mode).toBe(2);
    expect(body.advisory_on).toBe(true);
    expect(body.autonomous_on).toBe(true);

    const call = mocks.insertAuditRowSafe.mock.calls.find(
      (args: any[]) => args[0]?.action === "kill_switch.autonomous_loop_read",
    );
    expect(call).toBeDefined();
    expect(call![0].result.enabled).toBe(true);
    expect(call![0].result.raw).toBe("2");
  });

  it("SAFETY CRUX — value '1' (OBSERVE) reports enabled:false but advisory_on:true", async () => {
    // OBSERVE must NOT set enabled=true — autonomous readers gate on `enabled`.
    _killSwitchRow = { val: "1" };

    const app = await buildAdminApp();
    const { status, body } = await getKillSwitch(app);

    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.mode).toBe(1);
    expect(body.advisory_on).toBe(true);
    expect(body.autonomous_on).toBe(false);

    const call = mocks.insertAuditRowSafe.mock.calls.find(
      (args: any[]) => args[0]?.action === "kill_switch.autonomous_loop_read",
    );
    expect(call).toBeDefined();
    expect(call![0].result.enabled).toBe(false);
    expect(call![0].result.raw).toBe("1");
  });

  it("reports enabled:false (OFF) in audit row when DB row has value '0'", async () => {
    _killSwitchRow = { val: "0" };

    const app = await buildAdminApp();
    const { status, body } = await getKillSwitch(app);

    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.mode).toBe(0);
    expect(body.advisory_on).toBe(false);

    const call = mocks.insertAuditRowSafe.mock.calls.find(
      (args: any[]) => args[0]?.action === "kill_switch.autonomous_loop_read",
    );
    expect(call).toBeDefined();
    expect(call![0].result.enabled).toBe(false);
  });

  it("audit row contains correlationId from req.id", async () => {
    _killSwitchRow = null;

    const app = await buildAdminApp();
    await getKillSwitch(app);

    const call = mocks.insertAuditRowSafe.mock.calls.find(
      (args: any[]) => args[0]?.action === "kill_switch.autonomous_loop_read",
    );
    expect(call).toBeDefined();
    expect(call![0].correlationId).toBe("test-correlation-id");
  });

  it("route still returns 200 JSON even if insertAuditRowSafe were to reject (fail-soft)", async () => {
    // insertAuditRowSafe is fire-and-forget (void) — rejection must never break the response
    mocks.insertAuditRowSafe.mockRejectedValueOnce(new Error("audit DB down"));
    _killSwitchRow = null;

    const app = await buildAdminApp();
    const { status, body } = await getKillSwitch(app);

    // Response should still be 200 with JSON even if audit fails
    expect(status).toBe(200);
    expect(typeof body.enabled).toBe("boolean");
  });

  it("source code in admin.ts documents the fire-and-forget pattern with void", () => {
    const src = readSrc("routes/admin.ts");

    expect(src).toContain("kill_switch.autonomous_loop_read");
    expect(src).toContain("void insertAuditRowSafe(");
    expect(src).toContain("Fail-soft: insertAuditRowSafe never throws; response is never blocked.");
  });
});
