/**
 * Wave 27 Pass 2.F2 — Trade Critique Grade Signal Test
 *
 * Replay-grades all closed paper_positions from the last 90 days by
 * invoking runTradeCritique(positionId, correlationId, dryRun=true) over
 * historical data and analysing whether critique grade (A+/A/B+ vs D/F)
 * predicts realized strategy-level Sharpe degradation over the next 30 days.
 *
 * MANDATORY: dryRun=true on every invocation — never pollutes prod tables.
 *
 * CLI:
 *   npx tsx scripts/replay-grade-critique.ts                 # dry-run stdout only
 *   npx tsx scripts/replay-grade-critique.ts --apply         # writes docs/replay-results/<date>-critique-disagreement.md
 *   npx tsx scripts/replay-grade-critique.ts --limit N       # analyse at most N positions
 *   npx tsx scripts/replay-grade-critique.ts --strategy <id> # filter to one strategy
 *   npx tsx scripts/replay-grade-critique.ts --days N        # look-back window (default 90)
 *
 * Pure-function library: src/server/lib/replay/critique-disagreement.ts
 * Governance: dryRun=true — no writes to trade_critique, audit_log, system_parameters, Discord.
 * Exit 1 ONLY on DB error or invalid data shape.
 * Exit 0 on successful analysis regardless of verdict.
 *
 * Source: Wave 27 Pass 2, sub-track F2 (paper-parity)
 */

/**
 * replay-grade-critique.ts correlation-base determinism contract
 * ───────────────────────────────────────────────────────────────
 * FIX (Finding MED — Wave A Critic, Finding #4): the previous implementation
 * set correlationBase = `replay-critique-${new Date().toISOString()}`, which
 * embeds a wall-clock timestamp and breaks replay determinism — two runs on
 * the same dataset produce different correlation IDs, making audit trails
 * diverge and making it impossible to de-duplicate or diff replay runs.
 *
 * Fix: correlationBase defaults to sha256(positionIds.sort().join(","))
 * truncated to 16 hex chars.  This is input-deterministic: identical position
 * sets produce identical correlation IDs regardless of when the script runs.
 *
 * CLI override:
 *   --correlation-base <string>   Use the given string verbatim as the base.
 *                                 Useful for tagging a named replay session.
 *
 * The per-position suffix (`-${i}`) is still appended to the base so
 * individual position correlationIds remain unique within a run.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import postgres from "postgres";
import { logger } from "../src/server/lib/logger.js";
import {
  evaluateCritiqueGradeSignal,
  buildCritiqueMarkdownReport,
  type TradeCritiqueRow,
  type PaperPositionRow,
  type ParameterHint,
} from "../src/server/lib/replay/critique-disagreement.js";
import { runTradeCritique } from "../src/server/services/trade-critique-service.js";
export { computeCorrelationBase } from "../src/server/lib/replay/correlation-base.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawPositionRow {
  id: string;
  session_id: string | null;
  strategy_id: string | null;
  symbol: string;
  side: string;
  entry_price: string;
  exit_price: string | null;
  stop_price: string | null;
  current_price: string | null;
  closed_at: Date | null;
}

// ─── R computation (mirrors trade-critique-service.ts logic) ─────────────────

function computeRealizedR(pos: RawPositionRow): number | null {
  const entryPrice = Number(pos.entry_price);
  const stopPrice  = pos.stop_price != null ? Number(pos.stop_price) : null;
  const exitPrice  = pos.exit_price != null
    ? Number(pos.exit_price)
    : (pos.current_price != null ? Number(pos.current_price) : entryPrice);

  if (!stopPrice || stopPrice === entryPrice) return null;

  const stopDistance = Math.abs(entryPrice - stopPrice);
  const direction    = pos.side === "long" ? 1 : -1;
  const priceMove    = direction * (exitPrice - entryPrice);
  return priceMove / stopDistance;
}

// ─── Main analysis function ───────────────────────────────────────────────────

/**
 * Core analysis. Accepts a raw postgres SQL client.
 * Exported for integration testing with a real or mock DB.
 */
