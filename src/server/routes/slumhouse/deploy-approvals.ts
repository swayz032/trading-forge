/**
 * Slumhouse "The Office" — DEPLOY_READY → DEPLOYED approval card endpoints.
 *
 * Layer-4 Office P0 (2026-07-02). The Office is the ONLY control room —
 * this is the human "go live" step ON TOP of the promotion gates, never a
 * bypass. Approve calls lifecycleService.promoteStrategy() with
 * actor="human_release" (the EXISTING manual-release path — every gate that
 * lives inside the promotion path stays intact). Reject sends the strategy
 * back to PAPER through the same promotion machinery.
 *
 * Routes (all under /slumhouse/admin — requireAdminSession on every one):
 *   GET  /slumhouse/admin/deploy-approvals
 *        → { strategies: [ { id, name, evidence, approvable, blockers, ... } ] }
 *   POST /slumhouse/admin/deploy-approvals/:id/approve
 *        → fail-closed: re-derives evidence server-side; refuses when the
 *          evidence is missing/stale/failing even if the UI was tampered with.
 *   POST /slumhouse/admin/deploy-approvals/:id/reject   { reason }
 *        → DEPLOY_READY → PAPER with an operator reason (required).
 *
 * Evidence card (plain-English, per operator preference — no raw-stats jargon
 * up front; raw value rides small beneath):
 *   - regime tests  ← backtests.k_eff / walk-forward window count
 *   - luck chance   ← walkForwardResults.pbo_overall  (PBO)
 *   - firm survival ← monte-carlo riskMetrics.probability_of_ruin_ci.ci_high (B14)
 *   - edge kept     ← walkForwardResults.wfe_overall  (WFE)
 *   - skill score   ← resultExtras.deflated_sharpe    (DSR — info only)
 *
 * Fail-closed contract: approvable=false when any hard metric (WFE/PBO/B14)
 * is missing, when the backtest is older than BACKTEST_STALENESS_DAYS
 * (default 30), or when a hard metric fails its institutional threshold.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { backtests, monteCarloRuns, strategies } from "../../db/schema.js";
import { adminSessionFromCookie } from "../../lib/slumhouse/admin-session.js";
import { checkSlumhouseOrigin } from "../../lib/slumhouse/require-session.js";
import { insertAuditRowSafe } from "../../lib/audit-log-helper.js";
import { logger } from "../../lib/logger.js";
import type { LifecycleService } from "../../services/lifecycle-service.js";
import { getWfeHardFloor } from "../../lib/wfe-gate.js";
import { getPboLifecycleThreshold } from "../../lib/pbo-gate.js";
import { getB14CiHighThreshold } from "../../lib/b14-ci-gate.js";

export const deployApprovalsRouter = Router();

// Dynamic import + lazy singleton — lifecycle-service transitively pulls the
// Express bootstrap (several services import logger from ../index.js), and a
// static edge here makes the slumhouse router import circular with
// src/server/index.ts → routes/strategies.ts → new LifecycleService().
let _lifecycleService: LifecycleService | null = null;
async function getLifecycleService(): Promise<LifecycleService> {
  if (!_lifecycleService) {
    const { LifecycleService } = await import("../../services/lifecycle-service.js");
    _lifecycleService = new LifecycleService();
  }
  return _lifecycleService;
}

function requireAdminSession(req: Request, res: Response): boolean {
  if (!adminSessionFromCookie(req.headers.cookie)) {
    res.status(401).json({ ok: false, error: "locked" });
    return false;
  }
  return true;
}

// ─── Evidence model ──────────────────────────────────────────────────────────

export interface EvidenceMetric {
  key: "regime_tests" | "pbo" | "b14" | "wfe" | "dsr";
  /** Plain-English one-liner the operator reads first. */
  headline: string;
  /** Small raw-value line beneath the headline (e.g. "PBO 0.08 · limit 0.15"). */
  detail: string;
  /** Raw numeric value (null = missing). */
  value: number | null;
  /** true = passes threshold, false = fails, null = informational / missing. */
  ok: boolean | null;
  missing: boolean;
  /** Hard metrics block approval when missing or failing; info metrics never do. */
  hard: boolean;
}

