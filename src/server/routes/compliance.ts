import { Router, Request, Response } from "express";
import { db } from "../db/index.js";
import {
  complianceRulesets,
  complianceReviews,
  complianceDriftLog,
  auditLog,
} from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * G7.1 contracts — compliance human-approval surfaces.
 * NOTE: there is no `POST /api/compliance/approve` endpoint in this router.
 * Human approval is split across two existing routes:
 *   - `PATCH /api/compliance/rulesets/:id/verify` — human verifies an updated
 *     firm ruleset (clears drift, marks as verified).
 *   - `POST  /api/compliance/review`              — stores a per-strategy
 *     compliance review record (used as the execution gate signal).
 * Frontends must import these types instead of redeclaring shapes by hand.
 * See `src/server/lib/api-contracts.ts` for the per-route contract pattern.
 */
export interface ComplianceVerifyResponse {
  ruleset: typeof complianceRulesets.$inferSelect;
  message: string;
}

export interface ComplianceReviewSubmitResponse {
  review: typeof complianceReviews.$inferSelect;
}

// ─── Ruleset Freshness Constants ────────────────────────────
const RULESET_MAX_AGE_HOURS = {
  active_trading: Number(process.env.RULESET_MAX_AGE_HOURS_ACTIVE) || 24,
  research_only: Number(process.env.RULESET_MAX_AGE_HOURS_RESEARCH) || 72,
};

const stableComplianceRulesetSelect = {
  id: complianceRulesets.id,
  firm: complianceRulesets.firm,
  accountType: complianceRulesets.accountType,
  sourceUrl: complianceRulesets.sourceUrl,
  contentHash: complianceRulesets.contentHash,
  rawContent: complianceRulesets.rawContent,
  parsedRules: complianceRulesets.parsedRules,
  status: complianceRulesets.status,
  driftDetected: complianceRulesets.driftDetected,
  driftDiff: complianceRulesets.driftDiff,
  verifiedBy: complianceRulesets.verifiedBy,
  verifiedAt: complianceRulesets.verifiedAt,
  retrievedAt: complianceRulesets.retrievedAt,
  createdAt: complianceRulesets.createdAt,
  updatedAt: complianceRulesets.updatedAt,
};

const stableComplianceReviewSelect = {
  id: complianceReviews.id,
  strategyId: complianceReviews.strategyId,
  firm: complianceReviews.firm,
  accountType: complianceReviews.accountType,
  rulesetId: complianceReviews.rulesetId,
  complianceResult: complianceReviews.complianceResult,
  riskScore: complianceReviews.riskScore,
  violations: complianceReviews.violations,
  warnings: complianceReviews.warnings,
  requiredChanges: complianceReviews.requiredChanges,
  reasoningSummary: complianceReviews.reasoningSummary,
  executionGate: complianceReviews.executionGate,
  reviewedBy: complianceReviews.reviewedBy,
  createdAt: complianceReviews.createdAt,
};