export async function runCritiqueGradeAnalysis(
  sql: ReturnType<typeof postgres>,
  opts: {
    limitPositions?: number;
    strategyId?: string;
    lookbackDays?: number;
    /** Deterministic correlation base. Defaults to sha256(sortedPositionIds). */
    correlationBase?: string;
  } = {},
): Promise<{
  critiqueRows: TradeCritiqueRow[];
  positionRows: PaperPositionRow[];
  result: Awaited<ReturnType<typeof evaluateCritiqueGradeSignal>>;
}> {
  const lookbackDays = opts.lookbackDays ?? 90;

  // Step 1: Load closed paper_positions from the last N days
  let positionsQuery: RawPositionRow[];

  if (opts.strategyId) {
    positionsQuery = await sql<RawPositionRow[]>`
      SELECT
        pp.id,
        pp.session_id,
        ps.strategy_id,
        pp.symbol,
        pp.side,
        pp.entry_price,
        pp.current_price,
        pp.closed_at,
        -- Wave 26 / 27 columns that may exist via closePosition journal writes
        (pp.exit_plan->>'exitPrice')::text AS exit_price,
        pp.trail_hwm AS stop_price
      FROM paper_positions pp
      LEFT JOIN paper_sessions ps ON ps.id = pp.session_id
      WHERE pp.closed_at IS NOT NULL
        AND pp.closed_at >= NOW() - (${lookbackDays} || ' days')::interval
        AND ps.strategy_id = ${opts.strategyId}
      ORDER BY pp.closed_at ASC
      ${opts.limitPositions != null ? sql`LIMIT ${opts.limitPositions}` : sql``}
    `;
  } else {
    positionsQuery = await sql<RawPositionRow[]>`
      SELECT
        pp.id,
        pp.session_id,
        ps.strategy_id,
        pp.symbol,
        pp.side,
        pp.entry_price,
        pp.current_price,
        pp.closed_at,
        (pp.exit_plan->>'exitPrice')::text AS exit_price,
        pp.trail_hwm AS stop_price
      FROM paper_positions pp
      LEFT JOIN paper_sessions ps ON ps.id = pp.session_id
      WHERE pp.closed_at IS NOT NULL
        AND pp.closed_at >= NOW() - (${lookbackDays} || ' days')::interval
      ORDER BY pp.closed_at ASC
      ${opts.limitPositions != null ? sql`LIMIT ${opts.limitPositions}` : sql``}
    `;
  }

  logger.info(
    { count: positionsQuery.length, lookbackDays, strategyId: opts.strategyId },
    "replay-grade-critique: positions loaded",
  );

  if (positionsQuery.length === 0) {
    logger.warn("replay-grade-critique: no closed positions found in window");
    const emptyResult = evaluateCritiqueGradeSignal([], []);
    return { critiqueRows: [], positionRows: [], result: emptyResult };
  }

  // Step 2: Load pre-existing trade_critique rows for these positions to avoid
  // duplicate LLM calls (idempotent by design — critique service deduplicates
  // within 5 min window, but replay uses dryRun=true so old production rows
  // are also eligible as ground truth for grade analysis).
  const positionIds = positionsQuery.map(p => p.id);
  const existingCritiques = await sql<Array<{
    id: string;
    position_id: string;
    strategy_id: string | null;
    grade: string;
    critiqued_at: Date;
    technical_diagnosis: Record<string, unknown>;
  }>>`
    SELECT
      id,
      position_id,
      strategy_id,
      grade,
      critiqued_at,
      technical_diagnosis
    FROM trade_critique
    WHERE position_id = ANY(${positionIds})
    ORDER BY critiqued_at ASC
  `;

  logger.info(
    { existingCount: existingCritiques.length },
    "replay-grade-critique: existing critique rows found",
  );

  // Build a set of position IDs that already have a critique
  const alreadyCritiqued = new Set(existingCritiques.map(c => c.position_id));

  // Step 3: Run trade-critique service with dryRun=true for positions that
  // don't already have a critique row.  Collect results in-memory.
  const dryRunResults: TradeCritiqueRow[] = [];

  // FIX (Finding #4 — Wave A Critic): deterministic correlation base.
  // Use caller-supplied base if provided (e.g. from --correlation-base CLI flag),
  // otherwise derive from the sorted position IDs (reuse positionIds already built
  // above for existingCritiques query) so two identical runs on the same dataset
  // produce the same correlation IDs regardless of wall-clock time.
  const correlationBase = opts.correlationBase ?? computeCorrelationBase(positionIds);

  for (let i = 0; i < positionsQuery.length; i++) {
    const pos = positionsQuery[i];

    if (alreadyCritiqued.has(pos.id)) {
      // Use the existing critique row — no LLM call needed
      const existing = existingCritiques.find(c => c.position_id === pos.id);
      if (existing) {
        const td = existing.technical_diagnosis;
        const paramHintRaw = td?.parameter_hint ?? null;
        const paramHint: ParameterHint | null = (
          paramHintRaw && typeof paramHintRaw === "object" &&
          "field" in paramHintRaw && typeof (paramHintRaw as any).field === "string"
        )
          ? {
              field: (paramHintRaw as any).field,
              current: (paramHintRaw as any).current ?? null,
              suggested_range: (paramHintRaw as any).suggested_range ?? "",
              confidence: Number((paramHintRaw as any).confidence ?? 0),
            }
          : null;

        dryRunResults.push({
          id: existing.id,
          positionId: existing.position_id,
          strategyId: existing.strategy_id ?? pos.strategy_id,
          grade: existing.grade,
          critiquedAt: existing.critiqued_at,
          parameterHint: paramHint,
          realizedR: typeof td?.realized_r === "number" ? td.realized_r as number : computeRealizedR(pos),
        });
      }
      continue;
    }

    // Fire dryRun=true — MANDATORY per spec
    const correlationId = `${correlationBase}-${i}`;
    try {
      const critResult = await runTradeCritique(pos.id, correlationId, /* dryRun= */ true);
      if (critResult.status === "completed" || critResult.status === "partial_data") {
        // DryRun result has grade but no critiqueId (DB row was NOT written).
        // Use the grade from the result + compute R from position data.
        dryRunResults.push({
          id: `dry-${pos.id}`,
          positionId: pos.id,
          strategyId: pos.strategy_id,
          grade: critResult.grade ?? "C",   // fallback to C (neutral) on missing grade
          critiquedAt: new Date(),
          parameterHint: null,              // not accessible from dryRun result shape
          realizedR: computeRealizedR(pos),
        });
        logger.debug(
          { positionId: pos.id, grade: critResult.grade, dryRun: true },
          "replay-grade-critique: dry-run critique completed",
        );
      } else {
        logger.debug(
          { positionId: pos.id, status: critResult.status },
          "replay-grade-critique: dry-run critique skipped/failed",
        );
      }
    } catch (err) {
      logger.warn(
        { positionId: pos.id, err },
        "replay-grade-critique: dry-run critique threw — skipping position",
      );
    }
  }

  // Combine existing + dryRun results (existing critique rows give richer data
  // since they carry the full technicalDiagnosis)
  const existingAsTradeCritique: TradeCritiqueRow[] = existingCritiques
    .filter(c => !dryRunResults.find(r => r.positionId === c.position_id))
    .map(c => {
      const td = c.technical_diagnosis;
      const paramHintRaw = td?.parameter_hint ?? null;
      const paramHint: ParameterHint | null = (
        paramHintRaw && typeof paramHintRaw === "object" &&
        "field" in paramHintRaw && typeof (paramHintRaw as any).field === "string"
      )
        ? {
            field: (paramHintRaw as any).field,
            current: (paramHintRaw as any).current ?? null,
            suggested_range: (paramHintRaw as any).suggested_range ?? "",
            confidence: Number((paramHintRaw as any).confidence ?? 0),
          }
        : null;

      const rawPos = positionsQuery.find(p => p.id === c.position_id);
      return {
        id: c.id,
        positionId: c.position_id,
        strategyId: c.strategy_id,
        grade: c.grade,
        critiquedAt: c.critiqued_at,
        parameterHint: paramHint,
        realizedR: typeof td?.realized_r === "number" ? td.realized_r as number : (rawPos ? computeRealizedR(rawPos) : null),
      };
    });

  const allCritiques: TradeCritiqueRow[] = [...existingAsTradeCritique, ...dryRunResults];

  // Build PaperPositionRow list for the analysis library
  const paperPositions: PaperPositionRow[] = positionsQuery.map(p => ({
    id: p.id,
    strategyId: p.strategy_id,
    realizedR: computeRealizedR(p),
    closedAt: p.closed_at,
  }));

  const result = evaluateCritiqueGradeSignal(allCritiques, paperPositions);
  return { critiqueRows: allCritiques, positionRows: paperPositions, result };
}

