/**
 * Wave 28 Pass B.3 — Shadow Evidence Analysis Script
 *
 * Reads accumulated composite.shadow_evaluation audit rows and produces a
 * Pass C activation recommendation: ACTIVATE_PASS_C / INCONCLUSIVE /
 * REVISE_COMPOSITE / PRELIMINARY.
 *
 * CLI:
 *   npx tsx scripts/analyze-shadow-evidence.ts                         # dry-run (stdout only)
 *   npx tsx scripts/analyze-shadow-evidence.ts --apply                 # write report + audit row
 *   npx tsx scripts/analyze-shadow-evidence.ts --window-days 30        # extend window
 *   npx tsx scripts/analyze-shadow-evidence.ts --min-sample 100        # raise sample floor
 *   npx tsx scripts/analyze-shadow-evidence.ts --output <path>         # custom output path
 *   npx tsx scripts/analyze-shadow-evidence.ts --asOf 2026-06-01       # time-travel testing
 *   npx tsx scripts/analyze-shadow-evidence.ts --dry-run               # explicit dry-run flag
 *
 * Governance:
 *   - READS audit_log only.  Never mutates promotion logic.
 *   - Dry-run by default (absence of --apply triggers dry-run).
 *   - Audit rows written only in apply mode.
 *   - Challenger outputs are advisory, not authoritative.
 *   - Wave 27.5 hard gates retain independent veto power.
 *
 * Pure-function core lives in src/server/lib/shadow-evidence-analyzer.ts.
 * This script re-exports the core for test consumers (mirrors W27 pattern).
 *
 * Source commit: Wave 28 Pass B.3 (critic-optimizer sub-track)
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { logger } from "../src/server/lib/logger.js";
import {
  analyzeShadowEvidence,
  buildMarkdownReport,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MIN_SAMPLE,
  AGREEMENT_ACTIVATE_THRESHOLD,
  AGREEMENT_INCONCLUSIVE_THRESHOLD,
  type AuditRow,
  type AnalysisResult,
  type ShadowVerdict,
  type AgreementCounts,
  type ConfusionMatrix,
  type PerStrategyStats,
} from "../src/server/lib/shadow-evidence-analyzer.js";

// Re-export pure-function library for test consumers (mirrors replay-grade-quantum.ts pattern)
export {
  analyzeShadowEvidence,
  buildMarkdownReport,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MIN_SAMPLE,
  AGREEMENT_ACTIVATE_THRESHOLD,
  AGREEMENT_INCONCLUSIVE_THRESHOLD,
  type AuditRow,
  type AnalysisResult,
  type ShadowVerdict,
  type AgreementCounts,
  type ConfusionMatrix,
  type PerStrategyStats,
};

// ─── DB query ─────────────────────────────────────────────────────────────────

async function fetchAuditRows(
  sql: ReturnType<typeof postgres>,
  asOf: Date,
  windowDays: number,
): Promise<AuditRow[]> {
  const windowStart = new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await sql<Array<{
    id: string;
    action: string;
    result: Record<string, unknown> | null;
    created_at: Date;
  }>>`
    SELECT id, action, result, created_at
    FROM audit_log
    WHERE action = 'composite.shadow_evaluation'
      AND created_at >= ${windowStart}
      AND created_at <= ${asOf}
    ORDER BY created_at ASC
  `;

  return rows;
}

async function insertAuditRow(
  sql: ReturnType<typeof postgres>,
  action: string,
  result: Record<string, unknown>,
  status: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sql`
    INSERT INTO audit_log (action, entity_type, result, status, decision_authority)
    VALUES (
      ${action},
      'shadow_analysis',
      ${sql.json(result as any)},
      ${status},
      'system'
    )
  `;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Dry-run by default; --apply enables DB writes and file output
  const applyMode = args.includes("--apply");
  const explicitDryRun = args.includes("--dry-run");
  const isDryRun = !applyMode || explicitDryRun;

  const windowDaysIdx = args.indexOf("--window-days");
  const windowDays = windowDaysIdx !== -1 ? parseInt(args[windowDaysIdx + 1]!, 10) : DEFAULT_WINDOW_DAYS;

  const minSampleIdx = args.indexOf("--min-sample");
  const minSample = minSampleIdx !== -1 ? parseInt(args[minSampleIdx + 1]!, 10) : DEFAULT_MIN_SAMPLE;

  const outputIdx = args.indexOf("--output");
  const customOutput = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

  const asOfIdx = args.indexOf("--asOf");
  const asOfStr = asOfIdx !== -1 ? args[asOfIdx + 1] : undefined;
  const asOf = asOfStr ? new Date(asOfStr) : new Date();

  if (isNaN(asOf.getTime())) {
    console.error(`[ERROR] Invalid --asOf value: "${asOfStr}"`);
    process.exit(1);
  }

  if (isNaN(windowDays) || windowDays < 1) {
    console.error(`[ERROR] --window-days must be a positive integer, got "${args[windowDaysIdx + 1]}"`);
    process.exit(1);
  }

  if (isNaN(minSample) || minSample < 1) {
    console.error(`[ERROR] --min-sample must be a positive integer, got "${args[minSampleIdx + 1]}"`);
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("[ERROR] DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const isoDate = asOf.toISOString().split("T")[0]!;

  console.log("=== ANALYZE-SHADOW-EVIDENCE — Wave 28 Pass B.3 ===");
  if (isDryRun) {
    console.log("(Dry-run mode: no file written, no audit row. Pass --apply to persist.)");
  }
  console.log(`Window: ${windowDays} days, min-sample: ${minSample}, as-of: ${asOf.toISOString()}`);
  console.log();

  const sql = postgres(process.env.DATABASE_URL);

  let rows: AuditRow[];
  try {
    rows = await fetchAuditRows(sql, asOf, windowDays);
    logger.info({ count: rows.length }, "analyze-shadow-evidence: audit rows loaded");
  } catch (err) {
    logger.error({ err }, "analyze-shadow-evidence: DB error fetching audit rows");
    console.error("[ERROR] DB error fetching audit rows:", err);

    if (!isDryRun) {
      try {
        await insertAuditRow(sql, "shadow_analysis.failed", {
          window_days: windowDays,
          min_sample: minSample,
          as_of: asOf.toISOString(),
          error: String(err),
        }, "error");
      } catch { /* non-fatal */ }
    }

    await sql.end();
    process.exit(1);
  }

  const result = analyzeShadowEvidence(rows, { windowDays, minSample, asOf });

  const report = buildMarkdownReport(result, isoDate);

  // Always print to stdout
  console.log(report);
  console.log();
  console.log("=== Summary ===");
  console.log(`Total attempts (in window)  : ${result.totalAttempts}`);
  console.log(`Shadow NO_OPINION excluded  : ${result.agreements.shadow_no_opinion}`);
  console.log(`Denominator (opinionated)   : ${result.totalAttempts - result.agreements.shadow_no_opinion}`);
  console.log(`Agreement rate              : ${(result.agreementRate * 100).toFixed(1)}%`);
  console.log(`Sample sufficient?          : ${result.sampleSufficient ? "YES" : "NO"}`);
  console.log(`Weights version drift?      : ${result.weightsVersionDrift ? "YES" : "NO"}`);
  console.log(`Verdict                     : ${result.verdict}`);
  if (result.verdictFlags.length > 0) {
    console.log(`Verdict flags               : ${result.verdictFlags.join(", ")}`);
  }
  console.log();

  if (isDryRun) {
    console.log("[DRY-RUN] No file written. No audit row written. Pass --apply to persist.");
    await sql.end();
    process.exit(0);
  }

  // Apply mode: write markdown file
  let outputPath: string;
  if (customOutput) {
    outputPath = customOutput;
  } else {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.join(__dirname, "..");
    outputPath = path.join(repoRoot, "docs", "shadow-evidence", `${isoDate}-shadow-agreement.md`);
  }

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report, "utf8");
    console.log(`[APPLY] Report written to: ${outputPath}`);
  } catch (writeErr) {
    console.error(`[ERROR] Failed to write report: ${writeErr}`);
    try {
      await insertAuditRow(sql, "shadow_analysis.failed", {
        window_days: windowDays,
        total_attempts: result.totalAttempts,
        agreement_rate: result.agreementRate,
        verdict: result.verdict,
        error: String(writeErr),
      }, "error");
    } catch { /* non-fatal */ }
    await sql.end();
    process.exit(1);
  }

  // Write completion audit row
  try {
    await insertAuditRow(sql, "shadow_analysis.completed", {
      window_days: windowDays,
      total_attempts: result.totalAttempts,
      agreement_rate: Math.round(result.agreementRate * 10000) / 10000,
      verdict: result.verdict,
      verdict_flags: result.verdictFlags,
      weights_version_drift: result.weightsVersionDrift,
      output_path: outputPath,
    }, "success");
    console.log("[APPLY] Audit row shadow_analysis.completed written.");
  } catch (auditErr) {
    logger.warn({ auditErr }, "analyze-shadow-evidence: failed to write completion audit row (non-fatal)");
    console.warn("[WARN] Failed to write completion audit row (non-fatal):", auditErr);
  }

  await sql.end();
  process.exit(0);
}

main();
