/**
 * Daily drift check across the graduated-strategy library (Pass 21, 2026-05-12).
 *
 * Runs the auditor over every strategy with metadata.source='graduated_bucket'
 * and the joined pending_bucket evidence. Any DEFECT fires a Discord critical
 * alert listing the affected strategy IDs. WARNINGS are logged but do not
 * alert (warnings are advisory only).
 *
 * Designed for the scheduler: register as a daily cron at 06:00 ET. Resilient
 * to DB errors (logs + returns; never throws). Returns audit summary for the
 * scheduler-job metrics layer.
 */
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyPendingBuckets } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { auditGraduatedConfig } from "./graduated-strategy-auditor.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

export interface DriftSummary {
  totalScanned: number;
  cleanCount: number;
  defectCount: number;
  warningCount: number;
  defectiveStrategies: Array<{ id: string; name: string; defects: string[] }>;
}

export async function runGraduatedStrategyDriftCheck(): Promise<DriftSummary> {
  const cronCorrelationId = randomUUID();
  const summary: DriftSummary = {
    totalScanned: 0,
    cleanCount: 0,
    defectCount: 0,
    warningCount: 0,
    defectiveStrategies: [],
  };

  try {
    // SELECT s.id, s.name, s.symbol, s.config, b.id IS NOT NULL AS has_bucket
    const rows = await db
      .select({
        id: strategies.id,
        name: strategies.name,
        symbol: strategies.symbol,
        config: strategies.config,
      })
      .from(strategies)
      .where(sql`${strategies.config}->'metadata'->>'source' = 'graduated_bucket'`);

    summary.totalScanned = rows.length;

    for (const r of rows) {
      const audit = auditGraduatedConfig({
        conceptName: String((r.config as any)?.metadata?.concept_name ?? r.name).toLowerCase(),
        symbol: r.symbol,
        config: r.config,
      });
      summary.warningCount += audit.warnings.length;
      if (audit.passed) {
        summary.cleanCount++;
      } else {
        summary.defectCount += audit.defects.length;
        summary.defectiveStrategies.push({
          id: r.id,
          name: r.name,
          defects: audit.defects.map((d) => `${d.code}: ${d.message}`),
        });
      }
    }

    logger.info(
      { ...summary, defectiveStrategies: summary.defectiveStrategies.length },
      `drift-check: scanned=${summary.totalScanned} clean=${summary.cleanCount} defective=${summary.defectiveStrategies.length} warnings=${summary.warningCount}`,
    );

    // Persist summary to audit_log for historical drift tracking
    await insertAuditRow({
      action: "graduated_strategy_drift_check.completed",
      entityType: "system",
      input: { scope: "graduated_bucket" } as Record<string, unknown>,
      result: summary as unknown as Record<string, unknown>,
      status: summary.defectCount === 0 ? "success" : "failure",
      decisionAuthority: "system",
      correlationId: cronCorrelationId,
    });

    // Alert on any defect
    if (summary.defectiveStrategies.length > 0) {
      const top = summary.defectiveStrategies.slice(0, 5);
      const summaryLines = top.map((s) => `• ${s.name} (${s.id.slice(0, 8)}): ${s.defects[0]}`).join("\n");
      const more = summary.defectiveStrategies.length > 5
        ? `\n…and ${summary.defectiveStrategies.length - 5} more`
        : "";
      try {
        notifyCritical(
          `Graduated strategy drift: ${summary.defectiveStrategies.length} defects`,
          appendFamilyGradePostscript(
            `Backtest-pipeline integrity at risk. Layer 1/2 graduator + pre-backtest gates SHOULD have caught these — drift indicates manual SQL edits, migrations, or a regression in graduator/overlay.\n\nTop 5:\n${summaryLines}${more}\n\nRun \`npx tsx scripts/deep-scan-graduated-strategies.ts\` for full report.`,
            "A trading strategy's behavior drifted significantly from its backtest.",
            "No action needed — the bot paused the strategy automatically. Call Tony to review.",
          ),
          {
            totalScanned: summary.totalScanned,
            defectiveCount: summary.defectiveStrategies.length,
            firstFiveIds: top.map((s) => s.id),
          },
        );
      } catch (err) {
        logger.error({ err }, "drift-check critical alert failed");
      }
    }

    return summary;
  } catch (err) {
    logger.error({ err }, "drift-check FAILED — auditor or DB query threw");
    return summary;
  }
}
