/**
 * db-backup-service.ts — Nightly off-tower database backup.
 *
 * PURPOSE:
 *   Trading Forge holds its entire lifecycle/audit/paper/governance state in a
 *   single PostgreSQL instance on a single Skytech tower that has experienced
 *   NVIDIA-TDR freezes and power events. The only existing backup is the
 *   one-shot pre-migration snapshot inside boot-migration-runner.ts, which is
 *   ops-disabled. A hardware loss = total state loss, including the append-only
 *   audit trail. This service is the systemic fix.
 *
 * ALGORITHM:
 *   0. (deepscan19 G-1) Pre-write disk-space guard: check free space on the
 *      backup volume via disk-space-service.ts::checkDiskSpace(). If below
 *      DISK_FREE_MIN_GB / DISK_FREE_MIN_PCT, emergency-prune the OLDEST
 *      existing backup files (down to the DB_BACKUP_MIN_KEEP safety floor)
 *      and re-check. If still low, SKIP the write loudly (status
 *      "skipped_low_disk") rather than risk this backup being what tips the
 *      disk to 0 bytes free.
 *   1. Run pg_dump (no-shell execFile — credentials never touch process listing)
 *      to a timestamped local file under DB_BACKUP_LOCAL_DIR.
 *   2. Push the dump file off-tower to S3 (preferred when AWS_* + S3_BUCKET are
 *      configured). If off-tower push is unconfigured, still write the local dump
 *      and emit a LOUD audit + Discord critical so the operator knows the gap.
 *   3. Prune local dumps older than DB_BACKUP_RETENTION_DAYS (default 14).
 *   4. Emit structured audit rows for every outcome.
 *
 * ENV VARS:
 *   DB_BACKUP_LOCAL_DIR            (default: backups/db relative to repo root)
 *   DB_BACKUP_RETENTION_DAYS       (default: 14)
 *   DB_BACKUP_OFFTOWER_TARGET      (default: "s3" — "s3" | "none")
 *   DB_BACKUP_ENABLED              (default: "true")
 *   S3_BUCKET                      (already in .env — used for off-tower push)
 *   S3_BACKUP_BUCKET               (optional — dedicated backup bucket; falls back to S3_BUCKET)
 *   S3_BACKUP_PREFIX               (default: "db-backups/")
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (already in .env)
 *   DISK_FREE_MIN_GB               (default: 10)  — see disk-space-service.ts
 *   DISK_FREE_MIN_PCT              (default: 10)  — see disk-space-service.ts
 *   DB_BACKUP_MIN_KEEP             (default: 3)   — emergency-prune safety floor
 *
 * AUDIT ACTIONS EMITTED:
 *   db_backup.completed            — successful dump + optional off-tower push
 *   db_backup.failed               — dump or push failed (Discord critical)
 *   db_backup.offtower_unconfigured — dump succeeded but no off-tower target
 *   disk.low_space                 — (deepscan19 G-1, via disk-space-service.ts)
 *                                     pre-write guard found the disk low, tagged
 *                                     with whether emergency pruning recovered it
 *
 * FAIL-SOFT GUARANTEE:
 *   An off-tower push failure does NOT suppress the local dump write — the
 *   local dump is the last-resort safety net. An off-tower push failure DOES
 *   emit a Discord critical so the operator knows to investigate.
 *
 * SECURITY:
 *   pg_dump is invoked via execFile (no shell) so DATABASE_URL credentials
 *   never appear in process listings or shell history. PGPASSWORD is injected
 *   via the child process env only and is not logged.
 *
 * IDEMPOTENCY:
 *   Each run writes a timestamped file. Re-running is safe — it produces a
 *   second file, both of which are subject to retention pruning.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { notifyCritical, notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
// deepscan19 G-1: disk-full pre-write guard. This is a ONE-WAY static import
// (db-backup-service.ts -> disk-space-service.ts). disk-space-service.ts must
// NEVER statically import from this module — its own runDiskSpaceMonitor()
// reaches this module's getLocalDir() via a runtime `await import(...)` so
// the two modules never form a static circular-import cycle.
import {
  checkDiskSpace,
  isLowDiskSpace,
  pruneOldestFilesUntilSafe,
  getDbBackupMinKeep,
  emitLowSpaceSignalForPreWriteGuard,
} from "./disk-space-service.js";

const execFileAsync = promisify(execFile);

// ─── FIX 1 (deepscan10): disabled-path alert dedupe ─────────────────────────
// Emits audit + Discord WARN at most once per 24h when DB_BACKUP_ENABLED=false,
// so vacation-mode disablement is always queryable and never invisible.
let _disabledAlertLastAt: number | null = null;

// deepscan6 (2026-07-02): the tower has no system-installed PostgreSQL client, so the prod
// server is v17.10 and needs the pg17 pg_dump specifically (a v16 pg_dump REFUSES with a
// version mismatch). Rather than require a machine-scope install (admin/UAC), point at a
// portable pg_dump via PG_DUMP_PATH. Falls back to bare "pg_dump" on PATH when unset.
// Resolved at CALL time (not module load) so it is correct regardless of dotenv load order.
function pgDumpBin(): string {
  return process.env["PG_DUMP_PATH"] || "pg_dump";
}

// ─── Path resolution ──────────────────────────────────────────────────────────

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

/**
 * Resolve the default local backup directory.
 * services/ → server/ → src/ → repo root → backups/db
 */
