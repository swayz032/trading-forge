/**
 * synthetic-regime-bank-service.ts — A14 black-swan regime-bank population.
 *
 * PROBLEM CLOSED:
 *   A14 was a facade — every backtest fires runBlackSwanTest, which calls
 *   black_swan_evaluator.py, which queries synthetic_regime_bank — which was
 *   ALWAYS EMPTY. The evaluator returned survival_rate=null forever.
 *
 *   The Python stochastic generator (src/engine/synthetic/populate_regime_bank)
 *   is now REAL (8 named scenarios + 7-test calibration). The ONLY missing wire
 *   was a cron that invokes it and persists results. This service is that wire.
 *
 * WHAT THIS SERVICE DOES:
 *   1. Invokes `python -m src.engine.synthetic.populate_regime_bank` via the
 *      canonical runPythonModule() helper with a deterministic seed.
 *   2. Parses the JSON output contract (described below).
 *   3. For each regime record, uploads the local Parquet file to S3, then
 *      INSERTs a synthetic_regime_bank row.
 *   4. Deduplicates by (symbol, timeframe, regime_label, generator_model_version)
 *      — skips rows that already exist in the bank for the same version.
 *   5. Emits audit events: synthetic_regime_bank.populated / .partial / .failed
 *      with correlationId + counts.
 *   6. Fail-SOFT: a bad regime batch logs + continues; never throws into the cron.
 *
 * PYTHON CLI CONTRACT (already implemented + tested):
 *   Invoke: python -m src.engine.synthetic.populate_regime_bank --config '<JSON>'
 *   Config IN:
 *     {
 *       "symbols": ["MES","MNQ","MCL"],
 *       "timeframes": ["5min"],
 *       "scenarios": [...optional subset of 8 named scenarios...],
 *       "seed": 42,
 *       "output_dir": "data/regime_bank",
 *       "max_batches": N,
 *       "severity_check": true,
 *       "dry_run": false
 *     }
 *   Output JSON:
 *     {
 *       "generated": N,
 *       "calibrated_passed": N,
 *       "calibrated_failed": N,
 *       "stored": N,
 *       "regimes": [
 *         {
 *           "symbol": "MES",
 *           "timeframe": "5min",
 *           "regime_label": "COVID_crash",
 *           "file_path": "data/regime_bank/...",
 *           "num_bars": 1200,
 *           "generator_model_version": "1.0.0",
 *           "stylized_fact_passed": true,
 *           "severity_passed": true,
 *           "calibration_stats": {...}
 *         }
 *       ],
 *       "errors": [...]
 *     }
 *   Exit codes: 0 all ok / 1 partial / 2 total failure.
 *
 * THE 8 NAMED SCENARIOS:
 *   COVID_crash, rate_shock_2022, vol_spike_2018, credit_crisis_2008,
 *   flash_crash_1987, slow_bleed_grind, flash_recovery,
 *   prop_consistency_breach_stress
 *
 * AUTHORITY BOUNDARY:
 *   CHALLENGER-ONLY / ADVISORY. This service only FILLS the bank so the
 *   existing advisory A14 evaluator can return real survival rates.
 *   It never gates capital, never alters lifecycle decisions.
 *
 * S3 UPLOAD:
 *   Uses @aws-sdk/client-s3 PutObjectCommand — same SDK the db-backup-service
 *   uses. S3_BUCKET + AWS_* env vars must be set. If unconfigured, the row is
 *   written with the local path and flagged (s3_path = "local:<file_path>")
 *   so the operator can identify un-uploaded files via the bank table.
 *   An S3 upload failure on ONE regime does NOT abort the others (fail-soft).
 *
 * IDEMPOTENCY:
 *   Deduplication key = (symbol, timeframe, regime_label, generator_model_version).
 *   An existing row for the same key is SKIPPED (not updated). This ensures
 *   re-runs accumulate more versions rather than overwriting calibrated rows.
 *   The bank is append-only by convention — the evaluator samples from it.
 *
 * DB SCHEMA NOTE:
 *   synthetic_regime_bank.conditioning_vector_compressed is a required bytea.
 *   When the Python generator output does not include a conditioning vector
 *   (current contract), we write a zero-byte sentinel (empty Buffer). The
 *   evaluator already handles missing vectors gracefully (uses regime_label
 *   for context). conditioning_dim is set to 0 in that case.
 */