/**
 * Certified-gates transparency block.
 *
 * `buildDeployEvidence` freshly re-checks 4 gates (pbo, b14, wfe, staleness)
 * from the current backtest + MC run.  Six more gates ran at PAPER→DEPLOY_READY
 * and are NOT re-checked here (b15, bif, compliance, param_drift, frozen_policy,
 * shadow_divergence).  This block makes that split explicit so the UI can show
 * "4 re-checked now / 6 certified on <date>" rather than implying everything
 * is fresh.
 *
 * Values come from the same JSONB the promotion gates read (walk_forward_results
 * + result_extras on the backtest used at certification time).  Fields are null
 * when the backtest predates the gate or the gate did not persist its output.
 */
export interface CertifiedGates {
  /** Gates freshly re-derived from current backtest + MC run on every call. */
  freshlyRechecked: string[];
  /** Gates that ran only at PAPER→DEPLOY_READY; not re-derived here. */
  certifiedOnly: string[];
  /** Known values for certified-only gates from the stored backtest JSONB. */
  certifiedValues: {
    b15_passed: boolean | null;
    b15_status: string | null;
    bif_passed: boolean | null;
    compliance_pass_rate: number | null;
    param_stability_status: string | null;
    frozen_policy_hash: string | null;
  };
  /** ISO timestamp of the backtest record used for certification. */
  certifiedFrom: string | null;
  /** Human-readable note explaining the freshly_rechecked / certified_only split. */
  note: string;
}

export interface DeployApprovalEntry {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  lifecycleState: string;
  backtestId: string | null;
  backtestAgeDays: number | null;
  evidenceState: "ok" | "stale" | "missing";
  evidence: EvidenceMetric[];
  approvable: boolean;
  blockers: string[];
  /** Certified-gates transparency block. Null when no completed backtest exists. */
  certifiedGates: CertifiedGates | null;
}

function stalenessDays(): number {
  const raw = Number.parseInt(process.env.BACKTEST_STALENESS_DAYS ?? "30", 10);
  return Number.isNaN(raw) || raw <= 0 ? 30 : raw;
}

function asNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Build the plain-English evidence card for one strategy. Pure derivation from
 * the latest completed backtest + its latest Monte-Carlo run.
 *
 * Returns a `certifiedGates` transparency block distinguishing which gates are
 * freshly re-checked here vs. which ran only at PAPER→DEPLOY_READY (see
 * CertifiedGates for the full split and data provenance).
 */
