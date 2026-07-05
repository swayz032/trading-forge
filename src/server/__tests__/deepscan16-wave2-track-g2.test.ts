/**
 * deepscan16-wave2-track-g2.test.ts — Deep-scan #16 Wave 2 Track G2
 *
 * Coverage:
 *   E-1 (PRIORITY) — DSL guards_failed HARD promotion gate wired at
 *     TESTING→PAPER, SHADOW→PAPER, and PAPER→DEPLOY_READY in lifecycle-service.ts.
 *     Reads backtests.result_extras.dsl_guards.guards_failed and BLOCKS promotion
 *     when true; grandfather-passes legacy backtests that never emitted the field.
 *   #14 — paper.ts failed_to_stream status UPDATE failure handling.
 *   #15 — mcl-pre-eia-stop-tighten-service.ts stop_tightened audit failure logging.
 *   #16 — agent.ts extraction-pipeline audit insert failure logging.
 *   #17 — idempotency.ts expired-key DELETE failure handling.
 *   #18/#22 — critic-optimizer-service.ts success audit + recovery force-fail
 *     audit/counter.
 *   #20 — candidate-backtest-conveyor-service.ts per-strategy rejection audit + metric.
 *   #21 — paper-trading-stream.ts stream lifecycle audit + counter.
 *   #25 — health-dashboard.ts DB migration version + last-successful-backtest age.
 *
 * Pattern: lifecycle-service.ts (and several sibling services) are heavily
 * DB-coupled at module-load time (pull in ../db/index.js, which throws without
 * DATABASE_URL at collection time in some environments). Following the
 * established convention in this repo (see deepscan16-hard-gate-counters.test.ts
 * and lifecycle-pass5-paper-deploy-ready.test.ts), this file:
 *   (a) unit-tests a REFERENCE-IMPLEMENTATION copy of the new pure gate logic,
 *   (b) exercises the REAL (non-mocked) metrics-registry.ts counters directly, and
 *   (c) asserts on the actual source text of each owned file to guard the call
 *       sites against silent regression in a future refactor.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  promRegistry,
  dslGuardsGateTotal,
  trackG2SilentFailuresTotal,
  candidateConveyorRejectionsTotal,
  criticOptimizerRecoveryForceFailTotal,
  paperStreamLifecycleTotal,
} from "../lib/metrics-registry.js";

async function getCounterValue(
  metricName: string,
  labelFilter: Record<string, string> = {},
): Promise<number> {
  const metrics = await promRegistry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === metricName);
  if (!metric) return 0;
  const values = metric.values as Array<{ labels: Record<string, string>; value: number }>;
  if (Object.keys(labelFilter).length === 0) {
    return values.reduce((acc, v) => acc + v.value, 0);
  }
  const match = values.find((v) =>
    Object.entries(labelFilter).every(([k, val]) => v.labels[k] === val),
  );
  return match?.value ?? 0;
}

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");
const PAPER_ROUTE_PATH = resolve(process.cwd(), "src/server/routes/paper.ts");
const MCL_PRE_EIA_PATH = resolve(process.cwd(), "src/server/services/mcl-pre-eia-stop-tighten-service.ts");
const AGENT_ROUTE_PATH = resolve(process.cwd(), "src/server/routes/agent.ts");
const IDEMPOTENCY_PATH = resolve(process.cwd(), "src/server/middleware/idempotency.ts");
const CRITIC_OPTIMIZER_PATH = resolve(process.cwd(), "src/server/services/critic-optimizer-service.ts");
const CONVEYOR_PATH = resolve(process.cwd(), "src/server/services/candidate-backtest-conveyor-service.ts");
const PAPER_STREAM_PATH = resolve(process.cwd(), "src/server/services/paper-trading-stream.ts");
const HEALTH_DASHBOARD_PATH = resolve(process.cwd(), "src/server/routes/health-dashboard.ts");

// ─── E-1 (PRIORITY) — DSL guards_failed gate reference implementation ─────────
//
// Exact-copy reference of lifecycle-service.ts's evaluateDslGuardsGate(), unit
// tested independently per this file's established pattern.
interface DslGuardsGateInput {
  guards_failed?: boolean | null;
  guards_failed_reason?: string | null;
}

function evaluateDslGuardsGateRef(dslGuards: DslGuardsGateInput | null | undefined) {
  if (dslGuards == null || typeof dslGuards !== "object" || dslGuards.guards_failed === undefined) {
    return {
      passed: true,
      status: "legacy_proceed" as const,
      auditAction: "lifecycle.dsl_guards_unavailable_legacy" as const,
    };
  }
  if (dslGuards.guards_failed === true) {
    return {
      passed: false,
      status: "blocked" as const,
      auditAction: "lifecycle.dsl_guards_failed_block" as const,
    };
  }
  return {
    passed: true,
    status: "pass" as const,
    auditAction: null,
  };
}

function deriveDslGuardsOutcome(result: { passed: boolean; status: string }): string {
  return result.status === "legacy_proceed" ? "legacy" : result.passed ? "pass" : "block";
}

describe("E-1 — evaluateDslGuardsGate reference implementation", () => {
  it("blocks when guards_failed === true", () => {
    const r = evaluateDslGuardsGateRef({ guards_failed: true, guards_failed_reason: "stop_ceiling_exception" });
    expect(r.passed).toBe(false);
    expect(r.status).toBe("blocked");
    expect(r.auditAction).toBe("lifecycle.dsl_guards_failed_block");
  });

  it("passes when guards_failed === false (clean run)", () => {
    const r = evaluateDslGuardsGateRef({ guards_failed: false });
    expect(r.passed).toBe(true);
    expect(r.status).toBe("pass");
    expect(r.auditAction).toBeNull();
  });

  it("grandfather-passes with a legacy audit when the field is entirely absent", () => {
    expect(evaluateDslGuardsGateRef(null).status).toBe("legacy_proceed");
    expect(evaluateDslGuardsGateRef(undefined).status).toBe("legacy_proceed");
    expect(evaluateDslGuardsGateRef({}).status).toBe("legacy_proceed");
    expect(evaluateDslGuardsGateRef(null).passed).toBe(true);
    expect(evaluateDslGuardsGateRef({}).auditAction).toBe("lifecycle.dsl_guards_unavailable_legacy");
  });

  it("outcome-derivation maps legacy_proceed -> legacy, block -> block, pass -> pass", () => {
    expect(deriveDslGuardsOutcome({ passed: true, status: "legacy_proceed" })).toBe("legacy");
    expect(deriveDslGuardsOutcome({ passed: false, status: "blocked" })).toBe("block");
    expect(deriveDslGuardsOutcome({ passed: true, status: "pass" })).toBe("pass");
  });
});

describe("E-1 — tf_dsl_guards_gate_total counter", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_dsl_guards_gate_total");
  });

  it("is zero-initialized for all 3 transitions × 4 outcomes", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_dsl_guards_gate_total");
    expect(metric).toBeDefined();
    const values = (metric as any).values as Array<{ labels: Record<string, string>; value: number }>;
    for (const transition of ["TESTING_TO_PAPER", "SHADOW_TO_PAPER", "PAPER_TO_DEPLOY_READY"]) {
      for (const outcome of ["pass", "block", "legacy", "error"]) {
        expect(values.find((v) => v.labels.transition === transition && v.labels.outcome === outcome)).toBeDefined();
      }
    }
  });

  it("increments independently per transition+outcome pair", async () => {
    const before = await getCounterValue("tf_dsl_guards_gate_total", { transition: "PAPER_TO_DEPLOY_READY", outcome: "block" });
    dslGuardsGateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: "block" }).inc();
    const after = await getCounterValue("tf_dsl_guards_gate_total", { transition: "PAPER_TO_DEPLOY_READY", outcome: "block" });
    expect(after).toBe(before + 1);
  });
});

describe("E-1 — lifecycle-service.ts wires the DSL guards gate at all 3 transitions", () => {
  const src = readFileSync(LIFECYCLE_PATH, "utf8");

  it("defines the pure evaluator + counter helper once", () => {
    expect(src).toContain("function evaluateDslGuardsGate(");
    expect(src).toContain("function _incDslGuardsGateCounter(");
  });

  it("calls the gate at TESTING_TO_PAPER, SHADOW_TO_PAPER, and PAPER_TO_DEPLOY_READY", () => {
    expect(src).toContain('_incDslGuardsGateCounter("TESTING_TO_PAPER"');
    expect(src).toContain('_incDslGuardsGateCounter("SHADOW_TO_PAPER"');
    expect(src).toContain('_incDslGuardsGateCounter("PAPER_TO_DEPLOY_READY"');
  });

  it("reads dsl_guards off backtests.result_extras (not walk_forward_results)", () => {
    expect(src).toContain(".resultExtras as Record<string, unknown> | null)?.dsl_guards");
  });

  it("blocks promotion with a continue statement immediately after each block branch", () => {
    const idx = src.indexOf("DSL guards gate BLOCKED TESTING→PAPER");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 900)).toContain("continue;");
  });

  it("fails CLOSED (blocks) on infra/read errors at all 3 sites, mirroring the B14 gate severity", () => {
    expect(src).toContain('dslGuardsGateTotal.labels({ transition: "TESTING_TO_PAPER", outcome: "error" })');
    expect(src).toContain('dslGuardsGateTotal.labels({ transition: "SHADOW_TO_PAPER", outcome: "error" })');
    expect(src).toContain('dslGuardsGateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: "error" })');
    expect(src).toContain("lifecycle.dsl_guards_gate_error_fail_closed");
  });

  it("does NOT push the legacy grandfather status into gateEvidenceStatuses (would silently perturb the separate >=3-incomplete governor)", () => {
    const idx = src.indexOf("DSL guards_failed HARD gate: PAPER → DEPLOY_READY");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 4000);
    // The PAPER→DEPLOY_READY block must NOT call gateEvidenceStatuses.push for this gate.
    const pushIdx = block.indexOf("gateEvidenceStatuses.push(dslGuardsResult");
    expect(pushIdx).toBe(-1);
  });

  it("uses insertAuditRow-compatible audit_log inserts with a non-null status", () => {
    expect(src).toContain("lifecycle.dsl_guards_failed_block");
    expect(src).toContain("lifecycle.dsl_guards_unavailable_legacy");
  });
});

// ─── #14 — paper.ts failed_to_stream status UPDATE failure handling ──────────
describe("#14 — paper.ts failed_to_stream status UPDATE no longer swallows silently", () => {
  const src = readFileSync(PAPER_ROUTE_PATH, "utf8");

  it("no longer has a bare .catch(() => {}) on the failed_to_stream UPDATE", () => {
    const idx = src.indexOf('.set({ status: "failed_to_stream"');
    expect(idx).toBeGreaterThan(-1);
    const after = src.slice(idx, idx + 900);
    expect(after).not.toContain(".catch(() => {});");
    expect(after).toContain("updateErr");
  });

  it("logs, audits, and counts the failure", () => {
    expect(src).toContain("paper.failed_to_stream_status_update_failed");
    expect(src).toContain("trackG2SilentFailuresTotal.labels({ site: \"paper_session_failed_to_stream_update\" })");
  });
});

// ─── #15 — mcl-pre-eia-stop-tighten-service.ts audit failure logging ─────────
describe("#15 — mcl-pre-eia stop_tightened audit failure is no longer silent", () => {
  const src = readFileSync(MCL_PRE_EIA_PATH, "utf8");

  it("the stop_tightened insertAuditRow no longer swallows via .catch(() => {})", () => {
    const idx = src.indexOf('action: "mcl_pre_eia.stop_tightened"');
    expect(idx).toBeGreaterThan(-1);
    const after = src.slice(idx, idx + 700);
    expect(after).not.toContain(".catch(() => {});");
    expect(after).toContain("auditErr");
  });

  it("logs at error level and increments the shared silent-failure counter", () => {
    expect(src).toContain("logger.error(");
    expect(src).toContain('trackG2SilentFailuresTotal.labels({ site: "mcl_pre_eia_stop_tighten_audit" })');
  });
});

// ─── #16 — agent.ts extraction-pipeline audit insert failure logging ─────────
describe("#16 — agent.ts extraction-pipeline audit inserts now log on failure", () => {
  const src = readFileSync(AGENT_ROUTE_PATH, "utf8");

  it("extraction.mechanic_classification_override now has a .catch handler (previously none at all)", () => {
    const idx = src.indexOf('action: "extraction.mechanic_classification_override"');
    expect(idx).toBeGreaterThan(-1);
    const after = src.slice(idx, idx + 1200);
    expect(after).toContain(".catch((err) => {");
    expect(after).toContain("extraction.mechanic_classification_override: audit_log write failed");
  });

  it("extraction.recall_applied / confluence_recovered / coverage_repair_round / concept_named all log on failure", () => {
    for (const action of [
      "extraction.recall_applied",
      "extraction.confluence_recovered",
      "extraction.coverage_repair_round",
      "extraction.concept_named",
    ]) {
      const idx = src.indexOf(`action: "${action}"`);
      expect(idx, `missing action ${action}`).toBeGreaterThan(-1);
      const after = src.slice(idx, idx + 1200);
      expect(after, `${action} should not swallow silently`).not.toContain(".catch(() => {});");
      expect(after, `${action} should log the failure`).toContain(`${action}: audit_log write failed`);
    }
  });
});

// ─── #17 — idempotency.ts expired-key DELETE failure handling ───────────────
describe("#17 — idempotency.ts expired-key DELETE no longer swallows silently", () => {
  const src = readFileSync(IDEMPOTENCY_PATH, "utf8");

  it("no longer has a bare .catch(() => {}) on the expired-key delete", () => {
    const idx = src.indexOf("db.delete(idempotencyKeys)");
    expect(idx).toBeGreaterThan(-1);
    const after = src.slice(idx, idx + 700);
    expect(after).not.toContain(".catch(() => {});");
    expect(after).toContain("deleteErr");
  });

  it("logs and counts the failure via the shared Track G2 counter", () => {
    expect(src).toContain("Idempotency: failed to delete expired key");
    expect(src).toContain('trackG2SilentFailuresTotal.labels({ site: "idempotency_expired_key_delete" })');
  });
});

describe("Shared Track G2 silent-failure counter (#14/#15/#17)", () => {
  it("is registered and zero-initialized for its 3 sites", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_track_g2_silent_failures_total");
    expect(metric).toBeDefined();
    const values = (metric as any).values as Array<{ labels: Record<string, string>; value: number }>;
    for (const site of [
      "paper_session_failed_to_stream_update",
      "mcl_pre_eia_stop_tighten_audit",
      "idempotency_expired_key_delete",
    ]) {
      expect(values.find((v) => v.labels.site === site), `missing zero-init for site=${site}`).toBeDefined();
    }
  });

  it("increments per site independently", async () => {
    const before = await getCounterValue("tf_track_g2_silent_failures_total", { site: "idempotency_expired_key_delete" });
    trackG2SilentFailuresTotal.labels({ site: "idempotency_expired_key_delete" }).inc();
    const after = await getCounterValue("tf_track_g2_silent_failures_total", { site: "idempotency_expired_key_delete" });
    expect(after).toBe(before + 1);
  });
});

// ─── #18/#22 — critic-optimizer-service.ts success audit + recovery force-fail ──
describe("#18/#22 — critic-optimizer-service.ts success audit + recovery force-fail", () => {
  const src = readFileSync(CRITIC_OPTIMIZER_PATH, "utf8");

  it("emits a critic-optimizer.run success audit on BOTH the async and sync candidates-generated paths", () => {
    const matches = src.match(/outcome: "candidates_generated"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain('path: "async"');
    expect(src).toContain('path: "sync"');
  });

  it("the success audit sits between the 'replaying' status update and the candidates_ready broadcast (both async and sync paths)", () => {
    const asyncIdx = src.indexOf('status: "replaying"');
    expect(asyncIdx).toBeGreaterThan(-1);
    const asyncWindow = src.slice(asyncIdx, asyncIdx + 2000);
    expect(asyncWindow).toContain('outcome: "candidates_generated"');
    expect(asyncWindow).toContain("critic:candidates_ready");

    const syncIdx = src.indexOf('status: "replaying"', asyncIdx + 1);
    expect(syncIdx).toBeGreaterThan(-1);
    const syncWindow = src.slice(syncIdx, syncIdx + 2000);
    expect(syncWindow).toContain('outcome: "candidates_generated"');
    expect(syncWindow).toContain("critic:candidates_ready");
  });

  it("counts + audits the stuck-candidates crash-recovery force-fail (previously logger.warn only)", () => {
    expect(src).toContain("criticOptimizerRecoveryForceFailTotal.inc()");
    expect(src).toContain("critic-optimizer.stuck_candidates_force_failed");
    // Unique anchor for the stuck-candidates recovery block specifically (distinct
    // from the earlier per-candidate immediate-replay-failure branch, which also
    // sets replayStatus: "failed" but has no stuckCandidateIds context).
    const idx = src.indexOf("stuck_candidate_ids: stuckIds");
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, idx - 900), idx);
    expect(before).toContain("criticOptimizerRecoveryForceFailTotal.inc()");
  });
});

describe("#18/#22 — tf_critic_optimizer_recovery_force_fail_total counter", () => {
  it("is registered and increments", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_critic_optimizer_recovery_force_fail_total");
    const before = await getCounterValue("tf_critic_optimizer_recovery_force_fail_total");
    criticOptimizerRecoveryForceFailTotal.inc();
    const after = await getCounterValue("tf_critic_optimizer_recovery_force_fail_total");
    expect(after).toBe(before + 1);
  });
});

// ─── #20 — candidate-backtest-conveyor-service.ts rejection audit + metric ───
describe("#20 — candidate-backtest-conveyor-service.ts per-strategy rejection now has audit + metric", () => {
  const src = readFileSync(CONVEYOR_PATH, "utf8");

  it("increments candidateConveyorRejectionsTotal and writes a rejection audit row in the allSettled rejection branch", () => {
    const idx = src.indexOf('o.status === "fulfilled"');
    expect(idx).toBeGreaterThan(-1);
    const elseBlock = src.slice(idx, idx + 1800);
    expect(elseBlock).toContain("candidateConveyorRejectionsTotal.inc()");
    expect(elseBlock).toContain("candidate_conveyor.strategy_rejected");
  });
});

describe("#20 — tf_candidate_conveyor_rejections_total counter", () => {
  it("is registered and increments", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_candidate_conveyor_rejections_total");
    const before = await getCounterValue("tf_candidate_conveyor_rejections_total");
    candidateConveyorRejectionsTotal.inc();
    const after = await getCounterValue("tf_candidate_conveyor_rejections_total");
    expect(after).toBe(before + 1);
  });
});

// ─── #21 — paper-trading-stream.ts lifecycle audit + counter ─────────────────
describe("#21 — paper-trading-stream.ts startStream/stopStream/stopAllStreams now emit audit + counter", () => {
  const src = readFileSync(PAPER_STREAM_PATH, "utf8");

  it("startStream increments the lifecycle counter and writes an audit row", () => {
    const idx = src.indexOf("export function startStream(");
    expect(idx).toBeGreaterThan(-1);
    const fnBody = src.slice(idx, idx + 1600);
    expect(fnBody).toContain('paperStreamLifecycleTotal.labels({ event: "start" })');
    expect(fnBody).toContain("paper_stream.started");
  });

  it("stopStream increments the lifecycle counter and writes an audit row", () => {
    const idx = src.indexOf("export function stopStream(");
    expect(idx).toBeGreaterThan(-1);
    const fnBody = src.slice(idx, idx + 1200);
    expect(fnBody).toContain('paperStreamLifecycleTotal.labels({ event: "stop" })');
    expect(fnBody).toContain("paper_stream.stopped");
  });

  it("stopAllStreams increments the batch-level lifecycle counter and writes an audit row", () => {
    const idx = src.indexOf("export function stopAllStreams(");
    expect(idx).toBeGreaterThan(-1);
    const fnBody = src.slice(idx, idx + 900);
    expect(fnBody).toContain('paperStreamLifecycleTotal.labels({ event: "stop_all" })');
    expect(fnBody).toContain("paper_stream.stopped_all");
  });

  it("audit inserts are fire-and-forget (non-blocking) — startStream/stopStream stay synchronous", () => {
    const startIdx = src.indexOf("export function startStream(");
    const stopIdx = src.indexOf("export function stopStream(");
    expect(src.slice(startIdx, startIdx + 40)).not.toContain("async");
    expect(src.slice(stopIdx, stopIdx + 40)).not.toContain("async");
  });
});

describe("#21 — tf_paper_stream_lifecycle_total counter", () => {
  it("is registered and zero-initialized for all 3 events", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_paper_stream_lifecycle_total");
    expect(metric).toBeDefined();
    const values = (metric as any).values as Array<{ labels: Record<string, string>; value: number }>;
    for (const event of ["start", "stop", "stop_all"]) {
      expect(values.find((v) => v.labels.event === event)).toBeDefined();
    }
  });

  it("increments per event independently", async () => {
    const before = await getCounterValue("tf_paper_stream_lifecycle_total", { event: "start" });
    paperStreamLifecycleTotal.labels({ event: "start" }).inc();
    const after = await getCounterValue("tf_paper_stream_lifecycle_total", { event: "start" });
    expect(after).toBe(before + 1);
  });
});

// ─── #25 — health-dashboard.ts DB migration version + last-backtest age ──────
describe("#25 — health-dashboard.ts reports DB migration version + last-successful-backtest age", () => {
  const src = readFileSync(HEALTH_DASHBOARD_PATH, "utf8");

  it("queries drizzle.__drizzle_migrations for the latest applied migration", () => {
    expect(src).toContain("checkDbMigrationVersion");
    expect(src).toContain("drizzle.__drizzle_migrations");
  });

  it("queries the latest completed backtest and computes its age", () => {
    expect(src).toContain("checkLastSuccessfulBacktest");
    expect(src).toContain('eq(backtests.status, "completed")');
    expect(src).toContain("ageHours");
  });

  it("wires both checks into the Promise.allSettled batch and the JSON response", () => {
    expect(src).toContain("withTimeout(checkDbMigrationVersion())");
    expect(src).toContain("withTimeout(checkLastSuccessfulBacktest())");
    expect(src).toContain("dbMigration:");
    expect(src).toContain("lastBacktest:");
  });
});