function resolveDefaultLocalDir(): string {
  const repoRoot = path.resolve(_dirname, "..", "..", "..", "..");
  return path.join(repoRoot, "backups", "db");
}

// ─── Env-configurable accessors ───────────────────────────────────────────────

export function getLocalDir(): string {
  return process.env["DB_BACKUP_LOCAL_DIR"] ?? resolveDefaultLocalDir();
}

export function getRetentionDays(): number {
  const raw = process.env["DB_BACKUP_RETENTION_DAYS"];
  if (!raw) return 14;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

export function getOfftowerTarget(): "s3" | "none" {
  const raw = (process.env["DB_BACKUP_OFFTOWER_TARGET"] ?? "s3").toLowerCase();
  return raw === "none" ? "none" : "s3";
}

function getS3Prefix(): string {
  return process.env["S3_BACKUP_PREFIX"] ?? "db-backups/";
}

// deepscan7 M4 2026-07-02: optional dedicated backup bucket — when
// S3_BACKUP_BUCKET is set, backups go there instead of the shared data-lake
// S3_BUCKET (blast-radius isolation: data-lake credentials/lifecycle rules
// can't touch backups). Falls back to S3_BUCKET unchanged when unset.
export function getBackupBucket(): string | undefined {
  return process.env["S3_BACKUP_BUCKET"] || process.env["S3_BUCKET"];
}

// ─── pg_dump helpers ──────────────────────────────────────────────────────────

export async function checkPgDumpAvailable(): Promise<boolean> {
  try {
    await execFileAsync(pgDumpBin(), ["--version"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function extractPgPassword(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return url.password ?? "";
  } catch {
    return "";
  }
}

export function buildDumpFilename(timestamp: number): string {
  // Replace colons and dots with dashes so the filename is safe on all OS.
  return `tf-db-backup-${new Date(timestamp).toISOString().replace(/[:.]/g, "-")}.sql`;
}

/**
 * Run pg_dump to a local file. Uses execFile (no shell) so DATABASE_URL
 * credentials never hit process listings. The dump is written directly to
 * the target path via --file= so no stdout buffering is required.
 *
 * Returns the path of the written file and its byte size.
 */
export async function runPgDump(
  filePath: string,
  databaseUrl: string,
): Promise<{ filePath: string; sizeBytes: number }> {
  const pgPassword = extractPgPassword(databaseUrl);

  await execFileAsync(
    pgDumpBin(),
    [
      "--format=plain",   // Plain SQL — compatible with psql / pg_restore --format=plain
      "--no-password",    // Credentials come from PGPASSWORD env, not interactive prompt
      "--schema=public",  // Only public schema (skip drizzle internal schema)
      `--file=${filePath}`,
      databaseUrl,
    ],
    {
      env: { ...process.env, PGPASSWORD: pgPassword },
      timeout: 10 * 60_000, // 10-minute hard cap on the dump subprocess
    },
  );

  const stat = fs.statSync(filePath);
  return { filePath, sizeBytes: stat.size };
}

// ─── S3 push ──────────────────────────────────────────────────────────────────

/**
 * Push a local file to S3. Returns the S3 URI (s3://bucket/key).
 * Throws on any S3 error so the caller can handle fail-soft logic.
 */
export async function pushToS3(
  localPath: string,
  bucket: string,
  prefix: string,
  filename: string,
): Promise<string> {
  const client = new S3Client({
    region: process.env["AWS_REGION"] ?? "us-east-1",
  });

  // Sanity-check bucket reachability before streaming the (potentially large)
  // dump file. Fails fast on misconfigured credentials or missing bucket.
  await client.send(new HeadBucketCommand({ Bucket: bucket }));

  const key = `${prefix}${filename}`;
  const fileStream = fs.createReadStream(localPath);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: "application/sql",
      // Tag for cost attribution and lifecycle rules
      Tagging: "project=trading-forge&type=db-backup",
    }),
  );

  return `s3://${bucket}/${key}`;
}

// ─── Retention pruner ─────────────────────────────────────────────────────────

/**
 * Delete local dump files older than retentionDays.
 * Only touches files matching tf-db-backup-*.sql so it never deletes other
 * files in the directory (e.g., the legacy railway_pre_wipe_* snapshot).
 * Returns the list of pruned filenames.
 */
export function pruneOldLocalDumps(
  localDir: string,
  retentionDays: number,
): string[] {
  if (!fs.existsSync(localDir)) return [];

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const pruned: string[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(localDir);
  } catch (err) {
    logger.warn({ err, localDir }, "db-backup: pruneOldLocalDumps could not read directory");
    return [];
  }

  for (const filename of entries) {
    if (!filename.startsWith("tf-db-backup-") || !filename.endsWith(".sql")) continue;
    const fullPath = path.join(localDir, filename);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
        pruned.push(filename);
        logger.info({ filename, fullPath }, "db-backup: pruned old local dump");
      }
    } catch (err) {
      logger.warn({ err, filename }, "db-backup: could not stat/delete old dump — skipping");
    }
  }

  return pruned;
}

