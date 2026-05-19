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
import { complianceRulesets, complianceDriftLog } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { notifyCritical } from "./notification-service.js";

const FIRMS = [
  "MFFU",
  "Topstep",
  "TPT",
  "Apex",
  "FFN",
  "Alpha",
  "Tradeify",
  "Earn2Trade",
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
    logger.debug("Compliance rules unchanged — no drift");
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
      `The prop firm rules document has changed.\n` +
        `Affected firms: ${firmList}\n` +
        `Old hash: ${oldHash?.slice(0, 12) ?? "none"}\n` +
        `New hash: ${newHash.slice(0, 12)}\n` +
        `Please review and re-validate active strategies.`,
      { oldHash, newHash, affectedFirms: driftDetails.map((d) => d.firm) },
    );
  }

  return { drifted: driftDetails.length > 0, details: driftDetails };
}