// ─── Correlation base derivation ─────────────────────────────────────────────
// `computeCorrelationBase` is now a pure function in the replay lib so tests
// can import it without triggering the Express bootstrap graph.
// The re-export at the top of this file (`export { computeCorrelationBase }`)
// forwards it for any callers that import from this script.
import { computeCorrelationBase } from "../src/server/lib/replay/correlation-base.js";

// ─── Git SHA helper ──────────────────────────────────────────────────────────

function getCritiqueSHA(): string {
  try {
    return execSync("git log --format=%H -1 -- src/server/services/trade-critique-service.ts", {
      encoding: "utf8",
    }).trim().slice(0, 12);
  } catch {
    return "unknown";
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const applyMode     = args.includes("--apply");
  const limitIdx      = args.indexOf("--limit");
  const limitPositions = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined;
  const strategyIdx   = args.indexOf("--strategy");
  const strategyId    = strategyIdx !== -1 ? args[strategyIdx + 1] : undefined;
  const daysIdx       = args.indexOf("--days");
  const lookbackDays  = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 90;
  // FIX (Finding #4 — Wave A Critic): --correlation-base CLI flag for deterministic override.
  // When omitted, runCritiqueGradeAnalysis derives it from sha256(sortedPositionIds).
  const corrBaseIdx   = args.indexOf("--correlation-base");
  const correlationBase = corrBaseIdx !== -1 ? args[corrBaseIdx + 1] : undefined;

  if (!process.env.DATABASE_URL) {
    console.error("[ERROR] DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const isoDate = new Date().toISOString().split("T")[0];

  console.log("=== REPLAY-GRADE-CRITIQUE — Wave 27 Pass 2.F2 Grade Signal Test ===");
  if (!applyMode) {
    console.log("(Dry-run mode: no markdown file written. Pass --apply to write report.)");
  }
  if (limitPositions !== undefined) {
    console.log(`(Limit mode: analysing at most ${limitPositions} positions)`);
  }
  if (strategyId) {
    console.log(`(Strategy filter: ${strategyId})`);
  }
  console.log(`(Look-back window: ${lookbackDays} days)`);
  console.log();

  const sql = postgres(process.env.DATABASE_URL);

  let analysis: Awaited<ReturnType<typeof runCritiqueGradeAnalysis>>;
  try {
    analysis = await runCritiqueGradeAnalysis(sql, { limitPositions, strategyId, lookbackDays, correlationBase });
  } catch (err) {
    logger.error({ err }, "replay-grade-critique: DB error during analysis");
    console.error("[ERROR] DB error during analysis:", err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();

  const { result } = analysis;
  const critiqueSHA = getCritiqueSHA();

  const report = buildCritiqueMarkdownReport(result, isoDate, {
    critiqueSHA,
    sampleSql: `SELECT * FROM paper_positions WHERE closed_at IS NOT NULL AND closed_at >= NOW() - INTERVAL '${lookbackDays} days'`,
  });

  // Always print to stdout
  console.log(report);

  console.log("=== Summary ===");
  console.log(`Critiques analyzed        : ${result.critiquesAnalyzed}`);
  console.log(`Positions linked          : ${result.positionsLinked}`);
  console.log(`n_high (A+/A/B+)         : ${result.nHigh}`);
  console.log(`n_low  (D/F)              : ${result.nLow}`);
  console.log(`Mann-Whitney U            : ${result.mannWhitneyU.toFixed(2)}`);
  console.log(`p-value                   : ${result.mannWhitneyPValue.toFixed(4)}`);
  console.log(`U effect size             : ${result.uEffectSize.toFixed(4)}`);
  console.log(`Verdict                   : ${result.verdict}`);
  console.log();

  if (applyMode) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname  = path.dirname(__filename);
    const repoRoot   = path.join(__dirname, "..");
    const outputPath = path.join(
      repoRoot,
      "docs",
      "replay-results",
      `${isoDate}-critique-disagreement.md`,
    );

    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, report, "utf8");
      console.log(`[APPLY] Report written to: ${outputPath}`);
    } catch (writeErr) {
      console.error(`[ERROR] Failed to write report: ${writeErr}`);
      process.exit(1);
    }
  } else {
    console.log("[DRY-RUN] No file written. Pass --apply to write report.");
  }

  process.exit(0);
}

main();