export async function buildDeployEvidence(strategyId: string): Promise<{
  backtestId: string | null;
  backtestAgeDays: number | null;
  evidenceState: "ok" | "stale" | "missing";
  evidence: EvidenceMetric[];
  approvable: boolean;
  blockers: string[];
  certifiedGates: CertifiedGates | null;
}> {
  const blockers: string[] = [];
  const evidence: EvidenceMetric[] = [];

  const [bt] = await db
    .select({
      id: backtests.id,
      createdAt: backtests.createdAt,
      walkForwardResults: backtests.walkForwardResults,
      resultExtras: backtests.resultExtras,
      kEff: backtests.kEff,
    })
    .from(backtests)
    .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  if (!bt) {
    return {
      backtestId: null,
      backtestAgeDays: null,
      evidenceState: "missing",
      evidence: [],
      approvable: false,
      blockers: ["No completed backtest on file — run a fresh test before this can go live."],
      certifiedGates: null,
    };
  }

  const ageDays = bt.createdAt
    ? Math.floor((Date.now() - new Date(bt.createdAt).getTime()) / 86_400_000)
    : null;
  const maxAge = stalenessDays();
  const stale = ageDays !== null && ageDays > maxAge;
  if (stale) {
    blockers.push(
      `Test results are ${ageDays} days old (limit ${maxAge}) — run a fresh backtest first.`,
    );
  }

  const wfr = (bt.walkForwardResults ?? null) as Record<string, unknown> | null;
  const extras = (bt.resultExtras ?? null) as Record<string, unknown> | null;

  // ── regime tests (K_eff / WF window count) — informational ────────────────
  const windows = Array.isArray(wfr?.windows) ? (wfr?.windows as unknown[]).length : null;
  const kEff = asNum(bt.kEff) ?? windows;
  evidence.push({
    key: "regime_tests",
    headline:
      kEff !== null
        ? `Survived ${Math.round(kEff)} market-regime tests`
        : "Market-regime test count unavailable",
    detail: kEff !== null ? `K_eff ${Math.round(kEff)}` : "k_eff / windows missing",
    value: kEff,
    ok: kEff !== null ? true : null,
    missing: kEff === null,
    hard: false,
  });

  // ── PBO — "chance results are luck" (HARD) ────────────────────────────────
  const pbo = asNum(wfr?.pbo_overall);
  const pboLimit = getPboLifecycleThreshold();
  const pboOk = pbo !== null ? pbo <= pboLimit : null;
  evidence.push({
    key: "pbo",
    headline:
      pbo !== null
        ? `${pct(pbo)} chance the results are luck`
        : "Luck check missing — cannot rule out a lucky backtest",
    detail: pbo !== null ? `PBO ${pbo.toFixed(3)} · limit ${pboLimit}` : "pbo_overall missing",
    value: pbo,
    ok: pboOk,
    missing: pbo === null,
    hard: true,
  });
  if (pbo === null) blockers.push("Luck check (PBO) is missing from the latest test.");
  else if (!pboOk) blockers.push(`Too likely to be luck: ${pct(pbo)} (limit ${pct(pboLimit)}).`);

  // ── B14 — firm-survival chance (HARD) ─────────────────────────────────────
  let ciHigh: number | null = null;
  let b14Legacy = false;
  const [mc] = await db
    .select({ riskMetrics: monteCarloRuns.riskMetrics, createdAt: monteCarloRuns.createdAt })
    .from(monteCarloRuns)
    .where(eq(monteCarloRuns.backtestId, bt.id))
    .orderBy(desc(monteCarloRuns.createdAt))
    .limit(1);
  const rm = (mc?.riskMetrics ?? null) as Record<string, unknown> | null;
  const ruinCi = (rm?.probability_of_ruin_ci ?? null) as Record<string, unknown> | null;
  ciHigh = asNum(ruinCi?.ci_high);
  if (ciHigh === null) {
    // Documented legacy fallback (mirrors b14 legacy_ruin_scalar path) — still
    // rendered, but flagged so the operator sees it is the weaker estimate.
    ciHigh = asNum(rm?.probability_of_ruin);
    b14Legacy = ciHigh !== null;
  }
  const b14Limit = getB14CiHighThreshold();
  const b14Ok = ciHigh !== null ? ciHigh <= b14Limit : null;
  evidence.push({
    key: "b14",
    headline:
      ciHigh !== null
        ? `${pct(1 - ciHigh)} chance of surviving the firm's rules${b14Legacy ? " (older estimate)" : ""}`
        : "Firm-survival simulation missing",
    detail:
      ciHigh !== null
        ? `ruin ci_high ${ciHigh.toFixed(3)} · limit ${b14Limit}${b14Legacy ? " · legacy scalar" : ""}`
        : "probability_of_ruin_ci missing",
    value: ciHigh,
    ok: b14Ok,
    missing: ciHigh === null,
    hard: true,
  });
  if (ciHigh === null) blockers.push("Firm-survival simulation (B14) is missing.");
  else if (!b14Ok)
    blockers.push(
      `Firm-survival too risky: ${pct(ciHigh)} worst-case chance of blowing the account (limit ${pct(b14Limit)}).`,
    );

  // ── WFE — edge kept on unseen data (HARD) ─────────────────────────────────
  const wfe = asNum(wfr?.wfe_overall);
  const wfeFloor = getWfeHardFloor();
  const wfeOk = wfe !== null ? wfe >= wfeFloor : null;
  evidence.push({
    key: "wfe",
    headline:
      wfe !== null
        ? `Kept ${pct(Math.max(0, Math.min(wfe, 1.5)))} of its edge on data it never saw`
        : "Unseen-data check missing",
    detail: wfe !== null ? `WFE ${wfe.toFixed(2)} · floor ${wfeFloor}` : "wfe_overall missing",
    value: wfe,
    ok: wfeOk,
    missing: wfe === null,
    hard: true,
  });
  if (wfe === null) blockers.push("Unseen-data check (WFE) is missing.");
  else if (!wfeOk) blockers.push(`Kept too little edge on unseen data: WFE ${wfe.toFixed(2)} (floor ${wfeFloor}).`);

  // ── DSR — informational only ───────────────────────────────────────────────
  // deepscan17: resultExtras.deflated_sharpe is a nested dict {dsr, expected_max_sr,
  // significant} (cross_validation.py output), NOT a scalar — asNum(dict) was always NaN,
  // so this card ALWAYS rendered "deflated_sharpe missing" even when DSR computed fine.
  // Unwrap .dsr; stay robust to a future flattened-scalar shape if the DSR impls are unified.
  const dsRaw = extras?.deflated_sharpe as unknown;
  const dsr = typeof dsRaw === "number" ? dsRaw : asNum((dsRaw as { dsr?: unknown } | null | undefined)?.dsr);
  evidence.push({
    key: "dsr",
    headline:
      dsr !== null
        ? `Skill score after honesty adjustment: ${dsr.toFixed(2)}`
        : "Honesty-adjusted skill score unavailable",
    detail: dsr !== null ? `deflated Sharpe ${dsr.toFixed(2)}` : "deflated_sharpe missing",
    value: dsr,
    ok: null,
    missing: dsr === null,
    hard: false,
  });

  const anyHardMissing = evidence.some((m) => m.hard && m.missing);
  const evidenceState: "ok" | "stale" | "missing" = anyHardMissing ? "missing" : stale ? "stale" : "ok";

  // ── Certified-gates transparency block (FIX 4 — deep-scan #12 Track T) ────
  // Six gates ran at PAPER→DEPLOY_READY and are NOT re-derived on every call to
  // buildDeployEvidence.  Their values come from the same JSONB the lifecycle
  // gates read (walk_forward_results + result_extras from the backtest used at
  // certification time).  Null values mean the backtest predates that gate or
  // the gate did not persist its output into the backtest JSON.
  //
  // NOTE: shadow_divergence_pct lives in lifecycle_shadow_signals (separate table,
  // not in backtest JSONB) so it is not surfaced here; the audit_log row written
  // by the shadow gate at PAPER→DEPLOY_READY is the authoritative record.
  const certifiedGates: CertifiedGates = {
    freshlyRechecked: ["pbo", "b14", "wfe", "staleness"],
    certifiedOnly: ["b15", "bif", "compliance", "param_drift", "frozen_policy", "shadow_divergence"],
    certifiedValues: {
      b15_passed: extras?.b15_passed != null ? Boolean(extras.b15_passed) : null,
      b15_status: extras?.b15_status != null ? String(extras.b15_status) : null,
      bif_passed:
        extras?.bif_passed != null ? Boolean(extras.bif_passed)
        : wfr?.bif_passed != null ? Boolean(wfr.bif_passed)
        : null,
      compliance_pass_rate:
        extras?.compliance_pass_rate != null ? Number(extras.compliance_pass_rate) : null,
      param_stability_status:
        wfr?.param_stability_status != null ? String(wfr.param_stability_status)
        : extras?.param_stability_status != null ? String(extras.param_stability_status)
        : null,
      frozen_policy_hash:
        wfr?.frozen_policy_hash != null ? String(wfr.frozen_policy_hash)
        : extras?.frozen_policy_hash != null ? String(extras.frozen_policy_hash)
        : null,
    },
    certifiedFrom: bt.createdAt ? new Date(bt.createdAt).toISOString() : null,
    note: "freshly_rechecked gates are re-derived from the current backtest + MC run. certified_only gates ran at PAPER→DEPLOY_READY; values come from the backtest JSONB stored at certification time (null = gate predates this backtest or did not persist output).",
  };

  return {
    backtestId: bt.id,
    backtestAgeDays: ageDays,
    evidenceState,
    evidence,
    approvable: blockers.length === 0,
    blockers,
    certifiedGates,
  };
}