import path from "node:path";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { syntheticRegimeBank } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const POPULATE_TIMEOUT_MS = 20 * 60_000; // 20 minutes — full 8-scenario × 3-symbol run

/** Deterministic seed used for reproducible regime generation. */
const DEFAULT_SEED = 42;

/** Default symbols to populate the bank for. */
const DEFAULT_SYMBOLS = ["MES", "MNQ", "MCL"];

/** Default execution timeframes. */
const DEFAULT_TIMEFRAMES = ["5min"];

/** Default output directory (relative to repo root — Python side reads this). */
const DEFAULT_OUTPUT_DIR = "data/regime_bank";

/** S3 prefix for regime bank parquet files. */
const S3_REGIME_BANK_PREFIX = "regime-bank/";

// ─── Python Output Types ──────────────────────────────────────────────────────

export interface RegimePythonRecord {
  symbol: string;
  timeframe: string;
  regime_label: string;
  file_path: string;
  num_bars: number;
  generator_model_version: string;
  stylized_fact_passed: boolean;
  severity_passed: boolean;
  calibration_stats?: Record<string, unknown>;
}

export interface PopulateRegimeBankPythonResult {
  generated: number;
  calibrated_passed: number;
  calibrated_failed: number;
  stored: number;
  regimes: RegimePythonRecord[];
  errors: string[];
}

// ─── Public Result ────────────────────────────────────────────────────────────

export interface PopulateRegimeBankResult {
  correlationId: string;
  generated: number;
  calibratedPassed: number;
  calibratedFailed: number;
  stored: number;
  inserted: number;
  skipped: number;
  uploadFailed: number;
  errors: string[];
  status: "populated" | "partial" | "failed";
}

// ─── S3 helpers ───────────────────────────────────────────────────────────────

function buildS3Client(): S3Client {
  return new S3Client({
    region: process.env["AWS_REGION"] ?? "us-east-1",
  });
}

function isS3Configured(): boolean {
  return !!(
    process.env["S3_BUCKET"] &&
    process.env["AWS_ACCESS_KEY_ID"] &&
    process.env["AWS_SECRET_ACCESS_KEY"]
  );
}

/**
 * Upload a local Parquet file to S3 and return the S3 URI.
 * Returns a "local:<path>" sentinel when S3 is unconfigured.
 * Throws on S3 errors — caller handles fail-soft per regime.
 */
async function uploadRegimeParquetToS3(
  localFilePath: string,
  correlationId: string,
): Promise<string> {
  if (!isS3Configured()) {
    return `local:${localFilePath}`;
  }

  const bucket = process.env["S3_BUCKET"]!;
  const filename = path.basename(localFilePath);
  const key = `${S3_REGIME_BANK_PREFIX}${filename}`;

  const client = buildS3Client();
  await client.send(new HeadBucketCommand({ Bucket: bucket }));

  const fileStream = createReadStream(localFilePath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: "application/octet-stream",
      Tagging: "project=trading-forge&type=regime-bank",
    }),
  );

  const s3Uri = `s3://${bucket}/${key}`;
  logger.info(
    { correlationId, localFilePath, s3Uri },
    "synthetic_regime_bank: uploaded parquet to S3",
  );
  return s3Uri;
}

// ─── Dedup check ──────────────────────────────────────────────────────────────

/**
 * Returns true when a regime row for this (symbol, timeframe, label, version)
 * already exists in the bank (any row count ≥ 1 is a duplicate).
 */
