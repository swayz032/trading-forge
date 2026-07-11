/**
 * Compliance Rule Auto-Refresh Service
 *
 * Periodically checks whether docs/prop-firm-rules.md has changed
 * since the last known compliance ruleset. If the hash differs,
 * drift is flagged per firm, logged to complianceDriftLog, and a
 * Discord alert is sent. This does NOT auto-apply rule changes —
 * it only detects drift and alerts.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { db } from "../db/index.js";
import { complianceRulesets, complianceDriftLog, strategies, paperSessions } from "../db/schema.js";
import { eq, desc, and, inArray, sql as drizzleSql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { broadcastSSE } from "../routes/sse.js";

// F-5: Use lowercase firm IDs matching paper-execution-service queries.
// Legacy firms (Apex, FFN, Alpha, Tradeify, Earn2Trade, TPT) were removed via
// migration 0097 on 2026-05-10 per CLAUDE.md §6. Only Topstep + MFFU remain.
// Previously "MFFU" / "Topstep" (Titlecase) were written here, while
// paper-execution-service queried with lowercase — the case mismatch caused
// compliance rulesets to never be found, silently bypassing MFFU 2% checks.
const FIRMS = [
  "mffu",
  "topstep",
] as const;

export interface DriftCheckResult {
  drifted: boolean;
  details: Array<{ firm: string; oldHash: string | null; newHash: string }>;
}

/**
 * Check if the prop-firm-rules.md document has changed since the last
 * known ruleset. This detects when rules are manually updated in docs.
 *
 * Idempotent: if the newHash already matches the most recent ruleset's
 * contentHash, no duplicate drift entries are created.
 */