// ─── GET /api/compliance/rulesets ────────────────────────────
// All firm rulesets + freshness status
router.get("/rulesets", async (_req: Request, res: Response) => {
  const rulesets = await db
    .select(stableComplianceRulesetSelect)
    .from(complianceRulesets)
    .orderBy(complianceRulesets.firm);

  const now = new Date();
  const enriched = rulesets.map((r) => {
    const ageMs = now.getTime() - new Date(r.retrievedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    return {
      ...r,
      ageHours: Math.round(ageHours * 10) / 10,
      freshForTrading: ageHours <= RULESET_MAX_AGE_HOURS.active_trading && !r.driftDetected,
      freshForResearch: ageHours <= RULESET_MAX_AGE_HOURS.research_only && !r.driftDetected,
    };
  });

  res.json({ rulesets: enriched });
});

// ─── GET /api/compliance/rulesets/freshness ──────────────────
// Quick freshness check for all firms
router.get("/rulesets/freshness", async (_req: Request, res: Response) => {
  const rulesets = await db.select(stableComplianceRulesetSelect).from(complianceRulesets);

  const now = new Date();
  const freshness = rulesets.map((r) => {
    const ageMs = now.getTime() - new Date(r.retrievedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    return {
      firm: r.firm,
      accountType: r.accountType,
      status: r.status,
      ageHours: Math.round(ageHours * 10) / 10,
      driftDetected: r.driftDetected,
      freshForTrading: ageHours <= RULESET_MAX_AGE_HOURS.active_trading && !r.driftDetected,
      freshForResearch: ageHours <= RULESET_MAX_AGE_HOURS.research_only && !r.driftDetected,
      retrievedAt: r.retrievedAt,
    };
  });

  const allFreshForTrading = freshness.every((f) => f.freshForTrading);
  const staleFirms = freshness.filter((f) => !f.freshForTrading).map((f) => f.firm);

  res.json({
    allFreshForTrading,
    staleFirms,
    firms: freshness,
  });
});

// ─── GET /api/compliance/rulesets/:firm ──────────────────────
router.get("/rulesets/:firm", async (req: Request, res: Response) => {
  const { firm } = req.params;
  const rulesets = await db
    .select(stableComplianceRulesetSelect)
    .from(complianceRulesets)
    .where(eq(complianceRulesets.firm, String(firm)));

  if (rulesets.length === 0) {
    res.status(404).json({ error: `No rulesets found for firm: ${firm}` });
    return;
  }

  res.json({ rulesets });
});

// ─── PATCH /api/compliance/rulesets/:id/verify ──────────────
// Human approves an updated ruleset
router.patch("/rulesets/:id/verify", async (req: Request, res: Response) => {
  const { id } = req.params;

  const updated = await db
    .update(complianceRulesets)
    .set({
      status: "verified",
      driftDetected: false,
      driftDiff: null,
      verifiedBy: "human",
      verifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(complianceRulesets.id, String(id)))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "Ruleset not found" });
    return;
  }

  const response: ComplianceVerifyResponse = {
    ruleset: updated[0],
    message: "Ruleset verified by human operator.",
  };
  res.json(response);
});