// ─── GET /slumhouse/admin/deploy-approvals ───────────────────────────────────

deployApprovalsRouter.get(
  "/slumhouse/admin/deploy-approvals",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAdminSession(req, res)) return;
    try {
      const rows = await db
        .select({
          id: strategies.id,
          name: strategies.name,
          symbol: strategies.symbol,
          timeframe: strategies.timeframe,
          lifecycleState: strategies.lifecycleState,
        })
        .from(strategies)
        .where(eq(strategies.lifecycleState, "DEPLOY_READY"))
        .limit(25);

      const entries: DeployApprovalEntry[] = [];
      for (const row of rows) {
        try {
          const ev = await buildDeployEvidence(row.id);
          entries.push({ ...row, ...ev });
        } catch (err) {
          logger.warn({ err, strategyId: row.id }, "office deploy-approvals: evidence build failed");
          // Fail-closed: strategy renders, but is not approvable.
          entries.push({
            ...row,
            backtestId: null,
            backtestAgeDays: null,
            evidenceState: "missing",
            evidence: [],
            approvable: false,
            blockers: ["Could not read the evidence — approval disabled until it loads clean."],
            certifiedGates: null,
          });
        }
      }
      res.json({ ok: true, strategies: entries });
    } catch (err) {
      logger.error({ err }, "office deploy-approvals: list failed");
      res.status(500).json({ ok: false, error: "list_failed" });
    }
  },
);