export async function checkComplianceRuleDrift(): Promise<DriftCheckResult> {
  const rulesPath = path.resolve(process.cwd(), "docs/prop-firm-rules.md");

  if (!fs.existsSync(rulesPath)) {
    logger.warn("Compliance rules file not found at docs/prop-firm-rules.md");
    return { drifted: false, details: [] };
  }

  const content = fs.readFileSync(rulesPath, "utf-8");
  const newHash = crypto.createHash("sha256").update(content).digest("hex");

  // Get the most recent ruleset (any firm) to compare the document-level hash.
  const [latestRuleset] = await db
    .select({
      id: complianceRulesets.id,
      contentHash: complianceRulesets.contentHash,
    })
    .from(complianceRulesets)
    .orderBy(desc(complianceRulesets.createdAt))
    .limit(1);

  const oldHash = latestRuleset?.contentHash ?? null;

  if (oldHash === newHash) {
    // HIGH-4 (deep-scan 2026-07-09, ratified): re-stamp retrievedAt on a "verified
    // fresh, no drift" pass. PREVIOUS BUG — this branch returned early WITHOUT touching
    // any row, so `retrievedAt` never advanced while the rules doc was stable (the normal
    // case for weeks). The compliance freshness gate (compliance_gate.py, 24h
    // RULESET_MAX_AGE_HOURS) then failed ~24h after the last doc edit and HARD-REJECTED
    // every new fill (paper-execution-service.ts openPosition Stage 1) indefinitely, until
    // the doc text next changed. Freshness ("is this still verified accurate") and drift
    // ("has anything changed") are different questions — this heartbeat answers the first.
    await db
      .update(complianceRulesets)
      .set({ retrievedAt: new Date() })
      .where(eq(complianceRulesets.contentHash, newHash));
    logger.debug("Compliance rules unchanged — retrievedAt re-stamped (verified fresh, no drift)");
    return { drifted: false, details: [] };
  }

  logger.warn(
    { oldHash, newHash },
    "Compliance rule drift detected — rules document changed",
  );

  const driftDetails: DriftCheckResult["details"] = [];

  // For each firm, insert a new ruleset row with drift_detected status
  // and a corresponding drift log entry.
  for (const firm of FIRMS) {
    // Get the firm's most recent ruleset to detect per-firm idempotency
    const [firmLatest] = await db
      .select({
        id: complianceRulesets.id,
        contentHash: complianceRulesets.contentHash,
      })
      .from(complianceRulesets)
      .where(eq(complianceRulesets.firm, firm))
      .orderBy(desc(complianceRulesets.createdAt))
      .limit(1);

    const firmOldHash = firmLatest?.contentHash ?? null;

    // Skip if this firm already has a ruleset with the new hash (idempotency)
    if (firmOldHash === newHash) continue;

    // Insert new ruleset row with drift_detected status
    const [newRuleset] = await db
      .insert(complianceRulesets)
      .values({
        firm,
        accountType: "default",
        sourceUrl: "docs/prop-firm-rules.md",
        contentHash: newHash,
        rawContent: content,
        status: "drift_detected",
        driftDetected: true,
        driftDiff: `Document hash changed: ${firmOldHash?.slice(0, 12) ?? "none"} → ${newHash.slice(0, 12)}`,
        retrievedAt: new Date(),
      })
      .returning({ id: complianceRulesets.id });

    // Log drift
    await db.insert(complianceDriftLog).values({
      firm,
      accountType: "default",
      rulesetId: newRuleset.id,
      previousHash: firmOldHash ?? "none",
      newHash,
      driftSummary: `Rules document changed — hash ${firmOldHash?.slice(0, 12) ?? "none"} → ${newHash.slice(0, 12)}`,
    });

    driftDetails.push({ firm, oldHash: firmOldHash, newHash });
  }

  if (driftDetails.length > 0) {
    const firmList = driftDetails.map((d) => d.firm).join(", ");
    notifyCritical(
      "Compliance Rule Drift Detected",
      appendFamilyGradePostscript(
        `The prop firm rules document has changed.\n` +
          `Affected firms: ${firmList}\n` +
          `Old hash: ${oldHash?.slice(0, 12) ?? "none"}\n` +
          `New hash: ${newHash.slice(0, 12)}\n` +
          `Please review and re-validate active strategies.`,
        "The bot's trading compliance rules failed to refresh — a prop firm's rules document changed unexpectedly.",
        "Call Tony — the bot may be using outdated trading rules.",
      ),
      { oldHash, newHash, affectedFirms: driftDetails.map((d) => d.firm) },
    );

    // deepscan18 (E-E1): `compliance:drift_detected` has been a typed, subscribed
    // frontend dashboard tile (useSSE.ts) since it was catalogued — but this
    // function, the ONLY documented emitter of that event, never actually
    // called broadcastSSE. The tile was dead by omission (Discord got the
    // alert; the live dashboard never did). affectedStrategyCount + severity
    // are derived fail-soft — a count-query failure must never mask the
    // drift alert itself, so it defaults to the safe (critical/unknown-count)
    // reading rather than silently reporting "0 affected".
    const affectedFirms = driftDetails.map((d) => d.firm);
    let affectedStrategyCount = 0;
    let severity: "warning" | "critical" = "warning";
    try {
      const [{ count }] = await db
        .select({ count: drizzleSql<number>`count(distinct ${strategies.id})::int` })
        .from(strategies)
        .innerJoin(paperSessions, eq(paperSessions.strategyId, strategies.id))
        .where(
          and(
            inArray(strategies.lifecycleState, ["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"]),
            inArray(paperSessions.firmId, affectedFirms),
          ),
        );
      affectedStrategyCount = count ?? 0;
      severity = affectedStrategyCount > 0 ? "critical" : "warning";
    } catch (countErr) {
      logger.warn(
        { countErr, affectedFirms },
        "compliance-refresh-service: affected-strategy count query failed (deepscan18) — broadcasting drift with severity=critical (fail-safe, count unknown)",
      );
      severity = "critical"; // fail-safe: don't understate risk when we can't measure it
    }

    broadcastSSE("compliance:drift_detected", {
      affectedFirms,
      oldHash,
      newHash,
      affectedStrategyCount,
      severity,
      correlationId: null,
      timestamp: new Date().toISOString(),
    });
  }

  return { drifted: driftDetails.length > 0, details: driftDetails };
}