// ─── POST /api/compliance/review ────────────────────────────
// Store a compliance review result (produced by OpenClaw)
//
// P1-drift-2: every review submission writes an `auditLog` row so the trail
// of execution-gate decisions is queryable. Successful inserts log
// `compliance.review_submitted`; failures log `compliance.review_failed` and
// surface the error to the caller as a 500.
router.post("/review", idempotencyMiddleware, async (req: Request, res: Response) => {
  const {
    strategyId,
    firm,
    accountType,
    rulesetId,
    complianceResult,
    riskScore,
    violations,
    warnings,
    requiredChanges,
    reasoningSummary,
    executionGate,
    reviewedBy,
  } = req.body;

  if (!strategyId || !firm || !complianceResult || !executionGate) {
    res.status(400).json({ error: "Missing required fields: strategyId, firm, complianceResult, executionGate" });
    return;
  }

  const correlationId = (req as unknown as { id?: string }).id ?? null;

  try {
    const review = await db
      .insert(complianceReviews)
      .values({
        strategyId,
        firm,
        accountType: accountType || "default",
        rulesetId,
        complianceResult,
        riskScore: riskScore || 0,
        violations: violations || [],
        warnings: warnings || [],
        requiredChanges: requiredChanges || [],
        reasoningSummary,
        executionGate,
        reviewedBy: reviewedBy || "openclaw",
      })
      .returning();

    // Audit row on success — captures the gate decision so OpenClaw / human
    // reviewer activity is queryable from the audit trail without joining
    // through compliance_reviews.
    db.insert(auditLog)
      .values({
        action: "compliance.review_submitted",
        entityType: "compliance_review",
        entityId: review[0].id,
        input: {
          strategyId,
          firm,
          accountType: accountType || "default",
          rulesetId: rulesetId ?? null,
        } as Record<string, unknown>,
        result: {
          reviewId: review[0].id,
          complianceResult,
          executionGate,
          riskScore: riskScore || 0,
          violationCount: Array.isArray(violations) ? violations.length : 0,
          warningCount: Array.isArray(warnings) ? warnings.length : 0,
          reviewedBy: reviewedBy || "openclaw",
        } as Record<string, unknown>,
        status: "success",
        decisionAuthority: reviewedBy === "human" ? "human" : "agent",
        correlationId,
      })
      .catch((auditErr) => {
        logger.warn(
          { err: auditErr, reviewId: review[0].id },
          "compliance.review_submitted audit insert failed (non-blocking)",
        );
      });

    const response: ComplianceReviewSubmitResponse = { review: review[0] };
    res.status(201).json(response);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, strategyId, firm, complianceResult, executionGate },
      "POST /api/compliance/review: insert failed",
    );
    db.insert(auditLog)
      .values({
        action: "compliance.review_failed",
        entityType: "compliance_review",
        entityId: null,
        input: {
          strategyId,
          firm,
          accountType: accountType || "default",
          rulesetId: rulesetId ?? null,
          complianceResult,
          executionGate,
        } as Record<string, unknown>,
        result: { error: errMsg } as Record<string, unknown>,
        status: "failure",
        decisionAuthority: reviewedBy === "human" ? "human" : "agent",
        correlationId,
      })
      .catch((auditErr) => {
        logger.warn(
          { err: auditErr, originalError: errMsg },
          "compliance.review_failed audit insert also failed (non-blocking)",
        );
      });
    res.status(500).json({
      error: "Failed to write compliance review",
      details: errMsg,
    });
  }
});

// ─── GET /api/compliance/review/:strategyId ─────────────────
// All compliance reviews for a strategy
router.get("/review/:strategyId", async (req: Request, res: Response) => {
  const { strategyId } = req.params;

  const reviews = await db
    .select(stableComplianceReviewSelect)
    .from(complianceReviews)
    .where(eq(complianceReviews.strategyId, String(strategyId)))
    .orderBy(desc(complianceReviews.createdAt));

  res.json({ reviews });
});

// ─── GET /api/compliance/review/:strategyId/:firm ───────────
// Compliance review for a strategy at a specific firm
router.get("/review/:strategyId/:firm", async (req: Request, res: Response) => {
  const { strategyId, firm } = req.params;

  const reviews = await db
    .select(stableComplianceReviewSelect)
    .from(complianceReviews)
    .where(
      and(
        eq(complianceReviews.strategyId, String(strategyId)),
        eq(complianceReviews.firm, String(firm))
      )
    )
    .orderBy(desc(complianceReviews.createdAt))
    .limit(1);

  if (reviews.length === 0) {
    res.status(404).json({ error: `No compliance review found for strategy ${strategyId} at ${firm}` });
    return;
  }

  res.json({ review: reviews[0] });
});