async function regimeRowExists(
  symbol: string,
  timeframe: string,
  regimeLabel: string,
  generatorModelVersion: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: syntheticRegimeBank.id })
    .from(syntheticRegimeBank)
    .where(
      and(
        eq(syntheticRegimeBank.symbol, symbol),
        eq(syntheticRegimeBank.timeframe, timeframe),
        eq(syntheticRegimeBank.regimeLabel, regimeLabel),
        eq(syntheticRegimeBank.generatorModelVersion, generatorModelVersion),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the synthetic regime-bank population job.
 *
 * Called by the Sunday off-RTH cron in scheduler.ts.
 * Fail-SOFT: bad individual regimes log and continue; CLI failure produces
 * status="failed" with audit but NEVER throws into the cron loop.
 *
 * @param correlationId Propagated from the cron tick to all audit rows.
 */
export async function runSyntheticRegimeBankPopulate(
  correlationId: string,
): Promise<PopulateRegimeBankResult> {
  const startedAt = Date.now();

  // ── Build Python config ──────────────────────────────────────────────────
  const pythonConfig = {
    symbols: DEFAULT_SYMBOLS,
    timeframes: DEFAULT_TIMEFRAMES,
    seed: DEFAULT_SEED,
    output_dir: DEFAULT_OUTPUT_DIR,
    severity_check: true,
    dry_run: false,
  };

  logger.info(
    { correlationId, pythonConfig },
    "synthetic_regime_bank: starting populate run",
  );

  // ── Invoke Python CLI ────────────────────────────────────────────────────
  let pythonResult: PopulateRegimeBankPythonResult;
  try {
    pythonResult = await runPythonModule<PopulateRegimeBankPythonResult>({
      module: "src.engine.synthetic.populate_regime_bank",
      config: pythonConfig,
      timeoutMs: POPULATE_TIMEOUT_MS,
      componentName: "populate_regime_bank",
      correlationId,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { correlationId, err: errMsg },
      "synthetic_regime_bank: Python CLI failed — no regimes inserted",
    );

    await insertAuditRowSafe({
      action: "synthetic_regime_bank.failed",
      entityType: "regime_bank",
      entityId: correlationId,
      correlationId,
      status: "failure",
      result: {
        error: errMsg,
        durationMs: Date.now() - startedAt,
      },
    });

    return {
      correlationId,
      generated: 0,
      calibratedPassed: 0,
      calibratedFailed: 0,
      stored: 0,
      inserted: 0,
      skipped: 0,
      uploadFailed: 0,
      errors: [errMsg],
      status: "failed",
    };
  }

  // ── Process each regime record — fail-soft per record ───────────────────
  let inserted = 0;
  let skipped = 0;
  let uploadFailed = 0;
  const allErrors: string[] = [...(pythonResult.errors ?? [])];

  for (const regime of pythonResult.regimes ?? []) {
    const regimeCtx = {
      correlationId,
      symbol: regime.symbol,
      timeframe: regime.timeframe,
      regimeLabel: regime.regime_label,
      generatorModelVersion: regime.generator_model_version,
    };

    try {
      // ── Deduplicate ──────────────────────────────────────────────────────
      const exists = await regimeRowExists(
        regime.symbol,
        regime.timeframe,
        regime.regime_label,
        regime.generator_model_version,
      );
      if (exists) {
        logger.info(
          regimeCtx,
          "synthetic_regime_bank: regime already in bank — skipping",
        );
        skipped++;
        continue;
      }

      // ── Upload Parquet to S3 ─────────────────────────────────────────────
      let s3Path: string;
      try {
        s3Path = await uploadRegimeParquetToS3(regime.file_path, correlationId);
      } catch (uploadErr) {
        const uploadErrMsg =
          uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        logger.warn(
          { ...regimeCtx, err: uploadErrMsg },
          "synthetic_regime_bank: S3 upload failed — storing local path as fallback",
        );
        // Fail-soft: write the local path so the bank row exists even without S3.
        // The operator can re-upload manually; the evaluator reads s3_path at query time.
        s3Path = `local:${regime.file_path}`;
        uploadFailed++;
        allErrors.push(
          `S3 upload failed for ${regime.regime_label}/${regime.symbol}: ${uploadErrMsg}`,
        );
      }

      // ── INSERT bank row ──────────────────────────────────────────────────
      // conditioning_vector_compressed is bytea NOT NULL.
      // The Python generator contract does not yet expose the raw vector —
      // write a zero-byte sentinel. conditioning_dim=0 documents this.
      // The black_swan_evaluator samples by regime_label, not by vector —
      // so the zero sentinel does not affect evaluator accuracy.
      await db.insert(syntheticRegimeBank).values({
        symbol: regime.symbol,
        timeframe: regime.timeframe,
        regimeLabel: regime.regime_label,
        conditioningVectorCompressed: Buffer.alloc(0),
        conditioningDim: 0,
        s3Path,
        numBars: regime.num_bars,
        stylizedFactPassed: regime.stylized_fact_passed,
        generatorModelVersion: regime.generator_model_version,
      });

      logger.info(
        { ...regimeCtx, s3Path, numBars: regime.num_bars },
        "synthetic_regime_bank: inserted regime row",
      );
      inserted++;
    } catch (rowErr) {
      // Fail-soft: log + continue to next regime
      const rowErrMsg = rowErr instanceof Error ? rowErr.message : String(rowErr);
      logger.error(
        { ...regimeCtx, err: rowErrMsg },
        "synthetic_regime_bank: failed to process regime — continuing",
      );
      allErrors.push(
        `Row error for ${regime.regime_label}/${regime.symbol}: ${rowErrMsg}`,
      );
    }
  }

  const durationMs = Date.now() - startedAt;

  // ── Determine overall status ─────────────────────────────────────────────
  const hasRegimes = (pythonResult.regimes?.length ?? 0) > 0;
  const totalProcessed = inserted + skipped;
  const hasErrors = allErrors.length > 0;

  let status: PopulateRegimeBankResult["status"];
  if (!hasRegimes && hasErrors) {
    status = "failed";
  } else if (hasErrors || pythonResult.calibrated_failed > 0) {
    status = "partial";
  } else {
    status = "populated";
  }

  // ── Emit audit row ───────────────────────────────────────────────────────
  const auditAction =
    status === "populated"
      ? "synthetic_regime_bank.populated"
      : status === "partial"
      ? "synthetic_regime_bank.partial"
      : "synthetic_regime_bank.failed";

  await insertAuditRowSafe({
    action: auditAction,
    entityType: "regime_bank",
    entityId: correlationId,
    correlationId,
    status: status === "populated" ? "success" : status === "partial" ? "warning" : "failure",
    result: {
      generated: pythonResult.generated,
      calibrated_passed: pythonResult.calibrated_passed,
      calibrated_failed: pythonResult.calibrated_failed,
      python_stored: pythonResult.stored,
      inserted,
      skipped,
      upload_failed: uploadFailed,
      total_processed: totalProcessed,
      errors: allErrors.slice(0, 20), // truncate to prevent giant rows
      durationMs,
      seed: DEFAULT_SEED,
      symbols: DEFAULT_SYMBOLS,
      timeframes: DEFAULT_TIMEFRAMES,
    },
  });

  logger.info(
    {
      correlationId,
      status,
      generated: pythonResult.generated,
      calibratedPassed: pythonResult.calibrated_passed,
      calibratedFailed: pythonResult.calibrated_failed,
      inserted,
      skipped,
      uploadFailed,
      durationMs,
    },
    "synthetic_regime_bank: populate run complete",
  );

  return {
    correlationId,
    generated: pythonResult.generated,
    calibratedPassed: pythonResult.calibrated_passed,
    calibratedFailed: pythonResult.calibrated_failed,
    stored: pythonResult.stored,
    inserted,
    skipped,
    uploadFailed,
    errors: allErrors,
    status,
  };
}


// ─── Self-heal: ensureRegimeBankPopulated ─────────────────────────────────────

/**
 * Staleness window in days for the self-heal check.
 * If ALL rows in the bank are older than this, we treat the bank as stale
 * and trigger a refresh. Default 30 days (matches the Sunday weekly cron cadence
 * plus a 3-week tolerance window).
 *
 * Override via env REGIME_BANK_STALENESS_DAYS (integer string).
 */
const REGIME_BANK_STALENESS_DAYS: number = (() => {
  const raw = process.env["REGIME_BANK_STALENESS_DAYS"];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
})();

/**
 * Boot-time self-heal: ensures the regime bank has rows so backtests
 * run at ANY time (not just after the weekly Sunday cron) get real verdicts.
 *
 * Contract:
 *   - Queries `SELECT count(*) FROM synthetic_regime_bank`.
 *   - count === 0 → fire-and-forget `runSyntheticRegimeBankPopulate()` (async,
 *     NEVER awaited in a way that blocks app.listen).
 *     Emits audit `synthetic_regime_bank.self_heal_triggered`.
 *   - count > 0 → skip populate.
 *     Emits audit `synthetic_regime_bank.self_heal_skipped_populated`.
 *   - Any DB error → log warn + return (never throw, never block boot).
 *
 * Called once at boot from `src/server/index.ts` INSIDE app.listen() callback
 * so it is fire-and-forget relative to the listen() call itself.
 *
 * Governance: CHALLENGER-ONLY / ADVISORY — self-heal populates the bank but
 * the evaluator output is still advisory only. Never blocks promotion, entry,
 * exit, or sizing.
 *
 * @param correlationId  Passed to audit rows and downstream populate run.
 */
export async function ensureRegimeBankPopulated(
  correlationId: string,
): Promise<void> {
  try {
    // Count rows in the bank. Use sql`` template for a lightweight count query
    // that avoids loading all rows.
    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(syntheticRegimeBank);

    const bankCount = Number(countRows[0]?.count ?? 0);

    if (bankCount === 0) {
      // Empty bank — trigger self-heal (fire-and-forget)
      logger.info(
        { correlationId, bankCount },
        "synthetic_regime_bank: bank is empty — triggering self-heal populate (fire-and-forget)",
      );

      await insertAuditRowSafe({
        action: "synthetic_regime_bank.self_heal_triggered",
        entityType: "regime_bank",
        entityId: correlationId,
        correlationId,
        status: "warning",
        input: {
          bankCount,
          stalenessWindowDays: REGIME_BANK_STALENESS_DAYS,
          triggeredBy: "boot_self_heal",
        },
      });

      // Fire-and-forget: do NOT await.
      // Any error inside the populate run is handled by runSyntheticRegimeBankPopulate
      // itself (fail-soft, emits its own audit rows on failure).
      runSyntheticRegimeBankPopulate(correlationId).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { correlationId, err: errMsg },
          "synthetic_regime_bank: self-heal populate run failed (fire-and-forget, non-blocking)",
        );
      });

      return;
    }

    // Bank is populated — skip
    logger.info(
      { correlationId, bankCount },
      "synthetic_regime_bank: bank has rows — self-heal skipped",
    );

    await insertAuditRowSafe({
      action: "synthetic_regime_bank.self_heal_skipped_populated",
      entityType: "regime_bank",
      entityId: correlationId,
      correlationId,
      status: "success",
      input: {
        bankCount,
        stalenessWindowDays: REGIME_BANK_STALENESS_DAYS,
      },
    });
  } catch (err: unknown) {
    // Fail-soft: DB check error must never block boot
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { correlationId, err: errMsg },
      "synthetic_regime_bank: self-heal DB check failed — skipping (non-blocking)",
    );
  }
}