// ─── POST /slumhouse/admin/deploy-approvals/:id/approve ─────────────────────

deployApprovalsRouter.post(
  "/slumhouse/admin/deploy-approvals/:id/approve",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAdminSession(req, res)) return;
    // deep-scan Slumhouse F-3: CSRF Origin guard on the highest-stakes state-mutating POST (moves a
    // strategy to/from live capital) — matches every sibling Slumhouse control-surface POST.
    if (!checkSlumhouseOrigin(req, res)) return;
    const strategyId = String(req.params.id ?? "");
    const correlationId = randomUUID();

    // Fail-closed: re-derive evidence server-side. A tampered/stale UI can
    // never approve a strategy whose evidence is missing, stale, or failing.
    let evidenceSummary: Record<string, unknown> = {};
    try {
      const ev = await buildDeployEvidence(strategyId);
      evidenceSummary = {
        backtestId: ev.backtestId,
        backtestAgeDays: ev.backtestAgeDays,
        evidenceState: ev.evidenceState,
        metrics: ev.evidence.map((m) => ({ key: m.key, value: m.value, ok: m.ok })),
      };
      if (!ev.approvable) {
        await insertAuditRowSafe({
          action: "slumhouse_admin.deploy_approve_refused",
          entityType: "strategy",
          entityId: strategyId,
          decisionAuthority: "gate",
          input: { strategyId } as Record<string, unknown>,
          result: { blockers: ev.blockers, ...evidenceSummary } as Record<string, unknown>,
          status: "warning",
          correlationId,
        });
        res.status(409).json({ ok: false, error: "evidence_not_approvable", blockers: ev.blockers });
        return;
      }
    } catch (err) {
      logger.error({ err, strategyId }, "office deploy-approvals: approve evidence check failed");
      res.status(500).json({ ok: false, error: "evidence_check_failed" });
      return;
    }

    // EXISTING promotion path — human release authority, all gates intact.
    const result = await (await getLifecycleService()).promoteStrategy(strategyId, "DEPLOY_READY", "DEPLOYED", {
      actor: "human_release",
      reason: "office_deploy_approval",
      correlationId,
    });
    if (!result.success) {
      res.status(403).json({ ok: false, error: result.error ?? "promotion_refused" });
      return;
    }

    await insertAuditRowSafe({
      action: "slumhouse_admin.deploy_approved",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "human",
      input: { strategyId, via: "office_approval_card" } as Record<string, unknown>,
      result: evidenceSummary,
      status: "success",
      correlationId,
    });
    res.json({ ok: true, id: strategyId, newState: "DEPLOYED", correlationId });
  },
);

// ─── POST /slumhouse/admin/deploy-approvals/:id/reject ──────────────────────

deployApprovalsRouter.post(
  "/slumhouse/admin/deploy-approvals/:id/reject",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAdminSession(req, res)) return;
    // deep-scan Slumhouse F-3: CSRF Origin guard on the highest-stakes state-mutating POST (moves a
    // strategy to/from live capital) — matches every sibling Slumhouse control-surface POST.
    if (!checkSlumhouseOrigin(req, res)) return;
    const strategyId = String(req.params.id ?? "");
    const correlationId = randomUUID();
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 3) {
      res.status(400).json({ ok: false, error: "reason_required", hint: "Say why you're sending it back (a few words is fine)." });
      return;
    }

    // EXISTING demotion edge (DEPLOY_READY → PAPER) through the same promotion
    // machinery — mirrors POST /api/strategies/:id/reject-deploy.
    const result = await (await getLifecycleService()).promoteStrategy(strategyId, "DEPLOY_READY", "PAPER", {
      actor: "human_release",
      reason: `office_deploy_rejection: ${reason}`,
      correlationId,
    });
    if (!result.success) {
      res.status(403).json({ ok: false, error: result.error ?? "rejection_refused" });
      return;
    }

    await insertAuditRowSafe({
      action: "slumhouse_admin.deploy_rejected",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "human",
      input: { strategyId, reason, via: "office_approval_card" } as Record<string, unknown>,
      result: { newState: "PAPER" } as Record<string, unknown>,
      status: "success",
      correlationId,
    });
    res.json({ ok: true, id: strategyId, newState: "PAPER", correlationId });
  },
);