// ─── GET /api/compliance/gate/today ─────────────────────────
// Today's per-strategy gate decisions
router.get("/gate/today", async (_req: Request, res: Response) => {
  // Get all rulesets and check freshness
  const rulesets = await db.select(stableComplianceRulesetSelect).from(complianceRulesets);

  const now = new Date();
  const staleRulesets = rulesets.filter((r) => {
    const ageMs = now.getTime() - new Date(r.retrievedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    return ageHours > RULESET_MAX_AGE_HOURS.active_trading || r.driftDetected;
  });

  // Get latest compliance reviews
  const reviews = await db
    .select(stableComplianceReviewSelect)
    .from(complianceReviews)
    .orderBy(desc(complianceReviews.createdAt));

  const staleFirms = staleRulesets.map((r) => r.firm);

  const gateDecisions = reviews.map((r) => ({
    strategyId: r.strategyId,
    firm: r.firm,
    complianceResult: r.complianceResult,
    executionGate: r.executionGate,
    firmRulesStale: staleFirms.includes(r.firm),
    finalDecision: staleFirms.includes(r.firm)
      ? "BLOCKED"
      : r.complianceResult === "pass"
        ? "APPROVED"
        : "BLOCKED",
    blockReason: staleFirms.includes(r.firm)
      ? `Rules for ${r.firm} are stale. Refresh required.`
      : r.complianceResult !== "pass"
        ? r.reasoningSummary
        : null,
  }));

  res.json({
    date: now.toISOString().split("T")[0],
    staleFirms,
    decisions: gateDecisions,
  });
});

// ─── GET /api/compliance/drift ──────────────────────────────
// All drift events
router.get("/drift", async (_req: Request, res: Response) => {
  const drifts = await db
    .select()
    .from(complianceDriftLog)
    .orderBy(desc(complianceDriftLog.detectedAt));

  res.json({ drifts });
});

// ─── GET /api/compliance/drift/unresolved ───────────────────
router.get("/drift/unresolved", async (_req: Request, res: Response) => {
  const drifts = await db
    .select()
    .from(complianceDriftLog)
    .where(eq(complianceDriftLog.resolved, false))
    .orderBy(desc(complianceDriftLog.detectedAt));

  res.json({ drifts });
});

// ─── POST /api/compliance/drift/:firm/cascade ──────────────
// Trigger compliance cascade revalidation for a firm
router.post("/drift/:firm/cascade", idempotencyMiddleware, async (req: Request, res: Response) => {
  const firm = req.params.firm as string;

  try {
    const { cascadeRevalidation } = await import("../services/drift-detection-service.js");
    const result = await cascadeRevalidation(firm);
    res.json({
      firm,
      ...result,
      message: `Cascade revalidation complete: ${result.invalidatedReviews} reviews invalidated, ${result.pausedStrategies.length} strategies paused`,
    });
  } catch (err) {
    res.status(500).json({ error: "Cascade revalidation failed", details: String(err) });
  }
});

// ─── PATCH /api/compliance/drift/:id/resolve ────────────────
router.patch("/drift/:id/resolve", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { resolvedBy, notes } = req.body;

  const updated = await db
    .update(complianceDriftLog)
    .set({
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy: resolvedBy || "human",
      notes,
    })
    .where(eq(complianceDriftLog.id, String(id)))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "Drift event not found" });
    return;
  }

  res.json({ drift: updated[0], message: "Drift resolved." });
});

// ─── GET /api/compliance/status ─────────────────────────────
// Overall compliance health dashboard
router.get("/status", async (_req: Request, res: Response) => {
  const rulesets = await db.select(stableComplianceRulesetSelect).from(complianceRulesets);
  const unresolvedDrifts = await db
    .select()
    .from(complianceDriftLog)
    .where(eq(complianceDriftLog.resolved, false));

  const now = new Date();
  const firmStatus = rulesets.map((r) => {
    const ageMs = now.getTime() - new Date(r.retrievedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const fresh = ageHours <= RULESET_MAX_AGE_HOURS.active_trading && !r.driftDetected;
    return {
      firm: r.firm,
      accountType: r.accountType,
      status: r.status,
      ageHours: Math.round(ageHours * 10) / 10,
      driftDetected: r.driftDetected,
      fresh,
      health: fresh && r.status === "verified" ? "healthy" : "unhealthy",
    };
  });

  const healthyCount = firmStatus.filter((f) => f.health === "healthy").length;
  const totalCount = firmStatus.length;

  res.json({
    overallHealth: healthyCount === totalCount ? "healthy" : "degraded",
    healthyFirms: healthyCount,
    totalFirms: totalCount,
    unresolvedDrifts: unresolvedDrifts.length,
    firms: firmStatus,
  });
});

export default router;
