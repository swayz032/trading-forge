/**
 * Strategy Lifecycle Service — state machine for strategy pipeline.
 *
 * Valid transitions:
 * CANDIDATE → TESTING → SHADOW → PAPER → DEPLOY_READY → DEPLOYED → DECLINING → RETIRED → GRAVEYARD
 * DECLINING → TESTING (retry)
 * TESTING → DECLINING (catastrophic failure)
 * PAPER → DECLINING (drift demotion)
 * Every state → GRAVEYARD (terminal burial)
 *
 * Canonical autonomous ladder (H1/H2/H3 fix 2026-06-29): the tier-qualified fast-track
 * (backtest-service.ts) now routes CANDIDATE → TESTING → SHADOW (it no longer jumps
 * CANDIDATE → SHADOW). Every strategy entering TESTING via the autonomous path is flagged
 * shadowModeEnabled=true and is driven TESTING → SHADOW by Gate 1.5 in checkAutoPromotions —
 * so the Wave 29 PBO < 0.15 gate (TESTING → SHADOW) and the SHADOW → PAPER divergence gate
 * BOTH fire on the default path. CANDIDATE → SHADOW remains in VALID_TRANSITIONS as a
 * legacy/manual edge but no autonomous driver uses it.
 *
 * Note: CANDIDATE → PAPER is INVALID (F-3 fix 2026-06-23). TESTING → PAPER remains a
 * VALID edge but is the LEGACY direct path, taken only by shadowModeEnabled=false strategies
 * via Gate 2; every shadowModeEnabled=true strategy reaches PAPER only through SHADOW. So on
 * the autonomous path, all routes to PAPER require SHADOW first.
 *
 * DEPLOY_READY is the "strategy library" — strategies that passed paper trading
 * and are ready for human review. Only manual approval moves them to DEPLOYED.
 * The system NEVER auto-deploys to TradingView.
 */

import { randomUUID } from "crypto";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyNames, strategyGraveyard, backtests, auditLog, lifecycleTransitions, monteCarloRuns, quantumMcRuns, paperSessions, paperTrades, complianceRulesets, pilotSessions } from "../db/schema.js";
import { computeAgreement } from "../lib/quantum-agreement.js";
import { getLatestAdversarialStressRun } from "./adversarial-stress-service.js";
import { getLatestFrankensteinRun } from "./frankenstein-service.js";
// Track A F-5 / F-6: Use leaf logger; add insertAuditRowSafe for migrated call sites.
// Remaining db.insert(auditLog) call sites in this file retain the raw pattern
// until incremental migration completes.
// TODO: correlation_id not threaded through most call sites in this file.
import { logger } from "../lib/logger.js";
import { insertAuditRow, insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { evolveStrategy } from "./evolution-service.js";
import { AlertFactory } from "./alert-service.js";
import { broadcastSSE, LIFECYCLE_GATE_EVENTS, WAVE29_EVENTS } from "../routes/sse.js";
import { compileDualPineExport } from "./pine-export-service.js";
import { agentCoordinator } from "./agent-coordinator-service.js";
import { tracer } from "../lib/tracing.js";
import { strategyPromotions, pboBlocksTotal, lifecycleShadowPromotionsTotal, autoGraveyardTotal, bifGateEvaluationsTotal, slippageSurvivalBlocksTotal, auditWriteFailuresTotal, b14GateTotal, wfeGateTotal, parameterDriftGateTotal, dslGuardsGateTotal } from "../lib/metrics-registry.js";
import { evaluateMultiFirmEligibility } from "./multi-firm-promotion-service.js";
import { killSwitch } from "../production/kill-switch.js";
import { evaluateB14CiGate, evaluateDsrWalkForwardGate } from "../lib/b14-ci-gate.js";
import { evaluateWfeGate } from "../lib/wfe-gate.js";
import { computeFirmRulesVersion } from "../lib/firm-rules-version.js"; // #23: promotion-time firm-rule drift check
import { evaluateParameterDriftGate } from "../lib/parameter-drift-gate.js";
import { evaluateCompositeShadow } from "../lib/composite-shadow-gate.js";
import { routeShadowDisagreementAlert } from "../lib/composite-shadow-discord-router.js";
import { notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { evaluatePromotionGates, getWfePromotionFloor, getCpcvMinPaths } from "../lib/promotion-gate-orchestrator.js";
// Wave 29 Pass A.2 — PBO lifecycle gate (TESTING → SHADOW/PAPER hard gate).
// PBO_OVERFIT_THRESHOLD_PCT (default 0.15) — stricter than W27.5 PBO_OVERFIT_THRESHOLD (0.5).
import { evaluatePboGate } from "../lib/pbo-gate.js";
// Wave 29 Pass A.3 — shadow-signal divergence gate (SHADOW → PAPER).
// TODO (A.4 architect): Once A.1's SHADOW lifecycle state lands and the
// shadow_signals schema is extended with direction/intended_size/killzone/
// regime/confluence_score columns, remove the TODO markers in the loader.
import { compareShadowToBacktest } from "../lib/shadow-signal-divergence-checker.js";
import { loadDivergenceInputs } from "../lib/shadow-signal-divergence-loader.js";
// Wave 29 Pass B.2 — frozen-policy drift gate (PAPER → DEPLOY_READY).
// evaluateFrozenPolicyDriftAtPromotion: hash mismatch blocks promotion; first-time freeze stamps hash.
// freezePolicyForStrategy: called on first-time freeze to stamp all 4 columns atomically.
import {
  evaluateFrozenPolicyDriftAtPromotion,
  freezePolicyForStrategy,
} from "../lib/frozen-policy-contract.js";
// Wave 3 Track 3B — BIF (Backtest Inflation Factor) promotion gate (PAPER → DEPLOY_READY).
// Reads backtests.bif / backtests.kEff stamped from Python WF result fields `bif` / `k_eff`.
// Hard-blocks when bif > BIF_BLOCK_THRESHOLD (default 4.0). Grandfather-passes on null.
import { evaluateBifGate } from "../lib/bif-gate.js";
// Wave A — Slippage-Survival promotion gate (PAPER → DEPLOY_READY).
// Reads backtests.slippageSurvival JSONB (Python fixed-signal re-price sweep).
// Default-OFF (SLIPPAGE_SURVIVAL_GATE_ENABLED=false) — advisory-only until the
// operator opts in; hard-blocks when breaks_at <= SLIPPAGE_SURVIVAL_BLOCK_MULT
// once enabled. Grandfather-passes on legacy null.
import { evaluateSlippageSurvivalGate } from "../lib/slippage-survival-gate.js";
// deep-scan #15 FIX M1: shared evidence-completeness roll-up accounting.
// isIncompleteEvidenceStatus + *EvidenceBucket keep the cron path and the
// manual/deferred path (paper-to-deploy-ready-gates.ts) in lockstep and ensure a
// "malformed" (broken-producer) gate status counts as INCOMPLETE, not "complete".
import {
  isIncompleteEvidenceStatus,
  slippageEvidenceBucket,
  bifEvidenceBucket,
} from "../lib/evidence-completeness.js";

// ─── Deep-scan #16 Wave-1 Track 5 (HIGH E-6) — hard-gate observability helpers ──
//
// B14 ci_high, WFE, and parameter-drift gates write audit_log + SSE on every
// evaluation but previously incremented NO Prometheus counter — a promotion
// pipeline could sit blocked for weeks with no Grafana panel moving. These
// three tiny helpers derive a closed-set `outcome` label from each gate's pure
// result object and increment the corresponding registry counter. Called
// immediately after every `evaluateXGate(...)` invocation in this file so the
// increment site can never silently fall out of sync with a new branch.
//
// Non-blocking by design (wrapped in try/catch): a counter-increment failure
// must never affect a promotion decision.
type LifecycleGateTransition = "TESTING_TO_PAPER" | "SHADOW_TO_PAPER" | "PAPER_TO_DEPLOY_READY";

function _incB14GateCounter(
  transition: LifecycleGateTransition,
  result: { passed: boolean; legacyFallback?: boolean },
): void {
  try {
    const outcome = !result.passed ? "block" : result.legacyFallback ? "legacy" : "pass";
    b14GateTotal.labels({ transition, outcome }).inc();
  } catch { /* non-blocking counter */ }
}

function _incWfeGateCounter(
  transition: LifecycleGateTransition,
  result: { passed: boolean; status: string },
): void {
  try {
    const isLegacy = result.status === "legacy_null" || result.status === "cpcv_exempt";
    const outcome = isLegacy ? "legacy" : result.passed ? "pass" : "block";
    wfeGateTotal.labels({ transition, outcome }).inc();
  } catch { /* non-blocking counter */ }
}

function _incParameterDriftGateCounter(
  transition: LifecycleGateTransition,
  result: { passed: boolean; status: string },
): void {
  try {
    const isLegacy = result.status === "legacy_null" || result.status === "cpcv_exempt";
    const outcome = isLegacy ? "legacy" : result.passed ? "pass" : "block";
    parameterDriftGateTotal.labels({ transition, outcome }).inc();
  } catch { /* non-blocking counter */ }
}

// ─── Deep-scan #16 Wave 2 Track G2 (E-1) — DSL guards_failed HARD promotion gate ──
//
// Wave 1 stamped result["dsl_guards"]["guards_failed"]=true (backtester.py) when the
// E.3/E.4/E.5 risk-guard block (stop-ceiling / time-stop / DLL-halt) threw mid-backtest
// and NONE of those guards ran for that run. backtest-service.ts already persists the
// whole dsl_guards object into backtests.result_extras.dsl_guards and increments
// tf_backtest_dsl_guards_failed_total (producer-side signal — see the "E-1 guards_failed
// consumer" note in backtest-service.ts), but until this track NOTHING blocked promotion
// on it — an unguarded backtest could still reach PAPER / DEPLOY_READY and, downstream,
// live capital. This pure evaluator + its 3 call sites (TESTING→PAPER, SHADOW→PAPER,
// PAPER→DEPLOY_READY) close that gap using the SAME evidence-gate pattern as
// evaluateB14CiGate / evaluateWfeGate / evaluateParameterDriftGate: a plain object in,
// a { passed, auditAction, auditPayload } out, zero DB access, fully unit-testable.
//
// Legacy contract: pre-Wave-1-Track-2 backtests never emitted dsl_guards.guards_failed
// AT ALL (the key is absent, not false) — those grandfather-pass with a documented warn,
// mirroring lifecycle.wfe_unavailable_legacy / lifecycle.dsr_unavailable_legacy. Once a
// backtest genuinely emits guards_failed=false, the gate reports a clean "pass" (no
// audit-worthy event; the caller may still choose to write a routine success row).
interface DslGuardsGateInput {
  guards_failed?: boolean | null;
  guards_failed_reason?: string | null;
}

interface DslGuardsGateResult {
  /** True when the gate allows promotion; false when it blocks. */
  passed: boolean;
  /** Terminal state string, mirrors the other lifecycle gate helpers' `status`. */
  status: "pass" | "blocked" | "legacy_proceed";
  /** Canonical audit action name; null on a clean (non-legacy) pass. */
  auditAction: "lifecycle.dsl_guards_failed_block" | "lifecycle.dsl_guards_unavailable_legacy" | null;
  /** Human-readable reason string (mirrors the audit action). */
  reason: string;
  /** Full audit payload — merge into the audit_log result field. */
  auditPayload: {
    guards_failed: boolean | null;
    guards_failed_reason: string | null;
    status: string;
    blocked: boolean;
  };
}

function evaluateDslGuardsGate(
  dslGuards: DslGuardsGateInput | null | undefined,
): DslGuardsGateResult {
  // Legacy: the field is ABSENT (undefined), not merely falsy. A real backtest that
  // ran the guards cleanly always stamps guards_failed=false explicitly (see
  // _dsl_guards_meta default in backtester.py) — only a pre-Track-2 backtest, or a
  // resultExtras blob missing the dsl_guards key entirely, hits this branch.
  if (dslGuards == null || typeof dslGuards !== "object" || dslGuards.guards_failed === undefined) {
    return {
      passed: true,
      status: "legacy_proceed",
      auditAction: "lifecycle.dsl_guards_unavailable_legacy",
      reason: "lifecycle.dsl_guards_unavailable_legacy",
      auditPayload: {
        guards_failed: null,
        guards_failed_reason: null,
        status: "legacy_proceed",
        blocked: false,
      },
    };
  }

  if (dslGuards.guards_failed === true) {
    return {
      passed: false,
      status: "blocked",
      auditAction: "lifecycle.dsl_guards_failed_block",
      reason: "lifecycle.dsl_guards_failed_block",
      auditPayload: {
        guards_failed: true,
        guards_failed_reason: dslGuards.guards_failed_reason ?? null,
        status: "blocked",
        blocked: true,
      },
    };
  }

  return {
    passed: true,
    status: "pass",
    auditAction: null,
    reason: "lifecycle.dsl_guards_pass",
    auditPayload: {
      guards_failed: false,
      guards_failed_reason: null,
      status: "pass",
      blocked: false,
    },
  };
}

function _incDslGuardsGateCounter(
  transition: LifecycleGateTransition,
  result: { passed: boolean; status: string },
): void {
  try {
    const outcome = result.status === "legacy_proceed" ? "legacy" : result.passed ? "pass" : "block";
    dslGuardsGateTotal.labels({ transition, outcome }).inc();
  } catch { /* non-blocking counter */ }
}

const VALID_STATES = [
  "CANDIDATE",
  // (deepscan7 architect-M2 2026-07-02) NEEDS_REVISION / NEEDS_ARCHETYPE were written by
  // raw SQL (direct-bucket-graduator.ts / strategy-stale-detector.ts) but absent from the
  // state machine — write-only dead-ends with no lifecycle_transitions rows and no exit
  // path. Registered here (additive, NO gate logic) so promoteStrategy can route them
  // back to CANDIDATE (rework loop) or GRAVEYARD (abandon).
  "NEEDS_REVISION",
  "NEEDS_ARCHETYPE",
  "TESTING",
  // Wave 29 Pass A.1: SHADOW stage sits between TESTING and PAPER.
  // Signals fire Pine alerts (TradingView) but TradersPost webhook is OFF.
  // Logged to lifecycle_shadow_signals for divergence analysis (A.3).
  // Promotes to PAPER after ≥20 shadow signals with <5% divergence (A.3 gate).
  "SHADOW",
  "PAPER",
  "DEPLOY_READY",
  "PILOT",
  "DEPLOYED",
  "DECLINING",
  "RETIRED",
  "GRAVEYARD",
] as const;

type LifecycleState = (typeof VALID_STATES)[number];

interface PromoteStrategyOptions {
  actor?: "system" | "human_release" | "operator_absent_mode";
  reason?: string;
  /** Parent strategy ID for evolution-driven promotions (e.g., gen+1 child created by evolution-service). */
  parentStrategyId?: string;
  /** HTTP request correlation ID (req.id) or scheduler-generated UUID for end-to-end tracing. */
  correlationId?: string;
  /**
   * Double-evaluation guard (2026-06-29, fix #4): when the checkAutoPromotions cron
   * drives PAPER → DEPLOY_READY it has ALREADY run the full inline gate stack (including
   * the on-demand B14 survival-twin replay — a Python subprocess — and every hard gate).
   * Setting this true skips the PAPER → DEPLOY_READY evaluator block inside
   * _promoteStrategyInner so the survival-twin subprocess does NOT fire a SECOND time and
   * the per-gate audit rows are not duplicated per tick. Manual PATCH /:id/lifecycle does
   * NOT set this — that path relies on the evaluator as its sole gate stack.
   * TODO(consolidation): the cleaner end-state is to replace the cron's ~1400-line inline
   * PAPER → DEPLOY_READY block with a single evaluatePaperToDeployReadyGates() call (keeping
   * the cron-only side effects — _maybeAutoGraveyard, _resetHardGateCounter, gateEvidenceStatuses,
   * composite-shadow Discord — as a thin wrapper around the evaluator result). Deferred here
   * as too invasive to do without behavior-change risk; this guard removes the duplicate work.
   */
  skipPaperToDeployReadyEvaluator?: boolean;
}

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  // F-3 Fix 2026-06-23: CANDIDATE→PAPER is REMOVED. No strategy may reach PAPER
  // (real TradersPost creds, paper capital) without SHADOW skew measurement first.
  // The backtest fast-track (backtest-service.ts) now promotes CANDIDATE→SHADOW after its
  // 4 entry-quality gates (survival score, compliance drift, exportability, MC ruin).
  // SHADOW→PAPER is still gated by the A.3 divergence check (≥20 signals, <5% divergence).
  // TESTING is still skippable (tier-qualified fast-track; SHADOW is the mandatory skew layer).
  // A manual PATCH /:id/lifecycle {from:CANDIDATE,to:PAPER} is now correctly REJECTED as
  // an invalid transition — fail-closed by design (gate to real money).
  // (deepscan7 architect-M2 2026-07-02) NEEDS_REVISION / NEEDS_ARCHETYPE added as valid
  // rework detours (graduator/stale-detector write them via raw SQL). No gate logic on
  // these edges by design — they are research-side rework states, not capital paths.
  CANDIDATE: ["TESTING", "SHADOW", "NEEDS_REVISION", "NEEDS_ARCHETYPE", "GRAVEYARD"],  // SHADOW is the fast-track for tier-qualified strategies (backtest-service.ts F-3)
  // Wave 29 Pass A.1: TESTING can go to SHADOW (new path) OR directly to PAPER (legacy path preserved).
  // Both routes are valid depending on whether shadow_mode_enabled=true on the strategy.
  TESTING: ["SHADOW", "PAPER", "DECLINING", "NEEDS_REVISION", "GRAVEYARD"],
  // (deepscan7 architect-M2 2026-07-02) rework states loop back to CANDIDATE only (or GRAVEYARD).
  // NEEDS_REVISION → PAPER (or any capital-ward state) stays INVALID — must re-enter the ladder.
  NEEDS_REVISION: ["CANDIDATE", "GRAVEYARD"],
  NEEDS_ARCHETYPE: ["CANDIDATE", "GRAVEYARD"],
  // Wave 29 Pass A.1: SHADOW → PAPER after A.3 divergence gate clears (≥20 signals, <5% divergence).
  // SHADOW → DEPLOY_READY direct is INVALID — must go through PAPER first (full paper history required).
  SHADOW: ["PAPER", "DECLINING", "GRAVEYARD"],
  // (deepscan18 D-D2 2026-07-05) NEEDS_REVISION added as a valid target from PAPER and
  // DEPLOY_READY. The stale-detector cron (strategy-stale-detector.ts demoteToNeedsRevision)
  // demotes stale PAPER / DEPLOY_READY strategies to NEEDS_REVISION via raw SQL and writes a
  // TYPED lifecycle_transitions ledger row for that edge. VALID_TRANSITIONS previously omitted
  // these two edges, so the ledger accumulated rows for transitions the contract declared
  // impossible — a contract/ledger inconsistency that any transition-validity audit would flag.
  // NEEDS_REVISION is a research-side rework detour (loops back to CANDIDATE only, or GRAVEYARD);
  // it is NOT a capital-ward state, so no gate logic rides these demotion edges by design.
  // PILOT / DEPLOYED are intentionally NOT given this edge — they are DEMOTION_EXEMPT_STATES
  // (real capital) and the stale-detector CAS explicitly excludes them (NOT IN DEPLOYED/PILOT).
  PAPER: ["DEPLOY_READY", "DECLINING", "NEEDS_REVISION", "GRAVEYARD"],  // Demotable on drift; NEEDS_REVISION = stale-detector rework detour
  DEPLOY_READY: ["PILOT", "DEPLOYED", "PAPER", "NEEDS_REVISION", "GRAVEYARD"],  // Human approves PILOT canary OR legacy direct deploy OR back to paper; NEEDS_REVISION = stale-detector rework detour
  // B8: PILOT canary state — 5 sessions, 1 contract.
  // PILOT → DEPLOYED: automatic after 5 sessions (rolling Sharpe > 1.0, no compliance violations).
  // PILOT → GRAVEYARD: automatic if any kill switch fires.
  // PILOT is entered via human approval (actor="human_release") from DEPLOY_READY.
  PILOT: ["DEPLOYED", "GRAVEYARD"],
  DEPLOYED: ["DECLINING", "GRAVEYARD"],
  DECLINING: ["TESTING", "RETIRED", "GRAVEYARD"],
  RETIRED: ["GRAVEYARD"],
  GRAVEYARD: [],  // Terminal state
};

/**
 * P0-1 compliance-drift gate helper.
 *
 * propCompliance JSONB uses per-firm keys like "topstep_50k" / "mffu_50k", but
 * compliance_rulesets.firm uses display names ("Topstep" / "MFFU"). When we
 * gate a promotion on rule freshness we have to translate the propCompliance
 * keys into the firm names that match what the compliance refresh service
 * writes into compliance_rulesets.firm (see compliance-refresh-service.ts:20
 * for the canonical FIRMS list).
 */
// Only Topstep (PRIMARY) + MFFU (secondary) per CLAUDE.md §6.
const FIRM_KEY_TO_FIRM_NAME: Record<string, string> = {
  topstep_50k: "Topstep",
  mffu_50k: "MFFU",
};

/**
 * Resolve the set of distinct firm-name strings (matching compliance_rulesets.firm)
 * for the firms a strategy currently passes prop compliance against. Returns an
 * empty array when no firms pass — caller MUST treat that as "no drift gate
 * applies" rather than "drift detected".
 */
export function passingFirmNamesFromCompliance(
  propCompliance: unknown,
): string[] {
  if (!propCompliance || typeof propCompliance !== "object") return [];
  const propResults = propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
  const names = new Set<string>();
  for (const [firmKey, result] of Object.entries(propResults)) {
    const passing = result?.passed === true || result?.pass === true;
    if (!passing) continue;
    const firmName = FIRM_KEY_TO_FIRM_NAME[firmKey];
    // Fallback: if a firm key doesn't have a mapping (new firm not yet in
    // FIRM_KEY_TO_FIRM_NAME), use the prefix as the firm name. Better to
    // miss than to fail open — we still try a lookup against the raw prefix.
    if (firmName) {
      names.add(firmName);
    } else {
      const prefix = firmKey.split("_")[0];
      if (prefix) names.add(prefix);
    }
  }
  return [...names];
}

/**
 * Returns the list of firms (from `firmNames`) whose latest compliance ruleset
 * has driftDetected=true. Empty array means no drift; callers must treat
 * non-empty as a hard block on the promotion.
 *
 * Reads the LATEST ruleset row per firm (sorted by createdAt DESC) so a stale
 * older row from before the most recent verify cycle does not falsely block.
 */
export async function findFirmsWithComplianceDrift(firmNames: string[]): Promise<string[]> {
  if (firmNames.length === 0) return [];

  // Latest ruleset row per firm. We can't easily DISTINCT ON in drizzle
  // without raw SQL, so do a simple per-firm scan. Firms list is bounded
  // to <=8 in practice (FIRMS in compliance-refresh-service.ts).
  const driftFirms: string[] = [];
  for (const firm of firmNames) {
    const [latest] = await db
      .select({
        firm: complianceRulesets.firm,
        driftDetected: complianceRulesets.driftDetected,
        status: complianceRulesets.status,
      })
      .from(complianceRulesets)
      .where(eq(complianceRulesets.firm, firm))
      .orderBy(desc(complianceRulesets.createdAt))
      .limit(1);
    if (!latest) continue; // No ruleset row at all -> not "drift"; covered by other guards
    if (latest.driftDetected === true || latest.status === "drift_detected") {
      driftFirms.push(firm);
    }
  }
  return driftFirms;
}

/**
 * (deepscan7 F-1 2026-07-02) Shared PAPER→DEPLOY_READY compliance-drift resolver.
 * Extracted from the checkAutoPromotions inline block so the manual PATCH path
 * (_promoteStrategyInner) runs the IDENTICAL drift determination — previously the
 * manual path had no compliance-drift gate at all. Throws on infra error so each
 * call site can apply the cron's fail-CLOSED handling (block + drift_check_infra_error).
 */
export async function resolveComplianceDriftForPromotion(
  propCompliance: unknown,
): Promise<{ driftFirms: string[]; qualifyingFirms: string[] }> {
  const qualifyingFirms = passingFirmNamesFromCompliance(propCompliance);
  if (qualifyingFirms.length === 0) return { driftFirms: [], qualifyingFirms };
  const driftFirms = await findFirmsWithComplianceDrift(qualifyingFirms);
  return { driftFirms, qualifyingFirms };
}

/**
 * P0-2 part 2: Promotion-time compliance gate (mirrors the per-bar gate in
 * paper-execution-service.ts:637-865 but applied at lifecycle promotion time).
 *
 * For each firm in `firmNames`, runs `compliance_gate.check_freshness` against
 * the latest ruleset row. Returns the list of firms that fail the freshness
 * check (which is what blocks promotion). Does NOT run `check_violation`
 * (that requires runtime strategy_state which lifecycle promotion does not
 * have); the violation check still runs at order-execution time on every bar.
 *
 * Fail-closed: if the Python subprocess errors out, the firm is treated as
 * failing the gate. Promotion-time is rare (every 6h scheduler tick) so
 * subprocess failures are not a hot path; failing closed here is safer than
 * letting a strategy onto the live track behind a broken compliance check.
 *
 * Returns: { firmsFailing, errors } — `firmsFailing` is the list of firm
 * names whose compliance check did NOT pass (or threw); `errors` carries the
 * underlying messages keyed by firm so audit rows can capture the cause.
 */
export async function runComplianceGateForFirms(
  firmNames: string[],
): Promise<{ firmsFailing: string[]; details: Record<string, { fresh: boolean; status: string; message: string }> }> {
  if (firmNames.length === 0) return { firmsFailing: [], details: {} };

  const { runPythonModule } = await import("../lib/python-runner.js");

  const firmsFailing: string[] = [];
  const details: Record<string, { fresh: boolean; status: string; message: string }> = {};

  for (const firm of firmNames) {
    try {
      // Fetch the latest ruleset row for this firm so the Python module can
      // evaluate against actual rule data (matches paper-execution-service
      // pattern at line 668-693).
      const [rs] = await db
        .select({
          firm: complianceRulesets.firm,
          parsedRules: complianceRulesets.parsedRules,
          retrievedAt: complianceRulesets.retrievedAt,
          driftDetected: complianceRulesets.driftDetected,
          contentHash: complianceRulesets.contentHash,
          status: complianceRulesets.status,
        })
        .from(complianceRulesets)
        .where(eq(complianceRulesets.firm, firm))
        .orderBy(desc(complianceRulesets.retrievedAt))
        .limit(1);

      if (!rs) {
        // No ruleset for this firm — fail closed at promotion time. The
        // compliance refresh service should always have populated rulesets
        // for the canonical firms list before any strategy can pass prop
        // compliance against them.
        firmsFailing.push(firm);
        details[firm] = {
          fresh: false,
          status: "no_ruleset",
          message: `No compliance ruleset row for firm '${firm}' — compliance gate cannot be evaluated.`,
        };
        continue;
      }

      const rulesetPayload: Record<string, unknown> = {
        firm: rs.firm,
        retrieved_at: rs.retrievedAt instanceof Date
          ? rs.retrievedAt.toISOString()
          : new Date(rs.retrievedAt as unknown as string).toISOString(),
        drift_detected: !!rs.driftDetected,
        status: rs.status,
        parsed_rules: rs.parsedRules ?? {},
        content_hash: rs.contentHash ?? null,
      };

      const result = await runPythonModule<{
        fresh: boolean;
        status: string;
        message: string;
        drift_detected?: boolean;
      }>({
        module: "src.engine.compliance.compliance_gate",
        config: {
          action: "check_freshness",
          firm,
          ruleset: rulesetPayload,
          context: "active_trading",
        },
        timeoutMs: 5_000,
        componentName: "compliance-gate-promotion",
      });

      details[firm] = {
        fresh: !!result.fresh,
        status: result.status,
        message: result.message,
      };

      if (!result.fresh) {
        firmsFailing.push(firm);
      }
    } catch (err) {
      // Fail-closed on subprocess error — promotion-time is not a hot path,
      // and a broken Python check is safer treated as a failed gate than as
      // an open one (a strategy promoted on a broken gate enters the live
      // track without verified compliance).
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ firm, err }, "runComplianceGateForFirms: Python subprocess threw — treating firm as failing the gate");
      firmsFailing.push(firm);
      details[firm] = {
        fresh: false,
        status: "subprocess_error",
        message: `compliance_gate.check_freshness threw: ${msg}`,
      };
    }
  }

  return { firmsFailing, details };
}

export class LifecycleService {
  /**
   * Promote or demote a strategy to a new lifecycle state.
   * Validates the transition is allowed, logs to audit_log.
   *
   * Wave B5 atomicity contract:
   *   - When no caller-tx is provided, ALL writes (strategy update, strategyNames
   *     update on RETIRED, strategy.lifecycle audit row, and the
   *     strategy.graveyard_burial_pending audit row for DECLINING/RETIRED)
   *     execute inside a single db.transaction(). On any failure, the entire
   *     unit rolls back and the caller sees a thrown error / no partial state.
   *   - When a caller passes its own tx (e.g., backtest-service paper session),
   *     this method runs all writes through the caller's tx so atomicity is
   *     scoped to the caller's outer transaction.
   *   - SSE broadcasts and the fire-and-forget buryInGraveyard() call run
   *     ONLY after the transaction commits successfully. They never run inside
   *     the transaction or on a rolled-back path.
   */
  async promoteStrategy(
    id: string,
    fromState: LifecycleState,
    toState: LifecycleState,
    options: PromoteStrategyOptions = {},
    tx?: typeof db,
  ): Promise<{ success: boolean; error?: string; retry_after_seconds?: number }> {
    const span = tracer.startSpan("lifecycle.promote");
    span.setAttribute("strategy.id", id);
    span.setAttribute("lifecycle.from", fromState);
    span.setAttribute("lifecycle.to", toState);
    span.setAttribute("actor", options.actor ?? "system");
    span.setAttribute("correlationId", options.correlationId ?? "");

    try {
      return await this._promoteStrategyInner(id, fromState, toState, options, tx);
    } catch (err) {
      span.setAttribute("error", true);
      span.setAttribute("error.message", err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      span.end();
    }
  }

  private async _promoteStrategyInner(
    id: string,
    fromState: LifecycleState,
    toState: LifecycleState,
    options: PromoteStrategyOptions,
    tx?: typeof db,
  ): Promise<{ success: boolean; error?: string; retry_after_seconds?: number }> {
    if (fromState === "DEPLOY_READY" && toState === "DEPLOYED" && options.actor !== "human_release") {
      const error = "Only manual release authority can promote DEPLOY_READY -> DEPLOYED";
      logger.warn({ id, fromState, toState, actor: options.actor ?? "system" }, error);
      return { success: false, error };
    }

    // B8: DEPLOY_READY → PILOT requires human approval (same authority as DEPLOYED).
    // This prevents system-auto promotion into the canary track — a human must decide
    // to enter the canary window for each strategy.
    // Deep-scan 2026-06-28 (C-1): the operator-absent (vacation) autopilot is the
    // ONE authorized exception — actor="operator_absent_mode" promotes Tier-1
    // strategies (rolling Sharpe >= floor AND all autopilot gates passed, enforced
    // in operator-absent-mode-service.ts) while the operator is away. Plain
    // actor="system" is still blocked. Previously this gate blocked even the
    // vacation autopilot, making the documented §3 feature dead code.
    if (
      fromState === "DEPLOY_READY" &&
      toState === "PILOT" &&
      options.actor !== "human_release" &&
      options.actor !== "operator_absent_mode"
    ) {
      const error = "Only manual release authority can promote DEPLOY_READY -> PILOT (canary track requires human approval)";
      logger.warn({ id, fromState, toState, actor: options.actor ?? "system" }, error);
      return { success: false, error };
    }

    // B8: PILOT → DEPLOYED requires either human_release OR system auto-promotion
    // (system actor = automatic after 5 sessions pass). PILOT → GRAVEYARD is always
    // allowed (kill switch path — no actor restriction).
    // No additional guard needed here; the VALID_TRANSITIONS map allows both.

    // Validate transition
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed || !allowed.includes(toState)) {
      const error = `Invalid transition: ${fromState} → ${toState}. Allowed: ${allowed?.join(", ") || "none"}`;
      logger.warn({ id, fromState, toState }, error);
      return { success: false, error };
    }

    // Pre-tx read: verify current state matches before opening a transaction.
    // This avoids burning a tx slot on stale/missing strategies and lets us
    // return early on guard failures without touching the transaction at all.
    const readCtx = tx ?? db;
    const [strategy] = await readCtx
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!strategy) {
      return { success: false, error: "Strategy not found" };
    }

    if (strategy.lifecycleState !== fromState) {
      return {
        success: false,
        error: `Strategy is in state '${strategy.lifecycleState}', not '${fromState}'`,
      };
    }

    // Pass 5 Track C: PAPER → DEPLOY_READY evaluator in _promoteStrategyInner
    // Fix #4 (2026-06-29): the checkAutoPromotions cron sets skipPaperToDeployReadyEvaluator=true
    // because it already ran the full inline gate stack (incl. on-demand survival-twin replay).
    // Skipping here prevents the survival-twin Python subprocess from firing a SECOND time and
    // avoids duplicate per-gate audit rows per tick. The manual PATCH path leaves the flag unset
    // so the evaluator remains its authoritative gate stack.
    if (fromState === "PAPER" && toState === "DEPLOY_READY" && !options.skipPaperToDeployReadyEvaluator) {
      try {
        const { evaluatePaperToDeployReadyGates } = await import("../lib/paper-to-deploy-ready-gates.js");
        // Load gate inputs
        const correlationId = options.correlationId ?? randomUUID();
        const [latestBtP2D] = await db.select({
          id: backtests.id, walkForwardResults: backtests.walkForwardResults,
          gateResult: backtests.gateResult, b15Battery: backtests.b15Battery,
          wrcResult: backtests.wrcResult, spaResult: backtests.spaResult,
          // H1 fix 2026-06-28: fetch bif + kEff so the BIF gate in evaluatePaperToDeployReadyGates
          // runs on the manual PATCH /:id/lifecycle path (previously only ran in the cron sweep).
          bif: backtests.bif, kEff: backtests.kEff,
          // (deepscan7 F-1 2026-07-02) propCompliance feeds the compliance-drift hard block below.
          propCompliance: backtests.propCompliance,
          // Wave A (2026-07-03) — Slippage-Survival gate input; manual-path parity with the
          // cron sweep block below.
          slippageSurvival: backtests.slippageSurvival,
          // A-1 (deepscan17 2026-07-05) — result_extras.dsl_guards feeds the DSL guards HARD
          // gate below (manual-path parity with the cron sweep, which reads the same field).
          resultExtras: backtests.resultExtras,
        }).from(backtests).where(and(eq(backtests.strategyId, id), eq(backtests.status, "completed"))).orderBy(desc(backtests.createdAt)).limit(1);

        // ── (deepscan7 F-1 2026-07-02) Compliance-drift HARD block — cron-path parity ──
        // The autonomous cron blocks PAPER→DEPLOY_READY when any firm the strategy
        // passes compliance against has a drift-detected ruleset; the manual PATCH
        // path previously had ZERO drift references, so a human could promote a
        // strategy against stale firm rules. Same shared resolver, same audit action
        // + block reason, and the cron's fail-CLOSED behavior on infra error
        // (lifecycle.drift_check_infra_error + block, manual override required).
        // Runs BEFORE the evaluator so a drift block never spends an on-demand
        // survival-twin Python replay.
        if (latestBtP2D?.propCompliance) {
          let driftFirms: string[];
          let qualifyingFirms: string[];
          try {
            ({ driftFirms, qualifyingFirms } = await resolveComplianceDriftForPromotion(latestBtP2D.propCompliance));
          } catch (driftCheckErr) {
            const errMsg = driftCheckErr instanceof Error ? driftCheckErr.message : String(driftCheckErr);
            logger.warn(
              { strategyId: id, err: driftCheckErr },
              "PAPER → DEPLOY_READY drift-check threw (manual path) — blocking promotion (fail-closed, manual override required)",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.drift_check_infra_error",
              entityId: id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState, toState },
              result: {
                reason: "drift_check_infrastructure_error",
                error: errMsg,
                note: "Manual operator override required — cannot verify compliance ruleset integrity",
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: id, err: auditErr }, "lifecycle.drift_check_infra_error audit insert failed (non-blocking)");
            });
            return { success: false, error: `drift_check_infrastructure_error: ${errMsg}` };
          }
          if (driftFirms.length > 0) {
            logger.warn(
              { strategyId: id, driftFirms, transition: "PAPER→DEPLOY_READY" },
              "PAPER → DEPLOY_READY blocked (manual path): compliance ruleset drift detected",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.promotion_blocked_compliance_drift",
              entityId: id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState, toState },
              result: {
                firms_with_drift: driftFirms,
                qualifying_firms: qualifyingFirms,
                reason: "compliance ruleset drift_detected — promotion held until human revalidation",
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: id, err: auditErr }, "compliance-drift audit insert failed (non-blocking)");
            });
            broadcastSSE(LIFECYCLE_GATE_EVENTS.COMPLIANCE_DRIFT_BLOCKED, {
              strategyId: id,
              drift_firms: driftFirms,
              correlationId: correlationId,
            });
            return { success: false, error: "compliance ruleset drift_detected — promotion held until human revalidation" };
          }
        }

        // ── A-1 (deepscan17 2026-07-05) — DSL guards_failed HARD gate: PAPER → DEPLOY_READY (manual) ──
        // Cron parity: checkAutoPromotions gates PAPER→DEPLOY_READY on
        // result_extras.dsl_guards.guards_failed=true (unguarded backtest — E.3/E.4/E.5 risk
        // guards threw mid-run, so stop-ceiling / time-stop / DLL enforcement never ran). The
        // manual PATCH path delegates PAPER→DEPLOY_READY to evaluatePaperToDeployReadyGates
        // (B14/WFE/drift/BIF), which has ZERO dsl_guards references — so a correctly-signed
        // manual/n8n/Carter promotion of a guards_failed strategy reached DEPLOY_READY and,
        // downstream, live capital. Enforced inline here (same dual-call-site pattern the
        // slippage-survival + BIF gates use) BEFORE the on-demand survival-twin Python replay,
        // so an unguarded backtest never spends a subprocess. evaluateDslGuardsGate is total
        // (never throws) and is the SAME pure evaluator the 3 cron sites call; any resultExtras
        // shape error is caught by the outer PAPER→DEPLOY_READY fail-CLOSED handler.
        {
          const dslGuardsInputP2D = ((latestBtP2D?.resultExtras as Record<string, unknown> | null)?.dsl_guards ?? null) as
            | DslGuardsGateInput
            | null;
          const dslGuardsResultP2D = evaluateDslGuardsGate(dslGuardsInputP2D);
          _incDslGuardsGateCounter("PAPER_TO_DEPLOY_READY", dslGuardsResultP2D);

          broadcastSSE(LIFECYCLE_GATE_EVENTS.DSL_GUARDS_EVALUATED, {
            strategyId: id,
            ...dslGuardsResultP2D.auditPayload,
            correlationId, // deep-scan Obs re-verify #3 F-6: DSL-guards HARD gate SSE carries correlationId
            passed: dslGuardsResultP2D.passed,
            reason: dslGuardsResultP2D.reason,
          });

          await db.insert(auditLog).values({
            action: dslGuardsResultP2D.auditAction ?? "lifecycle.dsl_guards_pass",
            entityId: id,
            entityType: "strategy",
            status: !dslGuardsResultP2D.passed ? "failure" : dslGuardsResultP2D.status === "legacy_proceed" ? "warning" : "success",
            decisionAuthority: "gate",
            input: { fromState, toState },
            result: dslGuardsResultP2D.auditPayload,
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: id, err: auditErr }, "DSL guards gate (PAPER→DEPLOY_READY manual path) audit insert failed (non-blocking)");
          });

          if (!dslGuardsResultP2D.passed) {
            logger.warn(
              { strategyId: id, guardsFailedReason: dslGuardsResultP2D.auditPayload.guards_failed_reason, transition: "PAPER→DEPLOY_READY" },
              "DSL guards gate BLOCKED PAPER→DEPLOY_READY (manual path): guards_failed=true (E.3/E.4/E.5 risk guards did not run — unguarded backtest)",
            );
            strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
            return { success: false, error: "lifecycle.dsl_guards_failed_block" };
          }
          this._resetHardGateCounter(id, "dsl_guards_failed", correlationId);
        }

        // ── A7 (deepscan17-wave2 2026-07-05) — Signal Correlation HARD gate: PAPER → DEPLOY_READY (manual) ──
        // Cron parity: checkAutoPromotions gates PAPER→DEPLOY_READY on checkSignalCorrelationGate
        // (cosine similarity > 0.85 vs ANY DEPLOYED strategy — also blocks when no signal vector
        // exists). The manual PATCH path delegated PAPER→DEPLOY_READY to evaluatePaperToDeployReadyGates,
        // which has ZERO A7 references — so a correctly-signed manual/n8n/Carter promotion of a
        // signal-duplicate strategy reached DEPLOY_READY and, downstream, live capital (same class as
        // the A-1 DSL-guards manual-path gap just closed). Enforced inline here (dual-call-site pattern)
        // BEFORE the on-demand survival-twin Python replay so a duplicate never spends a subprocess.
        // Ramp-up/legacy behavior lives inside checkSignalCorrelationGate (the SAME helper the cron
        // calls). Fail-CLOSED on infra error. Manual-path convention: NO _maybeAutoGraveyard.
        try {
          const { checkSignalCorrelationGate } = await import("./signal-correlation-service.js");
          const sigCorrelationResultP2D = await checkSignalCorrelationGate(id);

          if (!sigCorrelationResultP2D.allowed) {
            logger.warn(
              {
                strategyId: id,
                reason: sigCorrelationResultP2D.reason,
                maxSimilarity: sigCorrelationResultP2D.maxSimilarity,
                blockingStrategyId: sigCorrelationResultP2D.blockingStrategyId,
                transition: "PAPER→DEPLOY_READY",
              },
              "A7 signal correlation gate: BLOCKED PAPER→DEPLOY_READY promotion (manual path)",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.promotion_blocked_signal_correlation",
              entityId: id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState, toState },
              result: {
                reason: sigCorrelationResultP2D.reason,
                max_similarity: sigCorrelationResultP2D.maxSimilarity,
                blocking_strategy_id: sigCorrelationResultP2D.blockingStrategyId,
                threshold: 0.85,
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: id, err: auditErr }, "A7 audit insert (manual path) failed (non-blocking)");
            });
            strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
            return { success: false, error: "lifecycle.promotion_blocked_signal_correlation" };
          }

          logger.info(
            {
              strategyId: id,
              reason: sigCorrelationResultP2D.reason,
              maxSimilarity: sigCorrelationResultP2D.maxSimilarity,
              transition: "PAPER→DEPLOY_READY",
            },
            "A7 signal correlation gate: PASSED (manual path)",
          );
          this._resetHardGateCounter(id, "signal_correlation", correlationId);
        } catch (sigCorrelationErr) {
          // Fail-closed on infra error — same policy as the cron A7 site + the manual DSL-guards gate.
          const msg = sigCorrelationErr instanceof Error ? sigCorrelationErr.message : String(sigCorrelationErr);
          logger.warn(
            { strategyId: id, err: sigCorrelationErr },
            "A7 signal correlation gate: infrastructure error — blocking promotion (fail-closed, manual path)",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.promotion_blocked_signal_correlation",
            entityId: id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState, toState },
            result: {
              reason: `A7 gate infrastructure error (fail-closed): ${msg}`,
              max_similarity: null,
              blocking_strategy_id: null,
              threshold: 0.85,
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ err: auditErr, correlationId }, "A7 gate fail-closed audit insert (manual path) failed (non-blocking)");
            auditWriteFailuresTotal.labels({ action: "lifecycle.a7_gate_error" }).inc();
          });
          strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
          return { success: false, error: "lifecycle.promotion_blocked_signal_correlation" };
        }

        const [latestMcP2D] = latestBtP2D ? await db.select({
          probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
          riskMetrics: monteCarloRuns.riskMetrics,
        }).from(monteCarloRuns).where(and(eq(monteCarloRuns.backtestId, latestBtP2D.id), eq(monteCarloRuns.status, "completed"))).orderBy(desc(monteCarloRuns.createdAt)).limit(1) : [undefined];

        const [frozenShadowRow] = await db.select({
          id: strategies.id, config: strategies.config, frozenPolicyHash: strategies.frozenPolicyHash,
        }).from(strategies).where(eq(strategies.id, id));

        // Map DB rows to the flat PaperToDeployReadyGateInput required by the evaluator.
        // The evaluator is a pure function — caller is responsible for all DB access and mapping.
        const wfResults = latestBtP2D?.walkForwardResults as Record<string, unknown> | null | undefined;
        const gateResultBlob = latestBtP2D?.gateResult as Record<string, unknown> | null | undefined;
        const survivalTwin = gateResultBlob?.survival_twin as { passed?: boolean } | null | undefined;

        // Honest B14 Survival Twin: survival_twin is only ever written by the manual
        // replay tool, so for every normal strategy it is ABSENT and Gate 1 used to
        // silently auto-pass. Evaluate it ON DEMAND via the replay harness so the gate
        // actually runs. Fail-soft: a slow/broken replay degrades to
        // advisory_not_evaluated (the B14 ci_high ruin gate remains the hard ruin
        // guard) — never a new freeze surface, never a false block.
        let survivalTwinOnDemand:
          import("../lib/paper-to-deploy-ready-gates.js").OnDemandSurvivalReplayResult | null = null;
        if (!survivalTwin && latestBtP2D?.id) {
          const { resolveSurvivalTwinOnDemand } = await import("../lib/paper-to-deploy-ready-gates.js");
          survivalTwinOnDemand = await resolveSurvivalTwinOnDemand({
            strategyId: id,
            backtestId: latestBtP2D.id,
          });
        }

        const mcRm = (latestMcP2D?.riskMetrics as Record<string, unknown> | null) ?? {};
        const ruinCi = (mcRm.probability_of_ruin_ci ?? null) as Record<string, unknown> | null;
        const wrcResult = latestBtP2D?.wrcResult as Record<string, unknown> | null | undefined;
        const spaResult = latestBtP2D?.spaResult as Record<string, unknown> | null | undefined;

        // Build the flat evaluator input from the pre-fetched DB rows.
        // Each cast is safe: the evaluator accepts `Record<string,unknown> | null` at its
        // inner union leaf (RuinCiDict, WalkForwardDsrInput etc.) — we pass the same JSON
        // blobs the cron sweep passes, just extracted one level earlier.
        const pdrInput: import("../lib/paper-to-deploy-ready-gates.js").PaperToDeployReadyGateInput = {
          strategyId: id,
          correlationId,
          // Hardening 2026-06-27 (phantom-gate fix): pass b15HardGateEnabled explicitly so the
          // operator's B15_BATTERY_ENABLED=false escape hatch is honored on the direct-promotion
          // path (_promoteStrategyInner). Previously omitted → pure evaluator defaulted to true,
          // silently ignoring the env flag when this path was used instead of the cron sweep.
          b15HardGateEnabled: (process.env.B15_BATTERY_ENABLED ?? "true") === "true",
          b14SurvivalTwin: { survival_twin: (survivalTwin ?? null) as import("../lib/paper-to-deploy-ready-gates.js").B14SurvivalTwinInput["survival_twin"], onDemandReplay: survivalTwinOnDemand },
          mcRuinCi: {
            probability_of_ruin_ci: ruinCi as import("../lib/b14-ci-gate.js").RuinCiDict | null,
            probability_of_ruin: latestMcP2D?.probabilityOfRuin != null ? Number(latestMcP2D.probabilityOfRuin) : null,
          },
          b14McDataAvailable: latestMcP2D != null,
          b15Battery: (latestBtP2D?.b15Battery ?? null) as import("../lib/paper-to-deploy-ready-gates.js").B15BatteryInput | null,
          walkForwardResults: wfResults
            ? {
                wfe_overall: (wfResults.wfe_overall as number | null | undefined) ?? null,
                wfe_status: (wfResults.wfe_status as string | null | undefined) ?? null,
                param_stability: (wfResults.param_stability as { drift_classification?: string | null; drift_confidence?: number | null } | null | undefined) ?? null,
                // C1 (2026-06-29): thread the top-level param_stability_status key so the
                // CPCV path resolves to cpcv_exempt (distinct audit) not legacy_null.
                param_stability_status: (wfResults.param_stability_status as string | null | undefined) ?? null,
                wf_metadata: ((wfResults.wf_metadata as Record<string, unknown> | null) ?? null) as import("../lib/b14-ci-gate.js").WalkForwardDsrInput | null,
                wf_metadata_mode: ((wfResults.wf_metadata as Record<string, unknown> | null)?.mode as string | null) ?? null,
                // Finding 3 fix 2026-06-29: read n_paths ONLY when mode==="cpcv", matching the
                // cron sweep's inline orchestrator read (lifecycle-service.ts:~3980). Without this
                // guard the consolidated mapping fed a plain-WF window_count into Gate 7's CPCV
                // n_paths check, so the SAME backtest row could yield different CPCV verdicts on
                // the cron path vs the manual PATCH path. The guard makes the verdict identical.
                wf_metadata_n_paths: (() => {
                  const m = wfResults.wf_metadata as Record<string, unknown> | null;
                  return m?.mode === "cpcv" && m.n_paths != null ? Number(m.n_paths) : null;
                })(),
              }
            : null,
          orchGates: {
            wrcPValue: (wrcResult?.p_value as number | null | undefined) ?? null,
            spaConsistentP: (spaResult?.spa_consistent_p as number | null | undefined) ?? null,
          },
          // H1 fix 2026-06-28: wire BIF gate inputs from backtests row.
          bifInput: {
            bif: latestBtP2D?.bif != null ? Number(latestBtP2D.bif) : null,
            kEff: latestBtP2D?.kEff != null ? Number(latestBtP2D.kEff) : null,
          },
          compositeShadow: null,  // _promoteStrategyInner does not pre-fetch composite shadow; observability only
          frozenPolicy: {
            id: frozenShadowRow?.id ?? id,
            config: frozenShadowRow?.config ?? null,
            frozenPolicyHash: frozenShadowRow?.frozenPolicyHash ?? null,
          },
        };
        // hardening/phase-0: BIF CPCV-unmeasured pre-check.
        // walk_forward.py emits bif_reliable=false in wf_metadata when mode="cpcv".
        // paper-to-deploy-ready-gates.ts (Gate 6.5) cannot be edited (paper-*.ts restriction),
        // so we emit the distinct lifecycle.bif_cpcv_unmeasured audit here — BEFORE the
        // evaluator runs — so the exemption is visible in the audit trail.
        // The evaluator still runs normally; in CPCV mode bif ≈ 1.0 (proxy-based) which
        // passes the BIF threshold cleanly (1.0 < 2.0 warn floor) — the proxy-basis warn
        // emitted by evaluatePaperToDeployReadyGates Gate 6.5 complements this audit row.
        {
          const p2dWfMeta = ((wfResults?.wf_metadata as Record<string, unknown> | null) ?? null);
          const bifReliable = p2dWfMeta?.bif_reliable;
          if (bifReliable === false) {
            const bifNum = latestBtP2D?.bif != null ? Number(latestBtP2D.bif) : null;
            const kEffNum = latestBtP2D?.kEff != null ? Number(latestBtP2D.kEff) : null;
            const bifProxyBasis = (p2dWfMeta?.bif_proxy_basis as string | null | undefined) ?? null;
            const bifCpcvResult = evaluateBifGate(bifNum, kEffNum, { bifReliable: false, proxyBasis: bifProxyBasis });
            await db.insert(auditLog).values({
              action: "lifecycle.bif_cpcv_unmeasured",
              entityId: id,
              entityType: "strategy",
              status: "success",
              decisionAuthority: "gate",
              input: { fromState, toState },
              result: bifCpcvResult.auditPayload as Record<string, unknown>,
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: id, err: auditErr }, "lifecycle.bif_cpcv_unmeasured audit insert failed (non-blocking)");
            });
          }
        }

        // ── Wave A (2026-07-03) — Slippage-Survival gate, manual-path enforcement ──
        // paper-to-deploy-ready-gates.ts is the shared pure evaluator owned by the
        // Pass 5 Track A carve-out; rather than touch it, this gate is enforced
        // inline here (manual PATCH path) and again in the cron sweep below —
        // mirroring the BIF gate's dual-call-site pattern (manual + cron parity).
        // Advisory-only while SLIPPAGE_SURVIVAL_GATE_ENABLED=false (default).
        // deepscan15 F-1: capture the slippage evidence bucket in an outer-scoped var
        // so the evidence-completeness governor below counts it on the MANUAL path too
        // (the shared evaluatePaperToDeployReadyGates has no slippage dimension). Without
        // this, a malformed slippage producer was INCOMPLETE in cron but invisible here.
        let slippageEvidenceStatusP2D: string | null = null;
        {
          const slippageSurvivalResultP2D = evaluateSlippageSurvivalGate(
            (latestBtP2D?.slippageSurvival ?? null) as import("../lib/slippage-survival-gate.js").SlippageSurvivalDict | null,
          );
          slippageEvidenceStatusP2D = slippageEvidenceBucket(slippageSurvivalResultP2D.status);

          await db.insert(auditLog).values({
            action: "slippage_survival.gate_evaluated",
            entityId: id,
            entityType: "strategy",
            status: slippageSurvivalResultP2D.passed
              ? (slippageSurvivalResultP2D.status === "clean" || slippageSurvivalResultP2D.status === "disabled" ? "success" : "warning")
              : "failure",
            decisionAuthority: "gate",
            input: { fromState, toState },
            result: slippageSurvivalResultP2D.auditPayload as Record<string, unknown>,
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: id, err: auditErr }, "slippage_survival.gate_evaluated audit insert (manual path) failed (non-blocking)");
          });

          broadcastSSE(LIFECYCLE_GATE_EVENTS.SLIPPAGE_SURVIVAL_EVALUATED, {
            strategyId: id,
            ...slippageSurvivalResultP2D.auditPayload,
            passed: slippageSurvivalResultP2D.passed,
            reason: slippageSurvivalResultP2D.reason,
            // §2 correlation_id mandate: thread the same id the audit row carries so
            // an SSE consumer can stitch a block back to its triggering backtest.
            correlationId,
          });

          if (!slippageSurvivalResultP2D.passed) {
            try {
              slippageSurvivalBlocksTotal.labels({ breaks_at: String(slippageSurvivalResultP2D.auditPayload.breaks_at) }).inc();
            } catch { /* non-blocking counter */ }
            logger.warn(
              { strategyId: id, breaks_at: slippageSurvivalResultP2D.auditPayload.breaks_at, threshold: slippageSurvivalResultP2D.auditPayload.block_mult, transition: "PAPER→DEPLOY_READY" },
              "Slippage-Survival gate BLOCKED PAPER→DEPLOY_READY (manual path): edge dies at or below block multiple (living on optimistic fills)",
            );
            strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
            return { success: false, error: slippageSurvivalResultP2D.reason };
          }
        }

        const gatePdrResult = await evaluatePaperToDeployReadyGates(pdrInput);

        // Finding 3 fix: emit bifGateEvaluationsTotal Prometheus counter.
        // evaluateBifGate is pure/synchronous (no I/O); calling it here with the same
        // inputs provides the BIF-specific outcome label without changing gate logic.
        // outcome label is mapped to short-form: clean | warn | blocked | legacy_null.
        // The counter increment is non-blocking — errors never affect promotion outcome.
        try {
          // Finding 5 fix 2026-06-29 (filed as F-4 by accuracy-validator / M-1 by backtest-core):
          // pass bifReliable so this counter call sees the SAME CPCV verdict the gate verdict uses.
          // wf_metadata.bif_reliable===false (CPCV mode) → the gate returns reason
          // "bif.cpcv_unmeasured"; without threading bifReliable here, CPCV strategies were
          // silently counted as outcome="clean". Map that distinct reason to its own label.
          const bifReliableForCounter =
            ((wfResults?.wf_metadata as Record<string, unknown> | null)?.bif_reliable) === false;
          // deep-scan promotion L-2: thread the computation-error sentinel so this outcome-counter reflects the
          // true fail-closed verdict (a real compute_bif failure counts as blocked, not clean).
          const bifCompErrorCounter =
            (wfResults as Record<string, unknown> | null)?.bif_computation_error === true;
          const bifResult = evaluateBifGate(
            latestBtP2D?.bif != null ? Number(latestBtP2D.bif) : null,
            latestBtP2D?.kEff != null ? Number(latestBtP2D.kEff) : null,
            {
              bifReliable: bifReliableForCounter ? false : undefined,
              computationError: bifCompErrorCounter,
            },
          );
          const bifOutcome = bifResult.reason === "bif.cpcv_unmeasured"
            ? "cpcv_unmeasured"
            : !bifResult.passed
              ? "blocked"
              : bifResult.legacyNull
                ? "legacy_null"
                : bifResult.reason === "bif.warn_above_warn_threshold"
                  ? "warn"
                  : "clean";
          bifGateEvaluationsTotal.labels({ outcome: bifOutcome }).inc();
        } catch (_bifCounterErr) { /* non-blocking — counter failures never prevent promotion */ }

        if (!gatePdrResult.passed) {
          logger.warn({ strategyId: id, reason: gatePdrResult.reason, fromState, toState }, "PAPER→DEPLOY_READY blocked by evaluatePaperToDeployReadyGates");
          await db.insert(auditLog).values({
            action: gatePdrResult.auditAction ?? "lifecycle.paper_to_deploy_ready_blocked",
            entityId: id, entityType: "strategy", status: "failure", decisionAuthority: "gate",
            input: { fromState, toState }, result: gatePdrResult.auditPayload ?? { reason: gatePdrResult.reason },
            correlationId,
          }).catch((e) => { logger.warn({ err: e }, "PAPER→DEPLOY_READY evaluator audit failed (non-blocking)"); });
          broadcastSSE(LIFECYCLE_GATE_EVENTS.PAPER_TO_DEPLOY_READY_BLOCKED, { strategyId: id, correlationId, reason: gatePdrResult.reason, passed: false });
          strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
          return { success: false, error: gatePdrResult.reason ?? "PAPER→DEPLOY_READY gate failed" };
        }

        // Honest survival-twin audit on the PROCEED path — makes an un-evaluated (or
        // on-demand-passed) gate VISIBLE rather than masquerading as protection. Block
        // paths are already audited above via gatePdrResult.auditAction (which carries
        // the survival-twin block action when the twin itself was the blocker).
        if (gatePdrResult.survivalTwin) {
          const stv = gatePdrResult.survivalTwin;
          const stAction =
            stv.status === "survival_twin_passed"
              ? "lifecycle.b14_survival_twin_evaluated"
              : "lifecycle.b14_survival_twin_advisory_not_evaluated";
          await db.insert(auditLog).values({
            action: stAction,
            entityId: id, entityType: "strategy",
            status: stv.status === "survival_twin_passed" ? "success" : "warning",
            decisionAuthority: "gate",
            input: { fromState, toState, evaluated_via: stv.evaluatedVia },
            result: { survival_twin_status: stv.status, reason: stv.auditReason, per_firm: stv.perFirm ?? null, replay_error: stv.replayError ?? null },
            correlationId,
          }).catch((e) => { logger.warn({ err: e }, "PAPER→DEPLOY_READY survival-twin audit failed (non-blocking)"); });
        }

        // ── (deepscan7 F-2 2026-07-02) First-time frozen-policy freeze — cron-path parity ──
        // evaluatePaperToDeployReadyGates returns needsFirstTimeFreeze=true with an explicit
        // caller contract ("call freezePolicyForStrategy() BEFORE the promotion DB write");
        // the manual path never read it, so manually-promoted strategies reached DEPLOY_READY
        // with frozenPolicyHash=null — the frozen-policy drift gate then grandfathered them
        // forever. Mirrors the cron call site: same regime resolution (biasState.regimeLabel,
        // UNKNOWN fallback), same fail-CLOSED block + frozen_policy.hash_compute_failed audit
        // on a failed freeze write. freezePolicyForStrategy emits frozen_policy.set itself.
        if (gatePdrResult.needsFirstTimeFreeze) {
          let currentRegime = "UNKNOWN";
          try {
            const { biasState: biasStateTable } = await import("../db/schema.js");
            const biasStateRows = await db
              .select({ regimeLabel: biasStateTable.regimeLabel })
              .from(biasStateTable)
              .limit(1)
              .catch(() => [] as { regimeLabel: string }[]);
            if (biasStateRows.length > 0 && typeof biasStateRows[0].regimeLabel === "string") {
              currentRegime = biasStateRows[0].regimeLabel;
            }
          } catch {
            // Regime lookup error is non-fatal — UNKNOWN is a valid regime label.
          }

          try {
            await freezePolicyForStrategy(id, currentRegime);
            logger.info(
              { strategyId: id, regime: currentRegime },
              "Frozen-policy first-time freeze: hash stamped successfully (manual path)",
            );
          } catch (freezeErr) {
            // Hash was not stamped — cannot verify policy integrity. Block (fail-CLOSED
            // per CLAUDE.md §12, identical to the cron path).
            const freezeMsg = freezeErr instanceof Error ? freezeErr.message : String(freezeErr);
            logger.warn({ strategyId: id, err: freezeErr }, "frozen_policy first-time freeze failed (manual path) — blocking promotion until hash is stamped (fail-CLOSED per CLAUDE.md §12)");
            await db.insert(auditLog).values({
              action: "frozen_policy.hash_compute_failed",
              entityId: id,
              entityType: "strategy",
              status: "blocked",
              decisionAuthority: "gate",
              input: { fromState, toState },
              result: { error: freezeMsg, note: "first-time freeze write failed — promotion blocked; retry once the DB write succeeds" },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ err: auditErr, correlationId }, "frozen_policy.hash_compute_failed (manual freeze-write) audit insert failed (non-blocking)");
              auditWriteFailuresTotal.labels({ action: "frozen_policy.hash_compute_failed" }).inc();
            });
            return { success: false, error: `frozen_policy.first_time_freeze_failed: ${freezeMsg}` };
          }
        }

        // ── (deepscan7 F-3 2026-07-02) Evidence-completeness governor — cron-path parity ──
        // The cron blocks PAPER→DEPLOY_READY when ≥3 tracked gates report incomplete
        // (legacy/data_unavailable) evidence; the manual path enforced no such floor,
        // so a hand-promoted strategy could clear the stack on grandfather passes alone.
        // Same ≥3 threshold, same lifecycle.promotion_evidence_incomplete audit action.
        // Runs AFTER the first-time freeze, mirroring the cron's gate ordering.
        {
          // deepscan15 F-1: fold the inline slippage-survival evidence bucket into the
          // manual-path count so cron+manual parity is REAL for the slippage dimension
          // (was cron-only). A malformed slippage producer now counts INCOMPLETE here too.
          const evidenceStatuses = [...(gatePdrResult.gateEvidenceStatuses ?? [])];
          if (slippageEvidenceStatusP2D !== null) evidenceStatuses.push(slippageEvidenceStatusP2D);
          const incompleteCount =
            (gatePdrResult.incompleteGateCount ?? 0) +
            (slippageEvidenceStatusP2D !== null && isIncompleteEvidenceStatus(slippageEvidenceStatusP2D) ? 1 : 0);
          if (incompleteCount >= 3) {
            logger.warn(
              { strategyId: id, incompleteCount, gateEvidenceStatuses: evidenceStatuses, transition: "PAPER→DEPLOY_READY" },
              "lifecycle.promotion_evidence_incomplete (manual path): too many gates lack institutional data — blocking promotion",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.promotion_evidence_incomplete",
              entityId: id,
              entityType: "strategy",
              status: "warn",
              decisionAuthority: "gate",
              input: { fromState, toState },
              result: {
                incomplete_count: incompleteCount,
                total_gates: evidenceStatuses.length,
                gate_evidence_statuses: evidenceStatuses,
                note: "Strategy must complete institutional-grade backtests before promotion proceeds",
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: id, err: auditErr }, "promotion_evidence_incomplete audit insert failed (non-blocking)");
            });
            broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTION_EVIDENCE_INCOMPLETE, {
              strategyId: id,
              strategy_name: strategy.name,
              incomplete_count: incompleteCount,
              total_gates: evidenceStatuses.length,
              gate_evidence_statuses: evidenceStatuses,
              correlationId: correlationId,
            });
            return {
              success: false,
              error: `promotion_evidence_incomplete: ${incompleteCount}/${evidenceStatuses.length} gates lack institutional data — run a full backtest first`,
            };
          }
        }
      } catch (pdrGateErr) {
        // F-1 Hardening 2026-06-23: Fail-CLOSED on infrastructure errors.
        // The "legacy gates" comment was misleading — no fallback gate stack exists.
        // An evaluator that cannot run must block promotion, not silently allow it.
        const pdrErrMsg = pdrGateErr instanceof Error ? pdrGateErr.message : String(pdrGateErr);
        logger.warn({ strategyId: id, err: pdrGateErr }, "PAPER→DEPLOY_READY evaluator: infrastructure error — blocking promotion (fail-closed)");
        return { success: false, error: `paper_to_deploy_ready_gate_evaluator_error: ${pdrErrMsg}` };
      }
    }

    // Pass 5 Track C: SHADOW → PAPER evaluator in _promoteStrategyInner
    if (fromState === "SHADOW" && toState === "PAPER") {
      try {
        const { evaluateShadowToPaperGate } = await import("../lib/shadow-to-paper-gate.js");
        const correlationId = options.correlationId ?? randomUUID();
        const { loadDivergenceInputs: loadDiv } = await import("../lib/shadow-signal-divergence-loader.js");
        const divInputs = await loadDiv(id);
        const shadowGateResult = await evaluateShadowToPaperGate({
          strategyId: id,
          shadowSignals: divInputs.shadowSignals,
          backtestExpected: divInputs.backtestExpected,
          backtestExpectedCount: divInputs.backtestExpected.length,
          correlationId,
        });

        if (!shadowGateResult.passed) {
          logger.warn({ strategyId: id, reason: shadowGateResult.reason }, "SHADOW→PAPER blocked by evaluateShadowToPaperGate");
          await db.insert(auditLog).values({
            action: shadowGateResult.auditAction ?? "lifecycle.shadow_to_paper_blocked",
            entityId: id, entityType: "strategy", status: "failure", decisionAuthority: "gate",
            input: { fromState, toState }, result: shadowGateResult.auditPayload ?? { reason: shadowGateResult.reason },
            correlationId,
          }).catch((e) => { logger.warn({ err: e }, "SHADOW→PAPER evaluator audit failed (non-blocking)"); });
          broadcastSSE(LIFECYCLE_GATE_EVENTS.SHADOW_TO_PAPER_BLOCKED, { strategyId: id, correlationId, reason: shadowGateResult.reason, passed: false });
          return { success: false, error: shadowGateResult.reason ?? "SHADOW→PAPER gate failed" };
        }
      } catch (shadowGateErr) {
        // F-2a Hardening 2026-06-23: Fail-CLOSED on infrastructure errors.
        // SHADOW→PAPER is a trust boundary; a broken evaluator must block, not allow.
        const shadowErrMsg = shadowGateErr instanceof Error ? shadowGateErr.message : String(shadowGateErr);
        logger.warn({ strategyId: id, err: shadowGateErr }, "SHADOW→PAPER evaluator: infrastructure error — blocking promotion (fail-closed)");
        return { success: false, error: `shadow_to_paper_gate_evaluator_error: ${shadowErrMsg}` };
      }
    }

    // ── A-1 (deepscan17 2026-07-05) — DSL guards_failed HARD gate: MANUAL path into PAPER ──
    // checkAutoPromotions (the autonomous cron) blocks BOTH forward edges into PAPER on
    // result_extras.dsl_guards.guards_failed=true (E.3/E.4/E.5 risk guards threw mid-run — the
    // stop-ceiling / time-stop / DLL-halt enforcement never ran, so the backtest is UNGUARDED,
    // not clean). Those cron call sites live entirely inside checkAutoPromotions; the manual
    // PATCH /:id/lifecycle path (this function) had NO such gate, so a correctly-HMAC-signed
    // manual/n8n/Carter promotion of a guards_failed strategy reached PAPER (and downstream live
    // capital). Mirrors the cron gate via the SAME pure evaluator: same audit actions, same SSE,
    // same counter, same fail-CLOSED posture. Covers TESTING→PAPER (legacy) + SHADOW→PAPER
    // (canonical); DEPLOY_READY→PAPER demotion is excluded (moving away from capital, not toward
    // it — matches the cron's forward-only gating). Runs BEFORE the heavy gate stack so an
    // unguarded backtest is rejected early. Self-contained fetch of the latest completed backtest
    // (no dependency on the promotionEvidence block below). No _maybeAutoGraveyard here: burial is
    // a repeated-autonomous-failure escalation, not a single-operator-attempt outcome (mirrors the
    // manual path's other gates, which block-and-return without burying).
    if ((fromState === "TESTING" || fromState === "SHADOW") && toState === "PAPER") {
      const dslGuardsTransition: LifecycleGateTransition =
        fromState === "SHADOW" ? "SHADOW_TO_PAPER" : "TESTING_TO_PAPER";
      try {
        const [btDslGuards] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(and(eq(backtests.strategyId, id), eq(backtests.status, "completed")))
          .orderBy(desc(backtests.createdAt))
          .limit(1);
        const dslGuardsInput = ((btDslGuards?.resultExtras as Record<string, unknown> | null)?.dsl_guards ?? null) as
          | DslGuardsGateInput
          | null;
        const dslGuardsResult = evaluateDslGuardsGate(dslGuardsInput);
        _incDslGuardsGateCounter(dslGuardsTransition, dslGuardsResult);

        broadcastSSE(LIFECYCLE_GATE_EVENTS.DSL_GUARDS_EVALUATED, {
          strategyId: id,
          ...dslGuardsResult.auditPayload,
          correlationId: options.correlationId ?? null, // deep-scan Obs re-verify #3 F-6: match paired audit row (manual-promotion block)
          passed: dslGuardsResult.passed,
          reason: dslGuardsResult.reason,
        });

        await db.insert(auditLog).values({
          action: dslGuardsResult.auditAction ?? "lifecycle.dsl_guards_pass",
          entityId: id,
          entityType: "strategy",
          status: !dslGuardsResult.passed ? "failure" : dslGuardsResult.status === "legacy_proceed" ? "warning" : "success",
          decisionAuthority: "gate",
          input: { fromState, toState },
          result: dslGuardsResult.auditPayload,
          correlationId: options.correlationId ?? null,
        }).catch((auditErr: unknown) => {
          logger.warn({ strategyId: id, err: auditErr }, "DSL guards gate (manual path into PAPER) audit insert failed (non-blocking)");
        });

        if (!dslGuardsResult.passed) {
          logger.warn(
            { strategyId: id, guardsFailedReason: dslGuardsResult.auditPayload.guards_failed_reason, transition: `${fromState}→PAPER` },
            "DSL guards gate BLOCKED (manual path): guards_failed=true (E.3/E.4/E.5 risk guards did not run — unguarded backtest)",
          );
          strategyPromotions.labels({ from_state: fromState, to_state: "PAPER", actor: "system_gate" }).inc();
          return { success: false, error: "lifecycle.dsl_guards_failed_block" };
        }
        this._resetHardGateCounter(id, "dsl_guards_failed", options.correlationId ?? null);
      } catch (dslGuardsErr) {
        // Fail-CLOSED: this gate protects live capital from an UNGUARDED backtest (same severity
        // class as B14) — a read/parse error must not silently allow promotion. In practice the
        // resultExtras blob is already-parsed JS, so this guards against unexpected shape errors,
        // not DB connectivity.
        try { dslGuardsGateTotal.labels({ transition: dslGuardsTransition, outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
        logger.warn({ strategyId: id, err: dslGuardsErr }, "DSL guards gate (manual path into PAPER): read failed — blocking promotion (fail-closed)");
        await db.insert(auditLog).values({
          action: "lifecycle.dsl_guards_gate_error_fail_closed",
          entityId: id,
          entityType: "strategy",
          status: "failure",
          decisionAuthority: "gate",
          input: { fromState, toState },
          result: {
            reason: "lifecycle.dsl_guards_gate_error_fail_closed",
            error: dslGuardsErr instanceof Error ? dslGuardsErr.message : String(dslGuardsErr),
            note: "DSL guards gate threw on manual promotion into PAPER — promotion blocked",
          },
          correlationId: options.correlationId ?? null,
        }).catch((auditErr: unknown) => {
          logger.warn({ strategyId: id, err: auditErr }, "DSL guards gate fail-closed audit insert (manual path into PAPER) failed (non-blocking)");
        });
        strategyPromotions.labels({ from_state: fromState, to_state: "PAPER", actor: "system_gate" }).inc();
        return { success: false, error: "lifecycle.dsl_guards_gate_error_fail_closed" };
      }
    }

    // Captured for post-commit side effects (SSE, fire-and-forget burial).
    // Populated INSIDE the tx, consumed AFTER commit.
    let retiredCodename: string | null = null;

    // FIX 2: Look up evidence snapshot for the audit row (both manual and auto promotions).
    // Done outside the tx (read-only) so the write block stays lean.
    // Failures are non-blocking — evidence is best-effort.
    let promotionEvidence: {
      backtestId: string | null;
      forgeScore: number | null;
      mcSurvivalRate: number | null;
      // Tier 1.1 QAE shadow fields — populated when quantum_mc_runs data exists.
      // Phase 0: these are observed only. Gate behavior is 100% classical.
      quantumAgreementScore: number | null;
      quantumAdvantageDelta: number | null;
      quantumFallbackTriggered: boolean;
      quantumClassicalDisagreementPct: number | null;
      // Tier 3.4 adversarial stress shadow fields — populated when adversarial_stress_runs data exists.
      // Phase 0 SHADOW ONLY: these are observed only. Gate behavior is 100% classical.
      // Phase 1 (W7b Day 52): worstCaseBreachProb > 0.5 AND breachMinimalNTrades < 4 -> BLOCK.
      adversarialWorstCaseBreachProb: number | null;
      adversarialBreachMinimalNTrades: number | null;
      adversarialPhase1BlockRecommended: boolean;
      adversarialMethod: string | null;
    } = {
      backtestId: null,
      forgeScore: null,
      mcSurvivalRate: null,
      quantumAgreementScore: null,
      quantumAdvantageDelta: null,
      quantumFallbackTriggered: false,
      quantumClassicalDisagreementPct: null,
      adversarialWorstCaseBreachProb: null,
      adversarialBreachMinimalNTrades: null,
      adversarialPhase1BlockRecommended: false,
      adversarialMethod: null,
    };

    try {
      const [latestBtEvidence] = await (tx ?? db)
        .select({
          id: backtests.id,
          forgeScore: backtests.forgeScore,
          // CRITICAL #6: read resultExtras for invariants.overall_passed + parity_shadow.passed
          resultExtras: backtests.resultExtras,
          createdAt: backtests.createdAt,
        })
        .from(backtests)
        .where(
          and(
            eq(backtests.strategyId, id),
            eq(backtests.status, "completed"),
          ),
        )
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      if (latestBtEvidence) {
        const [mcEvidence] = await (tx ?? db)
          .select({ probabilityOfRuin: monteCarloRuns.probabilityOfRuin })
          .from(monteCarloRuns)
          .where(eq(monteCarloRuns.backtestId, latestBtEvidence.id))
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1);

        const ruinProb = mcEvidence?.probabilityOfRuin != null
          ? parseFloat(String(mcEvidence.probabilityOfRuin))
          : null;

        promotionEvidence = {
          backtestId: latestBtEvidence.id,
          forgeScore: latestBtEvidence.forgeScore != null ? parseFloat(String(latestBtEvidence.forgeScore)) : null,
          mcSurvivalRate: ruinProb != null ? 1 - ruinProb : null,
          // Quantum fields default — populated below after parallel QMC read
          quantumAgreementScore: null,
          quantumAdvantageDelta: null,
          quantumFallbackTriggered: false,
          quantumClassicalDisagreementPct: null,
          // Adversarial stress fields default — populated below for TESTING->PAPER gate
          adversarialWorstCaseBreachProb: null,
          adversarialBreachMinimalNTrades: null,
          adversarialPhase1BlockRecommended: false,
          adversarialMethod: null,
        };

        // ── Tier 1.1 QAE shadow: read latest quantum_mc_runs row for this backtest ──
        // Phase 0 = shadow only. This read is:
        //   (a) non-blocking — any error falls through to fallback
        //   (b) non-authoritative — the classical decision is unaffected by this read
        //   (c) gated on QUANTUM_QAE_GATE_PHASE >= 0 (which is always true in Phase 0)
        //
        // AUTHORITY BOUNDARY: The result is stored in lifecycle_transitions for
        // Tier 7 graduation analysis. It MUST NOT influence the gate decision
        // while QUANTUM_QAE_GATE_PHASE=0.
        try {
          const [qmcRun] = await (tx ?? db)
            .select({
              estimatedValue: quantumMcRuns.estimatedValue,
              confidenceInterval: quantumMcRuns.confidenceInterval,
            })
            .from(quantumMcRuns)
            .where(
              and(
                eq(quantumMcRuns.backtestId, latestBtEvidence.id),
                eq(quantumMcRuns.status, "completed"),
              ),
            )
            .orderBy(desc(quantumMcRuns.createdAt))
            .limit(1);

          if (qmcRun) {
            const quantumEstimate = qmcRun.estimatedValue != null
              ? parseFloat(String(qmcRun.estimatedValue))
              : null;

            // Parse CI from jsonb: {lower, upper, confidence_level}
            const ciRaw = qmcRun.confidenceInterval as { lower?: number; upper?: number } | null;
            const ci: [number, number] | undefined =
              ciRaw?.lower != null && ciRaw?.upper != null
                ? [ciRaw.lower, ciRaw.upper]
                : undefined;

            // classical comparison uses probabilityOfRuin (higher = more risk)
            // quantum estimatedValue is also a probability (breach/ruin event)
            const agreement = computeAgreement(ruinProb, quantumEstimate, ci);

            promotionEvidence.quantumAgreementScore = agreement.score;
            promotionEvidence.quantumAdvantageDelta = agreement.delta;
            promotionEvidence.quantumFallbackTriggered = agreement.fallback;
            promotionEvidence.quantumClassicalDisagreementPct = agreement.disagreementPct;

            // Log disagreement for Tier 7 analysis — never suppress
            if (!agreement.withinTolerance && !agreement.fallback) {
              logger.warn(
                {
                  strategyId: id,
                  fromState,
                  toState,
                  classicalRuin: ruinProb,
                  quantumEstimate,
                  delta: agreement.delta,
                  disagreementPct: agreement.disagreementPct,
                  phase: process.env.QUANTUM_QAE_GATE_PHASE ?? "0",
                },
                "QAE shadow: quantum-classical disagreement exceeds 5pp tolerance (Phase 0 — advisory only, gate unaffected)",
              );
            }
          } else {
            // No completed QMC run for this backtest — normal during Phase 0 ramp-up
            promotionEvidence.quantumFallbackTriggered = true;
          }
        } catch (qmcErr) {
          // Non-blocking — quantum evidence read failure must never abort a promotion
          promotionEvidence.quantumFallbackTriggered = true;
          logger.warn(
            { strategyId: id, err: qmcErr },
            "QAE shadow: quantum_mc_runs read failed — fallback_triggered=true, classical decision unaffected",
          );
        }

        // ── Tier 3.4 adversarial stress shadow: read latest adversarial_stress_runs row ──
        // Phase 0 = shadow only. This read is:
        //   (a) non-blocking — any error falls through silently
        //   (b) non-authoritative — classical decision is unaffected by this read
        //   (c) TESTING->PAPER gate only — adversarial stress is irrelevant for other transitions
        //
        // AUTHORITY BOUNDARY: The result is stored in lifecycle_transitions.quantum_*
        // for Tier 7 / W7b graduation analysis (Day 52). It MUST NOT influence the
        // gate decision while QUANTUM_ADVERSARIAL_STRESS_ENABLED=false (Phase 0).
        if (fromState === "TESTING" && toState === "PAPER" && latestBtEvidence) {
          try {
            const adversarialRun = await getLatestAdversarialStressRun(latestBtEvidence.id);
            if (adversarialRun) {
              promotionEvidence.adversarialWorstCaseBreachProb = adversarialRun.worstCaseBreachProb;
              promotionEvidence.adversarialBreachMinimalNTrades = adversarialRun.breachMinimalNTrades;
              promotionEvidence.adversarialPhase1BlockRecommended = adversarialRun.phase1BlockRecommended;
              promotionEvidence.adversarialMethod = adversarialRun.method;

              // Log Phase 1 block recommendation — never suppress, never act on it in Phase 0
              if (adversarialRun.phase1BlockRecommended) {
                logger.warn(
                  {
                    strategyId: id,
                    fromState,
                    toState,
                    worstCaseBreachProb: adversarialRun.worstCaseBreachProb,
                    breachMinimalNTrades: adversarialRun.breachMinimalNTrades,
                    method: adversarialRun.method,
                    phase: "0_shadow",
                  },
                  "Adversarial stress shadow: Phase 1 would BLOCK this promotion (worst_case_breach_prob > 0.5 AND breach_minimal_n_trades < 4) — Phase 0 shadow, gate unaffected",
                );
              } else {
                logger.info(
                  {
                    strategyId: id,
                    fromState,
                    toState,
                    worstCaseBreachProb: adversarialRun.worstCaseBreachProb,
                    breachMinimalNTrades: adversarialRun.breachMinimalNTrades,
                    method: adversarialRun.method,
                    phase: "0_shadow",
                  },
                  "Adversarial stress shadow: evidence logged (Phase 0 — advisory only, gate unaffected)",
                );
              }
            }
            // No adversarial run for this backtest: normal — ramp-up phase, TIER_3, or no trades
          } catch (adversarialErr) {
            // Non-blocking — adversarial evidence read failure must never abort a promotion
            logger.warn(
              { strategyId: id, err: adversarialErr },
              "Adversarial stress shadow: read failed — continuing without adversarial evidence, classical decision unaffected",
            );
          }
        }
      }
    } catch (evidenceErr) {
      // Non-blocking — evidence enrichment must never abort a promotion
      logger.warn({ strategyId: id, err: evidenceErr }, "promoteStrategy: evidence lookup failed (audit row will lack backtestId/forgeScore/mcSurvivalRate)");
    }

    // ── HIGH #14: Backtest staleness gate ───────────────────────────────────
    // Promotion on a months-old backtest that doesn't reflect current market regime
    // is a trust violation. Default BACKTEST_STALENESS_DAYS=30; env-configurable.
    // Applied to all paths that consume a backtest (i.e., when promotionEvidence.backtestId exists).
    // HIGH#2 (fresh-scan 2026-07-12): this gate must NOT ride DEMOTION/EXIT edges. A DEPLOYED strategy's
    // last backtest naturally ages past 30d (deployed strategies are not re-backtested), so a SAFETY
    // demotion (DEPLOYED→DECLINING on underperformance, or the regime-drift DEPLOYED→TESTING/DECLINING)
    // was being BLOCKED by staleness — the exact opposite of the intent (the point is to REMOVE the
    // stale/underperforming strategy from live). Skip staleness for any demotion/exit target so the
    // safety off-ramp always fires.
    // HIGH#2 grader follow-up (fresh-scan-3 independent grade, 2026-07-12): the production demotion
    // services (regime-drift-detector, portfolio-drift-demotion, strategy-revalidation) all perform a
    // TWO-STEP demotion DEPLOYED→DECLINING→TESTING. Step 2 (DECLINING→TESTING) reads the SAME stale
    // backtestId, so omitting "TESTING" from the exempt set left the strategy DEADLOCKED in a zombie
    // DECLINING state — the exact failure the code's own notifyCritical handler anticipates. Adding
    // "TESTING" is hole-free: per VALID_TRANSITIONS the ONLY inbound edges to TESTING are (a) this
    // demotion step DECLINING→TESTING and (b) CANDIDATE→TESTING. Note (grader correction 2026-07-12):
    // CANDIDATE→TESTING is NOT pre-backtest — checkAutoPromotions requires a completed backtest with
    // walkForwardResults before it fires, so promotionEvidence.backtestId IS non-null there. Exempting it
    // is still safe because TESTING never touches a broker (SHADOW logs Pine alerts only; TradersPost
    // webhook OFF), i.e. TESTING is not a live-capital state. The live-capital trust boundary is the
    // OUTBOUND edge TESTING→PAPER (and SHADOW→PAPER), which is NOT exempt and re-fetches the CURRENT
    // latest backtestId FRESH on each call (no staleness leakage across hops) — so staleness is enforced
    // at exactly the right place, one hop later. Only forward edges into PAPER/DEPLOY_READY stay gated.
    const _isDemotionOrExitTransition = ["TESTING", "DECLINING", "NEEDS_REVISION", "RETIRED", "GRAVEYARD"].includes(toState);
    if (promotionEvidence.backtestId && !_isDemotionOrExitTransition) {
      const stalenessDays = parseInt(process.env.BACKTEST_STALENESS_DAYS ?? "30", 10);
      // latestBtEvidence.createdAt is available via the extended select above.
      // We re-fetch from promotionEvidence which doesn't store createdAt — we need to
      // carry the createdAt alongside. We stored it in latestBtEvidence but not promotionEvidence.
      // Read it from the evidence again inline (cheap — single row by PK).
      try {
        const [btAge] = await (tx ?? db)
          .select({ createdAt: backtests.createdAt })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btAge) {
          const ageMs = Date.now() - new Date(btAge.createdAt).getTime();
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          if (ageDays > stalenessDays) {
            const error =
              `lifecycle.backtest_stale: latest backtest for strategy ${id} is ${ageDays.toFixed(1)} days old ` +
              `(limit: ${stalenessDays}d via BACKTEST_STALENESS_DAYS). Re-run backtest before promoting.`;
            logger.warn({ strategyId: id, fromState, toState, ageDays: ageDays.toFixed(1), stalenessDays }, error);
            insertAuditRow({
              action: "lifecycle.backtest_stale",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: {
                reason: "backtest_too_old",
                age_days: parseFloat(ageDays.toFixed(1)),
                limit_days: stalenessDays,
                backtest_created_at: btAge.createdAt,
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.backtest_stale audit row write failed"));
            broadcastSSE(LIFECYCLE_GATE_EVENTS.BACKTEST_STALE, {
              strategyId: id,
              age_days: parseFloat(ageDays.toFixed(1)),
              limit_days: stalenessDays,
              correlationId: options.correlationId ?? null,
            });
            return { success: false, error };
          }
        }
      } catch (stalenessErr) {
        // Non-blocking infra failure: log and continue (fail-open; stale backtest is
        // a quality gate, not a safety gate — don't block on DB read errors).
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: stalenessErr }, "lifecycle.backtest_stale: age check threw (non-blocking — promotion continues)");
      }
    }

    // ── CRITICAL #6: Truthiness gate: resultExtras invariants + parity shadow ─
    // Applies to TESTING → PAPER only (the trust boundary before paper trading).
    // invariants.overall_passed=false → BLOCK (hard gate: curvefitting invariant harness)
    // parity_shadow.passed=false     → ADVISORY WARN (env-gated; not all backtests have it)
    if (fromState === "TESTING" && toState === "PAPER" && promotionEvidence.backtestId) {
      try {
        const [btExtras] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtras?.resultExtras) {
          const extras = btExtras.resultExtras as Record<string, unknown>;

          // ── Wave 24 / Item 12: mc_provisional sentinel check ────────────────
          // mc_provisional=true means Monte Carlo is still running. Promoting on
          // partial MC data yields distorted promotion inputs (Known-Facts Pin
          // 2026-05-20 Pass 2B F-8). Defer and instruct caller to retry in 30min.
          // Missing mc_provisional (undefined/null) = already cleared → proceed.
          if (extras.mc_provisional === true) {
            const deferMsg = `lifecycle.mc_provisional_deferred: MC still in progress for backtest ${promotionEvidence.backtestId} — promotion to PAPER deferred`;
            logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId }, deferMsg);
            insertAuditRow({
              action: "lifecycle.mc_provisional_deferred",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { backtestId: promotionEvidence.backtestId, attempted_transition: "TESTING→PAPER" } as Record<string, unknown>,
              result: { reason: "mc_provisional_in_progress", retry_after_seconds: 1800 } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.mc_provisional_deferred audit write failed"));
            return { success: false, error: "mc_provisional_in_progress", retry_after_seconds: 1800 };
          }

          // Invariant harness (B-2): hard block if overall_passed=false
          const invariants = extras.invariants as Record<string, unknown> | undefined;
          if (invariants?.overall_passed === false) {
            const criticalFailures = (invariants.critical_failures as unknown[]) ?? [];
            const error =
              `lifecycle.invariant_blocked: invariant harness FAILED for strategy ${id} — ` +
              `promotion to PAPER blocked. Critical failures: ${JSON.stringify(criticalFailures)}`;
            logger.warn({ strategyId: id, fromState, toState, criticalFailures }, error);
            insertAuditRow({
              action: "lifecycle.invariant_blocked",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: {
                reason: "invariant_harness_failed",
                critical_failures: criticalFailures,
                invariants_summary: invariants,
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.invariant_blocked audit row write failed"));
            return { success: false, error };
          }

          // Parity shadow (B-1): advisory warn only (env-gated — not all backtests have it)
          const parityShadow = extras.parity_shadow as Record<string, unknown> | undefined;
          if (parityShadow && parityShadow.passed === false) {
            logger.warn(
              { strategyId: id, fromState, toState, parityShadow },
              "lifecycle.parity_shadow_warn: parity shadow check reported passed=false — ADVISORY ONLY (promotion continues). Investigate paper/backtest drift before live deployment.",
            );
            insertAuditRow({
              action: "lifecycle.parity_shadow_warn",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "success",  // advisory — not blocking
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: {
                reason: "parity_shadow_failed_advisory",
                parity_shadow: parityShadow,
                note: "Parity shadow is env-gated; not all backtests have it. Investigate before live deployment.",
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.parity_shadow_warn audit row write failed"));
          }
        }
      } catch (extrasErr) {
        // Non-blocking: truthiness read failure must never abort a promotion.
        // Log at WARN — this is a trust gate and missing data should be visible.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: extrasErr }, "lifecycle.invariant_gate: resultExtras read failed (non-blocking — promotion continues)");
      }
    }

    // ── Wave 24 Pass 1 — Item 10: WF mode gate (Style C + plain WF → block) ─
    // Style C runner can span many bars. Plain walk-forward leaks future info
    // via overlapping runner holds at the IS/OOS boundary. Require purged_embargo
    // or cpcv mode for any Style C strategy. (Item 10, Wave 24 Pass 1, 2026-05-23)
    if (fromState === "TESTING" && toState === "PAPER" && promotionEvidence.backtestId) {
      try {
        const [btExtrasWf] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtrasWf?.resultExtras) {
          const extrasWf = btExtrasWf.resultExtras as Record<string, unknown>;
          const wfMeta = extrasWf.wf_metadata as Record<string, unknown> | undefined;
          const wfMode = wfMeta?.mode as string | undefined;

          // Read strategy DSL to check for Style C runner.
          // Strategy config lives in the strategies table — read the DSL column.
          const [stratDsl] = await (tx ?? db)
            .select({ dsl: strategies.config })
            .from(strategies)
            .where(eq(strategies.id, id))
            .limit(1);

          const dslConfig = stratDsl?.dsl as Record<string, unknown> | undefined;
          const exitParams = (dslConfig?.exit_params ?? dslConfig?.exitParams) as Record<string, unknown> | undefined;
          const isStyleC = exitParams?.style === "c" || exitParams?.style === "C";

          if (isStyleC && wfMode === "plain") {
            const error =
              `lifecycle.wf_mode_insufficient: strategy ${id} uses Style C runner exits ` +
              `but walk-forward mode is "plain" — overlapping runner bars leak IS→OOS. ` +
              `Re-run backtest with WF_MODE=purged_embargo or WF_MODE=cpcv before promoting to PAPER.`;
            logger.warn(
              { strategyId: id, fromState, toState, wfMode, isStyleC, backtestId: promotionEvidence.backtestId },
              error,
            );
            insertAuditRow({
              action: "lifecycle.wf_mode_insufficient",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId, wfMode } as Record<string, unknown>,
              result: {
                reason: "plain_wf_with_style_c_runner",
                wf_mode: wfMode,
                is_style_c: isStyleC,
                required_modes: ["purged_embargo", "cpcv"],
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.wf_mode_insufficient audit row write failed"));
            return { success: false, error };
          }
        }
      } catch (wfModeErr) {
        // Non-blocking: WF mode gate failure must not abort a promotion.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: wfModeErr }, "lifecycle.wf_mode_gate: read failed (non-blocking — promotion continues)");
      }
    }

    // ── Wave 24 Pass 1 — Item 18: PBO overfit gate (TESTING → PAPER) ────────
    // PBO > 0.5 = more likely overfit than not. Block promotion. (Item 18, W24P1)
    //
    // DEPRECATED belt-and-suspenders (2026-06-29): the AUTHORITATIVE PBO gate is the
    // Wave 29 Pass A.2 gate below (reads walkForwardResults.pbo_overall @ PBO_OVERFIT_THRESHOLD_PCT
    // 0.15, CPCV-aware, fires on TESTING → SHADOW *and* TESTING → PAPER). This W24 layer
    // reads a DIFFERENT, coarser signal — resultExtras.invariants.pbo_flag @ 0.5 — and is
    // retained only as a secondary catch on the legacy TESTING → PAPER edge. Its threshold
    // is NOT loosened (stricter W29 gate wins on the canonical SHADOW path). If the W24
    // pbo_flag producer is ever removed, delete this block — do NOT relax 0.15 to 0.5.
    if (fromState === "TESTING" && toState === "PAPER" && promotionEvidence.backtestId) {
      try {
        const [btExtrasPbo] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtrasPbo?.resultExtras) {
          const extrasPbo = btExtrasPbo.resultExtras as Record<string, unknown>;
          const invariants = extrasPbo.invariants as Record<string, unknown> | undefined;
          const pboFlag = invariants?.pbo_flag as boolean | undefined;
          const pboData = invariants?.pbo as Record<string, unknown> | undefined;

          // Only block when pbo_flag is explicitly true (not when N/A or missing).
          if (pboFlag === true) {
            const pboThreshold = parseFloat(process.env.PBO_PROMOTION_THRESHOLD ?? "0.5");
            const pboValue = pboData?.value as number | null ?? null;
            const error =
              `lifecycle.pbo_overfit_blocked: strategy ${id} has PBO=${pboValue?.toFixed(3) ?? "?"} ` +
              `which exceeds threshold ${pboThreshold}. ` +
              `Strategy appears curve-fit — block promotion to PAPER. ` +
              `Re-run backtest with more walk-forward windows or reduce parameter search space.`;
            logger.warn(
              { strategyId: id, fromState, toState, pboValue, pboThreshold, backtestId: promotionEvidence.backtestId },
              error,
            );
            insertAuditRow({
              action: "lifecycle.pbo_overfit_blocked",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: {
                reason: "pbo_exceeds_threshold",
                pbo_value: pboValue,
                pbo_threshold: pboThreshold,
                pbo_data: pboData,
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.pbo_overfit_blocked audit row write failed"));
            return { success: false, error };
          }
        }
      } catch (pboErr) {
        // Non-blocking: PBO gate failure must not abort a promotion.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: pboErr }, "lifecycle.pbo_gate: read failed (non-blocking — promotion continues)");
      }
    }

    // ── Wave 29 Pass A.2: PBO lifecycle gate (TESTING → SHADOW/PAPER) ────────
    // Institutional 2026 standard: PBO < 0.15 required (Lopez de Prado /
    // QuantBeckman 2025 / arXiv 2512.12924).
    //
    // Wire target: TESTING → SHADOW AND TESTING → PAPER (legacy fast-track).
    // A.1 HAS landed SHADOW in VALID_STATES. Gate fires on both routes.
    // A.4 architect: if desired, restrict to TESTING → SHADOW only; legacy
    // TESTING → PAPER fast-track can stay gated for extra safety.
    //
    // Two separate thresholds:
    //   PBO_OVERFIT_THRESHOLD     (0.5)  — W27.5 warn threshold (walk_forward.py)
    //   PBO_OVERFIT_THRESHOLD_PCT (0.15) — this gate (Wave 29 lifecycle hard gate)
    // deep-scan promotion L-1 (CRITICAL, 2026-07-06): the PBO<15% overfitting gate must fire on EVERY path
    // into a capital-adjacent stage (SHADOW/PAPER), not just from TESTING. VALID_TRANSITIONS still permits the
    // legacy CANDIDATE→SHADOW edge (reachable via the HMAC PATCH /:id/lifecycle route, whose secret is shared
    // with n8n/Carter automation, not human-only) — and it previously skipped PBO entirely because this guard
    // only matched fromState==="TESTING". Adding CANDIDATE closes the bypass so an overfit strategy can never
    // reach paper capital un-PBO-checked. (SHADOW→PAPER already gets the separate divergence gate.)
    if (
      (fromState === "TESTING" || fromState === "CANDIDATE") &&
      (toState === "SHADOW" || toState === "PAPER") &&
      promotionEvidence.backtestId
    ) {
      try {
        const [btExtrasPboW29] = await (tx ?? db)
          .select({ walkForwardResults: backtests.walkForwardResults })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtrasPboW29) {
          // pbo_overall lives in walkForwardResults (the WF result JSON blob).
          // Wave 29 Pass A.2 wires pbo_overall + pbo_overall_p_value into the
          // walk_forward.py return dict, which backtest-service persists here.
          const wfMeta = btExtrasPboW29.walkForwardResults as Record<string, unknown> | null | undefined;
          const pboOverall = wfMeta?.pbo_overall as number | null | undefined;
          const pboOverallPValue = wfMeta?.pbo_overall_p_value as number | null | undefined;
          // Merge 2026-06-29: adopted the phase-0 cpcv_exempt approach (proceed with an
          // explicit honest audit) over the deepscan-wiring BLOCK approach — CPCV is the
          // default WF_MODE so BLOCK-on-degenerate would strangle the whole pipeline.
          // pbo_degenerate_reason is nested inside wf_metadata (the sub-object inside
          // walkForwardResults) — walk_forward.py emits "cpcv_is_sharpe_unavailable" there
          // and backtest-service persists the wf_metadata sub-dict wholesale, so this read
          // matches the producer end-to-end (verified during merge).
          const innerWfMeta = (wfMeta?.wf_metadata as Record<string, unknown> | null) ?? null;
          const pboDegenReason = (innerWfMeta?.pbo_degenerate_reason as string | null | undefined) ?? null;

          const pboGateResult = evaluatePboGate(
            { pbo_overall: pboOverall, pbo_p_value: pboOverallPValue, pbo_degenerate_reason: pboDegenReason },
          );

          if (!pboGateResult.ok) {
            // Finding 6 fix 2026-06-29 (Track B coordination): a plain-WF degenerate PBO
            // (pbo_degenerate_reason="plain_wf_is_unavailable") must route to a DISTINCT
            // audit action so it is never conflated with the generic overfit block. The
            // pbo-gate.ts evaluator returns reason "lifecycle.pbo_plain_wf_degenerate_block"
            // for that case; the NaN sample-size guard and the real overfit block both keep
            // the canonical "lifecycle.pbo_overfit_block" action.
            const pboBlockAction =
              pboGateResult.reason === "lifecycle.pbo_plain_wf_degenerate_block"
                ? "lifecycle.pbo_plain_wf_degenerate_block"
                : "lifecycle.pbo_overfit_block";
            const pboError =
              pboBlockAction === "lifecycle.pbo_plain_wf_degenerate_block"
                ? `lifecycle.pbo_plain_wf_degenerate_block: strategy ${id} has a degenerate/unavailable ` +
                  `plain-WF PBO (plain_wf_is_unavailable) — strategy is UN-VALIDATED, block promotion to ${toState}. ` +
                  `Re-run the backtest (CPCV preferred) to produce a measurable PBO.`
                : `lifecycle.pbo_overfit_block: strategy ${id} has PBO=${pboGateResult.pbo?.toFixed(4) ?? "?"} ` +
                  `which exceeds threshold ${pboGateResult.threshold} (Wave 29 institutional gate). ` +
                  `Strategy appears overfit — block promotion to ${toState}. ` +
                  `Re-run backtest with more CPCV folds or reduce parameter search space.`;
            logger.warn(
              { strategyId: id, fromState, toState, pbo: pboGateResult.pbo, threshold: pboGateResult.threshold, reason: pboGateResult.reason, backtestId: promotionEvidence.backtestId },
              pboError,
            );
            // Emit the resolved block audit action (canonical Wave 29 overfit action OR
            // the distinct plain-WF-degenerate action per Finding 6).
            insertAuditRow({
              action: pboBlockAction,
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: pboGateResult.auditPayload as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.pbo_overfit_block audit row write failed"));
            // Emit SSE event lifecycle:pbo_evaluated
            broadcastSSE(WAVE29_EVENTS.PBO_EVALUATED, {
              correlationId: options.correlationId ?? null, // deep-scan Obs re-verify #6 F-7: WAVE29 HARD-gate SSE (manual path) carries correlationId
              strategyId: id,
              fromState,
              toState,
              pbo: pboGateResult.pbo,
              threshold: pboGateResult.threshold,
              blocked: true,
            });
            // Wave 29 prod hardening: increment Prom counter + Discord escalation
            try {
              // Wave B Fix 2: label PBO block by regime.
              // In _promoteStrategyInner we operate on strategy `id` only (no row preloaded),
              // so fetch regimeTrainedOn from DB (main's `strategy.regimeTrainedOn` is not in
              // scope in this function). Fail-open to "unknown" to keep the counter non-blocking.
              let regimeLabel = "unknown";
              try {
                const [stratRow] = await db.select({ regimeTrainedOn: strategies.regimeTrainedOn }).from(strategies).where(eq(strategies.id, id)).limit(1);
                regimeLabel = stratRow?.regimeTrainedOn ?? "unknown";
              } catch { /* non-blocking — keep "unknown" */ }
              pboBlocksTotal.labels({ regime: regimeLabel }).inc();
            } catch (_promErr) { /* non-blocking */ }
            try {
              const discordBody = appendFamilyGradePostscript(
                `PBO ${(pboGateResult.pbo ?? 0).toFixed(4)} > threshold ${pboGateResult.threshold} blocked strategy ${id} from ${fromState}→${toState}. Re-run backtest with more CPCV folds or narrower parameter search.`,
                "The bot detected that this trading strategy may have been over-tuned to historical data. Promotion was blocked to protect your account.",
                "No action needed — the bot will retry after the next backtest run.",
              );
              notifyWarning(`PBO Block: strategy ${id} ${fromState}→${toState}`, discordBody, { strategyId: id, fromState, toState, pbo: pboGateResult.pbo });
            } catch (_discordErr) { /* non-blocking */ }
            return { success: false, error: pboError };
          }

          // Legacy null or pbo passes — emit the appropriate audit action:
          //   - legacyNull=true     → genuine pre-Wave-29 backtest, no pbo_overall field
          //   - cpcv_is_unavailable → CPCV mode structural limitation (distinct from legacy)
          if (pboGateResult.legacyNull) {
            insertAuditRow({
              action: "lifecycle.pbo_unavailable_legacy",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "success",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: pboGateResult.auditPayload as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.pbo_unavailable_legacy audit row write failed"));
          } else if (pboGateResult.reason === "lifecycle.pbo_cpcv_is_unavailable") {
            // hardening/phase-0: CPCV mode — PBO structurally unavailable (not legacy missing).
            // Emit lifecycle.pbo_cpcv_is_unavailable so the audit trail distinguishes this
            // exemption from both a real PBO pass and the generic grandfather window.
            insertAuditRow({
              action: "lifecycle.pbo_cpcv_is_unavailable",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "success",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: pboGateResult.auditPayload as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.pbo_cpcv_is_unavailable audit row write failed"));
          }

          // Emit SSE event lifecycle:pbo_evaluated on every evaluation
          broadcastSSE(WAVE29_EVENTS.PBO_EVALUATED, {
            correlationId: options.correlationId ?? null, // deep-scan Obs re-verify #6 F-7: WAVE29 HARD-gate SSE (manual path) carries correlationId
            strategyId: id,
            fromState,
            toState,
            pbo: pboGateResult.pbo,
            threshold: pboGateResult.threshold,
            blocked: false,
            legacy_null: pboGateResult.legacyNull,
          });
        }
      } catch (pboW29Err) {
        // (deepscan18 D-D3 2026-07-05) FAIL-CLOSED per CLAUDE.md §12 ("there is no
        // PBO-bypass path"). Previously this catch logged a warn and CONTINUED, so any
        // read/eval error (DB blip, malformed walk_forward_results shape, evaluatePboGate
        // throw) silently BYPASSED the Wave 29 Pass A.2 PBO overfit HARD gate at
        // TESTING → SHADOW/PAPER — the exact fail-OPEN posture every sibling HARD gate on
        // this transition rejects (the B14 CI gate, DSL-guards gate, and A7 gate all
        // fail-CLOSED on infra error). Now blocks the promotion with a loud audit row +
        // Prom counter + SSE, matching the sibling gates. Additive-signal gates elsewhere
        // (BIF read-error) legitimately fail-OPEN, but PBO is a §12 HARD gate with no
        // bypass path, so an unreadable PBO must hold the strategy, not wave it through.
        const pboErrMsg = pboW29Err instanceof Error ? pboW29Err.message : String(pboW29Err);
        logger.error(
          { strategyId: id, fromState, toState, backtestId: promotionEvidence.backtestId, err: pboW29Err },
          "lifecycle.pbo_gate (Wave 29): read/eval error — BLOCKING promotion (fail-CLOSED per §12, no PBO-bypass path)",
        );
        insertAuditRow({
          action: "lifecycle.pbo_gate_error_fail_closed",
          entityType: "strategy",
          entityId: id,
          decisionAuthority: "gate",
          status: "failure",
          input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
          result: {
            reason: "pbo_gate_infrastructure_error",
            error: pboErrMsg,
            note: "PBO read/eval threw — promotion blocked fail-CLOSED (§12: no PBO-bypass path). Re-run the backtest to produce a measurable PBO, then retry.",
          } as Record<string, unknown>,
          correlationId: options.correlationId ?? null,
        }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.pbo_gate_error_fail_closed audit row write failed"));
        try {
          broadcastSSE(WAVE29_EVENTS.PBO_EVALUATED, {
            correlationId: options.correlationId ?? null, // deep-scan Obs re-verify #6 F-7: WAVE29 HARD-gate SSE (manual path) carries correlationId
            strategyId: id,
            fromState,
            toState,
            pbo: null,
            threshold: null,
            blocked: true,
            error: true,
          });
        } catch { /* non-blocking SSE */ }
        try { pboBlocksTotal.labels({ regime: "gate_error" }).inc(); } catch { /* non-blocking counter */ }
        return { success: false, error: `lifecycle.pbo_gate_error_fail_closed: ${pboErrMsg}` };
      }
    }

    // ── Wave 24 Pass 1 — Item 19: Honest DSR gate (→ PAPER) ─────────────────
    // Honest DSR (multiple-testing corrected) < threshold → block. (Item 19, W24P1)
    // Uses DSR_HONEST_THRESHOLD env (default 1.5). Old "dsr" field preserved for
    // back-compat; this gate reads dsr_honest.dsr_passed which is the honest value.
    //
    // deepscan14 H2 FIX: was `fromState === "TESTING" && toState === "PAPER"` —
    // the default ladder now reaches PAPER via SHADOW → PAPER too (Wave 29), and
    // this function (_promoteStrategyInner) runs for every promoteStrategy() call
    // regardless of fromState, so gating on fromState==="TESTING" silently skipped
    // the honest-DSR check for every shadow-routed strategy. Generalized to
    // toState==="PAPER" — the only two edges into PAPER are TESTING→PAPER (legacy)
    // and SHADOW→PAPER (canonical), so this is equivalent to explicitly listing
    // both and is consistent with the sibling archetype-gateway gate (line ~1780).
    if (toState === "PAPER" && promotionEvidence.backtestId) {
      try {
        const [btExtrasDsr] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtrasDsr?.resultExtras) {
          const extrasDsr = btExtrasDsr.resultExtras as Record<string, unknown>;
          const invariants = extrasDsr.invariants as Record<string, unknown> | undefined;
          const dsrHonest = invariants?.dsr_honest as Record<string, unknown> | undefined;

          // Only gate when dsr_honest is present and not_applicable is not set.
          if (dsrHonest && !dsrHonest.not_applicable) {
            const dsrPassed = dsrHonest.dsr_passed as boolean | undefined;
            const dsrValue = dsrHonest.dsr as number | null ?? null;
            const nTrials = dsrHonest.n_trials as number | null ?? null;
            // deepscan17-wave2 (2026-07-05): Wave-1 moved the engine DSR default to 1.645;
            // this is the audit-log MESSAGE STRING default only (the gate decision reads the
            // persisted dsr_passed boolean), kept in sync so the reason text is not misleading.
            const dsrThreshold = parseFloat(process.env.DSR_HONEST_THRESHOLD ?? "1.645");

            if (dsrPassed === false) {
              const error =
                `lifecycle.dsr_honest_blocked: strategy ${id} has honest DSR=${dsrValue?.toFixed(3) ?? "?"} ` +
                `(threshold ${dsrThreshold}, n_trials=${nTrials}). ` +
                `Multiple-testing correction reduces confidence in this edge. ` +
                `Increase OOS track record or reduce parameter search space before promoting to PAPER.`;
              logger.warn(
                { strategyId: id, fromState, toState, dsrValue, dsrThreshold, nTrials, backtestId: promotionEvidence.backtestId },
                error,
              );
              insertAuditRow({
                action: "lifecycle.dsr_honest_blocked",
                entityType: "strategy",
                entityId: id,
                decisionAuthority: "gate",
                status: "failure",
                input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
                result: {
                  reason: "honest_dsr_below_threshold",
                  dsr_honest: dsrHonest,
                  dsr_threshold: dsrThreshold,
                } as Record<string, unknown>,
                correlationId: options.correlationId ?? null,
              }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.dsr_honest_blocked audit row write failed"));
              return { success: false, error };
            }
          }
        }
      } catch (dsrErr) {
        // Non-blocking: DSR gate failure must not abort a promotion.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: dsrErr }, "lifecycle.dsr_honest_gate: read failed (non-blocking — promotion continues)");
      }
    }

    // ── A4 Frankenstein Gate: TESTING → PAPER hard block ─
    // The Frankenstein test detects lookahead / future-data bugs by checking
    // whether the strategy shows edge on shuffled/GBM data. If it does, the
    // backtester has a structural bug that invalidates all metrics.
    //
    // This is a HARD gate — not Phase 0 shadow. A failed Frankenstein test
    // blocks promotion immediately with a clear reason. No graduation required.
    //
    // Pass criteria (locked from plan):
    //   95th pct of |Sharpe| < 0.3 AND median PF in [0.85, 1.15]
    //
    // If no Frankenstein run exists yet: promotion is BLOCKED with a clear
    // message asking the operator to run the Frankenstein test first.
    // This forces the test to be run before any strategy can enter paper trading.
    //
    // F-3 context: CANDIDATE→PAPER is now INVALID (removed from VALID_TRANSITIONS).
    // CANDIDATE fast-track routes to SHADOW via backtest-service.ts, not directly
    // to PAPER. The `fromState === "CANDIDATE"` arm below is now dead code but
    // is preserved as defense-in-depth — if VALID_TRANSITIONS ever re-adds
    // CANDIDATE→PAPER, the Frankenstein gate would still apply.
    //
    // deepscan14 bonus fix (same class as A1/H2): added `fromState === "SHADOW"` —
    // this condition previously excluded SHADOW → PAPER, so curve-fit detection
    // (N-shuffle Frankenstein test, a documented CLAUDE.md §12 hard gate) never
    // ran for any strategy promoted via the canonical SHADOW ladder.
    if ((fromState === "TESTING" || fromState === "CANDIDATE" || fromState === "SHADOW") && toState === "PAPER") {
      if (promotionEvidence.backtestId) {
        try {
          const frankResult = await getLatestFrankensteinRun(promotionEvidence.backtestId);

          if (!frankResult) {
            // No Frankenstein run exists — block promotion and require the test
            const error =
              "Frankenstein gate: no completed Frankenstein test run found for this backtest. " +
              "Run POST /api/frankenstein/run before promoting to PAPER.";
            logger.warn(
              { strategyId: id, backtestId: promotionEvidence.backtestId, fromState, toState },
              error,
            );
            // Wave 23H Fix 3: audit row on every rejection path (was logger.warn only)
            insertAuditRow({
              action: "lifecycle.frankenstein_rejected",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: { decision: "missing_run", reason: "no completed Frankenstein test run found" } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((err: unknown) => logger.error({ err, strategyId: id }, "A4: missing_run audit row write failed"));
            return { success: false, error };
          }

          if (!frankResult.passed) {
            // Frankenstein test FAILED — hard block
            const error =
              `Frankenstein gate: FAILED. Strategy shows edge on randomized data — backtester likely has a lookahead bug. ` +
              `p95_sharpe=${frankResult.p95Sharpe?.toFixed(3) ?? "null"} (threshold: <0.3), ` +
              `median_pf=${frankResult.medianPf?.toFixed(3) ?? "null"} (threshold: [0.85, 1.15]). ` +
              `Run ID: ${frankResult.runId}`;
            logger.warn(
              {
                strategyId: id,
                backtestId: promotionEvidence.backtestId,
                frankRunId: frankResult.runId,
                p95Sharpe: frankResult.p95Sharpe,
                medianPf: frankResult.medianPf,
                fromState,
                toState,
              },
              "Frankenstein gate: BLOCKED promotion — strategy failed randomization detection test",
            );
            // Wave 23H Fix 3: audit row on every rejection path (was logger.warn only)
            insertAuditRow({
              action: "lifecycle.frankenstein_rejected",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: {
                fromState, toState,
                backtestId: promotionEvidence.backtestId,
                frankRunId: frankResult.runId,
              } as Record<string, unknown>,
              result: {
                decision: "failed",
                n_shuffles: frankResult.nShuffles,
                p_value_observed: frankResult.p95Sharpe,
                p_value_threshold: 0.3,
                median_pf: frankResult.medianPf,
                reason: "strategy shows edge on randomized data",
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((err: unknown) => logger.error({ err, strategyId: id }, "A4: failed audit row write failed"));
            return { success: false, error };
          }

          // Frankenstein passed — log confirmation and proceed
          logger.info(
            {
              strategyId: id,
              backtestId: promotionEvidence.backtestId,
              frankRunId: frankResult.runId,
              p95Sharpe: frankResult.p95Sharpe,
              medianPf: frankResult.medianPf,
              fromState,
              toState,
            },
            "Frankenstein gate: PASSED — promotion allowed",
          );
        } catch (frankErr) {
          // Gate failure should fail-closed: if we can't read the result, block promotion.
          // A broken Frankenstein check is safer treated as a failed gate than an open one.
          const msg = frankErr instanceof Error ? frankErr.message : String(frankErr);
          const error = `Frankenstein gate: read failed (fail-closed). Error: ${msg}`;
          logger.warn(
            { strategyId: id, backtestId: promotionEvidence.backtestId, err: frankErr },
            "Frankenstein gate: read error — blocking promotion (fail-closed)",
          );
          // Wave 23H Fix 3: audit row on every rejection path (was logger.warn only)
          insertAuditRow({
            action: "lifecycle.frankenstein_rejected",
            entityType: "strategy",
            entityId: id,
            decisionAuthority: "gate",
            status: "failure",
            input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
            result: { decision: "infrastructure_error", reason: msg } as Record<string, unknown>,
            correlationId: options.correlationId ?? null,
          }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "A4: infra_error audit row write failed"));
          return { success: false, error };
        }
      } else {
        // No backtestId in evidence — can't look up Frankenstein result.
        // Fail-closed: require a backtest before promotion.
        const error =
          "Frankenstein gate: no backtest ID found in evidence — cannot verify Frankenstein test. " +
          "Run a backtest and Frankenstein test before promoting to PAPER.";
        logger.warn({ strategyId: id, fromState, toState }, error);
        // Wave 23H Fix 3: audit row on every rejection path (was logger.warn only)
        insertAuditRow({
          action: "lifecycle.frankenstein_rejected",
          entityType: "strategy",
          entityId: id,
          decisionAuthority: "gate",
          status: "failure",
          input: { fromState, toState, backtestId: null } as Record<string, unknown>,
          result: { decision: "no_backtest_id", reason: "no backtest ID in promotion evidence" } as Record<string, unknown>,
          correlationId: options.correlationId ?? null,
        }).catch((err: unknown) => logger.error({ err, strategyId: id }, "A4: no_backtest_id audit row write failed"));
        return { success: false, error };
      }
    }

    // Pass 4.5 Track B — Archetype gateway-mode bypass gate (→ PAPER).
    // H2 fix 2026-06-28: changed fromState === "TESTING" to toState === "PAPER"
    // so SHADOW→PAPER also runs this check (previously only TESTING→PAPER did).
    // If the strategy uses an archetype: entry_indicator AND the server is configured
    // for Path B (LIVE_ORDER_GATEWAY_URL set), the strategy's compiled Pine output
    // MUST carry the canonical TF-gateway payload markers to prove the alert will be
    // routed through /api/live-order with action:"archetype_signal".
    // If the markers are absent, block promotion — the strategy would bypass the
    // in-process gate stack and fire directly to the broker without kill-switch,
    // compliance, or firm-cap protection.
    // Fail-CLOSED: if compileDualPineExport throws, block promotion.
    if (toState === "PAPER") {
      const stratCfg = (strategy.config ?? {}) as Record<string, unknown>;
      const entryIndicator = typeof stratCfg.entry_indicator === "string" ? stratCfg.entry_indicator : "";
      if (entryIndicator.startsWith("archetype:") && !process.env.LIVE_ORDER_GATEWAY_URL) {
        // B3 FIX — fail-CLOSED when LIVE_ORDER_GATEWAY_URL is unset.
        // An archetype strategy reaching PAPER without the live-order gateway configured
        // is a deploy-misconfiguration: if Pine alerts fire, they would hit /api/live-order
        // without TF-gateway markers, bypassing kill-switch/compliance/firm-cap.
        // Block until operator sets LIVE_ORDER_GATEWAY_URL.
        const blockReason =
          `archetype strategy (${entryIndicator}) cannot be promoted to PAPER: ` +
          "LIVE_ORDER_GATEWAY_URL is not configured. " +
          "Set LIVE_ORDER_GATEWAY_URL to the TF gateway endpoint before promoting archetype strategies. " +
          "Without it, Pine alerts would reach /api/live-order without TF-gateway markers and bypass kill-switch/compliance/firm-cap protection.";
        logger.warn({ strategyId: id, entryIndicator, fromState, toState }, blockReason);
        insertAuditRow({
          action: "lifecycle.archetype_gateway_env_missing",
          entityType: "strategy",
          entityId: id,
          decisionAuthority: "gate",
          status: "warn",
          input: { fromState, toState, entryIndicator } as Record<string, unknown>,
          result: { reason: blockReason, missingEnv: "LIVE_ORDER_GATEWAY_URL" } as Record<string, unknown>,
          correlationId: options.correlationId ?? null,
        }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "archetype_gateway_env_missing audit row write failed"));
        try {
          const discordBody = appendFamilyGradePostscript(
            `Strategy ${id} (${entryIndicator}) blocked from PAPER promotion — LIVE_ORDER_GATEWAY_URL is not set. ` +
            "Without the gateway URL, Pine alerts would bypass kill-switch/compliance/firm-cap protection. " +
            "Set LIVE_ORDER_GATEWAY_URL and retry the promotion.",
            "No action needed — the bot will retry when the gateway URL is configured.",
            "No action needed — the bot blocked a deploy-misconfiguration automatically.",
          );
          notifyWarning(
            `Archetype Gateway Env Missing: ${id}`,
            discordBody,
            { strategyId: id, entryIndicator, fromState, toState, correlationId: options.correlationId, missingEnv: "LIVE_ORDER_GATEWAY_URL" },
          );
        } catch { /* non-blocking */ }
        return { success: false, error: blockReason };
      } else if (entryIndicator.startsWith("archetype:") && process.env.LIVE_ORDER_GATEWAY_URL) {
        logger.info(
          { strategyId: id, entryIndicator, fromState, toState },
          "lifecycle: archetype gateway-mode bypass gate — compiling Pine to verify TF-gateway markers",
        );
        try {
          const { compileDualPineExport } = await import("./pine-export-service.js");
          // Pass gatewayOptions with literal union to satisfy GatewayOptions type.
          // The { mode: string } assertion is NOT used — GatewayOptions requires literal.
          const compileResult = (await compileDualPineExport(
            id,
            undefined,          // firmKey
            undefined,          // injectedRiskIntelligence
            false,              // persist=false (dry-run)
            options.correlationId,
            undefined,          // recipientQty
            undefined,          // recipientLabel
            undefined,          // hmacSecret
            undefined,          // accountId
            { mode: "tf_gateway" },
          )) as Record<string, unknown>;

          // Inspect combined Pine artifact content for canonical TF-gateway markers.
          // The raw DualCompilerOutput (available in memory for persist=false) carries
          // indicator_artifact.content and strategy_artifact.content. We access via
          // Record<string, unknown> cast since compileDualPineExport's TS return type
          // reshapes the success case — the compile result is cast for content inspection.
          const indicatorArtifact = compileResult?.indicator_artifact as Record<string, unknown> | null | undefined;
          const strategyArtifact = compileResult?.strategy_artifact as Record<string, unknown> | null | undefined;
          const indicatorContent = typeof indicatorArtifact?.content === "string" ? indicatorArtifact.content : "";
          const strategyContent = typeof strategyArtifact?.content === "string" ? strategyArtifact.content : "";
          const allContent = indicatorContent + "\n" + strategyContent;

          const hasActionMarker = allContent.includes('"action":"archetype_signal"');
          const archetypeKey = entryIndicator.slice("archetype:".length);
          const hasArchetypeMarker = allContent.includes(`"archetype":"${archetypeKey}"`);

          if (!hasActionMarker || !hasArchetypeMarker) {
            const missingMarkers: string[] = [];
            if (!hasActionMarker) missingMarkers.push('"action":"archetype_signal"');
            if (!hasArchetypeMarker) missingMarkers.push(`"archetype":"${archetypeKey}"`);
            const blockReason =
              `archetype strategy (${entryIndicator}) compiled Pine is missing TF-gateway markers: ${missingMarkers.join(", ")}. ` +
              "Promotion blocked to prevent gateway bypass — the alert would fire directly to the broker " +
              "without kill-switch, compliance, or firm-cap protection.";
            logger.warn({ strategyId: id, entryIndicator, fromState, toState, missingMarkers }, blockReason);
            insertAuditRow({
              action: "lifecycle.archetype_gateway_bypass_blocked",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "warn",
              input: { fromState, toState, entryIndicator } as Record<string, unknown>,
              result: { missingMarkers, reason: blockReason } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "archetype_gateway_bypass_blocked audit row write failed"));
            try {
              const discordBody = appendFamilyGradePostscript(
                `Strategy ${id} (${entryIndicator}) blocked from PAPER promotion — compiled Pine is missing TF-gateway markers: ${missingMarkers.join(", ")}. ` +
                "Track A (pine_compiler.py) must ship _build_archetype_alert_pine before this strategy can be promoted.",
                "No action needed — the bot will retry when the compiler is updated.",
                "No action needed — the bot blocked a potentially unsafe promotion automatically.",
              );
              notifyWarning(
                `Archetype Gateway Bypass Blocked: ${id}`,
                discordBody,
                { strategyId: id, entryIndicator, missingMarkers, fromState, toState, correlationId: options.correlationId },
              );
            } catch { /* non-blocking */ }
            return { success: false, error: blockReason };
          }

          logger.info(
            { strategyId: id, entryIndicator, fromState, toState },
            "lifecycle: archetype gateway-mode bypass gate PASSED — Pine markers present",
          );
        } catch (gateErr) {
          // Fail-CLOSED: if compilation fails, block promotion
          const errMsg = gateErr instanceof Error ? gateErr.message : String(gateErr);
          const blockReason = `archetype gateway-mode bypass gate: compilation failed (fail-closed). Error: ${errMsg}`;
          logger.warn({ strategyId: id, entryIndicator, fromState, toState, err: gateErr }, blockReason);
          insertAuditRow({
            action: "lifecycle.archetype_gateway_bypass_blocked",
            entityType: "strategy",
            entityId: id,
            decisionAuthority: "gate",
            status: "warn",
            input: { fromState, toState, entryIndicator } as Record<string, unknown>,
            result: { reason: blockReason, error: errMsg } as Record<string, unknown>,
            correlationId: options.correlationId ?? null,
          }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "archetype_gateway_bypass_blocked audit row write failed (compile error path)"));
          return { success: false, error: blockReason };
        }
      }
    }

    // ── (deepscan8 Track D 2026-07-02) Compliance-drift HARD block — T→P manual-path parity ──
    // The cron T→P gate (P0-1, lines ~2649-2689) blocks when any firm the strategy passes
    // compliance against has driftDetected=true. The manual PATCH path had no equivalent,
    // so a human could promote a TESTING strategy against a stale ruleset. Mirrors the
    // P→DR manual gate (lines 510-575) exactly: same shared resolver, same audit action
    // (lifecycle.promotion_blocked_compliance_drift), same fail-CLOSED try/catch for infra
    // errors (lifecycle.drift_check_infra_error + block). Uses the shared
    // resolveComplianceDriftForPromotion wrapper for exact parity.
    if (fromState === "TESTING" && toState === "PAPER") {
      const correlationIdTp = options.correlationId ?? randomUUID();
      const [latestBtTp] = await db
        .select({ propCompliance: backtests.propCompliance })
        .from(backtests)
        .where(and(eq(backtests.strategyId, id), eq(backtests.status, "completed")))
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      if (latestBtTp?.propCompliance) {
        let driftFirmsTp: string[];
        let qualifyingFirmsTp: string[];
        try {
          ({ driftFirms: driftFirmsTp, qualifyingFirms: qualifyingFirmsTp } =
            await resolveComplianceDriftForPromotion(latestBtTp.propCompliance));
        } catch (driftCheckErr) {
          const errMsg = driftCheckErr instanceof Error ? driftCheckErr.message : String(driftCheckErr);
          logger.warn(
            { strategyId: id, err: driftCheckErr },
            "TESTING → PAPER drift-check threw (manual path) — blocking promotion (fail-closed, manual override required)",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.drift_check_infra_error",
            entityId: id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState, toState },
            result: {
              reason: "drift_check_infrastructure_error",
              error: errMsg,
              note: "Manual operator override required — cannot verify compliance ruleset integrity",
            },
            correlationId: correlationIdTp,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: id, err: auditErr }, "lifecycle.drift_check_infra_error (T→P manual) audit insert failed (non-blocking)");
          });
          return { success: false, error: `drift_check_infrastructure_error: ${errMsg}` };
        }
        if (driftFirmsTp.length > 0) {
          logger.warn(
            { strategyId: id, driftFirms: driftFirmsTp, transition: "TESTING→PAPER" },
            "TESTING → PAPER blocked (manual path): compliance ruleset drift detected",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.promotion_blocked_compliance_drift",
            entityId: id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState, toState },
            result: {
              firms_with_drift: driftFirmsTp,
              qualifying_firms: qualifyingFirmsTp,
              reason: "compliance ruleset drift_detected — promotion held until human revalidation",
            },
            correlationId: correlationIdTp,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: id, err: auditErr }, "compliance-drift (T→P manual) audit insert failed (non-blocking)");
          });
          broadcastSSE(LIFECYCLE_GATE_EVENTS.COMPLIANCE_DRIFT_BLOCKED, {
            strategyId: id,
            drift_firms: driftFirmsTp,
            // deep-scan Obs re-verify F-3c: canonical camelCase key (its 4 sibling COMPLIANCE_DRIFT_BLOCKED
            // sites all emit correlationId) — one join key across all 33 lifecycle SSE broadcasts.
            correlationId: correlationIdTp,
          });
          return { success: false, error: "compliance ruleset drift_detected — promotion held until human revalidation" };
        }
      }
    }

    // ── (deepscan8 Track D 2026-07-02) Frozen-policy baseline stamp — T→P manual path ──
    // P→DR first-time freeze (deepscan7 F-2) stamps frozenPolicyHash at DEPLOY_READY gate time,
    // but by then the strategy has already spent weeks in PAPER where config may have been
    // mutated. Stamping at TESTING→PAPER means the P→DR drift check (evaluateFrozenPolicyDriftAtPromotion)
    // compares against the TRUE pre-PAPER baseline — any config change made during PAPER becomes
    // detectable. First-freeze-null tolerance at P→DR stays for legacy strategies already in PAPER.
    // Fail-CLOSED: block the manual promotion if the freeze write fails (mirrors P→DR freeze pattern).
    if (fromState === "TESTING" && toState === "PAPER") {
      const correlationIdFreeze = options.correlationId ?? randomUUID();
      let currentRegimeTp = "UNKNOWN";
      try {
        const { biasState: biasStateTable } = await import("../db/schema.js");
        const biasStateRows = await db
          .select({ regimeLabel: biasStateTable.regimeLabel })
          .from(biasStateTable)
          .limit(1)
          .catch(() => [] as { regimeLabel: string }[]);
        if (biasStateRows.length > 0 && typeof biasStateRows[0].regimeLabel === "string") {
          currentRegimeTp = biasStateRows[0].regimeLabel;
        }
      } catch {
        // Regime lookup error is non-fatal — UNKNOWN is a valid regime label.
      }

      try {
        await freezePolicyForStrategy(id, currentRegimeTp);
        logger.info(
          { strategyId: id, regime: currentRegimeTp },
          "Frozen-policy T→P baseline stamp: hash stamped successfully (manual path)",
        );
      } catch (freezeErr) {
        const freezeMsg = freezeErr instanceof Error ? freezeErr.message : String(freezeErr);
        logger.warn(
          { strategyId: id, err: freezeErr },
          "frozen_policy T→P baseline stamp failed (manual path) — blocking promotion (fail-CLOSED per CLAUDE.md §12)",
        );
        await db.insert(auditLog).values({
          action: "frozen_policy.hash_compute_failed",
          entityId: id,
          entityType: "strategy",
          status: "blocked",
          decisionAuthority: "gate",
          input: { fromState, toState },
          result: {
            error: freezeMsg,
            note: "T→P baseline freeze write failed (manual path) — promotion blocked; retry once the DB write succeeds",
          },
          correlationId: correlationIdFreeze,
        }).catch((auditErr: unknown) => {
          logger.warn({ err: auditErr, correlationId: correlationIdFreeze }, "frozen_policy.hash_compute_failed (T→P manual freeze-write) audit insert failed (non-blocking)");
          auditWriteFailuresTotal.labels({ action: "frozen_policy.hash_compute_failed" }).inc();
        });
        return { success: false, error: `frozen_policy.tp_baseline_stamp_failed: ${freezeMsg}` };
      }
    }

    // Atomic write block: state update + (optional) name retire + audit rows.
    // If a caller provided a tx we run inline against it (caller owns commit/rollback);
    // otherwise we open a fresh db.transaction() for these writes.
    const writeBlock = async (txCtx: typeof db): Promise<void> => {
      // CRITICAL #2: Add AND lifecycleState = fromState to the WHERE clause.
      // Two concurrent callers (cron + manual API) can both pass the pre-tx state read
      // and both attempt to UPDATE. With the state guard, only the first writer succeeds;
      // the second gets back an empty RETURNING array and we roll back with a conflict error.
      // F-3 Anti-orphan: shadow_mode_enabled must be set atomically with the lifecycle state
      // to prevent a window where the strategy is in SHADOW state but the signal interceptor
      // (paper-signal-service.ts) still routes to TradersPost (because it checks shadowModeEnabled,
      // not lifecycleState, for interception decisions).
      //   • toState === "SHADOW" → set shadowModeEnabled: true  (enables intercept)
      //   • fromState === "SHADOW" (exiting) → set shadowModeEnabled: false (clears intercept)
      //   • all other transitions → leave shadowModeEnabled unchanged (no explicit set)
      const shadowModeUpdate: Partial<{ shadowModeEnabled: boolean }> =
        toState === "SHADOW"
          ? { shadowModeEnabled: true }
          : fromState === "SHADOW"
            ? { shadowModeEnabled: false }
            : {};

      const updatedRows = await txCtx
        .update(strategies)
        .set({
          lifecycleState: toState,
          lifecycleChangedAt: new Date(),
          updatedAt: new Date(),
          ...shadowModeUpdate,
        })
        .where(and(eq(strategies.id, id), eq(strategies.lifecycleState, fromState)))
        .returning({ id: strategies.id });

      if (!updatedRows || updatedRows.length === 0) {
        // Another concurrent caller already transitioned this strategy out of fromState.
        // Write a race_blocked audit row for observability then throw so the transaction rolls back.
        await txCtx.insert(auditLog).values({
          action: "lifecycle.race_blocked",
          entityType: "strategy",
          entityId: id,
          input: { fromState, toState },
          result: {
            reason: "concurrent_promotion: strategy was no longer in fromState when UPDATE executed",
            actor: options.actor ?? "system",
            correlationId: options.correlationId ?? null,
          },
          status: "failure",
          decisionAuthority: "gate",
          correlationId: options.correlationId ?? null,
        });
        throw new Error(`lifecycle.race_blocked: strategy ${id} was no longer in '${fromState}' when the update executed — concurrent promotion detected`);
      }

      // Retire Forge name when strategy transitions to RETIRED.
      // Must be inside the transaction so name-retire and lifecycle update commit together.
      if (toState === "RETIRED") {
        const [retiredName] = await txCtx
          .update(strategyNames)
          .set({ retired: true, retiredAt: new Date() })
          .where(eq(strategyNames.strategyId, id))
          .returning();
        if (retiredName) {
          retiredCodename = retiredName.codename;
        }
      }

      // Audit row for the lifecycle transition itself (FIX 2: includes evidence snapshot)
      await txCtx.insert(auditLog).values({
        action: "strategy.lifecycle",
        entityType: "strategy",
        entityId: id,
        input: { fromState, toState },
        result: {
          success: true,
          actor: options.actor ?? "system",
          reason: options.reason ?? null,
          backtestId: promotionEvidence.backtestId,
          forgeScore: promotionEvidence.forgeScore,
          mcSurvivalRate: promotionEvidence.mcSurvivalRate,
        },
        status: "success",
        decisionAuthority: options.actor === "human_release" ? "human" : "gate",
        correlationId: options.correlationId ?? null,
      });

      // Tier 0.1 dual-write: typed lifecycle_transitions row alongside the
      // audit_log row. Both inserts run inside the same transaction so the
      // audit_log + lifecycle_transitions + strategy.lifecycle_state always
      // commit/roll back as a unit. Synchronous, no fire-and-forget.
      //
      // Tier 1.1 QAE shadow: quantum challenger evidence columns are now
      // populated from promotionEvidence (computed above, outside the tx).
      // Phase 0: gate behavior is 100% classical — quantum values are
      // observation-only. The partial index idx_lifecycle_transitions_quantum_agreement
      // begins filling as QMC runs accumulate for tested backtests.
      await txCtx.insert(lifecycleTransitions).values({
        strategyId: id,
        fromState,
        toState,
        decisionAuthority: options.actor === "human_release" ? "human" : "gate",
        reason: options.reason ?? null,
        backtestId: promotionEvidence.backtestId,
        forgeScore: promotionEvidence.forgeScore != null ? String(promotionEvidence.forgeScore) : null,
        mcSurvivalRate: promotionEvidence.mcSurvivalRate != null ? String(promotionEvidence.mcSurvivalRate) : null,
        // Tier 1.1 QAE shadow — populated when a completed quantum_mc_runs row exists
        // for the latest backtest. Null when no QMC run has been performed yet (expected
        // during Phase 0 ramp-up). AUTHORITY BOUNDARY: these values are advisory only.
        quantumAgreementScore: promotionEvidence.quantumAgreementScore != null
          ? String(promotionEvidence.quantumAgreementScore)
          : null,
        quantumAdvantageDelta: promotionEvidence.quantumAdvantageDelta != null
          ? String(promotionEvidence.quantumAdvantageDelta)
          : null,
        quantumFallbackTriggered: promotionEvidence.quantumFallbackTriggered,
        quantumClassicalDisagreementPct: promotionEvidence.quantumClassicalDisagreementPct != null
          ? String(promotionEvidence.quantumClassicalDisagreementPct)
          : null,
        cloudQmcRunId: null,
      });

      // Pending-burial audit row for DECLINING/RETIRED.
      // Written inside the transaction so the burial *intent* is durable even if
      // the post-commit fire-and-forget buryInGraveyard() crashes. Future replays
      // can scan for graveyard_burial_pending rows that lack a matching
      // strategy_graveyard row and re-run the burial.
      if (toState === "DECLINING" || toState === "RETIRED") {
        await txCtx.insert(auditLog).values({
          action: "strategy.graveyard_burial_pending",
          entityType: "strategy",
          entityId: id,
          input: { fromState, toState },
          result: {
            actor: options.actor ?? "system",
            reason: options.reason ?? null,
            burial_trigger: toState === "DECLINING" ? "demotion" : "retirement",
          },
          status: "pending",
          decisionAuthority: options.actor === "human_release" ? "human" : "gate",
          correlationId: options.correlationId ?? null,
        });
      }
    };

    try {
      if (tx) {
        // Caller owns the transaction — run inline, do not open a new tx.
        await writeBlock(tx);
      } else {
        // Standalone path — open a transaction. On throw, the entire unit rolls back.
        await db.transaction(async (innerTx) => {
          await writeBlock(innerTx as unknown as typeof db);
        });
      }
    } catch (writeErr) {
      // CRITICAL #2: race_blocked is a clean conflict — surface as { success: false }
      // rather than propagating an exception so callers can handle it gracefully.
      const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      if (errMsg.startsWith("lifecycle.race_blocked:")) {
        logger.warn({ strategyId: id, fromState, toState, correlationId: options.correlationId }, errMsg);
        return { success: false, error: errMsg };
      }
      // All other transaction errors propagate normally (atomicity guarantee).
      throw writeErr;
    }

    // ── Post-commit side effects ────────────────────────────────────────────
    // Everything below this line runs ONLY after the transaction commits
    // successfully. SSE/fire-and-forget burial NEVER fires on rollback.

    // F-1 Capital Safety Fix: Invalidate the in-memory paper-session cache for
    // this strategy whenever shadow_mode_enabled changes.
    //
    // The sessionCache in paper-signal-service.ts has no TTL and is keyed by
    // sessionId.  If an active session was cached BEFORE this transition, it
    // carries a stale CachedSession.shadowModeEnabled value:
    //   • Stale false after →SHADOW  → next signal executes as a real TradersPost
    //     order instead of being shadow-intercepted.  CAPITAL SAFETY BUG.
    //   • Stale true after SHADOW→   → next signal is intercepted after the
    //     strategy left SHADOW.  Missed trade; operator confusion.
    //
    // Eviction forces a DB reload of shadowModeEnabled on the next signal.
    //
    // Fail-soft: a cache-eviction error must NEVER block/abort the lifecycle
    // transition — it is wrapped in try/catch and only logged as a warning.
    //
    // Dynamic import avoids a static top-level import of paper-signal-service.ts
    // from lifecycle-service.ts, which would create a circular dependency risk at
    // production boot (paper-signal-service.ts already depends on lifecycle logic
    // indirectly through schema + audit helpers).
    if (toState === "SHADOW" || fromState === "SHADOW") {
      try {
        const { invalidateSessionCacheForStrategy } = await import("./paper-signal-service.js");
        invalidateSessionCacheForStrategy(id);
        logger.info(
          { strategyId: id, fromState, toState },
          "F-1: shadow_mode_enabled changed — paper session cache invalidated for strategy",
        );
      } catch (cacheInvalidateErr) {
        logger.warn(
          { strategyId: id, fromState, toState, err: cacheInvalidateErr },
          "F-1: paper session cache invalidation failed (fail-soft — lifecycle transition already committed)",
        );
      }
    }

    if (retiredCodename) {
      logger.info({ strategyId: id, codename: retiredCodename }, "Forge name retired with strategy");
    }

    // F-11 FIX: Only bury on truly terminal states (GRAVEYARD, RETIRED).
    // DECLINING is retry-eligible per VALID_TRANSITIONS (DECLINING → TESTING/RETIRED/GRAVEYARD)
    // and must NOT be buried — burial here would create a graveyard record for a strategy
    // that may still be promoted via checkDeclingAndTriggerRegen(). Burial on DECLINING
    // was causing premature graveyard records that blocked re-entry into TESTING.
    if (toState === "GRAVEYARD" || toState === "RETIRED") {
      this.buryInGraveyard(id, strategy, options.correlationId).catch((buryErr) => {
        logger.warn(
          { strategyId: id, toState, err: buryErr },
          "Failed to auto-bury strategy in graveyard (non-blocking — pending audit row exists)",
        );
      });
    }

    // ── Tier 4.5 cloud QMC enrichment: enqueue AFTER TESTING→PAPER promotion ──
    // Phase 0 shadow: enqueue is ALWAYS async and NEVER blocks promotion.
    // Classical promotion is already committed above. This fire-and-forget runs
    // best-effort, 24h enrichment window. Promotion decision is UNCHANGED.
    //
    // AUTHORITY BOUNDARY:
    //   - Classical promotion completes FIRST (already committed above).
    //   - enqueueCloudQmcRun() is fire-and-forget: promotion NEVER waits.
    //   - cloud_qmc_runs.governance_labels.decision_role = "challenger_only"
    //   - Lifecycle gate is 100% classical. Cloud QMC is observation-only.
    //   - Matches W3b Tier 3.4 Grover shadow pattern (same post-commit placement).
    //
    // Default OFF: QUANTUM_CLOUD_ENABLED env flag must be "true" to enable IBM
    // submissions. Without the flag, enqueueCloudQmcRun logs and returns quietly.
    if (fromState === "TESTING" && toState === "PAPER") {
      const cloudQmcEnabled = (process.env.QUANTUM_CLOUD_ENABLED ?? "").toLowerCase() === "true";
      if (cloudQmcEnabled) {
        import("./cloud-qmc-service.js").then(({ enqueueCloudQmcRun }) => {
          enqueueCloudQmcRun({
            strategyId: id,
            backtestId: promotionEvidence.backtestId ?? "",
            classicalRuinProb: promotionEvidence.mcSurvivalRate != null
              ? 1 - promotionEvidence.mcSurvivalRate
              : null,
            localIaeEstimate: promotionEvidence.quantumAgreementScore,
          }).catch((cloudErr) => {
            logger.warn(
              { strategyId: id, err: cloudErr },
              "cloud-qmc: enqueueCloudQmcRun failed (non-blocking — promotion unaffected, Phase 0 shadow)",
            );
          });
        }).catch((importErr) => {
          logger.warn(
            { strategyId: id, err: importErr },
            "cloud-qmc: service import failed (non-blocking — promotion unaffected)",
          );
        });
        logger.info(
          { strategyId: id, fromState, toState },
          "cloud-qmc: async enrichment enqueued post-promotion (challenger-only, Phase 0 shadow, never blocks)",
        );
      } else {
        logger.debug(
          { strategyId: id, fromState, toState },
          "cloud-qmc: QUANTUM_CLOUD_ENABLED=false — IBM enrichment skipped, promotion unaffected",
        );
      }
    }

    // B6 FIX — Pass 5 Track D.2: Stop internal stream on TESTING→PAPER (paper-engine authority)
    // The canonical paper-trade journal for PAPER+ strategies is TradersPost's broker tape.
    // The internal Massive-WS simulator is pre-PAPER only (CANDIDATE/TESTING).
    //
    // RACE FIX (B6): stopStream MUST complete before transitionState() returns.
    // The old fire-and-forget IIFE let a bar arrive between DB-commit and stream-stop,
    // emitting internal-simulator fills under a now-PAPER-state strategy → dual-stream
    // corruption with TradersPost. B5 (scheduler resume guard) prevents the stream from
    // restarting, but the gap before stop was still live.
    //
    // Contract post-B6:
    //   1. await stopStream — synchronous in the transition path, guarantees no new fills
    //   2. Audit + Discord notifications fire AFTER stop (observability, not state)
    //   3. If stopStream throws → audit paper.stop_stream_failed_on_transition (warn) but
    //      DO NOT block the transition — strategy IS in PAPER state in DB; the stream
    //      not stopping is smaller than dual-stream corruption from not awaiting.
    //
    // deepscan14 A1 FIX: was `fromState === "TESTING" && toState === "PAPER"` — the
    // default ladder now reaches PAPER via SHADOW → PAPER too (Wave 29), and the
    // internal Massive-WS sim stream stays alive through SHADOW (it's how shadow
    // signals get generated). Gating this on fromState==="TESTING" only meant
    // SHADOW → PAPER never stopped the stream, so it kept writing fills into
    // paper_positions/paper_trades after TradersPost became the live journal —
    // dual-stream P&L corruption. Generalized to toState==="PAPER" to mirror the
    // sibling H2 fix already at the archetype-gateway gate above (line ~1780).
    if (toState === "PAPER") {
      let activeSessId: string | null = null;
      let streamStopped = false;
      try {
        const { stopStream } = await import("./paper-trading-stream.js");
        // Find any active session for this strategy
        const [activeSess] = await db.select({ id: paperSessions.id })
          .from(paperSessions)
          .where(and(eq(paperSessions.strategyId, id), eq(paperSessions.status as unknown as typeof paperSessions.status, "active" as any)))
          .limit(1)
          .catch(() => [] as { id: string }[]);

        activeSessId = activeSess?.id ?? null;
        if (activeSessId) {
          // B6: await stopStream — must complete before returning to caller
          await stopStream(activeSessId);
          streamStopped = true;
          logger.info({ strategyId: id, sessionId: activeSessId }, "TESTING→PAPER: stopped internal stream (paper-engine authority declared)");
        }
      } catch (streamStopErr) {
        // B6: swallow stop failure but audit it — strategy IS already PAPER in DB.
        // Dual-stream may still occur if the simulator is alive, but this is a smaller
        // risk than blocking the lifecycle transition for the caller.
        const stopErrMsg = streamStopErr instanceof Error ? streamStopErr.message : String(streamStopErr);
        logger.warn({ strategyId: id, sessionId: activeSessId, err: streamStopErr }, "TESTING→PAPER: stopStream threw — stream may still be running (paper.stop_stream_failed_on_transition)");
        // Audit write is fire-and-forget (observability only)
        db.insert(auditLog).values({
          action: "paper.stop_stream_failed_on_transition",
          entityId: id, entityType: "strategy", status: "warn",
          decisionAuthority: "system",
          input: { fromState, toState, sessionId: activeSessId },
          result: { error: stopErrMsg, transitioned_to: "PAPER", stream_stopped: false },
          correlationId: options.correlationId ?? null,
        }).catch((e) => { logger.warn({ err: e }, "paper.stop_stream_failed_on_transition audit failed (non-blocking)"); });
      }
      // Audit + observability notifications are fire-and-forget (after stopStream completes)
      db.insert(auditLog).values({
        action: "paper.engine_authority_declared",
        entityId: id, entityType: "strategy", status: "info",
        decisionAuthority: "system",
        input: { fromState, toState },
        result: { strategyId: id, transitioned_to: "PAPER", stream_stopped: streamStopped, session_id: activeSessId },
        correlationId: options.correlationId ?? null,
      }).catch((e) => { logger.warn({ err: e }, "paper.engine_authority_declared audit failed (non-blocking)"); });
    }

    strategyPromotions.labels({
      from_state: fromState,
      to_state: toState,
      actor: options.actor ?? "system",
    }).inc();

    logger.info({ id, fromState, toState }, "Strategy lifecycle transition");
    return { success: true };
  }

  /**
   * Bury a retired strategy in the graveyard for duplicate-checking.
   * Loads the latest backtest, extracts failure modes, inserts graveyard row.
   */
  private async buryInGraveyard(
    strategyId: string,
    strategy: { name: string; config: unknown },
    correlationId?: string,
  ): Promise<void> {
    // Check if already buried (idempotent)
    const [existing] = await db
      .select({ id: strategyGraveyard.id })
      .from(strategyGraveyard)
      .where(eq(strategyGraveyard.strategyId, strategyId))
      .limit(1);
    if (existing) return;

    // Fetch latest completed backtest for failure analysis
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    // Derive failure modes from metrics
    const failureModes: string[] = [];
    if (latestBt) {
      const sharpe = Number(latestBt.sharpeRatio ?? 0);
      const pf = Number(latestBt.profitFactor ?? 0);
      const wr = Number(latestBt.winRate ?? 0);
      const dd = Number(latestBt.maxDrawdown ?? 0);
      const avgDaily = Number(latestBt.avgDailyPnl ?? 0);

      if (sharpe < 0.8) failureModes.push("low_sharpe");
      if (pf < 1.0) failureModes.push("unprofitable");
      if (wr < 0.4) failureModes.push("low_win_rate");
      if (dd > 3000) failureModes.push("excessive_drawdown");
      if (avgDaily < 250) failureModes.push("below_minimum_daily_pnl");
      if (latestBt.tier === "REJECTED") failureModes.push("rejected_by_gate");
    }
    if (failureModes.length === 0) failureModes.push("alpha_decay");

    const backtestSummary = latestBt
      ? {
          sharpe: latestBt.sharpeRatio,
          profitFactor: latestBt.profitFactor,
          winRate: latestBt.winRate,
          maxDrawdown: latestBt.maxDrawdown,
          avgDailyPnl: latestBt.avgDailyPnl,
          tier: latestBt.tier,
          totalTrades: latestBt.totalTrades,
        }
      : null;

    await db.insert(strategyGraveyard).values({
      strategyId,
      name: strategy.name,
      dslSnapshot: strategy.config ?? {},
      failureModes,
      failureDetails: { backtestId: latestBt?.id ?? null, autoAnalysis: true },
      backtestSummary,
      deathReason: `Auto-retired: ${failureModes.join(", ")}`,
      deathDate: new Date(),
      source: "auto",
    });

    // Audit trail — graveyard burial is a non-reversible terminal transition
    // Track A F-6: migrated to insertAuditRowSafe
    await insertAuditRowSafe({
      action: "strategy.graveyard_burial",
      entityType: "strategy",
      entityId: strategyId,
      input: {
        name: strategy.name,
        source: "auto",
        failureModes,
      },
      result: {
        deathReason: `Auto-retired: ${failureModes.join(", ")}`,
        backtestId: latestBt?.id ?? null,
        backtestSummary,
      },
      status: "success",
      decisionAuthority: "gate",
      correlationId: correlationId ?? null,
    });

    // Fire alert for visibility
    // H3 fix 2026-06-28: replaced bare .catch(() => {}) with logger.error so
    // DB-write failures are visible in logs.  Fire-and-forget semantic preserved
    // (no re-throw; strategy retirement continues regardless).
    AlertFactory.decayAlert(strategyId, "retire").catch((err: unknown) =>
      logger.error(
        { err, strategyId, context: "decay-alert-db-write" },
        "AlertFactory.decayAlert failed — alert not persisted",
      )
    );

    logger.info(
      { strategyId, failureModes, name: strategy.name },
      "Strategy auto-buried in graveyard",
    );

    // deepscan18 (E-E1): the frontend has carried a `strategy:graveyard_burial`
    // dashboard tile (useSSE.ts) since it was catalogued, but this — the ONLY
    // production call site of buryInGraveyard() — never actually broadcast it.
    // The tile was dead: correctly typed, correctly subscribed, never fired.
    // Payload matches the pre-existing StrategyGraveyardBurialData contract
    // (Trading_forge_frontend/.../types/sse-events.ts) exactly.
    broadcastSSE("strategy:graveyard_burial", {
      strategyId,
      name: strategy.name,
      failureModes,
      deathReason: `Auto-retired: ${failureModes.join(", ")}`,
      correlationId: correlationId ?? null,
    });
  }

  /**
   * Check for auto-promotions across all lifecycle gates:
   *   1. CANDIDATE → TESTING  (backtest + WF + tier + forgeScore)
   *   2. TESTING → PAPER      (MC survival + tier)
   *   3. PAPER → DEPLOY_READY (30 profitable days + rolling Sharpe)
   *
   * DEPLOY_READY → DEPLOYED is ALWAYS manual. The system NEVER auto-deploys.
   */
  async checkAutoPromotions(context?: { correlationId?: string }): Promise<string[]> {
    const correlationId = context?.correlationId ?? null;
    // FIX 2: Generate a per-tick correlationId so all gate evaluations in this
    // cron cycle share a single reconstructable trace root.
    const tickCorrelationId = correlationId ?? randomUUID();

    // HIGH #13: killSwitch is the FIRST gate on every lifecycle-mutating entry path.
    // CLAUDE.md §12 mandates this; lifecycle mutations are entry paths.
    if (await killSwitch.isHaltedForProduction()) {
      logger.warn({ correlationId, fn: "checkAutoPromotions" }, "Skipping — killSwitch halted");
      return [];
    }

    const promoted: string[] = [];

    // ──────────────────────────────────────────────────────────────
    // Gate 1: CANDIDATE → TESTING
    // Requires: completed backtest with walk-forward, non-REJECTED tier, forgeScore >= 50
    // ──────────────────────────────────────────────────────────────
    const candidates = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "CANDIDATE"));

    for (const s of candidates) {
      try {
        // Find latest completed backtest
        const [latestBt] = await db
          .select()
          .from(backtests)
          .where(
            and(
              eq(backtests.strategyId, s.id),
              eq(backtests.status, "completed"),
            ),
          )
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (!latestBt) continue;
        if (!latestBt.walkForwardResults) continue;

        const tier = latestBt.tier;
        // TRANSIENT: no tier data yet — skip without counting toward burial
        if (!tier) continue;
        // HARD: strategy was explicitly scored and rejected
        if (tier === "REJECTED") {
          await this._maybeAutoGraveyard(s.id, "tier_rejected", { tier }, "CANDIDATE", correlationId);
          continue;
        }
        // Gate passed — reset consecutive counter
        this._resetHardGateCounter(s.id, "tier_rejected", correlationId);

        const forgeScore = s.forgeScore ? parseFloat(String(s.forgeScore)) : 0;
        if (forgeScore < 50) {
          await this._maybeAutoGraveyard(s.id, "forge_score_below_floor", { forgeScore, floor: 50 }, "CANDIDATE", correlationId);
          continue;
        }
        // Gate passed — reset consecutive counter
        this._resetHardGateCounter(s.id, "forge_score_below_floor", correlationId);

        const result = await this.promoteStrategy(s.id, "CANDIDATE", "TESTING", { correlationId: correlationId ?? undefined });
        if (result.success) {
          promoted.push(s.id);

          // H1/H2/H3 (2026-06-29): flag for the SHADOW path. The canonical ladder is
          // CANDIDATE → TESTING → SHADOW → PAPER; every strategy entering TESTING via the
          // autonomous cron is destined for SHADOW (skew measurement) before PAPER. Setting
          // shadowModeEnabled here makes Gate 1.5 (TESTING → SHADOW) the sole driver and
          // makes Gate 2 (legacy TESTING → PAPER) skip these strategies — preventing the
          // dual-driver race. Mirrors the backtest-service fast-track which also flags it.
          await db.update(strategies).set({ shadowModeEnabled: true }).where(eq(strategies.id, s.id)).catch((flagErr) => {
            logger.warn({ strategyId: s.id, err: flagErr }, "Gate 1: shadowModeEnabled flag set failed (non-blocking — Gate 1.5 keys on it)");
          });

          broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTED, {
            correlationId, // deep-scan Obs re-verify F-3: SSE promotion event must carry correlationId (audit row does)
            strategyId: s.id,
            from: "CANDIDATE",
            to: "TESTING",
            name: s.name,
            forgeScore,
            tier,
          });

          // Mirror onto the typed agent event bus so cross-domain subscribers fire.
          // Existing SSE consumers are unaffected (additive).
          agentCoordinator.emit("strategy:promoted", {
            strategyId: s.id,
            from: "CANDIDATE",
            to: "TESTING",
          }).catch((emitErr) => {
            logger.warn({ strategyId: s.id, err: emitErr }, "agentCoordinator emit failed (non-blocking)");
          });

          logger.info(
            { id: s.id, forgeScore, tier },
            "Auto-promoted CANDIDATE → TESTING",
          );
        }
      } catch (err) {
        logger.error({ strategyId: s.id, err }, "Error checking CANDIDATE → TESTING promotion");
      }
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 1.5: TESTING → SHADOW  (H1/H2/H3, 2026-06-29)
    // The single canonical driver for the TESTING → SHADOW hop. Keyed on
    // shadowModeEnabled=true (set by the backtest-service fast-track AND Gate 1
    // above). promoteStrategy(TESTING → SHADOW) fires the existing Wave 29 Pass A.2
    // PBO < 0.15 hard gate — a PBO block HOLDS the strategy at TESTING (it is NOT
    // silently promoted) and this driver retries on the next tick once a fresh
    // backtest clears PBO. This closes the orphan TESTING → SHADOW transition (no
    // driver previously performed it) and routes the default autonomous path through
    // BOTH Wave 29 hard gates (PBO here, SHADOW → PAPER divergence at Gate 2.5).
    // The optimistic WHERE lifecycleState=fromState guard inside promoteStrategy is the
    // final backstop against any double-drive with the in-process fast-track hop.
    // ──────────────────────────────────────────────────────────────
    const testingShadowStrategies = await db
      .select()
      .from(strategies)
      .where(
        and(
          eq(strategies.lifecycleState, "TESTING"),
          eq(strategies.shadowModeEnabled, true),
        ),
      );

    for (const s of testingShadowStrategies) {
      try {
        const shadowResult = await this.promoteStrategy(s.id, "TESTING", "SHADOW", { correlationId: correlationId ?? undefined });
        if (shadowResult.success) {
          promoted.push(s.id);
          broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTED, {
            correlationId, // deep-scan Obs re-verify F-3: SSE promotion event must carry correlationId (audit row does)
            strategyId: s.id,
            from: "TESTING",
            to: "SHADOW",
            name: s.name,
          });
          logger.info({ id: s.id }, "Auto-promoted TESTING → SHADOW (Gate 1.5)");
        } else {
          // Non-success is the expected outcome on a PBO block — promoteStrategy's PBO
          // gate already wrote lifecycle.pbo_overfit_block audit + lifecycle:pbo_evaluated
          // SSE. Strategy stays at TESTING; retried next tick after re-backtest.
          logger.info(
            { id: s.id, reason: shadowResult.error },
            "TESTING → SHADOW held (Gate 1.5) — PBO block or transient; will retry",
          );
        }
      } catch (err) {
        logger.error({ strategyId: s.id, err }, "Error checking TESTING → SHADOW promotion (Gate 1.5)");
      }
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 2: TESTING → PAPER  (LEGACY path — shadowModeEnabled=false only)
    // Requires: completed backtest with WF, MC survival > 0.70, non-REJECTED tier
    // Prop compliance is checked if data exists but does NOT block if absent
    //
    // H1/H2/H3 (2026-06-29): shadowModeEnabled=true strategies are routed exclusively
    // through Gate 1.5 (TESTING → SHADOW). They are SKIPPED here so the legacy direct
    // TESTING → PAPER edge never double-drives a strategy already destined for SHADOW.
    // This is the deterministic routing the VALID_TRANSITIONS TESTING comment describes
    // ("SHADOW vs PAPER depending on whether shadow_mode_enabled=true").
    // ──────────────────────────────────────────────────────────────
    const testingStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "TESTING"));

    for (const s of testingStrategies) {
      try {
        // H1/H2/H3: skip shadow-destined strategies — Gate 1.5 owns them.
        if (s.shadowModeEnabled) continue;
        // Find latest completed backtest with walk-forward
        const [latestBt] = await db
          .select()
          .from(backtests)
          .where(
            and(
              eq(backtests.strategyId, s.id),
              eq(backtests.status, "completed"),
            ),
          )
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (!latestBt) continue;
        if (!latestBt.walkForwardResults) continue;

        const tier = latestBt.tier;
        if (!tier || tier === "REJECTED") continue;

        // HIGH #14: Backtest staleness gate — TESTING → PAPER auto-check path.
        // Default BACKTEST_STALENESS_DAYS=30; env-configurable.
        {
          const stalenessDays = parseInt(process.env.BACKTEST_STALENESS_DAYS ?? "30", 10);
          const ageMs = Date.now() - new Date(latestBt.createdAt).getTime();
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          if (ageDays > stalenessDays) {
            logger.warn({ strategyId: s.id, ageDays: ageDays.toFixed(1), stalenessDays }, "TESTING → PAPER blocked (auto-check): backtest too old");
            await db.insert(auditLog).values({
              action: "lifecycle.backtest_stale",
              entityType: "strategy",
              entityId: s.id,
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: {
                reason: "backtest_too_old",
                age_days: parseFloat(ageDays.toFixed(1)),
                limit_days: stalenessDays,
                backtest_created_at: latestBt.createdAt,
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.backtest_stale auto-check audit insert failed (non-blocking)");
            });
            broadcastSSE(LIFECYCLE_GATE_EVENTS.BACKTEST_STALE, {
              strategyId: s.id,
              age_days: parseFloat(ageDays.toFixed(1)),
              limit_days: stalenessDays,
              correlationId: correlationId,
            });
            continue;
          }
        }

        // Check MC survival rate > 0.70
        const [mcRun] = await db
          .select({
            probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
          })
          .from(monteCarloRuns)
          .where(eq(monteCarloRuns.backtestId, latestBt.id))
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1);

        if (!mcRun) continue;

        const ruinProb = mcRun.probabilityOfRuin != null ? parseFloat(String(mcRun.probabilityOfRuin)) : null;
        if (ruinProb === null) continue;

        const survivalRate = 1 - ruinProb;
        if (survivalRate <= 0.70) {
          logger.debug(
            { id: s.id, survivalRate: survivalRate.toFixed(3) },
            "TESTING → PAPER blocked: MC survival rate <= 0.70",
          );
          await this._maybeAutoGraveyard(s.id, "mc_survival_below_floor", { survivalRate, floor: 0.70 }, "TESTING", tickCorrelationId);
          continue;
        }
        // Gate passed — reset consecutive counter
        this._resetHardGateCounter(s.id, "mc_survival_below_floor", tickCorrelationId);

        // Prop compliance: check backtests.propCompliance if present, but don't block if absent
        // The propCompliance field is a per-firm results blob set during backtest
        if (latestBt.propCompliance) {
          const propResults = latestBt.propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
          const anyPassing = Object.values(propResults).some(
            (r) => r.passed === true || r.pass === true,
          );
          if (!anyPassing) {
            logger.debug(
              { id: s.id },
              "TESTING → PAPER blocked: no passing prop compliance result",
            );
            continue;
          }
        }
        // If propCompliance is null/undefined, skip this check — don't block on missing optional data

        // ── (deepscan8 Track D 2026-07-02) P0-1: Compliance-drift gate — parity upgrade ──
        // Upgraded from the older findFirmsWithComplianceDrift direct call to the shared
        // resolveComplianceDriftForPromotion wrapper (same underlying logic, same audit
        // action). Added explicit try/catch so infra errors emit lifecycle.drift_check_infra_error
        // instead of silently falling through to the outer catch with a generic log.
        // Mirrors the P→DR cron implementation (lines 3679-3736) exactly.
        try {
          if (latestBt.propCompliance) {
            const { driftFirms, qualifyingFirms } = await resolveComplianceDriftForPromotion(latestBt.propCompliance);
            if (driftFirms.length > 0) {
              logger.warn(
                { strategyId: s.id, driftFirms, transition: "TESTING→PAPER" },
                "TESTING → PAPER blocked (cron path): compliance ruleset drift detected",
              );
              await db.insert(auditLog).values({
                action: "lifecycle.promotion_blocked_compliance_drift",
                entityId: s.id,
                entityType: "strategy",
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "TESTING", toState: "PAPER" },
                result: {
                  firms_with_drift: driftFirms,
                  qualifying_firms: qualifyingFirms,
                  reason: "compliance ruleset drift_detected — promotion held until human revalidation",
                },
                correlationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "compliance-drift (T→P cron) audit insert failed (non-blocking)");
              });
              broadcastSSE(LIFECYCLE_GATE_EVENTS.COMPLIANCE_DRIFT_BLOCKED, {
                strategyId: s.id,
                drift_firms: driftFirms,
                correlationId: correlationId,
              });
              continue;
            }
          }
        } catch (driftCheckErrTp) {
          const errMsg = driftCheckErrTp instanceof Error ? driftCheckErrTp.message : String(driftCheckErrTp);
          logger.warn(
            { strategyId: s.id, err: driftCheckErrTp, transition: "TESTING→PAPER" },
            "TESTING → PAPER drift-check threw (cron path) — blocking promotion (fail-closed)",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.drift_check_infra_error",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "TESTING", toState: "PAPER" },
            result: {
              reason: "drift_check_infrastructure_error",
              error: errMsg,
              note: "Cron will retry next tick once the underlying error is resolved",
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.drift_check_infra_error (T→P cron) audit insert failed (non-blocking)");
          });
          continue;
        }

        // P0-2 part 2: Compliance gate at promotion time. The same
        // compliance_gate.py module that runs at every paper-execution bar
        // also runs here, giving us belt-and-suspenders protection: a
        // strategy that fails the freshness/violation check must never reach
        // PAPER even if a 6h scheduler tick catches up before the per-bar
        // gate. Drift gate above already filters on driftDetected; this
        // gate adds the freshness window check and surfaces "no_ruleset"
        // cases that the drift gate silently lets through.
        {
          const passingFirmNames = passingFirmNamesFromCompliance(latestBt.propCompliance);
          if (passingFirmNames.length > 0) {
            try {
              const { firmsFailing, details } = await runComplianceGateForFirms(passingFirmNames);
              if (firmsFailing.length > 0) {
                logger.warn(
                  { strategyId: s.id, firmsFailing, details, transition: "TESTING→PAPER" },
                  "TESTING → PAPER blocked: compliance gate (freshness) failed",
                );
                await db.insert(auditLog).values({
                  action: "strategy.lifecycle.compliance_blocked",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "TESTING", toState: "PAPER" },
                  result: {
                    firms_failing: firmsFailing,
                    qualifying_firms: passingFirmNames,
                    details,
                    reason: "compliance_gate.check_freshness failed — promotion held until ruleset is fresh and violation-free",
                  },
                  correlationId,
                }).catch((auditErr: unknown) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "compliance_blocked audit insert failed (non-blocking)");
                });
                broadcastSSE("strategy:compliance_blocked", {
                  strategyId: s.id,
                  name: s.name,
                  fromState: "TESTING",
                  toState: "PAPER",
                  firmsFailing,
                  details,
                  correlationId,
                });
                continue;
              }
            } catch (gateErr) {
              // Subprocess infrastructure failure (not a per-firm fail) —
              // fail closed, mirror runComplianceGateForFirms's posture.
              logger.error(
                { strategyId: s.id, err: gateErr, transition: "TESTING→PAPER" },
                "TESTING → PAPER blocked: compliance gate threw at the wrapper level",
              );
              await db.insert(auditLog).values({
                action: "strategy.lifecycle.compliance_blocked",
                entityId: s.id,
                entityType: "strategy",
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "TESTING", toState: "PAPER" },
                result: {
                  qualifying_firms: passingFirmNames,
                  reason: "compliance_gate wrapper threw",
                  error: gateErr instanceof Error ? gateErr.message : String(gateErr),
                },
                correlationId,
              }).catch((auditErr: unknown) => {
                // Deep-scan #5 H3 (2026-06-29): was silently swallowed — a gate-BLOCK decision
                // dropped with zero visibility if the DB was under pressure.
                logger.warn({ err: auditErr, correlationId }, "compliance_gate_error audit insert failed (non-blocking)");
                auditWriteFailuresTotal.labels({ action: "lifecycle.compliance_gate_error" }).inc();
              });
              broadcastSSE("strategy:compliance_blocked", {
                strategyId: s.id,
                name: s.name,
                fromState: "TESTING",
                toState: "PAPER",
                error: gateErr instanceof Error ? gateErr.message : String(gateErr),
                correlationId,
              });
              continue;
            }
          }
        }

        // C4: Survival score gate — require survival_score >= 60 before TESTING → PAPER.
        // The survival scorer (survival_scorer.py) measures prop-firm survivability across
        // 7 dimensions (daily breach prob, DD breach, consistency, recovery, worst month,
        // commission drag, eval speed). A strategy that looks profitable in backtests but
        // has poor survival characteristics will breach firm rules in live trading.
        // Score < 60 means the strategy is likely to hit daily loss limits or DD limits.
        //
        // Read source: backtests.gateResult (JSONB) — populated by backtest-service.ts:358
        // from the Python run_backtest result.gate_result. The Python contract is:
        //   { score, passed, components: { raw_survival_score, survival_optimizer, ... },
        //     crisis_veto, crisis_veto_reason, tier, gate_rejections }
        // (Pre-fix this read targeted backtests.forgeScore which is a numeric column,
        //  so `typeof === "object"` was always false and this entire gate was dead code.)
        const gateResult = latestBt.gateResult as Record<string, unknown> | null | undefined;
        if (gateResult && typeof gateResult === "object") {
          const components = (gateResult.components as Record<string, number> | undefined) ?? undefined;
          // Python emits `raw_survival_score` (the unscaled 0-100 score) in components.
          // The C4 gate operates on the raw score, NOT the weighted survival_optimizer
          // sub-score. Falls back to legacy `survival_score` key for forward-compat.
          const rawSurvivalScore = components?.raw_survival_score ?? components?.survival_score ?? null;
          if (rawSurvivalScore !== null && rawSurvivalScore < 60) {
            logger.debug(
              { id: s.id, rawSurvivalScore },
              "TESTING → PAPER blocked: survival-score-below-threshold",
            );
            // Audit the block reason explicitly
            await db.insert(auditLog).values({
              action: "strategy.lifecycle.blocked",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              result: {
                reason: "survival-score-below-threshold",
                survival_score: rawSurvivalScore,
                minimum_required: 60,
                from: "TESTING",
                to: "PAPER",
              },
              correlationId,
            });
            await this._maybeAutoGraveyard(s.id, "survival_score_below_threshold", { rawSurvivalScore, floor: 60 }, "TESTING", tickCorrelationId);
            continue;
          }
          // Gate passed (rawSurvivalScore >= 60) — reset consecutive counter
          if (rawSurvivalScore !== null) {
            this._resetHardGateCounter(s.id, "survival_score_below_threshold", tickCorrelationId);
          }
        } else {
          // Permissive fallback: legacy backtests written before gateResult was persisted
          // do not have survival-score data. Let the strategy advance, but emit a structured
          // warning + audit row so the gap is queryable and replayable. Once gateResult
          // backfill catches up, this branch should rarely fire.
          logger.warn(
            { strategyId: s.id, backtestId: latestBt.id },
            "TESTING → PAPER: survival-score-gate-missing-data (gateResult absent on latest backtest, defaulting to permissive)",
          );
          await db.insert(auditLog).values({
            action: "survival-score-gate-missing-data",
            entityId: s.id,
            entityType: "strategy",
            status: "success",
            decisionAuthority: "gate",
            input: { fromState: "TESTING", toState: "PAPER" },
            result: {
              backtestId: latestBt.id,
              note: "gateResult JSONB missing on latest backtest — survival-score gate skipped, promotion proceeded",
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "survival-score-gate-missing-data audit insert failed (non-blocking)");
          });
        }

        // H2: Pine exportability pre-check (G6.3 wiring) — BLOCKING.
        // A strategy that cannot be exported to Pine cannot be deployed to TradingView,
        // so promoting it to PAPER would create a stuck DEPLOY_READY downstream.
        // Block the promotion, audit the block, broadcast SSE so the frontend surfaces it.
        let exportabilityBlocked = false;
        try {
          const { checkExportability } = await import("./pine-export-service.js");
          const exportCheck = await checkExportability(s.id);
          if (!exportCheck.ok) {
            logger.warn({
              strategyId: s.id,
              score: exportCheck.score,
              band: exportCheck.band,
              deductions: exportCheck.deductions,
              reasons: (exportCheck as Record<string, unknown>).reasons,
            }, "TESTING→PAPER: BLOCKED — strategy has Pine exportability issues");

            // Durable audit row so the block is queryable and replayable
            await db.insert(auditLog).values({
              action: "strategy.lifecycle.exportability_blocked",
              entityType: "strategy",
              entityId: s.id,
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: {
                reasons: (exportCheck as Record<string, unknown>).reasons ?? null,
                score: exportCheck.score,
                band: exportCheck.band,
                deductions: exportCheck.deductions,
              } as Record<string, unknown>,
              status: "failure",
              correlationId,
            }).catch((auditErr: unknown) => {
              // Deep-scan #5 H3 (2026-06-29): was silently swallowed.
              logger.warn({ err: auditErr, correlationId }, "exportability_block audit insert failed (non-blocking)");
              auditWriteFailuresTotal.labels({ action: "lifecycle.exportability_block" }).inc();
            });

            // SSE so the dashboard can surface the block to the operator
            broadcastSSE("strategy:exportability_blocked", {
              strategyId: s.id,
              name: s.name,
              fromState: "TESTING",
              toState: "PAPER",
              score: exportCheck.score,
              band: exportCheck.band,
              reasons: (exportCheck as Record<string, unknown>).reasons ?? null,
              correlationId,
            });

            exportabilityBlocked = true;
            // HARD gate: exportability check ran and the strategy genuinely cannot be exported.
            // Infra errors (catch below) are TRANSIENT and do NOT count toward burial.
            await this._maybeAutoGraveyard(s.id, "exportability_blocked", { score: exportCheck.score, band: exportCheck.band }, "TESTING", tickCorrelationId);
          } else {
            // Gate passed — reset consecutive counter
            this._resetHardGateCounter(s.id, "exportability_blocked", tickCorrelationId);

            // Deep-Scan #21 Wave-2 (2026-07-05): the gate can now pass a strategy whose
            // Pine artifact is honestly unfaithful (exportCheck.faithful === false) when
            // it is a direct-routed archetype/uncatalogued strategy (exportCheck.
            // isDirectRoutedArchetype === true) — Pine is a visual-only aid for those; the
            // strategy executes server-side via broker-router regardless of Pine fidelity.
            // Log this exemption non-blocking so it is NOT an invisible pass-through: the
            // strategy's Pine artifact genuinely omits validated logic, and any operator or
            // downstream consumer inspecting the promotion history should see WHY the gate
            // passed a non-faithful export rather than assuming faithful=true.
            if (exportCheck.isDirectRoutedArchetype && exportCheck.faithful === false) {
              db.insert(auditLog).values({
                action: "strategy.lifecycle.exportability_archetype_direct_route_exempt",
                entityType: "strategy",
                entityId: s.id,
                decisionAuthority: "gate",
                input: { fromState: "TESTING", toState: "PAPER" },
                result: {
                  note: "Archetype/uncatalogued strategy executes DIRECT via broker-router — "
                    + "Pine faithfulness is not required for promotion. Pine export (if ever "
                    + "generated) is a visual-only aid and honestly omits the logic below.",
                  score: exportCheck.score,
                  band: exportCheck.band,
                  deductions: exportCheck.deductions,
                } as Record<string, unknown>,
                status: "success",
                correlationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ err: auditErr, correlationId, strategyId: s.id }, "exportability_archetype_direct_route_exempt audit insert failed (non-blocking)");
              });
            }
          }
        } catch (err) {
          // Pass 8 Track A (2026-06-23): Convert fail-OPEN to fail-CLOSED.
          // Previously this catch only logged a warn and let the strategy proceed —
          // a dynamic import failure, invalid s.id, or non-Error throw could silently
          // promote an unexportable strategy to PAPER.
          //
          // New behavior: set exportabilityBlocked=true so the calling loop SKIPS
          // this strategy for the cycle, write a durable audit row, emit SSE, and
          // fire a Discord WARN so the operator knows there is an infra problem to
          // diagnose.  The strategy is NOT permanently blocked — it will be re-tried
          // on the next cron sweep once the infra issue is resolved.
          const infraErrMsg = err instanceof Error ? err.message : String(err);
          logger.warn(
            { err, strategyId: s.id, correlationId },
            "checkExportability infra error — strategy skipped this cycle (fail-CLOSED)",
          );

          // Durable audit row so the infra error is queryable and replayable
          db.insert(auditLog).values({
            action: "strategy.lifecycle.exportability_infra_error",
            entityType: "strategy",
            entityId: s.id,
            decisionAuthority: "gate",
            input: { fromState: "TESTING", toState: "PAPER" },
            result: {
              reason: "infra_failure_in_outer_catch",
              errorMessage: infraErrMsg,
            } as Record<string, unknown>,
            status: "warn",
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ auditErr, strategyId: s.id }, "exportability_infra_error audit insert failed (non-blocking)");
          });

          // SSE so the dashboard/operator can surface the infra error
          broadcastSSE("strategy:exportability_infra_error", {
            strategyId: s.id,
            name: s.name,
            reason: "infra_failure_in_outer_catch",
            errorMessage: infraErrMsg,
            correlationId,
          });

          // Discord WARN with family-grade postscript
          try {
            const discordBody = appendFamilyGradePostscript(
              `checkExportability infra error for strategy ${s.id} (${s.name ?? "unnamed"}): ${infraErrMsg}. ` +
              "Strategy skipped this promotion cycle. Check logs for dynamic-import or subprocess errors.",
              "The bot encountered an infrastructure error while checking if a strategy is ready for trading. The strategy was skipped for now.",
              "No action needed — the bot will retry automatically on the next cycle.",
            );
            notifyWarning(
              `Exportability Infra Error: strategy ${s.id}`,
              discordBody,
              { strategyId: s.id, correlationId, errorMessage: infraErrMsg },
            );
          } catch (_discordErr) { /* non-blocking */ }

          exportabilityBlocked = true;
        }
        if (exportabilityBlocked) continue;

        // FIX 1: B14 CI gate — TESTING→PAPER (mirrors PAPER→DEPLOY_READY pattern)
        try {
          const [mcRunForB14Tp] = await db
            .select({
              probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
              riskMetrics: monteCarloRuns.riskMetrics,
            })
            .from(monteCarloRuns)
            .where(
              and(
                eq(monteCarloRuns.backtestId, latestBt.id),
                eq(monteCarloRuns.status, "completed"),
              ),
            )
            .orderBy(desc(monteCarloRuns.createdAt))
            .limit(1);

          if (mcRunForB14Tp) {
            const rmTp = (mcRunForB14Tp.riskMetrics as Record<string, unknown> | null) ?? {};
            const ruinCiTp = (rmTp.probability_of_ruin_ci ?? null) as Record<string, unknown> | null;
            const pointEstimateTp = mcRunForB14Tp.probabilityOfRuin != null
              ? Number(mcRunForB14Tp.probabilityOfRuin)
              : null;

            const b14CiResultTp = evaluateB14CiGate(ruinCiTp, pointEstimateTp);
            _incB14GateCounter("TESTING_TO_PAPER", b14CiResultTp);

            await db.insert(auditLog).values({
              action: "b14.gate_evaluated",
              entityId: s.id,
              entityType: "strategy",
              status: b14CiResultTp.passed ? "success" : "failure",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: b14CiResultTp.auditPayload,
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "B14 CI gate (TESTING→PAPER) audit insert failed (non-blocking)");
            });

            broadcastSSE(LIFECYCLE_GATE_EVENTS.B14_EVALUATED, {
              correlationId, // deep-scan Obs re-verify F-3: gate-eval SSE carries correlationId (audit row does)
              strategyId: s.id,
              ...b14CiResultTp.auditPayload,
              passed: b14CiResultTp.passed,
              reason: b14CiResultTp.reason,
              legacyFallback: b14CiResultTp.legacyFallback,
            });

            if (!b14CiResultTp.passed) {
              logger.warn(
                { strategyId: s.id, ciHigh: b14CiResultTp.auditPayload.ci_high, transition: "TESTING→PAPER" },
                "B14 CI gate BLOCKED TESTING→PAPER: probability_of_ruin_ci.ci_high exceeds threshold",
              );
              strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
              await this._maybeAutoGraveyard(s.id, "b14_ci_high", { ciHigh: b14CiResultTp.auditPayload.ci_high, threshold: b14CiResultTp.auditPayload.threshold }, "TESTING", tickCorrelationId);
              continue;
            }
            // Gate passed — reset consecutive counter
            this._resetHardGateCounter(s.id, "b14_ci_high", tickCorrelationId);
          } else {
            // Deep-scan #5 H2a (2026-06-29): the `if (mcRunForB14Tp)` had NO else, so an
            // absent MC run silently SKIPPED the ruin gate entirely (only a DB read error
            // hit the fail-closed catch below). MC auto-fires after every completed backtest
            // (backtest-service.ts:1734), so by TESTING→PAPER the latest backtest has an MC
            // run — an absent one means MC errored or is still pending, a genuine failure
            // that must BLOCK (retries next cron cycle once MC completes), not slip through.
            const b14TpNoMc = evaluateB14CiGate(null, null);
            _incB14GateCounter("TESTING_TO_PAPER", b14TpNoMc);
            await db.insert(auditLog).values({
              action: "b14.gate_evaluated",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: { ...b14TpNoMc.auditPayload, note: "no completed MC run for latest backtest — fail-closed (MC auto-fires post-backtest; absent = errored/pending)" },
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "B14 CI gate (TESTING→PAPER no-MC fail-closed) audit insert failed (non-blocking)");
            });
            logger.warn(
              { strategyId: s.id, transition: "TESTING→PAPER" },
              "B14 CI gate BLOCKED TESTING→PAPER: no completed MC run for latest backtest (fail-closed)",
            );
            strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
            continue;
          }
        } catch (b14TpErr) {
          // F-6 Hardening 2026-06-23: Fail-CLOSED on B14 CI gate infrastructure error.
          // B14 CI is a hard gate protecting against high ruin probability. A gate that
          // cannot run must block promotion, not silently allow it.
          const b14TpErrMsg = b14TpErr instanceof Error ? b14TpErr.message : String(b14TpErr);
          try { b14GateTotal.labels({ transition: "TESTING_TO_PAPER", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
          logger.warn({ strategyId: s.id, err: b14TpErr }, "B14 CI gate (TESTING→PAPER): read failed — blocking promotion (fail-closed)");
          await db.insert(auditLog).values({
            action: "b14.gate_error_fail_closed",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "TESTING", toState: "PAPER" },
            result: {
              reason: "b14.gate_error_fail_closed",
              error: b14TpErrMsg,
              note: "B14 CI gate threw on TESTING→PAPER path — promotion blocked; retries next cron cycle",
            },
            correlationId: tickCorrelationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "B14 fail-closed audit insert (TESTING→PAPER) failed (non-blocking)");
          });
          strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
          continue;
        }

        // FIX 1: WFE gate — TESTING→PAPER (mirrors PAPER→DEPLOY_READY pattern)
        try {
          const wfResultsTp = (latestBt.walkForwardResults as Record<string, unknown> | null) ?? null;
          const wfeOverallTp = wfResultsTp?.wfe_overall != null ? Number(wfResultsTp.wfe_overall) : null;
          const wfeStatusTp = wfResultsTp?.wfe_status != null ? String(wfResultsTp.wfe_status) : null;

          const wfeResultTp = evaluateWfeGate(wfeOverallTp, undefined, undefined, wfeStatusTp);
          _incWfeGateCounter("TESTING_TO_PAPER", wfeResultTp);

          broadcastSSE(LIFECYCLE_GATE_EVENTS.WFE_EVALUATED, {
            correlationId, // deep-scan Obs re-verify F-3: gate-eval SSE carries correlationId (audit row does)
            strategyId: s.id,
            wfe_overall: wfeResultTp.wfeOverall,
            status: wfeResultTp.status,
            hard_floor: wfeResultTp.hardFloor,
            warn_floor: wfeResultTp.warnFloor,
            passed: wfeResultTp.passed,
          });

          if (wfeResultTp.auditAction) {
            const isBlockTp = wfeResultTp.status === "blocked";
            // hardening/phase-0: cpcv_exempt is a known, intentional pass — emit "success"
            // rather than "warning" so the audit trail is unambiguous.  All other non-block
            // statuses (legacy_null, degenerate_is_block is never reached here) keep "warning".
            const wfeAuditStatusTp: "failure" | "warning" | "success" =
              isBlockTp ? "failure"
              : wfeResultTp.status === "cpcv_exempt" ? "success"
              : "warning";
            await db.insert(auditLog).values({
              action: wfeResultTp.auditAction,
              entityId: s.id,
              entityType: "strategy",
              status: wfeAuditStatusTp,
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: {
                wfe_overall: wfeResultTp.wfeOverall,
                hard_floor: wfeResultTp.hardFloor,
                warn_floor: wfeResultTp.warnFloor,
                status: wfeResultTp.status,
              },
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "WFE gate (TESTING→PAPER) audit insert failed (non-blocking)");
            });

            if (isBlockTp) {
              logger.warn(
                { strategyId: s.id, wfeOverall: wfeResultTp.wfeOverall, transition: "TESTING→PAPER" },
                "WFE gate BLOCKED TESTING→PAPER: wfe_overall below hard floor",
              );
              strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
              await this._maybeAutoGraveyard(s.id, "wfe_hard_floor", { wfeOverall: wfeResultTp.wfeOverall, hardFloor: wfeResultTp.hardFloor }, "TESTING", tickCorrelationId);
              continue;
            }
            // Gate passed (or warn-only) — reset consecutive counter
            this._resetHardGateCounter(s.id, "wfe_hard_floor", tickCorrelationId);
          }
        } catch (wfeTpErr) {
          // Fail-open: WFE gate read failure is non-blocking
          try { wfeGateTotal.labels({ transition: "TESTING_TO_PAPER", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
          logger.warn({ strategyId: s.id, err: wfeTpErr }, "WFE gate (TESTING→PAPER): read failed (non-blocking — promotion continues)");
        }

        // DS#20 T-A1 (2026-07-05): PBO overfit HARD gate — TESTING→PAPER (cron legacy fast-track).
        // §12 documents PBO < 0.15 as a HARD gate on BOTH TESTING→SHADOW and TESTING→PAPER with
        // "no PBO-bypass path". It WAS wired only into the manual _promoteStrategyInner path (the
        // single evaluatePboGate call site) and was MISSING from this autonomous cron legacy
        // fast-track — so a vacation-mode auto-promotion could push a genuinely overfit strategy
        // (pbo_overall > threshold) straight to PAPER that a manual click would BLOCK (Deep-Scan
        // #20 Band A F-1). Mirrors the manual PBO block + the sibling cron B14 fail-CLOSED pattern.
        // FAIL-CLOSED on infra error per §12 (matches manual deepscan18 D-D3 posture).
        try {
          const pboWfMetaTp = (latestBt.walkForwardResults as Record<string, unknown> | null) ?? null;
          const pboOverallTp = pboWfMetaTp?.pbo_overall as number | null | undefined;
          const pboOverallPValueTp = pboWfMetaTp?.pbo_overall_p_value as number | null | undefined;
          const innerWfMetaTp = (pboWfMetaTp?.wf_metadata as Record<string, unknown> | null) ?? null;
          const pboDegenReasonTp = (innerWfMetaTp?.pbo_degenerate_reason as string | null | undefined) ?? null;

          const pboResultTp = evaluatePboGate(
            { pbo_overall: pboOverallTp, pbo_p_value: pboOverallPValueTp, pbo_degenerate_reason: pboDegenReasonTp },
          );

          if (!pboResultTp.ok) {
            const pboBlockActionTp =
              pboResultTp.reason === "lifecycle.pbo_plain_wf_degenerate_block"
                ? "lifecycle.pbo_plain_wf_degenerate_block"
                : "lifecycle.pbo_overfit_block";
            const regimeLabelTp = s.regimeTrainedOn ?? "unknown";
            try { pboBlocksTotal.labels({ regime: regimeLabelTp }).inc(); } catch { /* non-blocking counter */ }
            await db.insert(auditLog).values({
              action: pboBlockActionTp,
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: pboResultTp.auditPayload as Record<string, unknown>,
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "PBO gate (TESTING→PAPER cron) block audit insert failed (non-blocking)");
            });
            broadcastSSE(WAVE29_EVENTS.PBO_EVALUATED, {
              correlationId: tickCorrelationId, // deep-scan Obs re-verify #7 F-8: canonical correlationId KEY (value=tick), matching the file's 41-site convention
              strategyId: s.id,
              fromState: "TESTING",
              toState: "PAPER",
              pbo: pboResultTp.pbo,
              threshold: pboResultTp.threshold,
              blocked: true,
            });
            logger.warn(
              { strategyId: s.id, pbo: pboResultTp.pbo, threshold: pboResultTp.threshold, reason: pboResultTp.reason, transition: "TESTING→PAPER" },
              "PBO gate BLOCKED TESTING→PAPER (cron): pbo_overall exceeds institutional threshold",
            );
            strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
            await this._maybeAutoGraveyard(s.id, "pbo_overfit", { pbo: pboResultTp.pbo, threshold: pboResultTp.threshold }, "TESTING", tickCorrelationId);
            continue;
          }

          // PBO passed (or legacy/cpcv-unavailable grandfather) — emit the matching audit + SSE.
          if (pboResultTp.legacyNull) {
            await db.insert(auditLog).values({
              action: "lifecycle.pbo_unavailable_legacy",
              entityId: s.id,
              entityType: "strategy",
              status: "success",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: pboResultTp.auditPayload as Record<string, unknown>,
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "PBO gate (TESTING→PAPER cron) legacy audit insert failed (non-blocking)");
            });
          } else if (pboResultTp.reason === "lifecycle.pbo_cpcv_is_unavailable") {
            await db.insert(auditLog).values({
              action: "lifecycle.pbo_cpcv_is_unavailable",
              entityId: s.id,
              entityType: "strategy",
              status: "success",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: pboResultTp.auditPayload as Record<string, unknown>,
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "PBO gate (TESTING→PAPER cron) cpcv-unavailable audit insert failed (non-blocking)");
            });
          }
          broadcastSSE(WAVE29_EVENTS.PBO_EVALUATED, {
            correlationId: tickCorrelationId, // deep-scan Obs re-verify #7 F-8: canonical correlationId KEY (value=tick), matching the file's 41-site convention
            strategyId: s.id,
            fromState: "TESTING",
            toState: "PAPER",
            pbo: pboResultTp.pbo,
            threshold: pboResultTp.threshold,
            blocked: false,
            legacy_null: pboResultTp.legacyNull,
          });
          this._resetHardGateCounter(s.id, "pbo_overfit", tickCorrelationId);
        } catch (pboTpErr) {
          // FAIL-CLOSED per §12 ("no PBO-bypass path") — mirrors the sibling B14 fail-closed catch
          // above and the manual path's deepscan18 D-D3 posture. An unreadable/failed PBO must
          // HOLD the strategy in TESTING, not wave it through to PAPER.
          const pboTpErrMsg = pboTpErr instanceof Error ? pboTpErr.message : String(pboTpErr);
          logger.warn({ strategyId: s.id, err: pboTpErr }, "PBO gate (TESTING→PAPER cron): read/eval error — BLOCKING promotion (fail-CLOSED per §12)");
          try { pboBlocksTotal.labels({ regime: "gate_error" }).inc(); } catch { /* non-blocking counter */ }
          await db.insert(auditLog).values({
            action: "lifecycle.pbo_gate_error_fail_closed",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "TESTING", toState: "PAPER" },
            result: { reason: "pbo_gate_infrastructure_error", error: pboTpErrMsg, note: "PBO gate threw on TESTING→PAPER cron path — promotion blocked; retries next cron cycle" },
            correlationId: tickCorrelationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "PBO fail-closed audit insert (TESTING→PAPER cron) failed (non-blocking)");
          });
          broadcastSSE(WAVE29_EVENTS.PBO_EVALUATED, {
            correlationId: tickCorrelationId, // deep-scan Obs re-verify #7 F-8: canonical correlationId KEY (value=tick), matching the file's 41-site convention
            strategyId: s.id,
            fromState: "TESTING",
            toState: "PAPER",
            pbo: null,
            threshold: null,
            blocked: true,
            error: true,
          });
          strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
          continue;
        }

        // FIX 1: Parameter drift gate — TESTING→PAPER (mirrors PAPER→DEPLOY_READY pattern)
        try {
          const driftWfResultsTp = (latestBt.walkForwardResults as Record<string, unknown> | null) ?? null;
          const paramStabilityTp = (driftWfResultsTp?.param_stability as Record<string, unknown> | null) ?? null;
          const driftClassificationTp = (paramStabilityTp?.drift_classification as string | null) ?? null;
          const driftConfidenceTp = paramStabilityTp?.drift_confidence != null
            ? Number(paramStabilityTp.drift_confidence)
            : null;
          // C1 (2026-06-29): top-level param_stability_status → cpcv_exempt on CPCV path.
          const paramStabilityStatusTp = (driftWfResultsTp?.param_stability_status as string | null | undefined) ?? null;

          const driftResultTp = evaluateParameterDriftGate(driftClassificationTp, driftConfidenceTp, paramStabilityStatusTp);
          _incParameterDriftGateCounter("TESTING_TO_PAPER", driftResultTp);

          broadcastSSE(LIFECYCLE_GATE_EVENTS.PARAMETER_DRIFT_EVALUATED, {
            correlationId: tickCorrelationId, // deep-scan Obs F-3: SSE carries correlationId
            strategyId: s.id,
            classification: driftResultTp.classification,
            confidence: driftResultTp.confidence,
            status: driftResultTp.status,
            passed: driftResultTp.passed,
          });

          if (driftResultTp.auditAction) {
            const isBlockDriftTp = driftResultTp.status === "blocked";
            await db.insert(auditLog).values({
              action: driftResultTp.auditAction,
              entityId: s.id,
              entityType: "strategy",
              status: isBlockDriftTp ? "failure" : "warning",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: {
                classification: driftResultTp.classification,
                confidence: driftResultTp.confidence,
                status: driftResultTp.status,
              },
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "Parameter drift gate (TESTING→PAPER) audit insert failed (non-blocking)");
            });

            if (isBlockDriftTp) {
              logger.warn(
                { strategyId: s.id, classification: driftResultTp.classification, transition: "TESTING→PAPER" },
                "Parameter drift gate BLOCKED TESTING→PAPER: overfit_drift with high confidence",
              );
              strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
              await this._maybeAutoGraveyard(s.id, "parameter_overfit_drift", { classification: driftResultTp.classification, confidence: driftResultTp.confidence }, "TESTING", tickCorrelationId);
              continue;
            }
            // Gate passed (or warn-only) — reset consecutive counter
            this._resetHardGateCounter(s.id, "parameter_overfit_drift", tickCorrelationId);
          }
        } catch (driftTpErr) {
          // Fail-open: drift gate read failure is non-blocking
          try { parameterDriftGateTotal.labels({ transition: "TESTING_TO_PAPER", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
          logger.warn({ strategyId: s.id, err: driftTpErr }, "Parameter drift gate (TESTING→PAPER): read failed (non-blocking — promotion continues)");
        }

        // ── Wave B Fix 1: DSR walk-forward gate (TESTING → PAPER) ────────────
        // Reads backtests.walk_forward_results.wf_metadata.{dsr_pass, dsr_unavailable, dsr}
        // (emitted by walk_forward.py FIX 7 / Wave A, 2026-06-22).
        //
        // Gate fires AFTER all existing Wave 27.5 hard gates (B14 ci_high, WFE,
        // parameter drift) are evaluated — DSR is ADDITIVE, never replaces them.
        //
        // Three block/pass states:
        //   dsr_unavailable=true AND dsr_pass=false → blocked_dsr_unavailable (fail-closed)
        //   dsr_pass=false                          → blocked_dsr_floor (honest SR failed)
        //   dsr_pass undefined/null                 → legacy_proceed + warn (grandfather)
        //   dsr_pass=true                           → pass clean
        try {
          const wfMetaTp = (latestBt.walkForwardResults as Record<string, unknown> | null) ?? null;
          const wfMetaObjTp = (wfMetaTp?.wf_metadata as Record<string, unknown> | null) ?? null;

          const dsrGateResultTp = evaluateDsrWalkForwardGate(
            wfMetaObjTp as { dsr_pass?: boolean | null; dsr_unavailable?: boolean | null; dsr?: number | null } | null,
          );

          if (dsrGateResultTp.auditAction) {
            const isBlockTp = !dsrGateResultTp.passed;
            await db.insert(auditLog).values({
              action: dsrGateResultTp.auditAction,
              entityId: s.id,
              entityType: "strategy",
              status: isBlockTp ? "failure" : "warning",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" } as Record<string, unknown>,
              result: dsrGateResultTp.auditPayload as Record<string, unknown>,
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "DSR gate (TESTING→PAPER) audit insert failed (non-blocking)");
            });
          }

          if (!dsrGateResultTp.passed) {
            logger.warn(
              {
                strategyId: s.id,
                status: dsrGateResultTp.status,
                dsr: dsrGateResultTp.auditPayload.dsr,
                transition: "TESTING→PAPER",
              },
              `DSR gate BLOCKED TESTING→PAPER: ${dsrGateResultTp.reason}`,
            );
            strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
            // blocked_dsr_floor = genuine Sharpe failure (HARD).
            // blocked_dsr_unavailable = computation infra failure (TRANSIENT — do not count toward burial).
            if (dsrGateResultTp.status === "blocked_dsr_floor") {
              await this._maybeAutoGraveyard(s.id, "dsr_blocked_floor", { dsr: dsrGateResultTp.auditPayload.dsr, status: dsrGateResultTp.status }, "TESTING", tickCorrelationId);
            }
            continue;
          }
          // Gate passed — reset consecutive counter
          this._resetHardGateCounter(s.id, "dsr_blocked_floor", tickCorrelationId);
        } catch (dsrTpErr) {
          // Fail-open: DSR gate read failure is non-blocking for TESTING→PAPER.
          // The gate failing to evaluate is distinct from dsr_pass=false — we
          // cannot block on infrastructure failures alone.
          logger.warn({ strategyId: s.id, err: dsrTpErr }, "DSR gate (TESTING→PAPER): read failed (non-blocking — promotion continues)");
        }

        // ── E-1 (deepscan16 Wave 2 Track G2) — DSL guards_failed HARD gate: TESTING → PAPER ──
        // Reads backtests.result_extras.dsl_guards.guards_failed (Wave-1 Track 2 producer
        // field). guards_failed=true means the E.3/E.4/E.5 risk-guard block threw mid-backtest
        // and NONE of the stop-ceiling / time-stop / DLL-halt guards ran for that run — the
        // backtest is UNGUARDED, not clean, and must not promote toward live capital.
        // `latestBt` here is the full-row select a few gates above (no extra DB round trip).
        try {
          const dslGuardsTp = ((latestBt.resultExtras as Record<string, unknown> | null)?.dsl_guards ?? null) as
            | DslGuardsGateInput
            | null;
          const dslGuardsResultTp = evaluateDslGuardsGate(dslGuardsTp);
          _incDslGuardsGateCounter("TESTING_TO_PAPER", dslGuardsResultTp);

          broadcastSSE(LIFECYCLE_GATE_EVENTS.DSL_GUARDS_EVALUATED, {
            strategyId: s.id,
            ...dslGuardsResultTp.auditPayload,
            correlationId, // deep-scan Obs re-verify #3 F-6: DSL-guards HARD gate SSE carries correlationId
            passed: dslGuardsResultTp.passed,
            reason: dslGuardsResultTp.reason,
          });

          await db.insert(auditLog).values({
            action: dslGuardsResultTp.auditAction ?? "lifecycle.dsl_guards_pass",
            entityId: s.id,
            entityType: "strategy",
            status: !dslGuardsResultTp.passed ? "failure" : dslGuardsResultTp.status === "legacy_proceed" ? "warning" : "success",
            decisionAuthority: "gate",
            input: { fromState: "TESTING", toState: "PAPER" },
            result: dslGuardsResultTp.auditPayload,
            correlationId: tickCorrelationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "DSL guards gate (TESTING→PAPER) audit insert failed (non-blocking)");
          });

          if (!dslGuardsResultTp.passed) {
            logger.warn(
              { strategyId: s.id, guardsFailedReason: dslGuardsResultTp.auditPayload.guards_failed_reason, transition: "TESTING→PAPER" },
              "DSL guards gate BLOCKED TESTING→PAPER: guards_failed=true (E.3/E.4/E.5 risk guards did not run — unguarded backtest)",
            );
            strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
            try {
              await this._maybeAutoGraveyard(s.id, "dsl_guards_failed", { guardsFailedReason: dslGuardsResultTp.auditPayload.guards_failed_reason }, "TESTING", tickCorrelationId);
            } catch (graveyardErr) {
              logger.warn({ strategyId: s.id, err: graveyardErr }, "dsl_guards_failed _maybeAutoGraveyard threw (non-blocking) — block decision preserved");
            }
            continue; // block decision wins regardless of graveyard write outcome
          }
          // Gate passed (or legacy grandfather) — reset consecutive counter
          this._resetHardGateCounter(s.id, "dsl_guards_failed", tickCorrelationId);
        } catch (dslGuardsTpErr) {
          // Fail-CLOSED: this gate protects live capital from an UNGUARDED backtest
          // (same severity class as B14) — a read/parse error must not silently allow
          // promotion. In practice `latestBt.resultExtras` is already-parsed JS from the
          // row this function loaded upstream, so this branch guards against unexpected
          // shape errors, not DB connectivity.
          try { dslGuardsGateTotal.labels({ transition: "TESTING_TO_PAPER", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
          logger.warn({ strategyId: s.id, err: dslGuardsTpErr }, "DSL guards gate (TESTING→PAPER): read failed — blocking promotion (fail-closed)");
          await db.insert(auditLog).values({
            action: "lifecycle.dsl_guards_gate_error_fail_closed",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "TESTING", toState: "PAPER" },
            result: {
              reason: "lifecycle.dsl_guards_gate_error_fail_closed",
              error: dslGuardsTpErr instanceof Error ? dslGuardsTpErr.message : String(dslGuardsTpErr),
              note: "DSL guards gate threw on TESTING→PAPER path — promotion blocked; retries next cron cycle",
            },
            correlationId: tickCorrelationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "DSL guards gate fail-closed audit insert (TESTING→PAPER) failed (non-blocking)");
          });
          strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
          continue;
        }

        // ── (deepscan8 Track D 2026-07-02) Frozen-policy baseline stamp — T→P cron path ──
        // Stamps frozen_policy_hash at TESTING→PAPER so the P→DR drift check
        // (evaluateFrozenPolicyDriftAtPromotion) compares against the TRUE config baseline
        // from before PAPER, not whatever was in place after potential PAPER mutations.
        // First-freeze-null tolerance at P→DR stays for legacy strategies already in PAPER.
        // Fail-CLOSED: skip this strategy cycle if the freeze write fails (matches P→DR cron pattern).
        {
          let currentRegimeTpCron = "UNKNOWN";
          try {
            const { biasState: biasStateTable } = await import("../db/schema.js");
            const biasStateRows = await db
              .select({ regimeLabel: biasStateTable.regimeLabel })
              .from(biasStateTable)
              .limit(1)
              .catch(() => [] as { regimeLabel: string }[]);
            if (biasStateRows.length > 0 && typeof biasStateRows[0].regimeLabel === "string") {
              currentRegimeTpCron = biasStateRows[0].regimeLabel;
            }
          } catch {
            // Regime lookup error is non-fatal — UNKNOWN is a valid regime label.
          }

          try {
            await freezePolicyForStrategy(s.id, currentRegimeTpCron);
            logger.info(
              { strategyId: s.id, regime: currentRegimeTpCron },
              "Frozen-policy T→P baseline stamp: hash stamped successfully (cron path)",
            );
          } catch (freezeErrTpCron) {
            const freezeMsg = freezeErrTpCron instanceof Error ? freezeErrTpCron.message : String(freezeErrTpCron);
            logger.warn(
              { strategyId: s.id, err: freezeErrTpCron },
              "frozen_policy T→P baseline stamp failed (cron path) — skipping this cycle (fail-CLOSED per CLAUDE.md §12)",
            );
            await db.insert(auditLog).values({
              action: "frozen_policy.hash_compute_failed",
              entityId: s.id,
              entityType: "strategy",
              status: "blocked",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: {
                error: freezeMsg,
                note: "T→P baseline freeze write failed (cron path) — cron retries next cycle",
              },
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ err: auditErr, correlationId: tickCorrelationId }, "frozen_policy.hash_compute_failed (T→P cron freeze-write) audit insert failed (non-blocking)");
              auditWriteFailuresTotal.labels({ action: "frozen_policy.hash_compute_failed" }).inc();
            });
            continue; // skip this strategy; cron retries next cycle once the DB write succeeds
          }
        }

        const result = await this.promoteStrategy(s.id, "TESTING", "PAPER", { correlationId: correlationId ?? undefined });
        if (result.success) {
          promoted.push(s.id);

          broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTED, {
            correlationId, // deep-scan Obs re-verify F-3: SSE promotion event must carry correlationId (audit row does)
            strategyId: s.id,
            from: "TESTING",
            to: "PAPER",
            name: s.name,
            survivalRate: survivalRate.toFixed(3),
            tier,
          });

          // Mirror onto the typed agent event bus so cross-domain subscribers fire.
          // Existing SSE consumers are unaffected (additive).
          agentCoordinator.emit("strategy:promoted", {
            strategyId: s.id,
            from: "TESTING",
            to: "PAPER",
          }).catch((emitErr) => {
            logger.warn({ strategyId: s.id, err: emitErr }, "agentCoordinator emit failed (non-blocking)");
          });

          logger.info(
            { id: s.id, survivalRate: survivalRate.toFixed(3), tier },
            "Auto-promoted TESTING → PAPER",
          );
        }
      } catch (err) {
        logger.error({ strategyId: s.id, err }, "Error checking TESTING → PAPER promotion");
      }
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 2.5 — Wave 29 Pass A.3: SHADOW → PAPER (shadow-signal divergence)
    //
    // Catches training-serving skew before paper money is deployed.
    // Compare logged shadow signals (TradingView Pine WITHOUT TradersPost webhook)
    // against what the historical backtest expected for the same period.
    // Gate: ≥5% divergence across ≥20 signals = BLOCK SHADOW → PAPER.
    //
    // TODO (A.4 architect): A.1 (paper-parity, parallel) adds the SHADOW lifecycle
    // state and shadow_mode_enabled flag. Until that lands, this block is a
    // PLACEHOLDER that returns ok: true (PROCEED) so the existing TESTING → PAPER
    // path is unblocked. A.4 will reconcile by wiring:
    //   1. Query strategies WHERE lifecycle_state = 'SHADOW'
    //   2. Remove the placeholder ok=true short-circuit below
    //
    // Fail-soft contract: if shadow_signals table is missing or query throws,
    // emit lifecycle.shadow_divergence_check_unavailable_legacy warn + PROCEED
    // (grandfather window for pre-Wave-29 strategies).
    // ──────────────────────────────────────────────────────────────
    try {
      // Wave 29 Pass A.4 architect close: A.1's SHADOW lifecycle state landed in VALID_STATES;
      // real Drizzle query replaces the empty-array placeholder.
      const shadowStrategies = await db
        .select()
        .from(strategies)
        .where(eq(strategies.lifecycleState, "SHADOW"));

      for (const s of shadowStrategies) {
        try {
          // ── deepscan14 H1: full pre-paper gate stack (SHADOW → PAPER) ───────────
          // Wave 29 inserted the mandatory SHADOW stage into the default ladder
          // (CANDIDATE → TESTING → SHADOW → PAPER) but the institutional pre-paper
          // gate stack (staleness, MC survival > 0.70, prop compliance, compliance
          // drift, C4 survival score, exportability, B14 ci_high, WFE, parameter
          // drift, DSR walk-forward, frozen-policy freeze) only ever ran on Gate 2
          // (the LEGACY TESTING → PAPER cron path, ~2704-3466). Every
          // shadowModeEnabled=true strategy SKIPS Gate 2 entirely
          // (`if (s.shadowModeEnabled) continue;` above) and was reaching PAPER via
          // this block with ONLY the shadow-signal divergence check below —
          // silently bypassing every hard gate that protects live-paper capital.
          // This block calls the SAME pure evaluator functions Gate 2 calls (no
          // gate math re-implemented) so SHADOW → PAPER and the legacy
          // TESTING → PAPER edge are gated identically. BIF is intentionally NOT
          // duplicated here: BIF only ever evaluates at PAPER → DEPLOY_READY
          // (evaluatePaperToDeployReadyGates), so it already applies uniformly to
          // strategies regardless of which edge got them into PAPER.
          const [latestBtSh] = await db
            .select()
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          if (!latestBtSh) continue;
          if (!latestBtSh.walkForwardResults) continue;

          const tierSh = latestBtSh.tier;
          if (!tierSh || tierSh === "REJECTED") continue;

          // Staleness (HIGH #14) — SHADOW → PAPER
          {
            const stalenessDaysSh = parseInt(process.env.BACKTEST_STALENESS_DAYS ?? "30", 10);
            const ageMsSh = Date.now() - new Date(latestBtSh.createdAt).getTime();
            const ageDaysSh = ageMsSh / (1000 * 60 * 60 * 24);
            if (ageDaysSh > stalenessDaysSh) {
              logger.warn({ strategyId: s.id, ageDays: ageDaysSh.toFixed(1), stalenessDays: stalenessDaysSh }, "SHADOW → PAPER blocked (auto-check): backtest too old");
              await db.insert(auditLog).values({
                action: "lifecycle.backtest_stale",
                entityType: "strategy",
                entityId: s.id,
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "SHADOW", toState: "PAPER" },
                result: {
                  reason: "backtest_too_old",
                  age_days: parseFloat(ageDaysSh.toFixed(1)),
                  limit_days: stalenessDaysSh,
                  backtest_created_at: latestBtSh.createdAt,
                },
                correlationId: tickCorrelationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.backtest_stale (SHADOW→PAPER) audit insert failed (non-blocking)");
              });
              broadcastSSE(LIFECYCLE_GATE_EVENTS.BACKTEST_STALE, {
                strategyId: s.id,
                age_days: parseFloat(ageDaysSh.toFixed(1)),
                limit_days: stalenessDaysSh,
                correlationId: tickCorrelationId,
              });
              continue;
            }
          }

          // MC survival rate > 0.70 — SHADOW → PAPER
          const [mcRunSh] = await db
            .select({
              probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
            })
            .from(monteCarloRuns)
            .where(eq(monteCarloRuns.backtestId, latestBtSh.id))
            .orderBy(desc(monteCarloRuns.createdAt))
            .limit(1);

          if (!mcRunSh) continue;

          const ruinProbSh = mcRunSh.probabilityOfRuin != null ? parseFloat(String(mcRunSh.probabilityOfRuin)) : null;
          if (ruinProbSh === null) continue;

          const survivalRateSh = 1 - ruinProbSh;
          if (survivalRateSh <= 0.70) {
            logger.debug(
              { id: s.id, survivalRate: survivalRateSh.toFixed(3) },
              "SHADOW → PAPER blocked: MC survival rate <= 0.70",
            );
            await this._maybeAutoGraveyard(s.id, "mc_survival_below_floor", { survivalRate: survivalRateSh, floor: 0.70 }, "SHADOW", tickCorrelationId);
            continue;
          }
          this._resetHardGateCounter(s.id, "mc_survival_below_floor", tickCorrelationId);

          // Prop compliance: don't block if absent (soft check) — SHADOW → PAPER
          if (latestBtSh.propCompliance) {
            const propResultsSh = latestBtSh.propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
            const anyPassingSh = Object.values(propResultsSh).some(
              (r) => r.passed === true || r.pass === true,
            );
            if (!anyPassingSh) {
              logger.debug({ id: s.id }, "SHADOW → PAPER blocked: no passing prop compliance result");
              continue;
            }
          }

          // Compliance-drift gate — SHADOW → PAPER
          try {
            if (latestBtSh.propCompliance) {
              const { driftFirms: driftFirmsSh, qualifyingFirms: qualifyingFirmsSh } = await resolveComplianceDriftForPromotion(latestBtSh.propCompliance);
              if (driftFirmsSh.length > 0) {
                logger.warn(
                  { strategyId: s.id, driftFirms: driftFirmsSh, transition: "SHADOW→PAPER" },
                  "SHADOW → PAPER blocked (cron path): compliance ruleset drift detected",
                );
                await db.insert(auditLog).values({
                  action: "lifecycle.promotion_blocked_compliance_drift",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "SHADOW", toState: "PAPER" },
                  result: {
                    firms_with_drift: driftFirmsSh,
                    qualifying_firms: qualifyingFirmsSh,
                    reason: "compliance ruleset drift_detected — promotion held until human revalidation",
                  },
                  correlationId: tickCorrelationId,
                }).catch((auditErr: unknown) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "compliance-drift (SHADOW→PAPER cron) audit insert failed (non-blocking)");
                });
                broadcastSSE(LIFECYCLE_GATE_EVENTS.COMPLIANCE_DRIFT_BLOCKED, {
                  strategyId: s.id,
                  drift_firms: driftFirmsSh,
                  correlationId: tickCorrelationId,
                });
                continue;
              }
            }
          } catch (driftCheckErrSh) {
            const errMsg = driftCheckErrSh instanceof Error ? driftCheckErrSh.message : String(driftCheckErrSh);
            logger.warn(
              { strategyId: s.id, err: driftCheckErrSh, transition: "SHADOW→PAPER" },
              "SHADOW → PAPER drift-check threw (cron path) — blocking promotion (fail-closed)",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.drift_check_infra_error",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "SHADOW", toState: "PAPER" },
              result: {
                reason: "drift_check_infrastructure_error",
                error: errMsg,
                note: "Cron will retry next tick once the underlying error is resolved",
              },
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.drift_check_infra_error (SHADOW→PAPER cron) audit insert failed (non-blocking)");
            });
            continue;
          }

          // C4: Survival score gate — require survival_score >= 60 — SHADOW → PAPER
          const gateResultSh = latestBtSh.gateResult as Record<string, unknown> | null | undefined;
          if (gateResultSh && typeof gateResultSh === "object") {
            const componentsSh = (gateResultSh.components as Record<string, number> | undefined) ?? undefined;
            const rawSurvivalScoreSh = componentsSh?.raw_survival_score ?? componentsSh?.survival_score ?? null;
            if (rawSurvivalScoreSh !== null && rawSurvivalScoreSh < 60) {
              logger.debug({ id: s.id, rawSurvivalScore: rawSurvivalScoreSh }, "SHADOW → PAPER blocked: survival-score-below-threshold");
              await db.insert(auditLog).values({
                action: "strategy.lifecycle.blocked",
                entityId: s.id,
                entityType: "strategy",
                status: "failure",
                decisionAuthority: "gate",
                result: {
                  reason: "survival-score-below-threshold",
                  survival_score: rawSurvivalScoreSh,
                  minimum_required: 60,
                  from: "SHADOW",
                  to: "PAPER",
                },
                correlationId: tickCorrelationId,
              });
              await this._maybeAutoGraveyard(s.id, "survival_score_below_threshold", { rawSurvivalScore: rawSurvivalScoreSh, floor: 60 }, "SHADOW", tickCorrelationId);
              continue;
            }
            if (rawSurvivalScoreSh !== null) {
              this._resetHardGateCounter(s.id, "survival_score_below_threshold", tickCorrelationId);
            }
          } else {
            logger.warn(
              { strategyId: s.id, backtestId: latestBtSh.id },
              "SHADOW → PAPER: survival-score-gate-missing-data (gateResult absent on latest backtest, defaulting to permissive)",
            );
            await db.insert(auditLog).values({
              action: "survival-score-gate-missing-data",
              entityId: s.id,
              entityType: "strategy",
              status: "success",
              decisionAuthority: "gate",
              input: { fromState: "SHADOW", toState: "PAPER" },
              result: {
                backtestId: latestBtSh.id,
                note: "gateResult JSONB missing on latest backtest — survival-score gate skipped, promotion proceeded",
              },
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "survival-score-gate-missing-data (SHADOW→PAPER) audit insert failed (non-blocking)");
            });
          }

          // H2: Pine exportability pre-check — BLOCKING — SHADOW → PAPER
          let exportabilityBlockedSh = false;
          try {
            const { checkExportability } = await import("./pine-export-service.js");
            const exportCheckSh = await checkExportability(s.id);
            if (!exportCheckSh.ok) {
              logger.warn({
                strategyId: s.id,
                score: exportCheckSh.score,
                band: exportCheckSh.band,
                deductions: exportCheckSh.deductions,
                reasons: (exportCheckSh as Record<string, unknown>).reasons,
              }, "SHADOW→PAPER: BLOCKED — strategy has Pine exportability issues");

              await db.insert(auditLog).values({
                action: "strategy.lifecycle.exportability_blocked",
                entityType: "strategy",
                entityId: s.id,
                decisionAuthority: "gate",
                input: { fromState: "SHADOW", toState: "PAPER" },
                result: {
                  reasons: (exportCheckSh as Record<string, unknown>).reasons ?? null,
                  score: exportCheckSh.score,
                  band: exportCheckSh.band,
                  deductions: exportCheckSh.deductions,
                } as Record<string, unknown>,
                status: "failure",
                correlationId: tickCorrelationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ err: auditErr, correlationId: tickCorrelationId }, "exportability_block (SHADOW→PAPER) audit insert failed (non-blocking)");
                auditWriteFailuresTotal.labels({ action: "lifecycle.exportability_block" }).inc();
              });

              broadcastSSE("strategy:exportability_blocked", {
                strategyId: s.id,
                name: s.name,
                fromState: "SHADOW",
                toState: "PAPER",
                score: exportCheckSh.score,
                band: exportCheckSh.band,
                reasons: (exportCheckSh as Record<string, unknown>).reasons ?? null,
                correlationId: tickCorrelationId,
              });

              exportabilityBlockedSh = true;
              await this._maybeAutoGraveyard(s.id, "exportability_blocked", { score: exportCheckSh.score, band: exportCheckSh.band }, "SHADOW", tickCorrelationId);
            } else {
              this._resetHardGateCounter(s.id, "exportability_blocked", tickCorrelationId);

              // Deep-Scan #21 Wave-2 (2026-07-05): mirror of the TESTING→PAPER exemption
              // audit above — surface (non-blocking) when this gate pass relied on the
              // archetype/uncatalogued direct-route exemption rather than genuine Pine
              // faithfulness, so no consumer is misled about what the Pine artifact covers.
              if (exportCheckSh.isDirectRoutedArchetype && exportCheckSh.faithful === false) {
                db.insert(auditLog).values({
                  action: "strategy.lifecycle.exportability_archetype_direct_route_exempt",
                  entityType: "strategy",
                  entityId: s.id,
                  decisionAuthority: "gate",
                  input: { fromState: "SHADOW", toState: "PAPER" },
                  result: {
                    note: "Archetype/uncatalogued strategy executes DIRECT via broker-router — "
                      + "Pine faithfulness is not required for promotion. Pine export (if ever "
                      + "generated) is a visual-only aid and honestly omits the logic below.",
                    score: exportCheckSh.score,
                    band: exportCheckSh.band,
                    deductions: exportCheckSh.deductions,
                  } as Record<string, unknown>,
                  status: "success",
                  correlationId: tickCorrelationId,
                }).catch((auditErr: unknown) => {
                  logger.warn({ err: auditErr, correlationId: tickCorrelationId, strategyId: s.id }, "exportability_archetype_direct_route_exempt (SHADOW→PAPER) audit insert failed (non-blocking)");
                });
              }
            }
          } catch (exportErrSh) {
            const infraErrMsgSh = exportErrSh instanceof Error ? exportErrSh.message : String(exportErrSh);
            logger.warn(
              { err: exportErrSh, strategyId: s.id, correlationId: tickCorrelationId },
              "checkExportability infra error (SHADOW→PAPER) — strategy skipped this cycle (fail-CLOSED)",
            );
            db.insert(auditLog).values({
              action: "strategy.lifecycle.exportability_infra_error",
              entityType: "strategy",
              entityId: s.id,
              decisionAuthority: "gate",
              input: { fromState: "SHADOW", toState: "PAPER" },
              result: {
                reason: "infra_failure_in_outer_catch",
                errorMessage: infraErrMsgSh,
              } as Record<string, unknown>,
              status: "warn",
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ auditErr, strategyId: s.id }, "exportability_infra_error (SHADOW→PAPER) audit insert failed (non-blocking)");
            });
            broadcastSSE("strategy:exportability_infra_error", {
              strategyId: s.id,
              name: s.name,
              reason: "infra_failure_in_outer_catch",
              errorMessage: infraErrMsgSh,
              correlationId: tickCorrelationId,
            });
            exportabilityBlockedSh = true;
          }
          if (exportabilityBlockedSh) continue;

          // B14 CI gate — SHADOW → PAPER
          try {
            const [mcRunForB14Sh] = await db
              .select({
                probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
                riskMetrics: monteCarloRuns.riskMetrics,
              })
              .from(monteCarloRuns)
              .where(
                and(
                  eq(monteCarloRuns.backtestId, latestBtSh.id),
                  eq(monteCarloRuns.status, "completed"),
                ),
              )
              .orderBy(desc(monteCarloRuns.createdAt))
              .limit(1);

            if (mcRunForB14Sh) {
              const rmSh = (mcRunForB14Sh.riskMetrics as Record<string, unknown> | null) ?? {};
              const ruinCiSh = (rmSh.probability_of_ruin_ci ?? null) as Record<string, unknown> | null;
              const pointEstimateSh = mcRunForB14Sh.probabilityOfRuin != null
                ? Number(mcRunForB14Sh.probabilityOfRuin)
                : null;

              const b14CiResultSh = evaluateB14CiGate(ruinCiSh, pointEstimateSh);
              _incB14GateCounter("SHADOW_TO_PAPER", b14CiResultSh);

              await db.insert(auditLog).values({
                action: "b14.gate_evaluated",
                entityId: s.id,
                entityType: "strategy",
                status: b14CiResultSh.passed ? "success" : "failure",
                decisionAuthority: "gate",
                input: { fromState: "SHADOW", toState: "PAPER" },
                result: b14CiResultSh.auditPayload,
                correlationId: tickCorrelationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "B14 CI gate (SHADOW→PAPER) audit insert failed (non-blocking)");
              });

              broadcastSSE(LIFECYCLE_GATE_EVENTS.B14_EVALUATED, {
                correlationId, // deep-scan Obs re-verify F-3: gate-eval SSE carries correlationId (audit row does)
                strategyId: s.id,
                ...b14CiResultSh.auditPayload,
                passed: b14CiResultSh.passed,
                reason: b14CiResultSh.reason,
                legacyFallback: b14CiResultSh.legacyFallback,
              });

              if (!b14CiResultSh.passed) {
                logger.warn(
                  { strategyId: s.id, ciHigh: b14CiResultSh.auditPayload.ci_high, transition: "SHADOW→PAPER" },
                  "B14 CI gate BLOCKED SHADOW→PAPER: probability_of_ruin_ci.ci_high exceeds threshold",
                );
                strategyPromotions.labels({ from_state: "SHADOW", to_state: "PAPER", actor: "system_gate" }).inc();
                await this._maybeAutoGraveyard(s.id, "b14_ci_high", { ciHigh: b14CiResultSh.auditPayload.ci_high, threshold: b14CiResultSh.auditPayload.threshold }, "SHADOW", tickCorrelationId);
                continue;
              }
              this._resetHardGateCounter(s.id, "b14_ci_high", tickCorrelationId);
            } else {
              const b14ShNoMc = evaluateB14CiGate(null, null);
              _incB14GateCounter("SHADOW_TO_PAPER", b14ShNoMc);
              await db.insert(auditLog).values({
                action: "b14.gate_evaluated",
                entityId: s.id,
                entityType: "strategy",
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "SHADOW", toState: "PAPER" },
                result: { ...b14ShNoMc.auditPayload, note: "no completed MC run for latest backtest — fail-closed (MC auto-fires post-backtest; absent = errored/pending)" },
                correlationId: tickCorrelationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "B14 CI gate (SHADOW→PAPER no-MC fail-closed) audit insert failed (non-blocking)");
              });
              logger.warn(
                { strategyId: s.id, transition: "SHADOW→PAPER" },
                "B14 CI gate BLOCKED SHADOW→PAPER: no completed MC run for latest backtest (fail-closed)",
              );
              strategyPromotions.labels({ from_state: "SHADOW", to_state: "PAPER", actor: "system_gate" }).inc();
              continue;
            }
          } catch (b14ShErr) {
            const b14ShErrMsg = b14ShErr instanceof Error ? b14ShErr.message : String(b14ShErr);
            try { b14GateTotal.labels({ transition: "SHADOW_TO_PAPER", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
            logger.warn({ strategyId: s.id, err: b14ShErr }, "B14 CI gate (SHADOW→PAPER): read failed — blocking promotion (fail-closed)");
            await db.insert(auditLog).values({
              action: "b14.gate_error_fail_closed",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "SHADOW", toState: "PAPER" },
              result: {
                reason: "b14.gate_error_fail_closed",
                error: b14ShErrMsg,
                note: "B14 CI gate threw on SHADOW→PAPER path — promotion blocked; retries next cron cycle",
              },
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "B14 fail-closed audit insert (SHADOW→PAPER) failed (non-blocking)");
            });
            strategyPromotions.labels({ from_state: "SHADOW", to_state: "PAPER", actor: "system_gate" }).inc();
            continue;
          }

          // WFE gate — SHADOW → PAPER
          try {
            const wfResultsSh = (latestBtSh.walkForwardResults as Record<string, unknown> | null) ?? null;
            const wfeOverallSh = wfResultsSh?.wfe_overall != null ? Number(wfResultsSh.wfe_overall) : null;
            const wfeStatusSh = wfResultsSh?.wfe_status != null ? String(wfResultsSh.wfe_status) : null;

            const wfeResultSh = evaluateWfeGate(wfeOverallSh, undefined, undefined, wfeStatusSh);
            _incWfeGateCounter("SHADOW_TO_PAPER", wfeResultSh);

            broadcastSSE(LIFECYCLE_GATE_EVENTS.WFE_EVALUATED, {
              correlationId, // deep-scan Obs re-verify F-3: gate-eval SSE carries correlationId (audit row does)
              strategyId: s.id,
              wfe_overall: wfeResultSh.wfeOverall,
              status: wfeResultSh.status,
              hard_floor: wfeResultSh.hardFloor,
              warn_floor: wfeResultSh.warnFloor,
              passed: wfeResultSh.passed,
            });

            if (wfeResultSh.auditAction) {
              const isBlockSh = wfeResultSh.status === "blocked";
              const wfeAuditStatusSh: "failure" | "warning" | "success" =
                isBlockSh ? "failure"
                : wfeResultSh.status === "cpcv_exempt" ? "success"
                : "warning";
              await db.insert(auditLog).values({
                action: wfeResultSh.auditAction,
                entityId: s.id,
                entityType: "strategy",
                status: wfeAuditStatusSh,
                decisionAuthority: "gate",
                input: { fromState: "SHADOW", toState: "PAPER" },
                result: {
                  wfe_overall: wfeResultSh.wfeOverall,
                  hard_floor: wfeResultSh.hardFloor,
                  warn_floor: wfeResultSh.warnFloor,
                  status: wfeResultSh.status,
                },
                correlationId: tickCorrelationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "WFE gate (SHADOW→PAPER) audit insert failed (non-blocking)");
              });

              if (isBlockSh) {
                logger.warn(
                  { strategyId: s.id, wfeOverall: wfeResultSh.wfeOverall, transition: "SHADOW→PAPER" },
                  "WFE gate BLOCKED SHADOW→PAPER: wfe_overall below hard floor",
                );
                strategyPromotions.labels({ from_state: "SHADOW", to_state: "PAPER", actor: "system_gate" }).inc();
                await this._maybeAutoGraveyard(s.id, "wfe_hard_floor", { wfeOverall: wfeResultSh.wfeOverall, hardFloor: wfeResultSh.hardFloor }, "SHADOW", tickCorrelationId);
                continue;
              }
              this._resetHardGateCounter(s.id, "wfe_hard_floor", tickCorrelationId);
            }
          } catch (wfeShErr) {
            try { wfeGateTotal.labels({ transition: "SHADOW_TO_PAPER", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
            logger.warn({ strategyId: s.id, err: wfeShErr }, "WFE gate (SHADOW→PAPER): read failed (non-blocking — promotion continues)");
          }

          // Parameter drift gate — SHADOW → PAPER
          try {
            const driftWfResultsSh = (latestBtSh.walkForwardResults as Record<string, unknown> | null) ?? null;
            const paramStabilitySh = (driftWfResultsSh?.param_stability as Record<string, unknown> | null) ?? null;
            const driftClassificationSh = (paramStabilitySh?.drift_classification as string | null) ?? null;
            const driftConfidenceSh = paramStabilitySh?.drift_confidence != null
              ? Number(paramStabilitySh.drift_confidence)
              : null;
            const paramStabilityStatusSh = (driftWfResultsSh?.param_stability_status as string | null | undefined) ?? null;

            const driftResultSh = evaluateParameterDriftGate(driftClassificationSh, driftConfidenceSh, paramStabilityStatusSh);
            _incParameterDriftGateCounter("SHADOW_TO_PAPER", driftResultSh);

            broadcastSSE(LIFECYCLE_GATE_EVENTS.PARAMETER_DRIFT_EVALUATED, {
              correlationId: tickCorrelationId, // deep-scan Obs F-3: SSE carries correlationId
              strategyId: s.id,
              classification: driftResultSh.classification,
              confidence: driftResultSh.confidence,
              status: driftResultSh.status,
              passed: driftResultSh.passed,
            });

            if (driftResultSh.auditAction) {
              const isBlockDriftSh = driftResultSh.status === "blocked";
              await db.insert(auditLog).values({
                action: driftResultSh.auditAction,
                entityId: s.id,
                entityType: "strategy",
                status: isBlockDriftSh ? "failure" : "warning",
                decisionAuthority: "gate",
                input: { fromState: "SHADOW", toState: "PAPER" },
                result: {
                  classification: driftResultSh.classification,
                  confidence: driftResultSh.confidence,
                  status: driftResultSh.status,
                },
                correlationId: tickCorrelationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "Parameter drift gate (SHADOW→PAPER) audit insert failed (non-blocking)");
              });

              if (isBlockDriftSh) {
                logger.warn(
                  { strategyId: s.id, classification: driftResultSh.classification, transition: "SHADOW→PAPER" },
                  "Parameter drift gate BLOCKED SHADOW→PAPER: overfit_drift with high confidence",
                );
                strategyPromotions.labels({ from_state: "SHADOW", to_state: "PAPER", actor: "system_gate" }).inc();
                await this._maybeAutoGraveyard(s.id, "parameter_overfit_drift", { classification: driftResultSh.classification, confidence: driftResultSh.confidence }, "SHADOW", tickCorrelationId);
                continue;
              }
              this._resetHardGateCounter(s.id, "parameter_overfit_drift", tickCorrelationId);
            }
          } catch (driftShErr) {
            try { parameterDriftGateTotal.labels({ transition: "SHADOW_TO_PAPER", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
            logger.warn({ strategyId: s.id, err: driftShErr }, "Parameter drift gate (SHADOW→PAPER): read failed (non-blocking — promotion continues)");
          }

          // DSR walk-forward gate — SHADOW → PAPER (H2: honest-DSR parity)
          try {
            const wfMetaSh = (latestBtSh.walkForwardResults as Record<string, unknown> | null) ?? null;
            const wfMetaObjSh = (wfMetaSh?.wf_metadata as Record<string, unknown> | null) ?? null;

            const dsrGateResultSh = evaluateDsrWalkForwardGate(
              wfMetaObjSh as { dsr_pass?: boolean | null; dsr_unavailable?: boolean | null; dsr?: number | null } | null,
            );

            if (dsrGateResultSh.auditAction) {
              const isBlockDsrSh = !dsrGateResultSh.passed;
              await db.insert(auditLog).values({
                action: dsrGateResultSh.auditAction,
                entityId: s.id,
                entityType: "strategy",
                status: isBlockDsrSh ? "failure" : "warning",
                decisionAuthority: "gate",
                input: { fromState: "SHADOW", toState: "PAPER" } as Record<string, unknown>,
                result: dsrGateResultSh.auditPayload as Record<string, unknown>,
                correlationId: tickCorrelationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "DSR gate (SHADOW→PAPER) audit insert failed (non-blocking)");
              });
            }

            if (!dsrGateResultSh.passed) {
              logger.warn(
                {
                  strategyId: s.id,
                  status: dsrGateResultSh.status,
                  dsr: dsrGateResultSh.auditPayload.dsr,
                  transition: "SHADOW→PAPER",
                },
                `DSR gate BLOCKED SHADOW→PAPER: ${dsrGateResultSh.reason}`,
              );
              strategyPromotions.labels({ from_state: "SHADOW", to_state: "PAPER", actor: "system_gate" }).inc();
              if (dsrGateResultSh.status === "blocked_dsr_floor") {
                await this._maybeAutoGraveyard(s.id, "dsr_blocked_floor", { dsr: dsrGateResultSh.auditPayload.dsr, status: dsrGateResultSh.status }, "SHADOW", tickCorrelationId);
              }
              continue;
            }
            this._resetHardGateCounter(s.id, "dsr_blocked_floor", tickCorrelationId);
          } catch (dsrShErr) {
            logger.warn({ strategyId: s.id, err: dsrShErr }, "DSR gate (SHADOW→PAPER): read failed (non-blocking — promotion continues)");
          }

          // ── E-1 (deepscan16 Wave 2 Track G2) — DSL guards_failed HARD gate: SHADOW → PAPER ──
          // Mirrors the TESTING→PAPER gate exactly so a shadow-destined strategy cannot
          // bypass the guards_failed check via the SHADOW ladder. `latestBtSh` is a
          // full-row select above (no extra DB round trip).
          try {
            const dslGuardsSh = ((latestBtSh.resultExtras as Record<string, unknown> | null)?.dsl_guards ?? null) as
              | DslGuardsGateInput
              | null;
            const dslGuardsResultSh = evaluateDslGuardsGate(dslGuardsSh);
            _incDslGuardsGateCounter("SHADOW_TO_PAPER", dslGuardsResultSh);

            broadcastSSE(LIFECYCLE_GATE_EVENTS.DSL_GUARDS_EVALUATED, {
              strategyId: s.id,
              ...dslGuardsResultSh.auditPayload,
              correlationId, // deep-scan Obs re-verify #3 F-6: DSL-guards HARD gate SSE carries correlationId
              passed: dslGuardsResultSh.passed,
              reason: dslGuardsResultSh.reason,
            });

            await db.insert(auditLog).values({
              action: dslGuardsResultSh.auditAction ?? "lifecycle.dsl_guards_pass",
              entityId: s.id,
              entityType: "strategy",
              status: !dslGuardsResultSh.passed ? "failure" : dslGuardsResultSh.status === "legacy_proceed" ? "warning" : "success",
              decisionAuthority: "gate",
              input: { fromState: "SHADOW", toState: "PAPER" },
              result: dslGuardsResultSh.auditPayload,
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "DSL guards gate (SHADOW→PAPER) audit insert failed (non-blocking)");
            });

            if (!dslGuardsResultSh.passed) {
              logger.warn(
                { strategyId: s.id, guardsFailedReason: dslGuardsResultSh.auditPayload.guards_failed_reason, transition: "SHADOW→PAPER" },
                "DSL guards gate BLOCKED SHADOW→PAPER: guards_failed=true (E.3/E.4/E.5 risk guards did not run — unguarded backtest)",
              );
              strategyPromotions.labels({ from_state: "SHADOW", to_state: "PAPER", actor: "system_gate" }).inc();
              try {
                await this._maybeAutoGraveyard(s.id, "dsl_guards_failed", { guardsFailedReason: dslGuardsResultSh.auditPayload.guards_failed_reason }, "SHADOW", tickCorrelationId);
              } catch (graveyardErr) {
                logger.warn({ strategyId: s.id, err: graveyardErr }, "dsl_guards_failed _maybeAutoGraveyard threw (non-blocking) — block decision preserved");
              }
              continue;
            }
            this._resetHardGateCounter(s.id, "dsl_guards_failed", tickCorrelationId);
          } catch (dslGuardsShErr) {
            try { dslGuardsGateTotal.labels({ transition: "SHADOW_TO_PAPER", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
            logger.warn({ strategyId: s.id, err: dslGuardsShErr }, "DSL guards gate (SHADOW→PAPER): read failed — blocking promotion (fail-closed)");
            await db.insert(auditLog).values({
              action: "lifecycle.dsl_guards_gate_error_fail_closed",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "SHADOW", toState: "PAPER" },
              result: {
                reason: "lifecycle.dsl_guards_gate_error_fail_closed",
                error: dslGuardsShErr instanceof Error ? dslGuardsShErr.message : String(dslGuardsShErr),
                note: "DSL guards gate threw on SHADOW→PAPER path — promotion blocked; retries next cron cycle",
              },
              correlationId: tickCorrelationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "DSL guards gate fail-closed audit insert (SHADOW→PAPER) failed (non-blocking)");
            });
            strategyPromotions.labels({ from_state: "SHADOW", to_state: "PAPER", actor: "system_gate" }).inc();
            continue;
          }

          // Frozen-policy baseline stamp — SHADOW → PAPER cron path
          {
            let currentRegimeShCron = "UNKNOWN";
            try {
              const { biasState: biasStateTable } = await import("../db/schema.js");
              const biasStateRowsSh = await db
                .select({ regimeLabel: biasStateTable.regimeLabel })
                .from(biasStateTable)
                .limit(1)
                .catch(() => [] as { regimeLabel: string }[]);
              if (biasStateRowsSh.length > 0 && typeof biasStateRowsSh[0].regimeLabel === "string") {
                currentRegimeShCron = biasStateRowsSh[0].regimeLabel;
              }
            } catch {
              // Regime lookup error is non-fatal — UNKNOWN is a valid regime label.
            }

            try {
              await freezePolicyForStrategy(s.id, currentRegimeShCron);
              logger.info(
                { strategyId: s.id, regime: currentRegimeShCron },
                "Frozen-policy SHADOW→PAPER baseline stamp: hash stamped successfully (cron path)",
              );
            } catch (freezeErrShCron) {
              const freezeMsgSh = freezeErrShCron instanceof Error ? freezeErrShCron.message : String(freezeErrShCron);
              logger.warn(
                { strategyId: s.id, err: freezeErrShCron },
                "frozen_policy SHADOW→PAPER baseline stamp failed (cron path) — skipping this cycle (fail-CLOSED per CLAUDE.md §12)",
              );
              await db.insert(auditLog).values({
                action: "frozen_policy.hash_compute_failed",
                entityId: s.id,
                entityType: "strategy",
                status: "blocked",
                decisionAuthority: "gate",
                input: { fromState: "SHADOW", toState: "PAPER" },
                result: {
                  error: freezeMsgSh,
                  note: "SHADOW→PAPER baseline freeze write failed (cron path) — cron retries next cycle",
                },
                correlationId: tickCorrelationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ err: auditErr, correlationId: tickCorrelationId }, "frozen_policy.hash_compute_failed (SHADOW→PAPER cron freeze-write) audit insert failed (non-blocking)");
                auditWriteFailuresTotal.labels({ action: "frozen_policy.hash_compute_failed" }).inc();
              });
              continue; // skip this strategy; cron retries next cycle once the DB write succeeds
            }
          }
          // ── end deepscan14 H1 full pre-paper gate stack ─────────────────────────

          const { shadowSignals: sSignals, backtestExpected } = await loadDivergenceInputs(s.id, 20);

          const divergenceResult = compareShadowToBacktest(sSignals, backtestExpected);

          if (!divergenceResult.ok) {
            const isInsufficientSamples = divergenceResult.reason === "insufficient_samples";
            const auditAction = isInsufficientSamples
              ? "lifecycle.shadow_divergence_insufficient_samples"
              : "lifecycle.shadow_divergence_blocked";

            logger.warn(
              {
                strategyId: s.id,
                divergence_pct: divergenceResult.divergence_pct,
                sample_size: divergenceResult.sample_size,
                reason: divergenceResult.reason,
                violations: divergenceResult.per_signal_violations.length,
              },
              `SHADOW → PAPER BLOCKED: ${divergenceResult.reason}`,
            );

            await db.insert(auditLog).values({
              action: auditAction,
              entityType: "strategy",
              entityId: s.id,
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "SHADOW", toState: "PAPER" },
              result: {
                ok: false,
                divergence_pct: divergenceResult.divergence_pct,
                sample_size: divergenceResult.sample_size,
                reason: divergenceResult.reason,
                per_signal_violations: divergenceResult.per_signal_violations,
                note: "SHADOW → PAPER blocked by divergence gate (Wave 29 Pass A.3)",
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "shadow divergence block audit insert failed (non-blocking)");
            });

            broadcastSSE(WAVE29_EVENTS.SHADOW_DIVERGENCE_EVALUATED, {
              correlationId, // deep-scan Obs re-verify #6 F-7: WAVE29 HARD-gate SSE must carry correlationId (audit row does)
              strategyId: s.id,
              ok: false,
              divergence_pct: divergenceResult.divergence_pct,
              sample_size: divergenceResult.sample_size,
              reason: divergenceResult.reason,
            });
            // Wave 29 prod hardening: Prom counter + Discord escalation on hard block
            if (!isInsufficientSamples) {
              try {
                lifecycleShadowPromotionsTotal.labels({ outcome: "blocked_divergence" }).inc();
              } catch (_promErr) { /* non-blocking */ }
              const thresholdPct = parseFloat(process.env.SHADOW_DIVERGENCE_THRESHOLD_PCT ?? "0.05");
              try {
                const discordBody = appendFamilyGradePostscript(
                  `Shadow divergence ${((divergenceResult.divergence_pct ?? 0) * 100).toFixed(2)}% >= threshold ${(thresholdPct * 100).toFixed(0)}% blocked strategy ${s.id} SHADOW→PAPER (samples=${divergenceResult.sample_size ?? 0}).`,
                  "The bot found that this strategy is behaving differently in shadow mode vs its backtest. Promotion to live paper trading was blocked.",
                  "No action needed — the bot will re-check when more shadow signals accumulate.",
                );
                notifyWarning(`Shadow Divergence Block: strategy ${s.id}`, discordBody, { strategyId: s.id, divergence_pct: divergenceResult.divergence_pct, sample_size: divergenceResult.sample_size });
              } catch (_discordErr) { /* non-blocking */ }
            } else {
              try {
                lifecycleShadowPromotionsTotal.labels({ outcome: "blocked_insufficient_samples" }).inc();
              } catch (_promErr) { /* non-blocking */ }
            }

            // insufficient_samples = not enough data yet (TRANSIENT).
            // Real divergence = strategy behaviour genuinely differs from backtest (HARD).
            if (!isInsufficientSamples) {
              await this._maybeAutoGraveyard(s.id, "shadow_divergence", { divergence_pct: divergenceResult.divergence_pct, sample_size: divergenceResult.sample_size, reason: divergenceResult.reason }, "SHADOW", correlationId);
            }
            continue; // BLOCK SHADOW → PAPER
          }
          // Gate passed — reset consecutive counter
          this._resetHardGateCounter(s.id, "shadow_divergence", correlationId);

          // ok: true — PROMOTE to PAPER
          logger.info(
            {
              strategyId: s.id,
              divergence_pct: divergenceResult.divergence_pct,
              sample_size: divergenceResult.sample_size,
            },
            "SHADOW → PAPER: divergence gate PASSED",
          );

          await db.insert(auditLog).values({
            action: "lifecycle.shadow_promotion_passed",
            entityType: "strategy",
            entityId: s.id,
            status: "success",
            decisionAuthority: "gate",
            input: { fromState: "SHADOW", toState: "PAPER" },
            result: {
              ok: true,
              divergence_pct: divergenceResult.divergence_pct,
              sample_size: divergenceResult.sample_size,
              note: "SHADOW → PAPER cleared by divergence gate (Wave 29 Pass A.3)",
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "shadow promotion passed audit insert failed (non-blocking)");
          });

          broadcastSSE(WAVE29_EVENTS.SHADOW_DIVERGENCE_EVALUATED, {
            correlationId, // deep-scan Obs re-verify #6 F-7: WAVE29 HARD-gate SSE must carry correlationId (audit row does)
            strategyId: s.id,
            ok: true,
            divergence_pct: divergenceResult.divergence_pct,
            sample_size: divergenceResult.sample_size,
          });
          // Wave 29 prod hardening: increment Prom counter for promoted outcome
          try {
            lifecycleShadowPromotionsTotal.labels({ outcome: "passed" }).inc();
          } catch (_promErr) { /* non-blocking */ }

          const shadowResult = await this.promoteStrategy(s.id, "SHADOW", "PAPER", { correlationId: correlationId ?? undefined });
          if (shadowResult.success) {
            promoted.push(s.id);
            logger.info({ strategyId: s.id }, "Auto-promoted SHADOW → PAPER");
          }
        } catch (shadowStratErr: unknown) {
          // F-2b Hardening 2026-06-23: Fail-CLOSED — grandfather window removed.
          // If shadow divergence check throws (shadow_signals table missing, DB error,
          // etc.), we CANNOT verify shadow evidence. Promotion is blocked this cycle;
          // the strategy retries next cron pass once the underlying issue is resolved.
          // Emits lifecycle.shadow_divergence_unavailable_blocked (not "legacy warn + PROCEED").
          logger.warn(
            { strategyId: s.id, err: shadowStratErr },
            "SHADOW → PAPER divergence check threw — blocking promotion (fail-closed; lifecycle.shadow_divergence_unavailable_blocked)",
          );

          await db.insert(auditLog).values({
            action: "lifecycle.shadow_divergence_unavailable_blocked",
            entityType: "strategy",
            entityId: s.id,
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "SHADOW", toState: "PAPER" },
            result: {
              note: "shadow_divergence_check threw — promotion blocked (fail-closed); retries next cron cycle",
              error: String(shadowStratErr),
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "shadow_divergence_unavailable_blocked audit insert failed (non-blocking)");
          });

          // No promoteStrategy call — strategy stays in SHADOW and retries next cycle.
          try {
            lifecycleShadowPromotionsTotal.labels({ outcome: "blocked_unavailable" }).inc();
          } catch (_promErr) { /* non-blocking */ }
        }
      }
    } catch (shadowGateErr: unknown) {
      // Fail-soft: outer SHADOW query failure is non-blocking.
      logger.warn({ err: shadowGateErr }, "SHADOW → PAPER gate: outer query threw (non-blocking)");
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 3: PAPER → DEPLOY_READY (30 distinct trading days + rolling Sharpe >= 1.5)
    // After promotion, fire-and-forget Pine compile for TradingView export.
    // DEPLOY_READY → DEPLOYED remains HUMAN-ONLY.
    //
    // Trading-day rule: count distinct calendar dates on which paper_trades closed
    // (exitTime) AFTER lifecycleChangedAt. This makes the gate honest — a strategy
    // promoted Monday cannot reach DEPLOY_READY on Saturday by sitting idle through
    // a weekend; it needs actual trade activity over 30 distinct days.
    // ──────────────────────────────────────────────────────────────
    const paperStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "PAPER"));

    for (const s of paperStrategies) {
      if (!s.lifecycleChangedAt) continue;

      // Count distinct trading days (paper_trades.exitTime dates) since this strategy
      // entered PAPER. paperTrades has sessionId not strategyId, so join via paperSessions.
      const tradeDays = await db
        .select({ day: sql<string>`DATE(${paperTrades.exitTime})` })
        .from(paperTrades)
        .innerJoin(paperSessions, eq(paperSessions.id, paperTrades.sessionId))
        .where(
          and(
            eq(paperSessions.strategyId, s.id),
            gte(paperTrades.exitTime, s.lifecycleChangedAt),
          ),
        )
        .groupBy(sql`DATE(${paperTrades.exitTime})`);
      const tradingDays = tradeDays.length;

      const rollingSharpe = s.rollingSharpe30d ? parseFloat(String(s.rollingSharpe30d)) : 0;
      if (tradingDays >= 30 && rollingSharpe >= 1.5) {
        // Track A.2: composite evidence-completeness tracker.
        // Records whether each major gate had complete data or fell back to a
        // legacy/unavailable status. Used after all gates pass to compute
        // composite_evidence_score = 1.0 - (incomplete_count / 8.0).
        // If incomplete_count >= 3: write lifecycle.promotion_evidence_incomplete
        // audit (status=warn) + Discord WARN + block promotion this cycle.
        const gateEvidenceStatuses: string[] = [];

        // P0-1: Compliance-drift gate at PAPER → DEPLOY_READY. DEPLOY_READY is the
        // gate to deployment authorization — promoting a strategy whose firm rules
        // are stale would let the human approve a deployment based on a ruleset
        // that no longer matches reality. Block until human revalidates.
        try {
          const [latestBt] = await db
            .select({ propCompliance: backtests.propCompliance, createdAt: backtests.createdAt })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          // HIGH #14: Backtest staleness gate — PAPER → DEPLOY_READY auto-check path.
          if (latestBt) {
            const stalenessDays = parseInt(process.env.BACKTEST_STALENESS_DAYS ?? "30", 10);
            const ageMs = Date.now() - new Date(latestBt.createdAt).getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays > stalenessDays) {
              logger.warn({ strategyId: s.id, ageDays: ageDays.toFixed(1), stalenessDays }, "PAPER → DEPLOY_READY blocked (auto-check): backtest too old");
              await db.insert(auditLog).values({
                action: "lifecycle.backtest_stale",
                entityType: "strategy",
                entityId: s.id,
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                result: {
                  reason: "backtest_too_old",
                  age_days: parseFloat(ageDays.toFixed(1)),
                  limit_days: stalenessDays,
                  backtest_created_at: latestBt.createdAt,
                },
                correlationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.backtest_stale PAPER audit insert failed (non-blocking)");
              });
              broadcastSSE(LIFECYCLE_GATE_EVENTS.BACKTEST_STALE, {
                strategyId: s.id,
                age_days: parseFloat(ageDays.toFixed(1)),
                limit_days: stalenessDays,
                correlationId: correlationId,
              });
              continue;  // skip to next strategy — inside the outer try
            }
          }

          if (latestBt?.propCompliance) {
            // (deepscan7 F-1 2026-07-02) drift determination extracted to the shared
            // resolveComplianceDriftForPromotion helper so the manual PATCH path runs
            // the identical check. Behavior unchanged on this cron path.
            const { driftFirms, qualifyingFirms } = await resolveComplianceDriftForPromotion(latestBt.propCompliance);
            if (driftFirms.length > 0) {
              logger.warn(
                { strategyId: s.id, driftFirms, transition: "PAPER→DEPLOY_READY" },
                "PAPER → DEPLOY_READY blocked: compliance ruleset drift detected",
              );
              await db.insert(auditLog).values({
                action: "lifecycle.promotion_blocked_compliance_drift",
                entityId: s.id,
                entityType: "strategy",
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                result: {
                  firms_with_drift: driftFirms,
                  qualifying_firms: qualifyingFirms,
                  reason: "compliance ruleset drift_detected — promotion held until human revalidation",
                },
                correlationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "compliance-drift audit insert failed (non-blocking)");
              });
              broadcastSSE(LIFECYCLE_GATE_EVENTS.COMPLIANCE_DRIFT_BLOCKED, {
                strategyId: s.id,
                drift_firms: driftFirms,
                correlationId: correlationId,
              });
              continue;
            }
          }
        } catch (driftCheckErr) {
          // F-6 FIX: Drift-check infrastructure failure must fail-CLOSED, symmetric
          // with TESTING→PAPER (A7 gate at lines ~1888-1910 fail-closed on infra error).
          // A broken drift check on a promotion-gate boundary is NOT informational —
          // promoting a strategy whose compliance ruleset we cannot verify could send
          // live orders against stale firm rules. Operator manual override required.
          const errMsg = driftCheckErr instanceof Error ? driftCheckErr.message : String(driftCheckErr);
          logger.warn(
            { strategyId: s.id, err: driftCheckErr },
            "PAPER → DEPLOY_READY drift-check threw — blocking promotion (fail-closed, manual override required)",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.drift_check_infra_error",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: {
              reason: "drift_check_infrastructure_error",
              error: errMsg,
              note: "Manual operator override required — cannot verify compliance ruleset integrity",
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.drift_check_infra_error audit insert failed (non-blocking)");
          });
          continue;
        }

        // ── B10: MRP Soft Gate: PAPER → DEPLOY_READY advisory ────────────────
        // SOFT gate: MRP > 0.5 is advisory for now. Hard gate activates after
        // 30 days of MRP data accumulates. Log at WARN if violated; never block.
        //
        // mrp_sharpe is computed post-backtest (fire-and-forget). If null (pre-B10
        // backtest or no regime data), log advisory and continue — never block.
        try {
          const [mrpBacktest] = await db
            .select({ mrpSharpe: backtests.mrpSharpe, mrpRegimeBreakdown: backtests.mrpRegimeBreakdown })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          if (mrpBacktest?.mrpSharpe != null) {
            const mrpValue = parseFloat(String(mrpBacktest.mrpSharpe));
            const MRP_SOFT_THRESHOLD = 0.5;

            if (mrpValue < MRP_SOFT_THRESHOLD) {
              logger.warn(
                {
                  strategyId: s.id,
                  mrpSharpe: mrpValue.toFixed(3),
                  threshold: MRP_SOFT_THRESHOLD,
                  regimeBreakdown: mrpBacktest.mrpRegimeBreakdown,
                  transition: "PAPER→DEPLOY_READY",
                },
                "B10 MRP soft gate: mrp_sharpe < 0.5 — strategy has regime-conditional fragility (advisory only, promotion continues)",
              );
              // Log advisory audit row so analysts can track MRP violations over time
              await db.insert(auditLog).values({
                action: "lifecycle.mrp_soft_gate_advisory",
                entityId: s.id,
                entityType: "strategy",
                status: "success",  // advisory — not a block
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                result: {
                  mrp_sharpe: mrpValue,
                  threshold: MRP_SOFT_THRESHOLD,
                  regime_breakdown: mrpBacktest.mrpRegimeBreakdown,
                  gate_phase: "soft_advisory",
                  note: "Hard gate activates after 30 days of MRP data",
                },
                correlationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "B10 MRP advisory audit insert failed (non-blocking)");
              });
            } else {
              logger.info(
                { strategyId: s.id, mrpSharpe: mrpValue.toFixed(3), transition: "PAPER→DEPLOY_READY" },
                "B10 MRP soft gate: mrp_sharpe >= 0.5 — PASSED",
              );
            }
          } else {
            // No MRP data yet — pre-B10 backtest or strategy with no regime data
            logger.info(
              { strategyId: s.id, transition: "PAPER→DEPLOY_READY" },
              "B10 MRP soft gate: no mrp_sharpe data — advisory skipped (pre-B10 backtest)",
            );
          }
        } catch (mrpGateErr) {
          // Non-blocking — MRP gate read failure must never abort promotion
          logger.warn(
            { strategyId: s.id, err: mrpGateErr },
            "B10 MRP soft gate: read failed (non-blocking — promotion continues)",
          );
        }

        // ── A7: Signal Correlation Gate: PAPER → DEPLOY_READY hard block ──────
        // Fail-closed: block promotion if the candidate strategy's signal vector
        // has cosine similarity > 0.85 with ANY DEPLOYED strategy.
        // Also blocks if no signal vector exists (strategy must have completed
        // a backtest that emitted signal_vector via backtester.py A7 changes).
        //
        // Ramp-up mode: if no DEPLOYED strategies have signal vectors yet (pre-A7
        // backtests), the gate passes with a warning. This prevents A7 from
        // permanently blocking all promotions during initial deployment.
        //
        // Authority: HARD GATE (fail-closed). Does NOT override classical gates.
        // Additive to existing Frankenstein, compliance-drift, and Sharpe gates.
        try {
          const { checkSignalCorrelationGate } = await import("./signal-correlation-service.js");
          const sigCorrelationResult = await checkSignalCorrelationGate(s.id);

          if (!sigCorrelationResult.allowed) {
            logger.warn(
              {
                strategyId: s.id,
                reason: sigCorrelationResult.reason,
                maxSimilarity: sigCorrelationResult.maxSimilarity,
                blockingStrategyId: sigCorrelationResult.blockingStrategyId,
                transition: "PAPER→DEPLOY_READY",
              },
              "A7 signal correlation gate: BLOCKED PAPER→DEPLOY_READY promotion",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.promotion_blocked_signal_correlation",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                reason: sigCorrelationResult.reason,
                max_similarity: sigCorrelationResult.maxSimilarity,
                blocking_strategy_id: sigCorrelationResult.blockingStrategyId,
                threshold: 0.85,
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "A7 audit insert failed (non-blocking)");
            });
            strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
            // Check ran successfully and the strategy is a signal duplicate — HARD gate.
            await this._maybeAutoGraveyard(s.id, "signal_correlation", { maxSimilarity: sigCorrelationResult.maxSimilarity, blockingStrategyId: sigCorrelationResult.blockingStrategyId, reason: sigCorrelationResult.reason }, "PAPER", correlationId);
            continue;
          }

          logger.info(
            {
              strategyId: s.id,
              reason: sigCorrelationResult.reason,
              maxSimilarity: sigCorrelationResult.maxSimilarity,
              transition: "PAPER→DEPLOY_READY",
            },
            "A7 signal correlation gate: PASSED",
          );
          // Gate passed — reset consecutive counter
          this._resetHardGateCounter(s.id, "signal_correlation", correlationId);
        } catch (sigCorrelationErr) {
          // Fail-closed on infrastructure error — same policy as Frankenstein gate.
          // A broken correlation check is safer treated as a failed gate than an
          // open one (a strategy promoted on a broken gate could be a signal duplicate).
          const msg = sigCorrelationErr instanceof Error ? sigCorrelationErr.message : String(sigCorrelationErr);
          logger.warn(
            { strategyId: s.id, err: sigCorrelationErr },
            "A7 signal correlation gate: infrastructure error — blocking promotion (fail-closed)",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.promotion_blocked_signal_correlation",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: {
              reason: `A7 gate infrastructure error (fail-closed): ${msg}`,
              max_similarity: null,
              blocking_strategy_id: null,
              threshold: 0.85,
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            // Deep-scan #5 H3 (2026-06-29): was silently swallowed.
            logger.warn({ err: auditErr, correlationId }, "A7 gate fail-closed audit insert failed (non-blocking)");
            auditWriteFailuresTotal.labels({ action: "lifecycle.a7_gate_error" }).inc();
          });
          strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
          continue;
        }

        // ── Wave 24 Item 9: B14 Survival Twin HARD gate: PAPER → DEPLOY_READY ──
        // PropScorer 2026-03: Topstep documented $40K payout-denial bans for
        // consistency violations. B14 must HARD-block before any live payout claim.
        // Env: B14_HARD_GATE_ENABLED (default "true") — set "false" for emergency disable.
        //
        // Wave 27.5 Pass B.2: B14 now ALSO reads probability_of_ruin_ci.ci_high from
        // the latest MC run (Pass A introduced BCa CI bootstrap). When ci_high > threshold
        // (default 0.20, env B14_RUIN_CI_HIGH_THRESHOLD — tightened 2026-06-22), the gate hard-blocks.
        // Falls back to scalar probability_of_ruin for pre-Pass-A MC runs.
        const b14HardGateEnabled = (process.env.B14_HARD_GATE_ENABLED ?? "true") !== "false";
        if (b14HardGateEnabled) {
          try {
            const [latestBtForB14] = await db
              .select({
                id: backtests.id,
                gateResult: backtests.gateResult,
                resultExtras: backtests.resultExtras,
                firmRulesVersion: backtests.firmRulesVersion, // #23: for promotion-time firm-rule drift check
              })
              .from(backtests)
              .where(
                and(
                  eq(backtests.strategyId, s.id),
                  eq(backtests.status, "completed"),
                ),
              )
              .orderBy(desc(backtests.createdAt))
              .limit(1);

            let survivalTwinPresentB14 = false;
            if (latestBtForB14?.gateResult) {
              const b14Gate = latestBtForB14.gateResult as Record<string, unknown>;
              // survival_twin.passed=false → HARD block.
              const survivalTwin = b14Gate.survival_twin as Record<string, unknown> | undefined;
              survivalTwinPresentB14 = survivalTwin != null;

              // Hardening 2026-06-22 (F-4): REMOVED the full-history daily-P&L consistency
              // reimplementation (max/sum over entire backtest history). That check used the
              // wrong denominator (aggregate not per-payout-cycle) and was redundant with the
              // authoritative consistency_fail_rate that Python now exposes per-firm in
              // probability_of_ruin_ci.per_firm (sliding-window, MC-simulated, firm-rule-aware).
              //
              // The payout-denial check is now enforced by evaluateB14CiGate() reading
              // per_firm.*.consistency_fail_rate from riskMetrics.probability_of_ruin_ci.per_firm
              // and blocking when worst-firm rate > B14_PAYOUT_DENIAL_THRESHOLD (default 0.10).
              // That check runs in the CI gate block below, which is always evaluated.

              const b14Failed = (survivalTwin && survivalTwin.passed === false);
              if (b14Failed) {
                const blockReason = "b14_survival_twin_failed";
                logger.warn(
                  { strategyId: s.id, blockReason, survivalTwin, transition: "PAPER→DEPLOY_READY" },
                  "B14 Survival Twin HARD gate BLOCKED PAPER→DEPLOY_READY promotion",
                );
                await db.insert(auditLog).values({
                  action: "lifecycle.b14_hard_blocked",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                  result: {
                    reason: blockReason,
                    survival_twin: survivalTwin ?? null,
                    b14_hard_gate_enabled: true,
                  },
                  correlationId,
                }).catch((auditErr: unknown) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "B14 audit insert failed (non-blocking)");
                });
                strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
                await this._maybeAutoGraveyard(s.id, "b14_survival_twin_failed", { survivalTwin: survivalTwin as Record<string, unknown> | undefined }, "PAPER", correlationId);
                continue;
              }
              // Gate passed (survival_twin not failed) — reset consecutive counter
              this._resetHardGateCounter(s.id, "b14_survival_twin_failed", correlationId);
            }

            // HONESTY FIX (autonomous-promotion path): survival_twin is only ever
            // written by the manual replay tool, so on the cron auto-promote path it is
            // ABSENT for every normal strategy and this gate used to silently auto-pass.
            // Evaluate it ON DEMAND via the replay harness. Fail-soft: blocked → skip
            // promotion; advisory_not_evaluated → allow through with a distinct audit so
            // it is visibly un-evaluated; passed → allow through. The B14 ci_high ruin
            // gate below remains the hard ruin guard (defense-in-depth).
            if (!survivalTwinPresentB14 && latestBtForB14?.id) {
              const { resolveSurvivalTwinOnDemand } = await import("../lib/paper-to-deploy-ready-gates.js");
              const od = await resolveSurvivalTwinOnDemand({ strategyId: s.id, backtestId: latestBtForB14.id });
              await db.insert(auditLog).values({
                action: od.status === "blocked"
                  ? "lifecycle.b14_survival_twin_replay_blocked"
                  : od.status === "passed"
                    ? "lifecycle.b14_survival_twin_evaluated"
                    : "lifecycle.b14_survival_twin_advisory_not_evaluated",
                entityId: s.id, entityType: "strategy",
                status: od.status === "blocked" ? "failure" : od.status === "passed" ? "success" : "warning",
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY", evaluated_via: "on_demand_replay" },
                result: { survival_twin_status: od.status, reason: od.reason, per_firm: od.perFirm ?? null, replay_error: od.error ?? null },
                correlationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "B14 survival-twin on-demand audit insert failed (non-blocking)");
              });

              if (od.status === "blocked") {
                logger.warn(
                  { strategyId: s.id, reason: od.reason, perFirm: od.perFirm, transition: "PAPER→DEPLOY_READY" },
                  "B14 Survival Twin ON-DEMAND REPLAY BLOCKED PAPER→DEPLOY_READY promotion",
                );
                strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
                await this._maybeAutoGraveyard(s.id, "b14_survival_twin_replay_blocked", { reason: od.reason, perFirm: od.perFirm }, "PAPER", correlationId);
                continue;
              }
            }

            // Track A.2: B14 survival twin gate evidence
            // If we reach this point without continuing, the survival twin either passed
            // or there was no data (legacy). Push the appropriate evidence status.
            gateEvidenceStatuses.push(latestBtForB14?.gateResult ? "complete" : "legacy_unavailable");
            // No gateResult or survival_twin data → log advisory, allow through
            // (legacy backtests pre-B14 don't have this data).

            // ── Wave 27.5 Pass B.2: B14 CI gate (probability_of_ruin_ci.ci_high) ──
            // Hardening 2026-06-22: threshold tightened 0.40 → 0.20; no-MC path now blocks
            // fail-CLOSED (F-1); payout-denial from per_firm.consistency_fail_rate (F-4/E).
            // Reads the latest MC run for this backtest and evaluates ci_high against threshold.
            // Falls back to scalar for pre-Pass-A runs (scalar also fails-CLOSED if absent).
            if (latestBtForB14?.id) {
              const [latestMcForB14] = await db
                .select({
                  probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
                  riskMetrics: monteCarloRuns.riskMetrics,
                })
                .from(monteCarloRuns)
                .where(
                  and(
                    eq(monteCarloRuns.backtestId, latestBtForB14.id),
                    eq(monteCarloRuns.status, "completed"),
                  ),
                )
                .orderBy(desc(monteCarloRuns.createdAt))
                .limit(1);

              if (latestMcForB14) {
                // #23 (deep-scan 2026-07-11 LOW): re-validate firm_rules_version at PROMOTION time. The
                // MC-run-time guard refuses to RUN MC under stale rules, but nothing re-checked at
                // promotion — so an MC validated under V1 rules could promote after the operator tightens
                // firm_config.py to V2 (within the 30-day staleness window), grading firm-breach ruin
                // against the stale V1 survival model → a strategy that would FAIL B14 under current rules
                // could reach live capital. Block fail-CLOSED on a NON-NULL mismatch; a null version
                // (pre-W27.5 backtest) grandfathers through, matching the MC-run-time guard's behavior.
                const currentFirmRulesVersion = computeFirmRulesVersion();
                const btFirmRulesVersion = latestBtForB14.firmRulesVersion as string | null | undefined;
                if (btFirmRulesVersion != null && btFirmRulesVersion !== currentFirmRulesVersion) {
                  logger.warn(
                    { strategyId: s.id, btFirmRulesVersion, currentFirmRulesVersion, transition: "PAPER→DEPLOY_READY" },
                    "B14 promotion BLOCKED: MC firm_rules_version is stale — re-run the backtest + MC under current firm rules",
                  );
                  await db.insert(auditLog).values({
                    action: "lifecycle.firm_rules_version_stale_block",
                    entityId: s.id,
                    entityType: "strategy",
                    status: "failure",
                    decisionAuthority: "gate",
                    input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                    result: { bt_firm_rules_version: btFirmRulesVersion, current_firm_rules_version: currentFirmRulesVersion, reason: "mc_validated_under_stale_firm_rules" } as Record<string, unknown>,
                    correlationId,
                  }).catch((auditErr: unknown) => {
                    logger.warn({ strategyId: s.id, err: auditErr }, "firm-rules-version stale-block audit insert failed (non-blocking)");
                  });
                  continue;
                }
                const rm = (latestMcForB14.riskMetrics as Record<string, unknown> | null) ?? {};
                const ruinCi = (rm.probability_of_ruin_ci ?? null) as Record<string, unknown> | null;
                const pointEstimate = latestMcForB14.probabilityOfRuin != null
                  ? Number(latestMcForB14.probabilityOfRuin)
                  : null;

                const b14CiResult = evaluateB14CiGate(ruinCi, pointEstimate);
                _incB14GateCounter("PAPER_TO_DEPLOY_READY", b14CiResult);

                // Always emit audit row so dashboard can show gate evaluation history.
                await db.insert(auditLog).values({
                  action: "b14.gate_evaluated",
                  entityId: s.id,
                  entityType: "strategy",
                  status: b14CiResult.passed ? "success" : "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                  result: b14CiResult.auditPayload,
                  correlationId,
                }).catch((auditErr: unknown) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "B14 CI gate audit insert failed (non-blocking)");
                });

                broadcastSSE(LIFECYCLE_GATE_EVENTS.B14_EVALUATED, {
                  correlationId, // deep-scan Obs re-verify F-3: gate-eval SSE carries correlationId (audit row does)
                  strategyId: s.id,
                  ...b14CiResult.auditPayload,
                  passed: b14CiResult.passed,
                  reason: b14CiResult.reason,
                  legacyFallback: b14CiResult.legacyFallback,
                });

                if (!b14CiResult.passed) {
                  logger.warn(
                    {
                      strategyId: s.id,
                      ciHigh: b14CiResult.auditPayload.ci_high,
                      threshold: b14CiResult.auditPayload.threshold,
                      transition: "PAPER→DEPLOY_READY",
                    },
                    "B14 CI gate BLOCKED: probability_of_ruin_ci.ci_high exceeds institutional threshold",
                  );
                  strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
                  await this._maybeAutoGraveyard(s.id, "b14_ci_high", { ciHigh: b14CiResult.auditPayload.ci_high, threshold: b14CiResult.auditPayload.threshold }, "PAPER", correlationId);
                  continue;
                }
                // Gate passed — reset consecutive counter
                this._resetHardGateCounter(s.id, "b14_ci_high", correlationId);

                if (b14CiResult.legacyFallback) {
                  logger.warn(
                    { strategyId: s.id },
                    "B14 CI gate: using legacy scalar fallback (pre-Pass-A MC run — upgrade to get BCa CI)",
                  );
                  // Track A.2: legacy fallback = incomplete evidence
                  gateEvidenceStatuses.push("legacy_null");
                } else {
                  // Track A.2: real CI data present = complete
                  gateEvidenceStatuses.push("complete");
                }
              } else {
                // Deep-scan #5 H2b (2026-06-29): the previous code only pushed
                // "data_unavailable" to the evidence aggregate and the comment FALSELY
                // claimed evaluateB14CiGate(null,null) blocked fail-CLOSED — no such call
                // existed, so a strategy missing ONLY its MC run (1 incomplete gate) sailed
                // past the ≥3-incomplete aggregate and promoted toward live capital with NO
                // ruin evidence. The manual PATCH path (_promoteStrategyInner via the pure
                // evaluator) ALREADY hard-blocks absent MC here; this makes the autonomous
                // cron path match. evaluateB14CiGate(null,null) returns passed=false.
                const b14NoMcResult = evaluateB14CiGate(null, null);
                _incB14GateCounter("PAPER_TO_DEPLOY_READY", b14NoMcResult);
                await db.insert(auditLog).values({
                  action: "b14.gate_evaluated",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                  result: { ...b14NoMcResult.auditPayload, note: "no completed MC run for latest backtest — fail-closed" },
                  correlationId,
                }).catch((auditErr: unknown) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "B14 CI gate (no-MC fail-closed) audit insert failed (non-blocking)");
                });
                broadcastSSE(LIFECYCLE_GATE_EVENTS.B14_EVALUATED, {
                  correlationId, // deep-scan Obs re-verify F-3: gate-eval SSE carries correlationId (audit row does)
                  strategyId: s.id,
                  ...b14NoMcResult.auditPayload,
                  passed: false,
                  reason: b14NoMcResult.reason,
                });
                logger.warn(
                  { strategyId: s.id, transition: "PAPER→DEPLOY_READY" },
                  "B14 CI gate BLOCKED: no completed MC run for latest backtest (fail-closed; re-run MC to promote)",
                );
                strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
                gateEvidenceStatuses.push("data_unavailable");
                continue;
              }
            }
          } catch (b14Err) {
            // Hardening 2026-06-22 (F-2): DB hiccup in B14 gate must BLOCK promotion,
            // not fall through silently. Pattern matches A7 signal-correlation gate catch.
            try { b14GateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
            logger.warn(
              { strategyId: s.id, err: b14Err },
              "B14 Survival Twin gate: infrastructure error — blocking promotion (fail-closed)",
            );
            await db.insert(auditLog).values({
              action: "b14.gate_error_fail_closed",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: { reason: "b14.gate_error_fail_closed", error: String(b14Err) },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "B14 fail-closed audit insert failed (non-blocking)");
            });
            strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
            continue;
          }
        } else {
          logger.warn(
            { strategyId: s.id },
            "B14 Survival Twin HARD gate DISABLED via B14_HARD_GATE_ENABLED=false — advisory only",
          );
          // Track A.2: B14 disabled — evidence incomplete for both survival twin and CI gates
          gateEvidenceStatuses.push("legacy_proceed", "legacy_proceed");
        }

        // ── Wave 25 Item 5: B15 Parameter Robustness Battery gate: PAPER → DEPLOY_READY ──
        // Hardening 2026-06-22 (F-5): default flipped from "false" → "true" (hard gate).
        // Docs claimed HARD and operator requires institutional-grade. Env-overridable for rollback.
        // When B15_BATTERY_ENABLED=true, strategies that ran the battery and FAILED are HARD-blocked.
        // Strategies WITHOUT b15_battery data (pre-B15 backtests) are NEVER blocked — backward compat.
        const b15HardGateEnabled = (process.env.B15_BATTERY_ENABLED ?? "true") === "true";
        try {
          const [latestBtForB15] = await db
            .select({ b15Battery: backtests.b15Battery })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          if (latestBtForB15?.b15Battery) {
            const b15 = latestBtForB15.b15Battery as Record<string, unknown>;
            // Only block when battery explicitly ran and passed=false.
            // Absent b15_battery → skip (backward compat for pre-B15 backtests).
            if (b15.passed === false) {
              const failures = (b15.failures as string[] | undefined) ?? [];
              const sdr = b15.sdr as number | undefined;
              const psi = b15.psi as number | undefined;
              const rws = b15.rws as number | undefined;
              logger.warn(
                { strategyId: s.id, sdr, psi, rws, failures, b15HardGateEnabled, transition: "PAPER→DEPLOY_READY" },
                b15HardGateEnabled
                  ? "B15 Parameter Robustness Battery HARD gate BLOCKED PAPER→DEPLOY_READY promotion"
                  : "B15 Parameter Robustness Battery ADVISORY — promotion continues (B15_BATTERY_ENABLED=false)",
              );
              await db.insert(auditLog).values({
                action: "lifecycle.b15_parameter_robustness_blocked",
                entityId: s.id,
                entityType: "strategy",
                status: b15HardGateEnabled ? "failure" : "warning",
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                result: {
                  sdr: sdr ?? null,
                  psi: psi ?? null,
                  rws: rws ?? null,
                  thresholds: b15.thresholds ?? null,
                  failures,
                  hard_gate_enabled: b15HardGateEnabled,
                },
                correlationId,
              }).catch((auditErr: unknown) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "B15 audit insert failed (non-blocking)");
              });
              if (b15HardGateEnabled) {
                strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
                await this._maybeAutoGraveyard(s.id, "b15_battery_failed", { sdr: b15.sdr, psi: b15.psi, rws: b15.rws, failures: b15.failures }, "PAPER", correlationId);
                continue;
              }
            }
            // Battery ran and passed (or no battery data) — reset consecutive counter
            if (latestBtForB15?.b15Battery && (latestBtForB15.b15Battery as Record<string, unknown>).passed !== false) {
              this._resetHardGateCounter(s.id, "b15_battery_failed", correlationId);
            }
          } else if (b15HardGateEnabled) {
            // Hardening 2026-06-27 (phantom-gate fix): producer default now ON; a null b15Battery
            // on a fresh backtest means the Python battery sentinel was not emitted (data-collection
            // failure or pre-fix backtest). Emit a documented warn + PROCEED — matches the
            // lifecycle.wfe_unavailable_legacy grandfather pattern (not a hard block for missing data).
            // Operator action: re-run the backtest to populate battery data, then retry promotion.
            logger.warn(
              { strategyId: s.id },
              "B15 Parameter Robustness Battery gate: no battery data on latest backtest — lifecycle.b15_unavailable_legacy (warn; promotion continues; re-run backtest to populate battery)",
            );
          }
        } catch (b15Err) {
          // deep-scan 2026-07-11 MED fix: a THROWN read error is a DB fault — NOT the pre-B15 "no
          // battery data" case (that returns a null b15Battery, handled above and legitimately
          // proceeds). When the gate is HARD (B15_BATTERY_ENABLED=true, default), fail CLOSED: skip
          // this promotion so a transient DB error cannot let an un-robustness-validated strategy
          // through, matching the sibling b14/wfe/pbo hard gates on this same transition. Advisory
          // mode (disabled) stays fail-open.
          logger.warn(
            { strategyId: s.id, err: b15Err, b15HardGateEnabled },
            b15HardGateEnabled
              ? "B15 Parameter Robustness Battery gate: read FAILED — blocking PAPER→DEPLOY_READY (fail-closed, hard gate)"
              : "B15 Parameter Robustness Battery gate: read failed (advisory — promotion continues)",
          );
          if (b15HardGateEnabled) {
            await db.insert(auditLog).values({
              action: "lifecycle.b15_gate_read_failed_fail_closed",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: { error: b15Err instanceof Error ? b15Err.message : String(b15Err), fail_closed: true },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "B15 fail-closed audit insert failed (non-blocking)");
            });
            continue;
          }
        }

        // F-5 Hardening 2026-06-23: REMOVED redundant standalone WFE gate (floor 0.70, evaluateWfeGate).
        // This block used WFE_HARD_FLOOR (0.70 via wfe-gate.ts) while the orchestrator below
        // evaluates WFE at WFE_PROMOTION_FLOOR (0.80 via promotion-gate-orchestrator.ts).
        // Running both created a double-evaluation with different floors and created confusion
        // about which gate governed — a strategy could pass the 0.70 standalone check but be
        // blocked by the 0.80 orchestrator check, producing redundant audit rows.
        //
        // Resolution: the orchestrator's 0.80 floor is authoritative for PAPER→DEPLOY_READY.
        // The standalone 0.70 call is removed. WFE tracking for gateEvidenceStatuses is now
        // handled by the orchestrator result below (wfe_floor gate).
        //
        // The standalone evaluateWfeGate call is still active for TESTING→PAPER (a different
        // transition with a separate floor) — that call is unaffected.

        // ── Wave 27.5 Pass B.2 Gate #3: Parameter drift classification: PAPER → DEPLOY_READY ──
        // Reads backtests.walk_forward_results.param_stability.drift_classification (Pass B.1).
        // Pass B.1 walk_forward.py writes regime-context classification into param_stability
        // as {drift_classification, drift_confidence, drift_evidence} — embedded in the
        // existing walkForwardResults JSONB column.
        // overfit_drift + confidence >= 0.70 → HARD block.
        // overfit_drift (low confidence) OR indeterminate → WARN + allow.
        // regime_driven | stable → no action.
        // Null → fail-open for legacy compat.
        try {
          const [latestBtForDrift] = await db
            .select({ walkForwardResults: backtests.walkForwardResults })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          const driftWfResults = (latestBtForDrift?.walkForwardResults as Record<string, unknown> | null) ?? null;
          // param_stability.drift_classification is the regime-context enhanced field.
          // Falls back to binary is_fragile via "indeterminate" in legacy WF runs.
          const paramStability = (driftWfResults?.param_stability as Record<string, unknown> | null) ?? null;
          const driftClassification = (paramStability?.drift_classification as string | null) ?? null;
          const driftConfidence = paramStability?.drift_confidence != null
            ? Number(paramStability.drift_confidence)
            : null;
          // C1 (2026-06-29): top-level param_stability_status → cpcv_exempt on CPCV path
          // (distinct lifecycle.parameter_drift_cpcv_exempt audit, not legacy_null).
          const paramStabilityStatus = (driftWfResults?.param_stability_status as string | null | undefined) ?? null;

          const driftResult = evaluateParameterDriftGate(driftClassification, driftConfidence, paramStabilityStatus);
          _incParameterDriftGateCounter("PAPER_TO_DEPLOY_READY", driftResult);

          broadcastSSE(LIFECYCLE_GATE_EVENTS.PARAMETER_DRIFT_EVALUATED, {
            correlationId: tickCorrelationId, // deep-scan Obs F-3: SSE carries correlationId
            strategyId: s.id,
            classification: driftResult.classification,
            confidence: driftResult.confidence,
            status: driftResult.status,
            passed: driftResult.passed,
          });

          if (driftResult.auditAction) {
            const isBlock = driftResult.status === "blocked";
            logger[isBlock ? "warn" : "info"](
              {
                strategyId: s.id,
                classification: driftResult.classification,
                confidence: driftResult.confidence,
                status: driftResult.status,
                transition: "PAPER→DEPLOY_READY",
              },
              isBlock
                ? "Parameter drift gate BLOCKED PAPER→DEPLOY_READY: overfit_drift with high confidence"
                : `Parameter drift gate ADVISORY: ${driftResult.classification ?? "unavailable"} — promotion continues`,
            );
            await db.insert(auditLog).values({
              action: driftResult.auditAction,
              entityId: s.id,
              entityType: "strategy",
              status: isBlock ? "failure" : "warning",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                classification: driftResult.classification,
                confidence: driftResult.confidence,
                status: driftResult.status,
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "Parameter drift gate audit insert failed (non-blocking)");
            });
            if (isBlock) {
              strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
              // O1-fix-4: wrap graveyard write so a DB hiccup cannot swallow the block decision.
              // The `continue` fires regardless of whether _maybeAutoGraveyard succeeds or throws.
              try {
                await this._maybeAutoGraveyard(s.id, "parameter_overfit_drift", { classification: driftResult.classification, confidence: driftResult.confidence }, "PAPER", correlationId);
              } catch (graveyardErr) {
                logger.warn({ strategyId: s.id, err: graveyardErr }, "parameter_drift _maybeAutoGraveyard threw (non-blocking) — block decision preserved");
              }
              continue; // block decision wins regardless of graveyard write outcome
            }
            // Gate passed (or warn-only) — reset consecutive counter
            this._resetHardGateCounter(s.id, "parameter_overfit_drift", correlationId);
            // Track A.2: push parameter drift status
            gateEvidenceStatuses.push(driftResult.status ?? "legacy_null");
          } else {
            // No auditAction means no drift classification needed (stable/regime_driven)
            gateEvidenceStatuses.push("complete");
          }
        } catch (driftErr) {
          // Fail-open: drift gate read failure is non-blocking.
          try { parameterDriftGateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
          logger.warn(
            { strategyId: s.id, err: driftErr },
            "Parameter drift gate: read failed (non-blocking — promotion continues)",
          );
          // O1-fix-1: emit observable audit row so this fail-open is not silent.
          await db.insert(auditLog).values({
            action: "lifecycle.parameter_drift_infra_error_proceeded",
            entityId: s.id,
            entityType: "strategy",
            status: "warning",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: { error: driftErr instanceof Error ? driftErr.message : String(driftErr), note: "infra read failure — fail-open, promotion continues" },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "parameter_drift_infra_error_proceeded audit insert failed (non-blocking)");
          });
          gateEvidenceStatuses.push("data_unavailable");
        }

        // ── E-1 (deepscan16 Wave 2 Track G2) — DSL guards_failed HARD gate: PAPER → DEPLOY_READY ──
        // Reads backtests.result_extras.dsl_guards.guards_failed (Wave-1 Track 2 producer
        // field). guards_failed=true means the E.3/E.4/E.5 risk-guard block threw mid-backtest
        // and NONE of the stop-ceiling / time-stop / DLL-halt guards ran for that run — the
        // backtest is UNGUARDED, not clean, and must not promote toward live capital. This is
        // the LAST-CHANCE gate before DEPLOY_READY, so it runs regardless of whether the
        // strategy arrived via TESTING→PAPER or SHADOW→PAPER (both already gate it too — this
        // is intentional defense-in-depth, matching how B14/WFE/parameter-drift all re-evaluate
        // at every hop rather than trusting an earlier hop's pass).
        try {
          const [latestBtForDslGuards] = await db
            .select({ resultExtras: backtests.resultExtras })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          const dslGuards = ((latestBtForDslGuards?.resultExtras as Record<string, unknown> | null)?.dsl_guards ?? null) as
            | DslGuardsGateInput
            | null;
          const dslGuardsResult = evaluateDslGuardsGate(dslGuards);
          _incDslGuardsGateCounter("PAPER_TO_DEPLOY_READY", dslGuardsResult);

          broadcastSSE(LIFECYCLE_GATE_EVENTS.DSL_GUARDS_EVALUATED, {
            strategyId: s.id,
            ...dslGuardsResult.auditPayload,
            correlationId, // deep-scan Obs re-verify #3 F-6: DSL-guards HARD gate SSE carries correlationId
            passed: dslGuardsResult.passed,
            reason: dslGuardsResult.reason,
          });

          await db.insert(auditLog).values({
            action: dslGuardsResult.auditAction ?? "lifecycle.dsl_guards_pass",
            entityId: s.id,
            entityType: "strategy",
            status: !dslGuardsResult.passed ? "failure" : dslGuardsResult.status === "legacy_proceed" ? "warning" : "success",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: dslGuardsResult.auditPayload,
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "DSL guards gate (PAPER→DEPLOY_READY) audit insert failed (non-blocking)");
          });

          if (!dslGuardsResult.passed) {
            logger.warn(
              { strategyId: s.id, guardsFailedReason: dslGuardsResult.auditPayload.guards_failed_reason, transition: "PAPER→DEPLOY_READY" },
              "DSL guards gate BLOCKED PAPER→DEPLOY_READY: guards_failed=true (E.3/E.4/E.5 risk guards did not run — unguarded backtest)",
            );
            strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
            try {
              await this._maybeAutoGraveyard(s.id, "dsl_guards_failed", { guardsFailedReason: dslGuardsResult.auditPayload.guards_failed_reason }, "PAPER", correlationId);
            } catch (graveyardErr) {
              logger.warn({ strategyId: s.id, err: graveyardErr }, "dsl_guards_failed _maybeAutoGraveyard threw (non-blocking) — block decision preserved");
            }
            continue; // block decision wins regardless of graveyard write outcome
          }
          // Gate passed (or legacy grandfather) — reset consecutive counter.
          // Deliberately NOT pushed into gateEvidenceStatuses: that array feeds the
          // SEPARATE >=3-incomplete "evidence completeness" governor
          // (evidence-completeness.ts). Every backtest today is pre-Track-2 and would
          // book "legacy_proceed" (an isIncompleteEvidenceStatus "legacy" match) on
          // this brand-new gate, silently tipping strategies that currently sit at
          // 2-incomplete over the 3-incomplete threshold — an unintended change to a
          // DIFFERENT hard gate's blocking behavior. This gate's own pass/block
          // decision (above) is unaffected either way.
          this._resetHardGateCounter(s.id, "dsl_guards_failed", correlationId);
        } catch (dslGuardsErr) {
          // Fail-CLOSED: same severity class as B14 — a read/parse error must not
          // silently allow an unguarded backtest to promote to DEPLOY_READY.
          try { dslGuardsGateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
          logger.warn({ strategyId: s.id, err: dslGuardsErr }, "DSL guards gate (PAPER→DEPLOY_READY): read failed — blocking promotion (fail-closed)");
          await db.insert(auditLog).values({
            action: "lifecycle.dsl_guards_gate_error_fail_closed",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: {
              reason: "lifecycle.dsl_guards_gate_error_fail_closed",
              error: dslGuardsErr instanceof Error ? dslGuardsErr.message : String(dslGuardsErr),
              note: "DSL guards gate threw on PAPER→DEPLOY_READY path — promotion blocked; retries next cron cycle",
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "DSL guards gate fail-closed audit insert (PAPER→DEPLOY_READY) failed (non-blocking)");
          });
          strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
          continue;
        }

        // ── Wave B Fix 1: DSR walk-forward gate (PAPER → DEPLOY_READY) ──────────
        // Reads backtests.walk_forward_results.wf_metadata.{dsr_pass, dsr_unavailable, dsr}
        // (emitted by walk_forward.py FIX 7 / Wave A, 2026-06-22).
        //
        // This gate runs AFTER all Wave 27.5 hard gates clear (B14 ci_high, WFE,
        // parameter drift) and BEFORE the Wave 26 Pass G E orchestrator — DSR is
        // ADDITIVE, never replaces existing gates.
        //
        // Fail-closed on Python DSR computation failure (dsr_unavailable=true);
        // legacy grandfather for pre-Wave-A backtests (dsr_pass absent).
        try {
          const [latestBtForDsr] = await db
            .select({ walkForwardResults: backtests.walkForwardResults })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          const wfResultsDsr = (latestBtForDsr?.walkForwardResults as Record<string, unknown> | null) ?? null;
          const wfMetaDsr = (wfResultsDsr?.wf_metadata as Record<string, unknown> | null) ?? null;

          const dsrGateResult = evaluateDsrWalkForwardGate(
            wfMetaDsr as { dsr_pass?: boolean | null; dsr_unavailable?: boolean | null; dsr?: number | null } | null,
          );

          if (dsrGateResult.auditAction) {
            const isBlockDsr = !dsrGateResult.passed;
            await db.insert(auditLog).values({
              action: dsrGateResult.auditAction,
              entityId: s.id,
              entityType: "strategy",
              status: isBlockDsr ? "failure" : "warning",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: dsrGateResult.auditPayload,
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "DSR gate (PAPER→DEPLOY_READY) audit insert failed (non-blocking)");
            });

            if (isBlockDsr) {
              logger.warn(
                {
                  strategyId: s.id,
                  status: dsrGateResult.status,
                  dsr: dsrGateResult.auditPayload.dsr,
                  transition: "PAPER→DEPLOY_READY",
                },
                `DSR gate BLOCKED PAPER→DEPLOY_READY: ${dsrGateResult.reason}`,
              );
              strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
              // blocked_dsr_floor = genuine Sharpe failure (HARD).
              // blocked_dsr_unavailable = computation infra failure (TRANSIENT).
              if (dsrGateResult.status === "blocked_dsr_floor") {
                // O1-fix-5: wrap graveyard write so a DB hiccup cannot swallow the block decision.
                try {
                  await this._maybeAutoGraveyard(s.id, "dsr_blocked_floor", { dsr: dsrGateResult.auditPayload.dsr, status: dsrGateResult.status }, "PAPER", correlationId);
                } catch (graveyardErr) {
                  logger.warn({ strategyId: s.id, err: graveyardErr }, "dsr _maybeAutoGraveyard threw (non-blocking) — block decision preserved");
                }
              }
              continue; // block decision wins regardless of graveyard write outcome
            }
            // Gate passed — reset consecutive counter
            this._resetHardGateCounter(s.id, "dsr_blocked_floor", correlationId);
            // Track A.2: push DSR status
            gateEvidenceStatuses.push(dsrGateResult.status ?? "legacy_proceed");
          } else {
            // No auditAction = DSR available and passed
            gateEvidenceStatuses.push("complete");
          }
        } catch (dsrPdrErr) {
          // Fail-open: DSR gate infrastructure failure is non-blocking.
          logger.warn(
            { strategyId: s.id, err: dsrPdrErr },
            "DSR gate (PAPER→DEPLOY_READY): read failed (non-blocking — promotion continues)",
          );
          // O1-fix-2: emit observable audit row so this fail-open is not silent.
          await db.insert(auditLog).values({
            action: "lifecycle.dsr_infra_error_proceeded",
            entityId: s.id,
            entityType: "strategy",
            status: "warning",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: { error: dsrPdrErr instanceof Error ? dsrPdrErr.message : String(dsrPdrErr), note: "infra read failure — fail-open, promotion continues" },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "dsr_infra_error_proceeded audit insert failed (non-blocking)");
          });
          gateEvidenceStatuses.push("data_unavailable");
        }

        // ── Deep-scan #5 H1 (2026-06-29): BIF gate on the AUTONOMOUS cron path ──
        // The cron calls promoteStrategy(..., {skipPaperToDeployReadyEvaluator:true}), so the
        // pure evaluator's Gate 6.5 (which holds BIF) never ran here — BIF was enforced ONLY on
        // the manual dashboard PATCH path (_promoteStrategyInner). This block makes the autonomous
        // cron path — the PRIMARY promotion path — enforce BIF identically. Mirrors the manual
        // path (lifecycle-service.ts ~558-631) + bif-gate.ts. CPCV mode (bif_reliable=false) →
        // advisory cpcv_unmeasured pass (BIF≈1.0 structural, Wave 30 carry-forward); bif>4.0 →
        // HARD block; legacy-null → grandfather pass; infra read error → fail-OPEN (additive
        // signal — a DB blip shouldn't block, but a real bif>4 still blocks).
        try {
          const [latestBtForBif] = await db
            .select({
              bif: backtests.bif,
              kEff: backtests.kEff,
              walkForwardResults: backtests.walkForwardResults,
            })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          const bifWfMeta = ((latestBtForBif?.walkForwardResults as Record<string, unknown> | null)?.wf_metadata as Record<string, unknown> | null) ?? null;
          const bifReliableFalse = bifWfMeta?.bif_reliable === false;
          const bifProxyBasis = (bifWfMeta?.bif_proxy_basis as string | null | undefined) ?? null;
          const bifNum = latestBtForBif?.bif != null ? Number(latestBtForBif.bif) : null;
          const kEffNum = latestBtForBif?.kEff != null ? Number(latestBtForBif.kEff) : null;

          // deep-scan promotion L-2: read the computation-error sentinel (top-level of walkForwardResults)
          // so a REAL compute_bif() failure fails the gate CLOSED instead of grandfathering as legacy-null.
          const bifCompError =
            (latestBtForBif?.walkForwardResults as Record<string, unknown> | null)?.bif_computation_error === true;
          const bifResult = evaluateBifGate(
            bifNum,
            kEffNum,
            bifReliableFalse
              ? { bifReliable: false, proxyBasis: bifProxyBasis, computationError: bifCompError }
              : { proxyBasis: bifProxyBasis, computationError: bifCompError },
          );

          const bifOutcome = bifResult.reason === "bif.cpcv_unmeasured"
            ? "cpcv_unmeasured"
            : !bifResult.passed
              ? "blocked"
              : bifResult.legacyNull
                ? "legacy_null"
                : bifResult.reason === "bif.warn_above_warn_threshold"
                  ? "warn"
                  : "clean";
          try { bifGateEvaluationsTotal.labels({ outcome: bifOutcome }).inc(); } catch { /* non-blocking counter */ }

          await db.insert(auditLog).values({
            action: "bif.gate_evaluated",
            entityId: s.id,
            entityType: "strategy",
            status: bifResult.passed
              ? (bifResult.reason === "bif.warn_above_warn_threshold" ? "warning" : "success")
              : "failure",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: bifResult.auditPayload as Record<string, unknown>,
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "BIF gate audit insert (PAPER→DEPLOY_READY) failed (non-blocking)");
          });

          broadcastSSE(LIFECYCLE_GATE_EVENTS.BIF_EVALUATED, {
            strategyId: s.id,
            correlationId, // deep-scan Obs re-verify F-3b: BIF is a HARD gate; SSE must carry correlationId (audit row does)
            ...bifResult.auditPayload,
            passed: bifResult.passed,
            reason: bifResult.reason,
          });

          if (!bifResult.passed) {
            logger.warn(
              { strategyId: s.id, bif: bifResult.auditPayload.bif, threshold: bifResult.auditPayload.block_threshold, transition: "PAPER→DEPLOY_READY" },
              "BIF gate BLOCKED PAPER→DEPLOY_READY: bif exceeds block threshold (synthetic overfit; IS edge does not transfer to OOS)",
            );
            strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
            // O1-fix-6: wrap graveyard write so a DB hiccup cannot swallow the block decision.
            try {
              await this._maybeAutoGraveyard(s.id, "bif_blocked", { bif: bifResult.auditPayload.bif, threshold: bifResult.auditPayload.block_threshold }, "PAPER", correlationId);
            } catch (graveyardErr) {
              logger.warn({ strategyId: s.id, err: graveyardErr }, "bif _maybeAutoGraveyard threw (non-blocking) — block decision preserved");
            }
            continue; // block decision wins regardless of graveyard write outcome
          }
          // Gate passed (clean / warn / cpcv_unmeasured / legacy) — reset consecutive counter
          this._resetHardGateCounter(s.id, "bif_blocked", correlationId);
          // FIX M1: route through the shared bucket helper. A malformed/producer-error
          // BIF reason books INCOMPLETE "malformed" instead of a false "complete"
          // (BIF coerces garbage bif → legacyNull today, so this is forward-safe).
          gateEvidenceStatuses.push(bifEvidenceBucket(bifResult.legacyNull, bifResult.reason));
        } catch (bifErr) {
          logger.warn(
            { strategyId: s.id, err: bifErr },
            "BIF gate (PAPER→DEPLOY_READY): read failed (non-blocking — promotion continues)",
          );
          // O1-fix-3: emit observable audit row so this fail-open is not silent.
          await db.insert(auditLog).values({
            action: "lifecycle.bif_infra_error_proceeded",
            entityId: s.id,
            entityType: "strategy",
            status: "warning",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: { error: bifErr instanceof Error ? bifErr.message : String(bifErr), note: "infra read failure — fail-open, promotion continues" },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "bif_infra_error_proceeded audit insert failed (non-blocking)");
          });
          gateEvidenceStatuses.push("data_unavailable");
        }

        // ── Wave A (2026-07-03) — Slippage-Survival gate, cron-path enforcement ──
        // Mirrors the BIF block immediately above (same fetch/evaluate/audit/SSE/
        // block/reset-counter shape). Default-OFF via SLIPPAGE_SURVIVAL_GATE_ENABLED
        // (advisory-only — never alters flow while disabled); legacy-null and
        // insufficient-sample both grandfather-pass with a warn. See design spec:
        // docs/superpowers/specs/2026-07-03-slippage-survival-gate-design.md
        try {
          const [latestBtForSlippage] = await db
            .select({ slippageSurvival: backtests.slippageSurvival })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          const slippageSurvivalResult = evaluateSlippageSurvivalGate(
            (latestBtForSlippage?.slippageSurvival ?? null) as import("../lib/slippage-survival-gate.js").SlippageSurvivalDict | null,
          );

          await db.insert(auditLog).values({
            action: "slippage_survival.gate_evaluated",
            entityId: s.id,
            entityType: "strategy",
            status: slippageSurvivalResult.passed
              ? (slippageSurvivalResult.status === "clean" || slippageSurvivalResult.status === "disabled" ? "success" : "warning")
              : "failure",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: slippageSurvivalResult.auditPayload as Record<string, unknown>,
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "slippage_survival.gate_evaluated audit insert (PAPER→DEPLOY_READY) failed (non-blocking)");
          });

          broadcastSSE(LIFECYCLE_GATE_EVENTS.SLIPPAGE_SURVIVAL_EVALUATED, {
            strategyId: s.id,
            ...slippageSurvivalResult.auditPayload,
            passed: slippageSurvivalResult.passed,
            reason: slippageSurvivalResult.reason,
            // §2 correlation_id mandate: thread the same id the audit row carries.
            correlationId,
          });

          if (!slippageSurvivalResult.passed) {
            try {
              slippageSurvivalBlocksTotal.labels({ breaks_at: String(slippageSurvivalResult.auditPayload.breaks_at) }).inc();
            } catch { /* non-blocking counter */ }
            logger.warn(
              { strategyId: s.id, breaks_at: slippageSurvivalResult.auditPayload.breaks_at, threshold: slippageSurvivalResult.auditPayload.block_mult, transition: "PAPER→DEPLOY_READY" },
              "Slippage-Survival gate BLOCKED PAPER→DEPLOY_READY: edge dies at or below block multiple (living on optimistic fills)",
            );
            strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
            try {
              await this._maybeAutoGraveyard(s.id, "slippage_survival_blocked", { breaks_at: slippageSurvivalResult.auditPayload.breaks_at, threshold: slippageSurvivalResult.auditPayload.block_mult }, "PAPER", correlationId);
            } catch (graveyardErr) {
              logger.warn({ strategyId: s.id, err: graveyardErr }, "slippage_survival _maybeAutoGraveyard threw (non-blocking) — block decision preserved");
            }
            continue; // block decision wins regardless of graveyard write outcome
          }
          this._resetHardGateCounter(s.id, "slippage_survival_blocked", correlationId);
          // FIX M1: a malformed (wrong-key / broken-producer) slippage_survival row
          // now books INCOMPLETE "malformed" — previously it was silently booked
          // "complete", letting a broken-producer strategy dodge the >=3-incomplete
          // governor. legacy_null keeps its existing bucket; genuine passes → "complete".
          gateEvidenceStatuses.push(slippageEvidenceBucket(slippageSurvivalResult.status));
        } catch (slippageSurvivalErr) {
          logger.warn(
            { strategyId: s.id, err: slippageSurvivalErr },
            "Slippage-Survival gate (PAPER→DEPLOY_READY): read failed (non-blocking — promotion continues)",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.slippage_survival_infra_error_proceeded",
            entityId: s.id,
            entityType: "strategy",
            status: "warning",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: { error: slippageSurvivalErr instanceof Error ? slippageSurvivalErr.message : String(slippageSurvivalErr), note: "infra read failure — fail-open, promotion continues" },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "slippage_survival_infra_error_proceeded audit insert failed (non-blocking)");
          });
          gateEvidenceStatuses.push("data_unavailable");
        }

        // ── Wave 26 Pass G Pass E Gate Stack: WFE-0.80 + CPCV-15 + WRC + SPA ─
        // Evaluates 4 additional institutional gates via promotion-gate-orchestrator.
        // The orchestrator reads pre-fetched backtest data and applies AND logic:
        //
        //   Gate 1 (wfe_floor): WFE >= WFE_PROMOTION_FLOOR (default 0.80 — lifted
        //     from 0.70 per Bailey & Lopez de Prado 2025 conference). Backward-compat:
        //     strategies already at DEPLOY_READY/PILOT/DEPLOYED not demoted; floor
        //     applies only to new PAPER → DEPLOY_READY transitions.
        //
        //   Gate 2 (cpcv_n_paths): latest CPCV run must have n_paths >= CPCV_MIN_PATHS
        //     (default 15, env CPCV_MIN_PATHS). Fails-open when no CPCV run yet.
        //
        //   Gate 3 (wrc_p): White's Reality Check p_value < 0.05. Fails-open for
        //     pre-Pass-E backtests that lack wrc_result.
        //
        //   Gate 4 (spa_p): Hansen SPA spa_consistent_p < 0.05. Fails-open for
        //     pre-Pass-E backtests that lack spa_result.
        //
        // When ANY gate blocks: write audit `promotion.gate_failed` + continue (skip promotion).
        // When ALL pass: write audit `promotion.gates_cleared` and proceed.
        // Note: B14 ci_high gate continues to run via its existing block above; the
        // orchestrator's b14 result is redundant here but included for the unified
        // `promotion.gates_cleared` audit row.
        try {
          const [latestBtForOrch] = await db
            .select({
              walkForwardResults: backtests.walkForwardResults,
              wrcResult: backtests.wrcResult,
              spaResult: backtests.spaResult,
              gateResult: backtests.gateResult,
            })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          if (latestBtForOrch) {
            const wfResults = (latestBtForOrch.walkForwardResults as Record<string, unknown> | null) ?? null;
            const wfeOverall = wfResults?.wfe_overall != null ? Number(wfResults.wfe_overall) : null;

            // CPCV n_paths lives in wf_metadata sub-object
            const wfMeta = (wfResults?.wf_metadata as Record<string, unknown> | null) ?? null;
            const cpcvNPaths = wfMeta?.mode === "cpcv" && wfMeta.n_paths != null
              ? Number(wfMeta.n_paths)
              : null;

            const wrcData = (latestBtForOrch.wrcResult as Record<string, unknown> | null) ?? null;
            const wrcPValue = wrcData?.p_value != null ? Number(wrcData.p_value) : null;

            const spaData = (latestBtForOrch.spaResult as Record<string, unknown> | null) ?? null;
            const spaConsistentP = spaData?.spa_consistent_p != null ? Number(spaData.spa_consistent_p) : null;

            // Run the orchestrator (skipping B14 — already evaluated above)
            const orchResult = evaluatePromotionGates({
              ruinCi: null,       // B14 already handled by the dedicated block above
              wfeOverall,
              cpcvNPaths,
              wrcPValue,
              spaConsistentP,
            });

            // Deep-scan #16 Wave-1 Track 5 (HIGH E-6): the Pass E orchestrator's wfe_floor
            // sub-gate is a SECOND WFE evaluation site (distinct from the standalone WFE-gate
            // helper invocation used for TESTING→PAPER/SHADOW→PAPER above — see the
            // F-5 removal note near line ~5123). It has no `status`/`legacyFallback` field,
            // only {passed, data_available} — data_available===false means the gate had
            // no backtest data to evaluate (mapped to "legacy" for consistency with the
            // other two counters' semantics).
            {
              const wfeFloorRes = orchResult.gate_results.wfe_floor;
              const wfeFloorOutcome = wfeFloorRes.data_available === false
                ? "legacy"
                : wfeFloorRes.passed ? "pass" : "block";
              try {
                wfeGateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: wfeFloorOutcome }).inc();
              } catch { /* non-blocking counter */ }
            }

            // Remove b14 from orchestrator result to avoid double-counting
            const gatesToEvaluate: Array<"wfe_floor" | "cpcv_n_paths" | "wrc_p" | "spa_p"> =
              ["wfe_floor", "cpcv_n_paths", "wrc_p", "spa_p"];

            const orchFailingGates = gatesToEvaluate.filter(
              (g) => !orchResult.gate_results[g].passed,
            );

            if (orchFailingGates.length > 0) {
              // At least one Pass E gate blocked
              const primaryFail = orchResult.gate_results[orchFailingGates[0]!];
              logger.warn(
                {
                  strategyId: s.id,
                  failingGates: orchFailingGates,
                  gateDetails: orchFailingGates.map((g) => ({
                    gate: g,
                    value: orchResult.gate_results[g].value,
                    threshold: orchResult.gate_results[g].threshold,
                    reason: orchResult.gate_results[g].reason,
                  })),
                  transition: "PAPER→DEPLOY_READY",
                },
                "Wave 26 Pass G Pass E gates BLOCKED PAPER→DEPLOY_READY promotion",
              );
              for (const gate of orchFailingGates) {
                const gateRes = orchResult.gate_results[gate];
                await db.insert(auditLog).values({
                  action: "promotion.gate_failed",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                  result: {
                    gate,
                    value: gateRes.value,
                    threshold: gateRes.threshold,
                    reason: gateRes.reason,
                    data_available: gateRes.data_available,
                  },
                  correlationId,
                }).catch((auditErr: unknown) => {
                  logger.warn({ strategyId: s.id, gate, err: auditErr }, "Pass E gate_failed audit insert failed (non-blocking)");
                });
                // data_available: false → strategy just lacks data yet (TRANSIENT); don't count toward burial.
                // data_available: true → gate evaluated against real data and failed (HARD).
                // Fail-safe: undefined/null data_available is treated as TRANSIENT (don't bury on uncertainty).
                if (gateRes.data_available === true) {
                  // Use a stable gate name by prefixing with "promotion_gate_"
                  await this._maybeAutoGraveyard(
                    s.id,
                    `promotion_gate_${gate}`,
                    { gate, value: gateRes.value, threshold: gateRes.threshold, reason: gateRes.reason },
                    "PAPER",
                    correlationId,
                  );
                }
              }
              strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
              continue;
            }
            // All orchestrator gates cleared — reset consecutive counters for gates that had data_available
            for (const gate of gatesToEvaluate) {
              if (orchResult.gate_results[gate].data_available === true) {
                this._resetHardGateCounter(s.id, `promotion_gate_${gate}`, correlationId);
              }
            }

            // All Pass E gates cleared — write gates_cleared audit (advisory, not blocking)
            await db.insert(auditLog).values({
              action: "promotion.gates_cleared",
              entityId: s.id,
              entityType: "strategy",
              status: "success",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                wfe_floor: {
                  value: orchResult.gate_results.wfe_floor.value,
                  threshold: orchResult.gate_results.wfe_floor.threshold,
                  data_available: orchResult.gate_results.wfe_floor.data_available,
                },
                cpcv_n_paths: {
                  value: orchResult.gate_results.cpcv_n_paths.value,
                  threshold: orchResult.gate_results.cpcv_n_paths.threshold,
                  data_available: orchResult.gate_results.cpcv_n_paths.data_available,
                },
                wrc_p: {
                  value: orchResult.gate_results.wrc_p.value,
                  threshold: orchResult.gate_results.wrc_p.threshold,
                  data_available: orchResult.gate_results.wrc_p.data_available,
                },
                spa_p: {
                  value: orchResult.gate_results.spa_p.value,
                  threshold: orchResult.gate_results.spa_p.threshold,
                  data_available: orchResult.gate_results.spa_p.data_available,
                },
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "Pass E gates_cleared audit insert failed (non-blocking)");
            });
            // Track A.2: check orchestrator data availability for evidence scoring
            const orchDataAvailable = gatesToEvaluate.every((g) => orchResult.gate_results[g].data_available !== false);
            gateEvidenceStatuses.push(orchDataAvailable ? "complete" : "legacy_proceed");
          } else {
            // No backtest data for orchestrator — evidence unavailable
            gateEvidenceStatuses.push("data_unavailable");
          }
        } catch (orchErr) {
          // F-4 Hardening 2026-06-23: Fail-CLOSED on orchestrator infrastructure error.
          // The orchestrator evaluates WFE-0.80, CPCV-15, WRC, and SPA — all institutional gates.
          // An orchestrator that cannot run must BLOCK promotion, not silently allow it.
          // Deep-scan #16 Wave-1 Track 5: this orchestrator failure blocks the wfe_floor
          // sub-gate too (it never got the chance to evaluate) — count it as an error.
          try { wfeGateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: "error" }).inc(); } catch { /* non-blocking counter */ }
          const orchErrMsg = orchErr instanceof Error ? orchErr.message : String(orchErr);
          logger.warn(
            { strategyId: s.id, err: orchErr },
            "Wave 26 Pass G Pass E gate orchestrator: read failed — blocking promotion (fail-closed)",
          );
          await db.insert(auditLog).values({
            action: "promotion.orchestrator_error_fail_closed",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: {
              reason: "orchestrator_infrastructure_error",
              error: orchErrMsg,
              note: "Pass E orchestrator threw — promotion blocked (fail-closed); retries next cron cycle",
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "orchestrator fail-closed audit insert failed (non-blocking)");
          });
          strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
          continue;
        }

        // ── Wave 28 Pass B.1: Composite shadow gate (OBSERVABILITY ONLY) ─────
        //
        // OBSERVABILITY ONLY — Pass B shadow mode; Wave 27.5 hard gates remain
        // authoritative. See Wave 28 plan.
        //
        // This block runs AFTER all Wave 27.5 hard gates (B14 ci_high, WFE,
        // parameter drift, orchestrator gates) have already made their
        // ALLOW/BLOCK decisions.  The composite shadow result is logged as an
        // audit row so 14 days of agreement data can accumulate before Pass C
        // considers activation.  The shadow result NEVER changes the hard-gate
        // decision that precedes or follows it.  Fail-OPEN for observability:
        // any throw is caught, emits composite.shadow_evaluation_error, and
        // promotion proceeds via the hard-gate outcome alone.
        {
          // hard_gate_outcome reflects whether all gates above allowed promotion.
          // We have reached this line only because none of the earlier `continue`
          // statements fired — so hard gates ALLOWED this promotion attempt.
          // The type is widened to string so the agreement branches compile cleanly
          // (TypeScript would otherwise flag the "blocked" branches as dead code
          // because the const literal type narrows to "allowed").
          //
          // ⚠️ F-1 (obs re-scan 2026-07-10, HIGH — DISCLOSED, not silent): this call site
          // ONLY runs on the ALLOW path, so the composite.shadow_evaluation rows it emits can
          // only ever be agree_allow / disagree_shadow_blocks / shadow_no_opinion — NEVER
          // agree_block / disagree_shadow_allows. The evidence is therefore ONE-SIDED (allow
          // direction only). shadow-evidence-analyzer.ts now FAIL-SAFES on this: it refuses
          // ACTIVATE_PASS_C while block-direction evidence is absent (NO_BLOCK_DIRECTION_EVIDENCE
          // flag). To collect the missing block-direction evidence, evaluateCompositeShadow must
          // ALSO be invoked at each hard-gate BLOCK `continue` above (with hardGateOutcome=
          // "blocked") — a STAGED instrument follow-up (touches the promotion path; requires
          // operator ratification) tracked as the Pass-C activation prerequisite.
          const hardGateOutcome: string = "allowed";

          try {
            const shadowResult = await evaluateCompositeShadow(s.id);

            // Compute agreement between shadow and hard-gate outcome.
            type AgreementLabel =
              | "agree_allow"
              | "agree_block"
              | "disagree_shadow_blocks"
              | "disagree_shadow_allows"
              | "shadow_no_opinion";

            let agreement: AgreementLabel;
            if (
              shadowResult.shadow_decision === "NO_OPINION" ||
              shadowResult.shadow_decision === "WOULD_WARN"
            ) {
              agreement = "shadow_no_opinion";
            } else if (hardGateOutcome === "allowed" && shadowResult.shadow_decision === "WOULD_PROMOTE") {
              agreement = "agree_allow";
            } else if (hardGateOutcome === "allowed" && shadowResult.shadow_decision === "WOULD_BLOCK") {
              agreement = "disagree_shadow_blocks";
            } else if (hardGateOutcome === "blocked" && shadowResult.shadow_decision === "WOULD_BLOCK") {
              agreement = "agree_block";
            } else if (hardGateOutcome === "blocked" && shadowResult.shadow_decision === "WOULD_PROMOTE") {
              agreement = "disagree_shadow_allows";
            } else {
              agreement = "shadow_no_opinion";
            }

            await db.insert(auditLog).values({
              action: "composite.shadow_evaluation",
              entityId: s.id,
              entityType: "strategy",
              status: "success",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                strategy_id: s.id,
                hard_gate_outcome: hardGateOutcome,
                shadow_result: shadowResult,
                agreement,
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "composite shadow evaluation audit insert failed (non-blocking)");
            });

            logger.info(
              {
                strategyId: s.id,
                agreement,
                shadow_decision: shadowResult.shadow_decision,
                composite_score: shadowResult.composite_score,
                verdict: shadowResult.verdict,
                availability: shadowResult.availability,
                hard_gate_outcome: hardGateOutcome,
              },
              "composite-shadow-gate: shadow evaluation logged (observability only — no gate authority)",
            );

            // ── Wave 28 Pass B.2: Discord disagreement routing ──────────────
            // Fire-and-forget — must never block or throw into this try-block.
            // Agreements and shadow_no_opinion are silenced inside the router.
            routeShadowDisagreementAlert({
              strategyId: s.id,
              strategyName: s.name,
              hardGateOutcome,
              shadow_result: shadowResult,
              agreement,
            }).catch((routerErr) => {
              logger.warn(
                { strategyId: s.id, err: routerErr },
                "composite-shadow-discord-router: unexpected throw (caught at lifecycle boundary) — promotion unaffected",
              );
            });
          } catch (shadowErr) {
            // Fail-OPEN: shadow infrastructure must NEVER cause a real lifecycle failure.
            // Catch any throw, emit a separate error audit, and proceed to promoteStrategy.
            const msg = shadowErr instanceof Error ? shadowErr.message : String(shadowErr);
            logger.warn(
              { strategyId: s.id, err: shadowErr },
              "composite-shadow-gate: helper threw — emitting error audit, promotion proceeds (fail-OPEN)",
            );
            await db.insert(auditLog).values({
              action: "composite.shadow_evaluation_error",
              entityId: s.id,
              entityType: "strategy",
              status: "warning",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                error: msg,
                hard_gate_outcome: hardGateOutcome,
                note: "composite shadow gate threw — promotion proceeds via Wave 27.5 hard gates alone",
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              // Deep-scan #5 H3 (2026-06-29): was silently swallowed.
              logger.warn({ err: auditErr, correlationId }, "composite_shadow_evaluation_error audit insert failed (non-blocking)");
              auditWriteFailuresTotal.labels({ action: "composite.shadow_evaluation_error" }).inc();
            });
          }
          // Track A.2: composite shadow gate is observability-only and always runs —
          // evidence is always "complete" (the evaluator itself handles missing data).
          gateEvidenceStatuses.push("complete");
        }
        // ── End Wave 28 Pass B.1 composite shadow gate ───────────────────────

        // ── Wave 29 Pass B.2: Frozen-policy drift gate (PAPER → DEPLOY_READY) ──
        // Gate: evaluate whether the live config hash matches the frozen hash.
        //   - First-time freeze (frozenPolicyHash == null): PERMIT promotion + stamp hash.
        //   - Hash matches: PERMIT promotion — policy is stable.
        //   - Hash mismatch (config changed since freeze): BLOCK promotion.
        //     Operator must POST /api/admin/frozen-policy-override with HMAC + rationale ≥50.
        // Fail-soft: hash computation error → emit warn audit + PROCEED (never block on hash plumbing).
        let frozenPolicyBlocked = false;
        try {
          const driftResult = evaluateFrozenPolicyDriftAtPromotion({
            id: s.id,
            config: s.config,
            frozenPolicyHash: s.frozenPolicyHash,
          });

          if (!driftResult.ok && driftResult.frozenHash !== null) {
            // Hash mismatch — config changed after policy was frozen.  Hard block.
            frozenPolicyBlocked = true;
            logger.warn(
              {
                strategyId: s.id,
                currentHash: driftResult.currentHash.slice(0, 16),
                frozenHash: (driftResult.frozenHash ?? "").slice(0, 16),
                transition: "PAPER→DEPLOY_READY",
              },
              "Frozen-policy drift gate BLOCKED PAPER→DEPLOY_READY promotion",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.frozen_policy_drift_blocked",
              entityId: s.id,
              entityType: "strategy",
              status: "blocked",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                strategy_id: s.id,
                current_hash: driftResult.currentHash,
                frozen_hash: driftResult.frozenHash,
                reason: driftResult.reason ?? "frozen_policy.hash_mismatch",
                note: "Operator must POST /api/admin/frozen-policy-override with HMAC + rationale ≥50 chars",
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "frozen_policy drift-block audit failed (non-blocking)");
            });
            broadcastSSE(LIFECYCLE_GATE_EVENTS.FROZEN_POLICY_DRIFT_BLOCKED, {
              strategyId: s.id,
              current_hash: driftResult.currentHash,
              frozen_hash: driftResult.frozenHash ?? null,
              correlationId: correlationId,
            });
            continue; // skip this strategy in the current pass
          }

          if (driftResult.ok && driftResult.frozenHash === null) {
            // First-time freeze: stamp the policy hash + regime. AWAITED — a persistent
            // freeze failure means the hash was never stamped and we cannot verify policy
            // integrity. Block this cycle; the strategy retries next cron pass once the
            // DB write succeeds. (Wave hardening 2026-06-22, frozen-policy fail-CLOSED per CLAUDE.md §12)
            let currentRegime = "UNKNOWN";
            try {
              const { biasState: biasStateTable } = await import("../db/schema.js");
              const biasStateRows = await db
                .select({ regimeLabel: biasStateTable.regimeLabel })
                .from(biasStateTable)
                .limit(1)
                .catch(() => [] as { regimeLabel: string }[]);
              if (biasStateRows.length > 0 && typeof biasStateRows[0].regimeLabel === "string") {
                currentRegime = biasStateRows[0].regimeLabel;
              }
            } catch {
              // Regime lookup error is non-fatal — UNKNOWN is a valid regime label.
            }

            try {
              await freezePolicyForStrategy(s.id, currentRegime);
              logger.info(
                { strategyId: s.id, regime: currentRegime },
                "Frozen-policy first-time freeze: hash stamped successfully",
              );
            } catch (freezeErr) {
              // Hash was not stamped — cannot verify policy integrity this cycle. Block.
              frozenPolicyBlocked = true;
              const freezeMsg = freezeErr instanceof Error ? freezeErr.message : String(freezeErr);
              logger.warn({ strategyId: s.id, err: freezeErr }, "frozen_policy first-time freeze failed — blocking promotion until hash is stamped (fail-CLOSED per CLAUDE.md §12)");
              await db.insert(auditLog).values({
                action: "frozen_policy.hash_compute_failed",
                entityId: s.id,
                entityType: "strategy",
                status: "blocked",
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                result: { error: freezeMsg, note: "first-time freeze write failed — promotion blocked; retries next cron cycle" },
                correlationId,
              }).catch((auditErr: unknown) => {
                // Deep-scan #5 H3 (2026-06-29): was silently swallowed.
                logger.warn({ err: auditErr, correlationId }, "frozen_policy.hash_compute_failed (freeze-write) audit insert failed (non-blocking)");
                auditWriteFailuresTotal.labels({ action: "frozen_policy.hash_compute_failed" }).inc();
              });
              continue;
            }
          }
        } catch (frozenPolicyErr) {
          // Wave hardening 2026-06-22, frozen-policy fail-CLOSED per CLAUDE.md §12:
          // hash compute exceptions block promotion; strategy stays in PAPER and retries
          // next cycle once the underlying error is fixed.
          frozenPolicyBlocked = true;
          const msg = frozenPolicyErr instanceof Error ? frozenPolicyErr.message : String(frozenPolicyErr);
          logger.warn({ strategyId: s.id, err: frozenPolicyErr }, "frozen_policy gate threw — blocking promotion (fail-CLOSED per CLAUDE.md §12)");
          await db.insert(auditLog).values({
            action: "frozen_policy.hash_compute_failed",
            entityId: s.id,
            entityType: "strategy",
            status: "blocked",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: { error: msg, note: "hash compute exception — promotion blocked until manual investigation" },
            correlationId,
          }).catch((auditErr: unknown) => {
            // Deep-scan #5 H3 (2026-06-29): was silently swallowed.
            logger.warn({ err: auditErr, correlationId }, "frozen_policy.hash_compute_failed (exception) audit insert failed (non-blocking)");
            auditWriteFailuresTotal.labels({ action: "frozen_policy.hash_compute_failed" }).inc();
          });
        }

        if (frozenPolicyBlocked) continue; // already continued above; guard for clarity
        // ── End Wave 29 Pass B.2 frozen-policy drift gate ────────────────────

        // Track A.2: frozen-policy gate completed with data (strategy has a config hash)
        gateEvidenceStatuses.push(s.frozenPolicyHash != null ? "complete" : "legacy_proceed");

        // ── Track A.2: Evidence completeness gate ─────────────────────────────
        // Count incomplete gate evidence (legacy fallbacks or unavailable data).
        // If >= 3 of the 8 tracked gates lack institutional-quality data, write
        // a lifecycle.promotion_evidence_incomplete audit row + Discord WARN and
        // block promotion this cycle (strategy retries next cron pass).
        {
          const incompleteCount = gateEvidenceStatuses.filter(
            isIncompleteEvidenceStatus,
          ).length;
          if (incompleteCount >= 3) {
            logger.warn(
              {
                strategyId: s.id,
                incompleteCount,
                gateEvidenceStatuses,
                transition: "PAPER→DEPLOY_READY",
              },
              "lifecycle.promotion_evidence_incomplete: too many gates lack institutional data — blocking promotion this cycle",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.promotion_evidence_incomplete",
              entityId: s.id,
              entityType: "strategy",
              status: "warn",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                incomplete_count: incompleteCount,
                total_gates: gateEvidenceStatuses.length,
                gate_evidence_statuses: gateEvidenceStatuses,
                note: "Strategy must complete institutional-grade backtests before promotion proceeds",
              },
              correlationId: correlationId ?? null,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "promotion_evidence_incomplete audit insert failed (non-blocking)");
            });
            notifyWarning(
              `Evidence Incomplete: strategy ${s.name} blocked from PAPER→DEPLOY_READY`,
              appendFamilyGradePostscript(
                `Strategy \`${s.name}\` (${s.id.slice(0, 8)}) blocked from PAPER→DEPLOY_READY: ` +
                `${incompleteCount}/${gateEvidenceStatuses.length} gates lack institutional data. ` +
                `Run a full backtest to unlock promotion.`,
                "The bot can't verify this strategy has been tested properly because some quality checks lack data.",
                "No action needed — re-run a full backtest on this strategy and the bot will retry.",
              ),
            );
            // M8: SSE broadcast so dashboard consumers can surface evidence-incomplete
            // blocks without polling audit_log. Uses catalog constant to prevent
            // magic-string drift. Mirrors the pattern of other lifecycle gate broadcasts.
            broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTION_EVIDENCE_INCOMPLETE, {
              strategyId: s.id,
              strategy_name: s.name,
              incomplete_count: incompleteCount,
              total_gates: gateEvidenceStatuses.length,
              gate_evidence_statuses: gateEvidenceStatuses,
              correlationId: correlationId ?? null,
            });

            // ─── FIX 3 (DEBT-3) 2026-06-24: auto-backtest enqueue on evidence-incomplete ────
            // If the gate blocks for lack of institutional-grade backtest data, automatically
            // enqueue a backtest so the strategy doesn't stall for the entire vacation.
            // Cap: 1 auto-enqueue per strategy per 24h (audit_log count, mirrors heartbeat pattern).
            // Actor is "automated" so it respects pipeline pause.
            // Fire-and-forget (no await) — lifecycle cycle must not block on backtest duration.
            // Discord INFO (not CRITICAL) — research pipeline, no live capital involved.
            void (async () => {
              try {
                const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const recentAutoEnqueues = await db
                  .select({ id: auditLog.id })
                  .from(auditLog)
                  .where(
                    and(
                      eq(auditLog.action, "lifecycle.evidence_auto_backtest_enqueued"),
                      eq(auditLog.entityId, s.id),
                      gte(auditLog.createdAt, twentyFourHoursAgo),
                    ),
                  );

                if (recentAutoEnqueues.length >= 1) {
                  logger.debug(
                    { strategyId: s.id, recentCount: recentAutoEnqueues.length },
                    "FIX-3: lifecycle evidence-incomplete: auto-backtest-enqueue cap reached today, skipping",
                  );
                  return;
                }

                logger.info(
                  { strategyId: s.id, strategyName: s.name, incompleteCount, correlationId },
                  "FIX-3: auto-enqueuing backtest for evidence-incomplete strategy",
                );

                const { runBacktest } = await import("./backtest-service.js");
                const btResult = await runBacktest(
                  s.id,
                  {
                    strategy: {
                      name: s.name,
                      symbol: s.symbol ?? "MES",
                      timeframe: "5m",
                      indicators: [],
                      entry_long: "",
                      entry_short: "",
                      exit: "",
                      stop_loss: { type: "atr", multiplier: 2.0 },
                      position_size: { type: "dynamic_atr", target_risk_dollars: 500 },
                    },
                    mode: "walkforward",
                  },
                  undefined,
                  undefined,
                  correlationId ?? undefined,
                  "automated",
                );

                await db.insert(auditLog).values({
                  action: "lifecycle.evidence_auto_backtest_enqueued",
                  entityType: "strategy",
                  entityId: s.id,
                  status: btResult.status === "skipped" ? "skipped" : "success",
                  decisionAuthority: "lifecycle_service",
                  input: { strategyName: s.name, incompleteCount, totalGates: gateEvidenceStatuses.length },
                  result: { backtest_id: btResult.id, backtest_status: btResult.status },
                  correlationId: correlationId ?? null,
                }).catch((auditErr: unknown) => {
                  logger.warn({ err: auditErr, strategyId: s.id }, "FIX-3: lifecycle.evidence_auto_backtest_enqueued audit write failed");
                });

                logger.info(
                  { strategyId: s.id, backtestId: btResult.id, backtestStatus: btResult.status },
                  "FIX-3: auto-backtest enqueued for evidence-incomplete strategy",
                );
              } catch (enqueueErr) {
                logger.error(
                  { strategyId: s.id, strategyName: s.name, err: enqueueErr },
                  "FIX-3: auto-backtest enqueue threw unexpectedly (non-blocking, lifecycle continues)",
                );
              }
            })();
            // ─── End FIX 3 ────────────────────────────────────────────

            continue;
          }
          // Evidence is adequate — compute composite score and proceed.
          // Score is persisted into lifecycle_transitions.result after successful promotion.
          // Finding 4 fix 2026-06-29: derive the denominator from the actual number of
          // tracked gates, NOT a hardcoded 8. After F-5 removed the inline standalone WFE
          // gate, gateEvidenceStatuses.length is no longer 8, so `/ 8.0` produced a score
          // inconsistent with total_gates (gateEvidenceStatuses.length) reported in the
          // audit/SSE payloads above. Math.max(1, …) guards the (theoretically impossible)
          // zero-length case so the score can never divide by zero.
          const evidenceDenominator = Math.max(1, gateEvidenceStatuses.length);
          const compositeEvidenceScore = 1.0 - (incompleteCount / evidenceDenominator);
          logger.info(
            { strategyId: s.id, compositeEvidenceScore, incompleteCount, total: gateEvidenceStatuses.length },
            "Track A.2: composite_evidence_score computed — promotion proceeding",
          );
        }

        // Fix #4 (2026-06-29): skipPaperToDeployReadyEvaluator=true — the inline gate
        // stack above already evaluated every PAPER → DEPLOY_READY gate (incl. the
        // on-demand B14 survival-twin replay). This commit-only call must NOT re-run the
        // evaluator (would fire a second survival-twin Python subprocess + duplicate audits).
        const result = await this.promoteStrategy(s.id, "PAPER", "DEPLOY_READY", { correlationId: correlationId ?? undefined, skipPaperToDeployReadyEvaluator: true });
        if (result.success) {
          promoted.push(s.id);

          // Alert the human — strategy is ready for deployment review
          broadcastSSE("strategy:deploy-ready", {
            strategyId: s.id,
            name: s.name,
            symbol: s.symbol,
            rollingSharpe,
            tradingDays,
            message: `Strategy "${s.name}" qualified for deployment — review in library`,
            correlationId: correlationId ?? null,
          });

          AlertFactory.deployReady(
            s.id,
            `Strategy "${s.name}" is DEPLOY_READY — Sharpe ${rollingSharpe.toFixed(2)}, ${tradingDays} trading days. Awaiting your approval.`,
          ).catch((e) => {
            logger.error(
              { err: e, strategyId: s.id, correlationId },
              "AlertFactory.deployReady failed — operator will not receive DEPLOY_READY notification",
            );
            insertAuditRowSafe({
              action: "lifecycle.deploy_ready_alert_failed",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "lifecycle_service",
              input: { rollingSharpe, tradingDays },
              result: { error: String(e) },
              correlationId: correlationId ?? null,
            }).catch((auditErr: unknown) => {
              // Deep-scan #5 H3 (2026-06-29): was silently swallowed.
              logger.warn({ err: auditErr, correlationId }, "deploy_ready_alert_failed audit insert failed (non-blocking)");
              auditWriteFailuresTotal.labels({ action: "lifecycle.deploy_ready_alert_failed" }).inc();
            });
          });

          logger.info(
            { id: s.id, rollingSharpe, tradingDays },
            "Strategy moved to DEPLOY_READY library — awaiting human approval",
          );

          // Fire-and-forget: compile Pine export for TradingView
          this.triggerPineCompile(s.id).catch((pineErr) => {
            logger.warn(
              { strategyId: s.id, err: pineErr },
              "Pine compile failed after DEPLOY_READY promotion (non-blocking)",
            );
          });

          // B5: Fire-and-forget multi-firm eligibility check.
          // Runs AFTER the promotion commits — does NOT block DEPLOY_READY.
          // Iterates all 8 configured firms, stores one row per firm in
          // strategy_firm_eligibility for human review and B7 Kelly sizing.
          this.triggerMultiFirmEligibility(s.id, correlationId ?? undefined).catch((mfErr) => {
            logger.warn(
              { strategyId: s.id, err: mfErr },
              "B5 multi-firm eligibility check failed after DEPLOY_READY promotion (non-blocking)",
            );
          });

          // Track A.2: persist composite_evidence_score into lifecycle_transitions.result JSONB.
          // Fire-and-forget — must never block the promotion success path.
          {
            const incompleteCountFinal = gateEvidenceStatuses.filter(
              isIncompleteEvidenceStatus,
            ).length;
            const compositeEvidenceScoreFinal = 1.0 - (incompleteCountFinal / 8.0);
            db.execute(
              sql`UPDATE lifecycle_transitions
                SET result = jsonb_set(
                  COALESCE(result, '{}'::jsonb),
                  '{composite_evidence_score}',
                  ${JSON.stringify(compositeEvidenceScoreFinal)}::jsonb
                )
                WHERE id = (
                  SELECT id FROM lifecycle_transitions
                  WHERE strategy_id = ${s.id}
                    AND from_state = 'PAPER'
                    AND to_state = 'DEPLOY_READY'
                  ORDER BY created_at DESC
                  LIMIT 1
                )`,
            ).catch((updateErr: unknown) => {
              logger.warn({ strategyId: s.id, err: updateErr }, "Track A.2: composite_evidence_score persist failed (non-blocking)");
            });
          }
        }
      } else if (tradingDays >= 30 && rollingSharpe < 1.5) {
        logger.warn({ id: s.id, rollingSharpe, tradingDays }, "DEPLOY_READY blocked: rolling Sharpe < 1.5");
      }
    }

    return promoted;
  }

  // ── Auto-Graveyard helpers ─────────────────────────────────────────────────
  //
  // Design: two audit-log action types per gate encode the consecutive-fail state
  // without JSONB parsing.  Counter resets whenever the gate passes OR the
  // strategy is promoted to a different state (it leaves the gate's evaluation set).
  //
  //   lifecycle.hard_gate_fail.<gate>   — written at each HARD gate block
  //   lifecycle.hard_gate_reset.<gate>  — written when gate passes this tick
  //
  // Consecutive count = rows of "fail.<gate>" for this strategy
  //   WHERE created_at > most-recent "reset.<gate>" row (or epoch if none).
  //
  // Threshold: LIFECYCLE_GATE_FAIL_GRAVEYARD_THRESHOLD env (default 3).
  // Fail-safe: any gate NOT in the HARD allowlist must NOT be passed here.

  /**
   * Record a hard gate failure for (strategyId, gate).
   * Count consecutive failures since last reset; if threshold is reached and the
   * strategy is not already in GRAVEYARD, promote it to GRAVEYARD.
   *
   * MUST only be called at explicitly identified HARD gate `continue` sites —
   * never at transient/infra-error sites.
   */
  private async _maybeAutoGraveyard(
    strategyId: string,
    gate: string,
    metrics: Record<string, unknown>,
    fromState: LifecycleState,
    correlationId: string | null,
  ): Promise<void> {
    const threshold = parseInt(process.env.LIFECYCLE_GATE_FAIL_GRAVEYARD_THRESHOLD ?? "3", 10);
    const failAction = `lifecycle.hard_gate_fail.${gate}`;
    const resetAction = `lifecycle.hard_gate_reset.${gate}`;

    // Step 1: Persist this hard gate failure (non-blocking on error)
    await db.insert(auditLog).values({
      action: failAction,
      entityType: "strategy",
      entityId: strategyId,
      status: "failure",
      decisionAuthority: "gate",
      input: { fromState, gate } as Record<string, unknown>,
      result: { gate, ...metrics } as Record<string, unknown>,
      correlationId,
    }).catch((auditErr: unknown) => {
      logger.warn({ strategyId, gate, err: auditErr }, "_maybeAutoGraveyard: fail audit insert failed (non-blocking)");
    });

    // Step 2: Find most-recent reset row to bound the consecutive count
    const [lastReset] = await db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, resetAction),
          eq(auditLog.entityId, strategyId),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    const sinceCutoff: Date = lastReset?.createdAt ?? new Date(0);

    // Step 3: Count consecutive failures since last reset
    const failRows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, failAction),
          eq(auditLog.entityId, strategyId),
          gte(auditLog.createdAt, sinceCutoff),
        ),
      );
    const consecutiveFailures = failRows.length;

    if (consecutiveFailures < threshold) {
      logger.debug(
        { strategyId, gate, consecutiveFailures, threshold },
        `auto-graveyard: ${consecutiveFailures}/${threshold} consecutive hard failures — not yet at threshold`,
      );
      return;
    }

    // Step 4: Double-bury guard — re-read current state (may have changed this tick)
    const [current] = await db
      .select({ lifecycleState: strategies.lifecycleState })
      .from(strategies)
      .where(eq(strategies.id, strategyId));

    if (!current || current.lifecycleState === "GRAVEYARD") {
      logger.debug(
        { strategyId, gate },
        "auto-graveyard: strategy already in GRAVEYARD or missing — no double-bury",
      );
      return;
    }

    // Step 5: Promote to GRAVEYARD
    logger.warn(
      { strategyId, gate, consecutiveFailures, threshold, fromState },
      `AUTO-GRAVEYARD: ${consecutiveFailures} consecutive hard failures on gate "${gate}" — archiving strategy`,
    );

    const graveyardResult = await this.promoteStrategy(
      strategyId,
      fromState,
      "GRAVEYARD",
      {
        actor: "system",
        reason: `hard_gate_fail:${gate}`,
        correlationId: correlationId ?? undefined,
      },
    );

    if (graveyardResult.success) {
      // Durable audit row for the auto-graveyard event
      await db.insert(auditLog).values({
        action: "lifecycle.auto_graveyard",
        entityType: "strategy",
        entityId: strategyId,
        status: "success",
        decisionAuthority: "gate",
        input: { fromState, toState: "GRAVEYARD", gate } as Record<string, unknown>,
        result: {
          gate,
          metrics,
          consecutiveFailures,
          fromState,
          threshold,
        } as Record<string, unknown>,
        correlationId,
      }).catch((auditErr: unknown) => {
        logger.warn({ strategyId, gate, err: auditErr }, "lifecycle.auto_graveyard audit insert failed (non-blocking)");
      });

      // Prometheus
      autoGraveyardTotal.labels({ gate }).inc();

      // SSE
      broadcastSSE(LIFECYCLE_GATE_EVENTS.AUTO_GRAVEYARD, {
        strategyId,
        gate,
        consecutiveFailures,
        threshold,
        fromState,
        metrics,
        correlationId,
      });

      // Discord WARN (family-grade, non-blocking)
      try {
        notifyWarning(
          `Auto-Graveyard: strategy ${strategyId} archived`,
          appendFamilyGradePostscript(
            `Strategy ${strategyId} (state ${fromState}) was auto-archived to GRAVEYARD after ${consecutiveFailures} consecutive hard failures on gate \`${gate}\`.`,
            "A strategy that kept failing quality checks was automatically archived and will no longer trade.",
            "No action needed — the bot handled this. View the strategy audit log for details.",
          ),
          { strategyId, gate, consecutiveFailures, fromState },
        );
      } catch (_discordErr) { /* non-blocking */ }
    } else {
      logger.error(
        { strategyId, gate, error: graveyardResult.error },
        "auto-graveyard: promoteStrategy to GRAVEYARD FAILED — strategy remains in current state",
      );
    }
  }

  /**
   * Record a hard gate PASS (reset the consecutive-failure counter for this gate).
   * Fire-and-forget — never blocks promotion on audit write failure.
   *
   * Call immediately after the hard gate check code block falls through (i.e. passes).
   */
  private _resetHardGateCounter(
    strategyId: string,
    gate: string,
    correlationId: string | null,
  ): void {
    db.insert(auditLog).values({
      action: `lifecycle.hard_gate_reset.${gate}`,
      entityType: "strategy",
      entityId: strategyId,
      status: "success",
      decisionAuthority: "gate",
      input: { gate } as Record<string, unknown>,
      result: { gate, reason: "gate_passed" } as Record<string, unknown>,
      correlationId,
    }).catch((auditErr: unknown) => {
      logger.warn({ strategyId, gate, err: auditErr }, "_resetHardGateCounter: audit insert failed (non-blocking)");
    });
  }

  /**
   * Fire-and-forget Pine compile for a strategy that just reached DEPLOY_READY.
   * Fetches latest backtest + MC data to build risk intelligence for the export.
   */
  private async triggerPineCompile(strategyId: string): Promise<void> {
    // Fetch strategy for firm association
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, strategyId));

    if (!strategy) return;

    // Find latest completed backtest
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    // Build risk intelligence from MC if available
    let riskIntelligence: Record<string, number | string | null> | null = null;
    if (latestBt) {
      const [mcRun] = await db
        .select({
          probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
          sharpeP50: monteCarloRuns.sharpeP50,
          riskMetrics: monteCarloRuns.riskMetrics,
        })
        .from(monteCarloRuns)
        .where(eq(monteCarloRuns.backtestId, latestBt.id))
        .orderBy(desc(monteCarloRuns.createdAt))
        .limit(1);

      if (mcRun) {
        const ruinProb = mcRun.probabilityOfRuin != null ? Number(mcRun.probabilityOfRuin) : null;
        const survivalRate = ruinProb != null ? 1 - ruinProb : null;
        const rm = (mcRun.riskMetrics as Record<string, unknown> | null) ?? {};
        const breachProb = rm.breach_probability != null ? Number(rm.breach_probability) : null;
        const sharpeP50 = mcRun.sharpeP50 != null ? Number(mcRun.sharpeP50) : null;

        riskIntelligence = {
          breach_probability: breachProb,
          ruin_probability: ruinProb,
          survival_rate: survivalRate,
          mc_sharpe_p50: sharpeP50,
        };
      }
    }

    // Derive firm key from prop compliance if available
    let firmKey = "topstep_50k";
    if (latestBt?.propCompliance) {
      const propResults = latestBt.propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
      const passingFirm = Object.entries(propResults).find(
        ([, r]) => r.passed === true || r.pass === true,
      );
      if (passingFirm) {
        firmKey = passingFirm[0];
      }
    }

    // Emit both _INDICATOR.pine (manual-approval firms) and _STRATEGY.pine (ATS firms)
    // from the same underlying signal logic.  compileDualPineExport writes two separate
    // artifact rows into strategy_export_artifacts (artifact_type = dual_indicator |
    // dual_strategy | dual_alerts_json).  No DB schema change required.
    //
    // CF3: thread gatewayOptions explicitly so compileDualPineExport does not fall through
    // to env-only resolution for archetype strategies with paper_account_routing set.
    // When paperAccountRouting is non-null the strategy is A/B routed — pass explicit
    // { mode: "tf_gateway" } to suppress pine_export.gateway_options_missing audit warn
    // and make the routing intent auditable.  Fall through to undefined for legacy rows.
    const stratPaperRouting = (strategy as unknown as { paperAccountRouting?: string | null }).paperAccountRouting;
    const gatewayOptionsForCompile = (stratPaperRouting != null && stratPaperRouting !== "")
      ? ({ mode: "tf_gateway" } as const)
      : undefined;
    const result = await compileDualPineExport(strategyId, firmKey, riskIntelligence, true, undefined, undefined, undefined, undefined, undefined, gatewayOptionsForCompile);
    logger.info(
      {
        strategyId,
        firmKey,
        exportId: result?.id,
        indicator_file: (result as Record<string, unknown>)?.indicator_file,
        strategy_file: (result as Record<string, unknown>)?.strategy_file,
      },
      "Pine dual compile completed for DEPLOY_READY strategy",
    );
  }

  /**
   * B5: Fire-and-forget multi-firm eligibility check.
   *
   * Called after PAPER → DEPLOY_READY promotion. Fetches the latest completed
   * backtest ID and delegates to evaluateMultiFirmEligibility() which runs
   * compliance_gate.py for each of the 8 configured firms and persists one
   * strategy_firm_eligibility row per firm.
   *
   * Does NOT gate or reverse the promotion — purely additive.
   */
  private async triggerMultiFirmEligibility(
    strategyId: string,
    correlationId?: string,
  ): Promise<void> {
    // Resolve the latest completed backtest ID for compliance input
    const [latestBt] = await db
      .select({ id: backtests.id })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    const backtestId = latestBt?.id ?? null;

    await evaluateMultiFirmEligibility(strategyId, backtestId, correlationId);
  }

  /**
   * Check for auto-demotions: DEPLOYED → DECLINING if rolling Sharpe < 1.0.
   */
  async checkAutoDemotions(context?: { correlationId?: string }): Promise<string[]> {
    const correlationId = context?.correlationId;

    // HIGH #13: killSwitch is the FIRST gate on every lifecycle-mutating entry path.
    if (await killSwitch.isHaltedForProduction()) {
      logger.warn({ correlationId, fn: "checkAutoDemotions" }, "Skipping — killSwitch halted");
      return [];
    }

    const demoted: string[] = [];

    const deployedStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOYED"));

    for (const s of deployedStrategies) {
      const sharpe = s.rollingSharpe30d ? parseFloat(s.rollingSharpe30d) : null;

      if (sharpe !== null && sharpe < 1.0) {
        const result = await this.promoteStrategy(s.id, "DEPLOYED", "DECLINING", { correlationId });
        if (result.success) {
          demoted.push(s.id);

          // Emit regen.auto_triggered audit row — intent record before the fire-and-forget call.
          // This serves as the idempotency marker for the critic-feedback daily sweep
          // (checkDeclingAndTriggerRegen), ensuring it won't re-fire on the same strategy
          // within the 7-day cooldown window. Written fire-and-forget (non-blocking).
          const declineReason = `rolling_sharpe_${sharpe.toFixed(3)}_below_1.0`;
          db.insert(auditLog).values({
            action: "regen.auto_triggered",
            entityType: "strategy",
            entityId: s.id,
            input: {
              strategyName: s.name,
              generation: s.generation,
              triggerPath: "checkAutoDemotions",
              declineReason,
              rollingSharpe30d: sharpe,
            },
            result: {
              note: "evolution auto-spawn fired (fire-and-forget; check strategy.evolved audit row for outcome)",
            },
            status: "pending",
            decisionAuthority: "scheduler",
            correlationId: correlationId ?? null,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "regen.auto_triggered audit insert failed (non-blocking)");
          });

          // Fire-and-forget: trigger self-evolution for declining strategy.
          // evolveStrategy() internally guards: pipeline pause, max generations, 7-day
          // cooldown, circuit breaker. Errors are non-blocking — lifecycle demotion already
          // committed above and the daily sweep (checkDeclingAndTriggerRegen) will retry.
          evolveStrategy(s.id, { correlationId }).then((evoResult) => {
            logger.info({ strategyId: s.id, ...evoResult }, "Auto-evolution completed for declining strategy");
          }).catch((evoErr) => {
            logger.error({ strategyId: s.id, err: evoErr }, "Auto-evolution failed (non-blocking)");
          });
        }
      }
    }

    return demoted;
  }

  /**
   * Get pipeline health — count of strategies per lifecycle state.
   */
  async getPipelineHealth(): Promise<{
    counts: Record<string, number>;
    alerts: string[];
  }> {
    const allStrategies = await db.select().from(strategies);

    const counts: Record<string, number> = {};
    for (const state of VALID_STATES) {
      counts[state] = 0;
    }
    for (const s of allStrategies) {
      const state = s.lifecycleState;
      counts[state] = (counts[state] || 0) + 1;
    }

    const alerts: string[] = [];

    // Alert if strategies waiting for deployment approval
    if (counts.DEPLOY_READY > 0) {
      alerts.push(`${counts.DEPLOY_READY} strateg${counts.DEPLOY_READY === 1 ? "y" : "ies"} ready for deployment — review at GET /api/strategies/library`);
    }

    // Alert if no DEPLOYED strategies
    if (counts.DEPLOYED === 0) {
      alerts.push("No deployed strategies — pipeline is empty");
    }

    // Alert if no CANDIDATE/TESTING strategies (pipeline drying up)
    if (counts.CANDIDATE === 0 && counts.TESTING === 0) {
      alerts.push("No strategies in development — pipeline will dry up");
    }

    // Alert if too many DECLINING
    if (counts.DECLINING > counts.DEPLOYED) {
      alerts.push("More declining than deployed strategies — investigate");
    }

    return { counts, alerts };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // B8: PILOT auto-promotion / auto-kill sweep
  //
  // Called by the 6-hour lifecycle cron alongside checkAutoPromotions().
  // Evaluates every strategy currently in PILOT state:
  //
  //   Promotion criteria (PILOT → DEPLOYED):
  //     - Exactly PILOT_REQUIRED_SESSIONS=5 pilot sessions completed
  //     - All sessions: compliancePassed=true
  //     - rollingSharpeFinal >= PILOT_MIN_SHARPE=1.0 (at least for the last session)
  //     - No kill switch has fired (no 'killed' outcome row)
  //
  //   Auto-kill criteria (PILOT → GRAVEYARD):
  //     - Any pilot session has outcome='killed' (kill switch fired)
  //
  // Contract guarantees:
  //   - Exactly 1 contract is enforced by paper-signal-service during PILOT
  //     (checked via the pilotContracts field on the paper session config).
  //   - This function is non-blocking: errors per strategy are caught and logged.
  //   - Duplicate runs (idempotent): already-promoted strategies are not in PILOT state.
  // ─────────────────────────────────────────────────────────────────────────
  async checkPilotAutoPromotions(context?: { correlationId?: string }): Promise<{
    swept: number;
    promoted: number;
    killed: number;
    pending: number;
    errors: number;
  }> {
    const correlationId = context?.correlationId;

    // HIGH #13: killSwitch is the FIRST gate on every lifecycle-mutating entry path.
    if (await killSwitch.isHaltedForProduction()) {
      logger.warn({ correlationId, fn: "checkPilotAutoPromotions" }, "Skipping — killSwitch halted");
      return { swept: 0, promoted: 0, killed: 0, pending: 0, errors: 0 };
    }

    const PILOT_REQUIRED_SESSIONS = 5;
    const PILOT_MIN_SHARPE = 1.0;

    const result = { swept: 0, promoted: 0, killed: 0, pending: 0, errors: 0 };

    // Find all strategies currently in PILOT state
    const pilotStrategies = await db
      .select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "PILOT"));

    result.swept = pilotStrategies.length;

    for (const s of pilotStrategies) {
      try {
        // Fetch all pilot session rows for this strategy
        const sessions = await db
          .select()
          .from(pilotSessions)
          .where(eq(pilotSessions.strategyId, s.id))
          .orderBy(pilotSessions.sessionNumber);

        // Auto-kill: any session with outcome='killed' means a kill switch fired
        const killedSession = sessions.find((ps) => ps.outcome === "killed");
        if (killedSession) {
          logger.warn(
            { strategyId: s.id, killReason: killedSession.killReason, sessionNumber: killedSession.sessionNumber },
            "PILOT auto-kill: kill switch fired — promoting to GRAVEYARD",
          );
          const killResult = await this.promoteStrategy(s.id, "PILOT", "GRAVEYARD", {
            actor: "system",
            reason: `PILOT kill switch fired in session ${killedSession.sessionNumber}: ${killedSession.killReason ?? "kill_switch"}`,
            correlationId,
          });
          if (killResult.success) {
            result.killed++;
            broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTED, {
              correlationId, // deep-scan Obs re-verify F-3: SSE promotion event must carry correlationId (audit row does)
              strategyId: s.id,
              from: "PILOT",
              to: "GRAVEYARD",
              name: s.name,
              reason: killedSession.killReason,
            });
          } else {
            logger.warn({ strategyId: s.id, error: killResult.error }, "PILOT auto-kill promotion failed");
            result.errors++;
          }
          continue;
        }

        // Count completed sessions (outcome = 'passed' or 'failed')
        const completedSessions = sessions.filter((ps) => ps.outcome === "passed" || ps.outcome === "failed");

        if (completedSessions.length < PILOT_REQUIRED_SESSIONS) {
          // Still accumulating sessions — not yet evaluable
          result.pending++;
          logger.debug(
            { strategyId: s.id, completed: completedSessions.length, required: PILOT_REQUIRED_SESSIONS },
            "PILOT: insufficient sessions — pending",
          );
          continue;
        }

        // All 5 sessions completed — evaluate promotion criteria
        const allCompliant = completedSessions.every((ps) => ps.compliancePassed === true);
        // F-4 FIX: ALL sessions must have rollingSharpeFinal >= PILOT_MIN_SHARPE.
        // Previously only the last session was checked, allowing strategies with
        // early sub-threshold Sharpe sessions (e.g. [0.4, 0.3, 0.5, 0.6, 1.1]) to
        // promote. Promotion gate is the trust boundary before live deployment —
        // every session in the canary window must demonstrate quality.
        const allSharpePassed = completedSessions.every(
          (ps) =>
            ps.rollingSharpeFinal != null &&
            parseFloat(String(ps.rollingSharpeFinal)) >= PILOT_MIN_SHARPE,
        );
        const lastSession = completedSessions[completedSessions.length - 1];

        if (allCompliant && allSharpePassed) {
          // PILOT → DEPLOYED: automatic promotion after successful canary
          logger.info(
            {
              strategyId: s.id,
              sessions: completedSessions.length,
              allSharpes: completedSessions.map((ps) => ps.rollingSharpeFinal),
              allCompliant,
            },
            "PILOT auto-promote: 5 sessions passed — promoting to DEPLOYED",
          );
          const promoteResult = await this.promoteStrategy(s.id, "PILOT", "DEPLOYED", {
            actor: "system",
            reason: `PILOT canary passed: ${PILOT_REQUIRED_SESSIONS} sessions, all compliant, rolling Sharpe >= ${PILOT_MIN_SHARPE}`,
            correlationId,
          });
          if (promoteResult.success) {
            result.promoted++;
            broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTED, {
              correlationId, // deep-scan Obs re-verify F-3: SSE promotion event must carry correlationId (audit row does)
              strategyId: s.id,
              from: "PILOT",
              to: "DEPLOYED",
              name: s.name,
              pilotSessionsCompleted: completedSessions.length,
              lastRollingSharpe: lastSession?.rollingSharpeFinal,
            });
            // Compile Pine on promotion to DEPLOYED (same as DEPLOY_READY → DEPLOYED path)
            // Track C.1 fix: pass undefined for firmKey (2nd arg) so correlationId reaches
            // the correct 5th positional argument, not the firmKey slot.
            // Wrapped in retry-with-backoff: 3 attempts at 30s / 2m / 10m delays.
            // On persistent failure: lifecycle.deployed_pine_compile_failed audit + Discord WARN.
            (async () => {
              const PINE_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
              let lastPineErr: unknown = null;
              let pineSuccess = false;
              for (let attempt = 0; attempt < 3; attempt++) {
                if (attempt > 0) {
                  await new Promise((resolve) => setTimeout(resolve, PINE_RETRY_DELAYS_MS[attempt - 1]));
                }
                try {
                  // CF3: thread gatewayOptions when paperAccountRouting is set (A/B routed strategies).
                  const sPaperRouting = (s as unknown as { paperAccountRouting?: string | null }).paperAccountRouting;
                  const sGatewayOpts = (sPaperRouting != null && sPaperRouting !== "")
                    ? ({ mode: "tf_gateway" } as const)
                    : undefined;
                  await compileDualPineExport(s.id, undefined, undefined, true, correlationId ?? undefined, undefined, undefined, undefined, undefined, sGatewayOpts);
                  pineSuccess = true;
                  break;
                } catch (pineErr) {
                  lastPineErr = pineErr;
                  logger.warn(
                    { strategyId: s.id, attempt: attempt + 1, err: pineErr },
                    "PILOT auto-promote: Pine export attempt failed (will retry)",
                  );
                }
              }
              if (!pineSuccess) {
                const errMsg = lastPineErr instanceof Error ? lastPineErr.message : String(lastPineErr);
                logger.warn(
                  { strategyId: s.id, err: lastPineErr },
                  "PILOT auto-promote: Pine export failed after 3 attempts — writing deployed_pine_compile_failed audit",
                );
                await db.insert(auditLog).values({
                  action: "lifecycle.deployed_pine_compile_failed",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "warning",
                  decisionAuthority: "system",
                  input: { fromState: "PILOT", toState: "DEPLOYED" },
                  result: { error: errMsg, attempts: 3, note: "Pine compile failed after 3 retries (30s/2m/10m)" },
                  correlationId: correlationId ?? null,
                }).catch((auditErr: unknown) => {
                  // Deep-scan #5 H3 (2026-06-29): was silently swallowed.
                  logger.warn({ err: auditErr, correlationId }, "deployed_pine_compile_failed audit insert failed (non-blocking)");
                  auditWriteFailuresTotal.labels({ action: "lifecycle.deployed_pine_compile_failed" }).inc();
                });
                notifyWarning(
                  `Pine Compile Failed: strategy ${s.name} DEPLOYED but no TradingView artifact`,
                  appendFamilyGradePostscript(
                    `Strategy \`${s.name}\` (${s.id.slice(0, 8)}) DEPLOYED but Pine compile failed after 3 retries. ` +
                    `TradingView artifact unavailable — check \`lifecycle.deployed_pine_compile_failed\` in audit_log.\n` +
                    `Error: ${errMsg.slice(0, 200)}`,
                    "The bot's trading strategy was promoted to live but the TradingView chart file failed to generate.",
                    "Check the audit log for lifecycle.deployed_pine_compile_failed and re-trigger Pine compile from the admin panel.",
                  ),
                );
              }
            })().catch((err: unknown) => {
              logger.error({ strategyId: s.id, err }, "PILOT auto-promote: Pine export retry wrapper threw unexpectedly");
            });
          } else {
            logger.warn({ strategyId: s.id, error: promoteResult.error }, "PILOT auto-promote failed");
            result.errors++;
          }
        } else {
          // Criteria not met — send to GRAVEYARD (PILOT failed but no kill switch)
          const failureReason = !allCompliant
            ? "compliance_violation_in_pilot_session"
            : `rolling_sharpe_below_${PILOT_MIN_SHARPE}`;
          logger.warn(
            {
              strategyId: s.id,
              allCompliant,
              allSharpePassed,
              allSharpes: completedSessions.map((ps) => ps.rollingSharpeFinal),
              failureReason,
            },
            "PILOT criteria not met — promoting to GRAVEYARD",
          );
          const failResult = await this.promoteStrategy(s.id, "PILOT", "GRAVEYARD", {
            actor: "system",
            reason: `PILOT failed: ${failureReason}`,
            correlationId,
          });
          if (failResult.success) {
            result.killed++;
            broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTED, {
              correlationId, // deep-scan Obs re-verify F-3: SSE promotion event must carry correlationId (audit row does)
              strategyId: s.id,
              from: "PILOT",
              to: "GRAVEYARD",
              name: s.name,
              reason: failureReason,
            });
          } else {
            logger.warn({ strategyId: s.id, error: failResult.error }, "PILOT failure promotion to GRAVEYARD failed");
            result.errors++;
          }
        }
      } catch (err) {
        result.errors++;
        logger.error({ strategyId: s.id, err }, "checkPilotAutoPromotions: error processing PILOT strategy (non-blocking)");
      }
    }

    logger.info(result, "PILOT auto-promotion sweep complete");
    return result;
  }

  /**
   * Record a completed pilot session row for a PILOT strategy.
   * Called by paper-execution-service when a paper session closes for a PILOT strategy.
   *
   * Enforces the 1-contract constraint by reading the pilot session's contracts field.
   * Does NOT promote the strategy — promotion is handled by checkPilotAutoPromotions().
   */
  async recordPilotSession(options: {
    strategyId: string;
    paperSessionId: string;
    rollingSharpeFinal: number | null;
    compliancePassed: boolean;
    outcome: "passed" | "failed" | "killed";
    killReason?: string;
  }): Promise<void> {
    // Count existing pilot sessions for this strategy (determines session_number)
    const [existingCount] = await db
      .select({ n: count() })
      .from(pilotSessions)
      .where(eq(pilotSessions.strategyId, options.strategyId));

    const sessionNumber = Number(existingCount?.n ?? 0) + 1;

    await db.insert(pilotSessions).values({
      strategyId: options.strategyId,
      sessionNumber,
      paperSessionId: options.paperSessionId,
      rollingSharpeFinal: options.rollingSharpeFinal != null ? String(options.rollingSharpeFinal) : null,
      compliancePassed: options.compliancePassed,
      contracts: 1,  // Always 1 in PILOT
      completedAt: new Date(),
      outcome: options.outcome,
      killReason: options.killReason ?? null,
    });

    logger.info(
      {
        strategyId: options.strategyId,
        sessionNumber,
        outcome: options.outcome,
        rollingSharpeFinal: options.rollingSharpeFinal,
        compliancePassed: options.compliancePassed,
      },
      "Pilot session recorded",
    );
  }
}

// ─── F-4: promoted_at backfill from lifecycle_transitions ────────────────────
// The schema has no `strategies.promoted_at` column. Python decay computations
// need the strategy's most-recent DEPLOYED transition timestamp to short-circuit
// the decay verdict during the grace window. This helper queries
// lifecycle_transitions for the latest row with to_state='DEPLOYED' for the
// given strategy and returns an ISO string (the format the Python helper
// `_within_grace_period()` accepts as a string).
//
// Returns null when:
//   - the strategy has never been promoted to DEPLOYED
//   - the lookup throws (caller treats null as "no grace period")
export async function getPromotedAtFromTransitions(
  strategyId: string,
): Promise<string | null> {
  try {
    const rows = await db
      .select({ createdAt: lifecycleTransitions.createdAt })
      .from(lifecycleTransitions)
      .where(
        and(
          eq(lifecycleTransitions.strategyId, strategyId),
          eq(lifecycleTransitions.toState, "DEPLOYED"),
        ),
      )
      .orderBy(desc(lifecycleTransitions.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row || !row.createdAt) return null;
    return new Date(row.createdAt).toISOString();
  } catch (err) {
    logger.warn(
      { err, strategyId },
      "lifecycle-service: getPromotedAtFromTransitions failed — returning null (no grace period)",
    );
    return null;
  }
}
