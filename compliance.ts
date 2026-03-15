import { Router, Request, Response } from "express";
import { db } from "../db/index.js";
import {
  complianceRulesets,
  complianceReviews,
  complianceDriftLog,
} from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// ─── Ruleset Freshness Constants ────────────────────────────
const RULESET_MAX_AGE_HOURS = {
  active_trading: 24,
  research_only: 72,
};

// ─── GET /api/compliance/rulesets ────────────────────────────
// All firm rulesets + freshness status
router.get("/rulesets", async (_req: Request, res: Response) => {
  const rulesets = await db
    .select()
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
  const rulesets = await db.select().from(complianceRulesets);

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
    .select()
    .from(complianceRulesets)
    .where(eq(complianceRulesets.firm, firm));

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
    .where(eq(complianceRulesets.id, id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "Ruleset not found" });
    return;
  }

  res.json({ ruleset: updated[0], message: "Ruleset verified by human operator." });
});

// ─── POST /api/compliance/review ────────────────────────────
// Store a compliance review result (produced by OpenClaw)
router.post("/review", async (req: Request, res: Response) => {
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

  res.status(201).json({ review: review[0] });
});

// ─── GET /api/compliance/review/:strategyId ─────────────────
// All compliance reviews for a strategy
router.get("/review/:strategyId", async (req: Request, res: Response) => {
  const { strategyId } = req.params;

  const reviews = await db
    .select()
    .from(complianceReviews)
    .where(eq(complianceReviews.strategyId, strategyId))
    .orderBy(desc(complianceReviews.createdAt));

  res.json({ reviews });
});

// ─── GET /api/compliance/review/:strategyId/:firm ───────────
// Compliance review for a strategy at a specific firm
router.get("/review/:strategyId/:firm", async (req: Request, res: Response) => {
  const { strategyId, firm } = req.params;

  const reviews = await db
    .select()
    .from(complianceReviews)
    .where(
      and(
        eq(complianceReviews.strategyId, strategyId),
        eq(complianceReviews.firm, firm)
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
  const rulesets = await db.select().from(complianceRulesets);

  const now = new Date();
  const staleRulesets = rulesets.filter((r) => {
    const ageMs = now.getTime() - new Date(r.retrievedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    return ageHours > RULESET_MAX_AGE_HOURS.active_trading || r.driftDetected;
  });

  // Get latest compliance reviews
  const reviews = await db
    .select()
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
    .where(eq(complianceDriftLog.id, id))
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
  const rulesets = await db.select().from(complianceRulesets);
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
