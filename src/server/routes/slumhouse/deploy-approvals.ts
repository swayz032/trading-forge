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
 */
export async function buildDeployEvidence(strategyId: string): Promise<{
  backtestId: string | null;
  backtestAgeDays: number | null;
  evidenceState: "ok" | "stale" | "missing";
  evidence: EvidenceMetric[];
  approvable: boolean;
  blockers: string[];
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
  const dsr = asNum(extras?.deflated_sharpe);
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

  return {
    backtestId: bt.id,
    backtestAgeDays: ageDays,
    evidenceState,
    evidence,
    approvable: blockers.length === 0,
    blockers,
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