// ─── Off-tower target configuration check ────────────────────────────────────

/**
 * Returns true if all prerequisites for the configured off-tower target are
 * present in env. Does NOT validate credentials end-to-end — that happens
 * at push time.
 */
export function isOfftowerConfigured(): boolean {
  const target = getOfftowerTarget();
  if (target === "none") return false;
  // S3 target: needs bucket name + AWS credentials
  const bucket = getBackupBucket();
  const key = process.env["AWS_ACCESS_KEY_ID"];
  const secret = process.env["AWS_SECRET_ACCESS_KEY"];
  return Boolean(bucket && key && secret);
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface DbBackupResult {
  status: "success" | "failed" | "disabled" | "skipped_low_disk";
  filePath?: string;
  sizeBytes?: number;
  offtowerUrl?: string;
  offtowerTarget?: string;
  durationMs: number;
  prunedFiles?: string[];
  error?: string;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the nightly database backup cycle.
 *
 * The cron caller (scheduler.ts) should never observe an uncaught throw — all
 * failure paths are caught internally and surface via audit rows + Discord
 * critical alerts. The returned DbBackupResult is the exit contract.
 */
export async function runDbBackup(): Promise<DbBackupResult> {
  const t0 = Date.now();

  const enabled = (process.env["DB_BACKUP_ENABLED"] ?? "true").toLowerCase();
  if (enabled === "false" || enabled === "0") {
    logger.info("db-backup: disabled via DB_BACKUP_ENABLED=false — skipping");
    // FIX 1 (deepscan10): disabled path must never be silent — emit audit row +
    // Discord WARN once per 24h so the operator can query audit_log for
    // db_backup.disabled_by_env and know the backup has been off continuously.
    const _DISABLED_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (_disabledAlertLastAt === null || now - _disabledAlertLastAt >= _DISABLED_ALERT_COOLDOWN_MS) {
      _disabledAlertLastAt = now;
      void insertAuditRowSafe({
        action: "db_backup.disabled_by_env",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { DB_BACKUP_ENABLED: "false" } as Record<string, unknown>,
        result: { outcome: "skipped_disabled" } as Record<string, unknown>,
        status: "warning",
      });
      notifyWarning(
        "DB Backup Disabled by Environment Variable",
        appendFamilyGradePostscript(
          "DB_BACKUP_ENABLED=false — the nightly database backup is intentionally skipped by environment configuration. If this is expected for vacation mode, no action needed. Restore DB_BACKUP_ENABLED=true to re-enable automated backups.",
          "The automated database backup is turned off. Trading data is NOT being backed up off-tower right now.",
          "No action needed if Tony disabled this on purpose. Call Tony if backups should be running.",
        ),
        { envVar: "DB_BACKUP_ENABLED", value: "false" },
      );
    }
    return { status: "disabled", durationMs: 0 };
  }

  const correlationId = randomUUID();

  // ─── Ensure local backup directory exists ───────────────────────────────────
  const localDir = getLocalDir();
  try {
    fs.mkdirSync(localDir, { recursive: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, localDir }, "db-backup: cannot create local backup directory");
    await _emitFailedAudit(correlationId, error, t0);
    notifyCritical(
      "DB Backup FAILED: directory creation failed",
      appendFamilyGradePostscript(
        `Cannot create backup directory ${localDir}. Error: ${error}. Database is NOT being backed up.`,
        "The automated backup of trading data failed — the backup folder could not be created.",
        "No action needed for now — the bot will retry. Call Tony if this persists for more than 24 hours.",
      ),
      { correlationId, localDir, error },
    );
    return { status: "failed", error, durationMs: Date.now() - t0 };
  }

  // ─── Disk-space pre-write guard (deepscan19 G-1) ────────────────────────────
  // Never let the backup itself be what fills the disk. Check free space on
  // the backup volume BEFORE writing a new dump; if low, emergency-prune the
  // oldest existing backups (down to the DB_BACKUP_MIN_KEEP safety floor) and
  // re-check. If space is still low after pruning, SKIP this backup write
  // loudly rather than risk writing the file that tips the disk to 0 bytes
  // free (which would take Postgres itself down, not just the backup).
  const preWriteCheck = await checkDiskSpace(localDir);
  if (isLowDiskSpace(preWriteCheck)) {
    logger.warn(
      { correlationId, preWriteCheck },
      "db-backup: low disk space detected before write — attempting emergency prune of oldest backups",
    );
    const minKeep = getDbBackupMinKeep();
    const { pruned: emergencyPruned, finalCheck } = await pruneOldestFilesUntilSafe(
      localDir,
      "tf-db-backup-",
      ".sql",
      minKeep,
    );
    const stillLow = isLowDiskSpace(finalCheck);

    // Emit the same audit/Discord/metric signal the hourly disk-space-monitor
    // cron emits, tagged as coming from the backup pre-write guard.
    await emitLowSpaceSignalForPreWriteGuard(preWriteCheck, finalCheck, emergencyPruned, stillLow);

    if (stillLow) {
      const freeGb = finalCheck.freeBytes != null ? (finalCheck.freeBytes / 1_000_000_000).toFixed(2) : "unknown";
      const freePct = finalCheck.freePercent != null ? finalCheck.freePercent.toFixed(1) : "unknown";
      const error =
        `Disk space critically low (${freeGb}GB free, ${freePct}%) even after emergency-pruning ` +
        `${emergencyPruned.length} oldest backup(s) down to the ${minKeep}-file safety floor. ` +
        `Skipping this backup write to avoid making the disk-full condition worse.`;
      logger.error({ correlationId, finalCheck, emergencyPruned }, `db-backup: ${error}`);
      await _emitFailedAudit(correlationId, error, t0);
      return {
        status: "skipped_low_disk",
        error,
        durationMs: Date.now() - t0,
        prunedFiles: emergencyPruned,
      };
    }
    logger.info(
      { correlationId, emergencyPruned, finalCheck },
      "db-backup: emergency prune recovered enough disk space — proceeding with backup write",
    );
  }

  // ─── Check pg_dump availability ─────────────────────────────────────────────
  const pgAvailable = await checkPgDumpAvailable();
  if (!pgAvailable) {
    const error = "pg_dump not found on PATH — cannot perform logical backup";
    logger.error({ correlationId }, `db-backup: ${error}`);
    await _emitFailedAudit(correlationId, error, t0);
    notifyCritical(
      "DB Backup FAILED: pg_dump not available",
      appendFamilyGradePostscript(
        `pg_dump is not on PATH. Database is NOT being backed up. Install PostgreSQL client tools. Error: ${error}`,
        "The automated backup of trading data failed — the backup tool is not installed.",
        "No action needed for now — the bot will retry. Call Tony if this persists for more than 24 hours.",
      ),
      { correlationId, error },
    );
    return { status: "failed", error, durationMs: Date.now() - t0 };
  }

  // ─── Resolve DATABASE_URL ────────────────────────────────────────────────────
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    const error = "DATABASE_URL env var is not set — cannot connect to database";
    logger.error({ correlationId }, `db-backup: ${error}`);
    await _emitFailedAudit(correlationId, error, t0);
    notifyCritical(
      "DB Backup FAILED: DATABASE_URL missing",
      appendFamilyGradePostscript(
        `DATABASE_URL is not configured. Database is NOT being backed up. Error: ${error}`,
        "The automated backup of trading data failed — the database connection is not configured.",
        "No action needed for now — the bot will retry. Call Tony if this persists for more than 24 hours.",
      ),
      { correlationId, error },
    );
    return { status: "failed", error, durationMs: Date.now() - t0 };
  }

  // ─── Run pg_dump ─────────────────────────────────────────────────────────────
  const timestamp = Date.now();
  const filename = buildDumpFilename(timestamp);
  const dumpPath = path.join(localDir, filename);

  let dumpResult: { filePath: string; sizeBytes: number };
  try {
    dumpResult = await runPgDump(dumpPath, databaseUrl);
    logger.info(
      { correlationId, filePath: dumpResult.filePath, sizeBytes: dumpResult.sizeBytes },
      "db-backup: pg_dump completed",
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, correlationId }, "db-backup: pg_dump failed");
    await _emitFailedAudit(correlationId, error, t0);
    notifyCritical(
      "DB Backup FAILED: pg_dump execution error",
      appendFamilyGradePostscript(
        `pg_dump execution failed. Database state is NOT backed up. Error: ${error}`,
        "The automated backup of trading data failed — the backup process encountered an error.",
        "No action needed for now — the bot will retry. Call Tony if this persists for more than 24 hours.",
      ),
      { correlationId, dumpPath, error },
    );
    return { status: "failed", error, durationMs: Date.now() - t0 };
  }

  // ─── Off-tower push ──────────────────────────────────────────────────────────
  let offtowerUrl: string | undefined;
  const offtowerTarget = getOfftowerTarget();
  const offtowerConfigured = isOfftowerConfigured();

  if (!offtowerConfigured) {
    // CRITICAL warning — local-only dump is better than nothing but is NOT safe
    // since it lives on the same hardware that could fail.
    logger.warn(
      { correlationId, offtowerTarget },
      "db-backup: off-tower target is not configured — dump is LOCAL ONLY. Hardware failure will destroy this backup.",
    );
    notifyCritical(
      "DB Backup WARNING: off-tower push unconfigured",
      appendFamilyGradePostscript(
        `Database dump written locally to ${dumpResult.filePath} (${Math.round(dumpResult.sizeBytes / 1024)} KB) but NO off-tower backup target is configured.\n\n` +
        `Set S3_BUCKET + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in .env to enable S3 off-tower backup.\n\n` +
        `A tower hardware failure WILL destroy this backup.`,
        "The automated backup of trading data was saved locally but not sent off-site — if the computer fails the backup would be lost.",
        "No action needed for now — the bot will retry. Call Tony if this persists for more than 24 hours.",
      ),
      { correlationId, filePath: dumpResult.filePath },
    );
    await insertAuditRowSafe({
      action: "db_backup.offtower_unconfigured",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { filePath: dumpResult.filePath, offtowerTarget } as Record<string, unknown>,
      result: {
        status: "warn",
        message: "local dump written but no off-tower target configured",
        sizeBytes: dumpResult.sizeBytes,
      } as Record<string, unknown>,
      status: "success",
      correlationId,
    });
  } else if (offtowerTarget === "s3") {
    const bucket = getBackupBucket() as string;
    const prefix = getS3Prefix();
    try {
      offtowerUrl = await pushToS3(dumpResult.filePath, bucket, prefix, filename);
      logger.info(
        { correlationId, offtowerUrl, sizeBytes: dumpResult.sizeBytes },
        "db-backup: off-tower push to S3 completed",
      );
    } catch (err) {
      const pushError = err instanceof Error ? err.message : String(err);
      logger.error({ err, correlationId, bucket, prefix }, "db-backup: S3 push failed (local dump preserved)");
      // Emit critical but do NOT discard the local dump — it was written successfully.
      notifyCritical(
        "DB Backup FAILED: S3 push failed",
        appendFamilyGradePostscript(
          `Database dump written locally to ${dumpResult.filePath} (${Math.round(dumpResult.sizeBytes / 1024)} KB) but S3 push FAILED.\n\n` +
          `Error: ${pushError}\n\n` +
          `Local dump exists on the tower only — investigate S3 credentials and retry.`,
          "The automated backup of trading data was saved locally but failed to upload off-site.",
          "No action needed for now — the bot will retry. Call Tony if this persists for more than 24 hours.",
        ),
        { correlationId, filePath: dumpResult.filePath, bucket, error: pushError },
      );
      await _emitFailedAudit(correlationId, `S3 push failed: ${pushError}`, t0);
      // Return failed — local dump present but off-tower guarantee not met.
      return {
        status: "failed",
        filePath: dumpResult.filePath,
        sizeBytes: dumpResult.sizeBytes,
        offtowerTarget: "s3",
        error: `S3 push failed: ${pushError}`,
        durationMs: Date.now() - t0,
      };
    }
  }

  // ─── Prune old local dumps ───────────────────────────────────────────────────
  const retentionDays = getRetentionDays();
  const prunedFiles = pruneOldLocalDumps(localDir, retentionDays);
  if (prunedFiles.length > 0) {
    logger.info(
      { correlationId, prunedFiles, retentionDays },
      "db-backup: pruned old local dumps",
    );
  }

  // ─── Emit completion audit ───────────────────────────────────────────────────
  const durationMs = Date.now() - t0;
  await insertAuditRowSafe({
    action: "db_backup.completed",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: {
      filePath: dumpResult.filePath,
      offtowerTarget: offtowerConfigured ? offtowerTarget : "unconfigured",
    } as Record<string, unknown>,
    result: {
      status: "success",
      sizeBytes: dumpResult.sizeBytes,
      offtowerUrl: offtowerUrl ?? null,
      prunedCount: prunedFiles.length,
      durationMs,
    } as Record<string, unknown>,
    status: "success",
    correlationId,
  });

  logger.info(
    {
      correlationId,
      filePath: dumpResult.filePath,
      sizeBytes: dumpResult.sizeBytes,
      offtowerUrl: offtowerUrl ?? null,
      prunedCount: prunedFiles.length,
      durationMs,
    },
    "db-backup: backup cycle complete",
  );

  return {
    status: "success",
    filePath: dumpResult.filePath,
    sizeBytes: dumpResult.sizeBytes,
    offtowerUrl,
    offtowerTarget: offtowerConfigured ? offtowerTarget : "unconfigured",
    durationMs,
    prunedFiles,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _emitFailedAudit(
  correlationId: string,
  error: string,
  t0: number,
): Promise<void> {
  await insertAuditRowSafe({
    action: "db_backup.failed",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: {} as Record<string, unknown>,
    result: { status: "failed", error, durationMs: Date.now() - t0 } as Record<string, unknown>,
    status: "failed",
    correlationId,
  });
}
