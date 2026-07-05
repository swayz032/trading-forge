/**
 * disk-space-service.ts — Disk-full / ENOSPC early-warning + auto-remediation.
 *
 * PURPOSE (Deep-Scan #19 G-1, CRITICAL):
 *   Before this module, Trading Forge had ZERO disk-space awareness anywhere
 *   in the codebase (`grep -rn "ENOSPC|diskFree|checkDiskSpace|statvfs" src/
 *   scripts/` returned 0 matches at HEAD 77a72f9). The nightly db-backup
 *   (db-backup-service.ts) + boot pg_dump snapshots + growing NSSM logs all
 *   run unattended for weeks. When the disk fills, Postgres writes fail with
 *   no distinguished signal, nothing auto-prunes, and nothing alerts the
 *   operator — a silent, slow-motion outage on a 24/7 unattended tower.
 *
 * ALGORITHM:
 *   1. checkDiskSpace() — statfs-based free-space probe (Node 24 built-in
 *      `fs.promises.statfs`, NO external npm dependency) for the volume
 *      containing a given path.
 *   2. isLowDiskSpace() — true when EITHER the absolute-GB floor OR the
 *      free-percent floor is breached (see doc comment on the function for
 *      why OR, not AND).
 *   3. pruneOldestFilesUntilSafe() — emergency LRU pruning of the OLDEST
 *      matching backup files (independent of db-backup-service's normal
 *      retention-day pruner), re-checking disk space after every delete,
 *      stopping at EITHER recovery OR the DB_BACKUP_MIN_KEEP safety floor
 *      (never delete every backup regardless of how full the disk is).
 *   4. runDiskSpaceMonitor() — the cron entry point: checks the backup
 *      volume, auto-prunes if low, and on a low-space event emits:
 *        - `disk.low_space` audit_log row (insertAuditRowSafe)
 *        - Discord CRITICAL with family-grade postscript
 *        - `tf_disk_low_space_events_total{outcome}` Prometheus counter
 *
 * FAIL-SAFE GUARANTEE (mandatory per Deep-Scan #19 G-1 spec):
 *   A statfs error (permission denied, unsupported filesystem, path doesn't
 *   exist, etc.) NEVER throws out of checkDiskSpace() and NEVER blocks boot
 *   or the backup write. It returns `ok: false` with null numeric fields —
 *   callers MUST treat that as "unknown", not "low disk". `isLowDiskSpace()`
 *   always returns `false` for an `ok: false` check, by contract.
 *
 * ENV VARS:
 *   DISK_FREE_MIN_GB   (default: 10)  — absolute free-space floor in GB
 *   DISK_FREE_MIN_PCT  (default: 10)  — free-space floor as a percent of total
 *   DB_BACKUP_MIN_KEEP (default: 3)   — never emergency-prune below this many
 *                                        backup files, regardless of disk pressure
 *
 * AUDIT ACTIONS EMITTED:
 *   disk.low_space — every time a low-space event is detected (by the hourly
 *                    cron OR the db-backup-service pre-write guard), tagged
 *                    with whether emergency pruning recovered enough space.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { diskLowSpaceEventsTotal } from "../lib/metrics-registry.js";

// ─── Env-configurable thresholds ──────────────────────────────────────────────

export function getDiskFreeMinGb(): number {
  const raw = process.env["DISK_FREE_MIN_GB"];
  if (!raw) return 10;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

export function getDiskFreeMinPct(): number {
  const raw = process.env["DISK_FREE_MIN_PCT"];
  if (!raw) return 10;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 10;
}

export function getDbBackupMinKeep(): number {
  const raw = process.env["DB_BACKUP_MIN_KEEP"];
  if (!raw) return 3;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

// ─── Disk space probe ──────────────────────────────────────────────────────────

export interface DiskSpaceCheck {
  /** The path actually statfs'd — may be an existing ancestor of the requested path. */
  path: string;
  freeBytes: number | null;
  totalBytes: number | null;
  /** 0-100. Null only when totalBytes is unavailable/zero. */
  freePercent: number | null;
  /** false = statfs failed; treat all numeric fields as UNKNOWN, never as "low". */
  ok: boolean;
  error?: string;
}

/**
 * checkDiskSpace — statfs-based free-space probe for the volume containing
 * `targetPath`. Walks up to the nearest existing ancestor directory first so a
 * not-yet-created backup directory doesn't ENOENT the syscall.
 *
 * FAIL-SAFE CONTRACT: never throws. Any error (permission, unsupported FS,
 * missing path chain, mocked/stubbed fs in tests, etc.) is caught and returned
 * as `{ ok: false, error }` with null numeric fields. Callers must not block
 * on `ok: false` — it means "we don't know", not "disk is low".
 */
export async function checkDiskSpace(targetPath: string): Promise<DiskSpaceCheck> {
  let resolvedPath = targetPath;
  try {
    // Walk up to the nearest existing ancestor. Bounded by filesystem depth —
    // path.dirname() is idempotent at the root, so this always terminates.
    let guard = 0;
    while (!fs.existsSync(resolvedPath) && guard < 64) {
      const parent = path.dirname(resolvedPath);
      if (parent === resolvedPath) break; // reached the root
      resolvedPath = parent;
      guard++;
    }

    const stat = await fs.promises.statfs(resolvedPath);
    const totalBytes = stat.blocks * stat.bsize;
    // bavail = blocks available to unprivileged users — the conservative,
    // actually-usable figure (vs bfree which includes root-reserved blocks).
    const freeBytes = stat.bavail * stat.bsize;
    const freePercent = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : null;

    return { path: resolvedPath, freeBytes, totalBytes, freePercent, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, targetPath: resolvedPath },
      "disk-space-service: statfs failed — treating as UNKNOWN (fail-safe; not blocking boot or backup)",
    );
    return { path: resolvedPath, freeBytes: null, totalBytes: null, freePercent: null, ok: false, error };
  }
}

/**
 * isLowDiskSpace — true when EITHER the absolute free-GB floor OR the
 * free-percent floor is breached.
 *
 * Deliberately OR, not AND: the two thresholds catch different failure
 * shapes. A huge disk at 15% free can still have many GB of true headroom
 * (the GB floor alone would false-alarm on a big disk); a small disk at 40%
 * free may have well under 1GB left (the percent floor alone would miss a
 * genuinely dangerous small-disk situation). Either signal firing is real risk.
 *
 * An `ok: false` (unknown) check NEVER reports low — fail-safe per the module
 * contract; a statfs failure must not trigger emergency pruning or alerts on
 * a phantom low-space reading.
 */
export function isLowDiskSpace(check: DiskSpaceCheck): boolean {
  if (!check.ok || check.freeBytes == null) return false;
  const minGb = getDiskFreeMinGb();
  const minPct = getDiskFreeMinPct();
  const freeGb = check.freeBytes / 1_000_000_000;
  const belowGb = freeGb < minGb;
  const belowPct = check.freePercent != null && check.freePercent < minPct;
  return belowGb || belowPct;
}

// ─── Emergency pruner ──────────────────────────────────────────────────────────

export interface PruneResult {
  pruned: string[];
  finalCheck: DiskSpaceCheck;
}

/**
 * pruneOldestFilesUntilSafe — deletes the OLDEST matching files in `dir` one
 * at a time (by mtime ascending), re-checking disk space after each delete,
 * until EITHER disk space clears both thresholds OR only `minKeep` files
 * remain. `minKeep` is a hard safety floor — never prune below it regardless
 * of how low disk space is; a full disk is recoverable, a wiped backup
 * history is not.
 *
 * This is independent of db-backup-service's normal age-based retention
 * pruner (`pruneOldLocalDumps`) — that one prunes by calendar age; this one
 * prunes by LRU order as an emergency measure regardless of age, because a
 * disk-full event needs space back NOW, not "next time a file crosses the
 * retention-day cutoff".
 *
 * Never throws — individual file-stat/delete failures are logged and
 * skipped so one bad file can't stop the rest of the emergency prune.
 */
export async function pruneOldestFilesUntilSafe(
  dir: string,
  matchPrefix: string,
  matchSuffix: string,
  minKeep: number,
): Promise<PruneResult> {
  const pruned: string[] = [];

  if (!fs.existsSync(dir)) {
    return { pruned, finalCheck: await checkDiskSpace(dir) };
  }

  let entries: string[];
  try {
    entries = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(matchPrefix) && f.endsWith(matchSuffix));
  } catch (err) {
    logger.warn({ err, dir }, "disk-space-service: pruneOldestFilesUntilSafe could not read directory — skipping prune");
    return { pruned, finalCheck: await checkDiskSpace(dir) };
  }

  const withStats = entries
    .map((filename) => {
      try {
        return { filename, mtimeMs: fs.statSync(path.join(dir, filename)).mtimeMs };
      } catch (err) {
        logger.warn({ err, filename }, "disk-space-service: could not stat file during emergency prune scan — excluding");
        return null;
      }
    })
    .filter((e): e is { filename: string; mtimeMs: number } => e !== null)
    .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

  let check = await checkDiskSpace(dir);
  const totalCount = withStats.length;

  for (const entry of withStats) {
    if (!isLowDiskSpace(check)) break; // recovered — stop pruning
    if (totalCount - pruned.length <= minKeep) break; // hit the safety floor

    const fullPath = path.join(dir, entry.filename);
    try {
      fs.unlinkSync(fullPath);
      pruned.push(entry.filename);
      logger.warn(
        { filename: entry.filename, dir },
        "disk-space-service: emergency-pruned oldest backup file to recover disk space",
      );
    } catch (err) {
      logger.warn({ err, filename: entry.filename }, "disk-space-service: could not delete file during emergency prune — skipping");
      continue;
    }
    check = await checkDiskSpace(dir);
  }

  return { pruned, finalCheck: check };
}

// ─── Signal emission (audit + Discord + metric) ───────────────────────────────

async function _emitLowSpaceSignal(
  initialCheck: DiskSpaceCheck,
  finalCheck: DiskSpaceCheck,
  pruned: string[],
  stillLow: boolean,
  source: "disk-space-monitor" | "db-backup-pre-write",
): Promise<void> {
  const outcome = stillLow ? "still_low_after_prune" : "pruned_recovered";
  diskLowSpaceEventsTotal.labels({ outcome }).inc();

  const freeGbInitial = initialCheck.freeBytes != null ? (initialCheck.freeBytes / 1_000_000_000).toFixed(2) : "unknown";
  const freeGbFinal = finalCheck.freeBytes != null ? (finalCheck.freeBytes / 1_000_000_000).toFixed(2) : "unknown";
  const freePctFinal = finalCheck.freePercent != null ? finalCheck.freePercent.toFixed(1) : "unknown";

  await insertAuditRowSafe({
    action: "disk.low_space",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: { source, path: initialCheck.path, prunedCount: pruned.length, prunedFiles: pruned } as Record<string, unknown>,
    result: {
      outcome,
      freeGbInitial,
      freeGbFinal,
      freePctFinal,
      minGbThreshold: getDiskFreeMinGb(),
      minPctThreshold: getDiskFreeMinPct(),
    } as Record<string, unknown>,
    status: stillLow ? "error" : "warning",
  });

  const title = stillLow
    ? "DISK CRITICALLY LOW: emergency pruning did not recover enough space"
    : "Disk space low — auto-recovered via emergency backup pruning";

  const operatorBody = stillLow
    ? `Disk at ${initialCheck.path} is at ${freeGbFinal}GB free (${freePctFinal}%) even after emergency-pruning ${pruned.length} oldest backup file(s) down to the DB_BACKUP_MIN_KEEP=${getDbBackupMinKeep()} safety floor. This is NOT backup files — something else is filling the disk (logs, OS, other apps). Free up space on the tower immediately; Postgres writes and future backups WILL fail if this reaches 0.`
    : `Disk at ${initialCheck.path} dropped to ${freeGbInitial}GB free before emergency pruning. Auto-pruned ${pruned.length} oldest backup file(s); free space is now ${freeGbFinal}GB (${freePctFinal}%), above the DISK_FREE_MIN_GB/DISK_FREE_MIN_PCT thresholds. No action needed unless this repeats frequently (indicates the disk is genuinely undersized for the retention window).`;

  notifyCritical(
    title,
    appendFamilyGradePostscript(
      operatorBody,
      stillLow
        ? "The tower's computer storage is nearly full even after the bot deleted its own old backup files to make room."
        : "The tower's computer storage was getting full, so the bot automatically deleted some old backup files to free up room.",
      stillLow
        ? "Free up disk space on the tower today (empty Recycle Bin, delete old downloads, move large files elsewhere). Call Tony if you're not sure how."
        : "No action needed — the bot handled it automatically. If this message repeats often, tell Tony the tower may need a bigger disk.",
    ),
    { source, path: initialCheck.path, prunedCount: pruned.length, freeGbFinal, freePctFinal },
  );
}

// ─── Cron entry point ──────────────────────────────────────────────────────────

export interface DiskSpaceMonitorResult {
  check: DiskSpaceCheck;
  low: boolean;
  pruned: string[];
  stillLowAfterPrune: boolean;
}

/**
 * runDiskSpaceMonitor — the `disk-space-monitor` cron entry point.
 *
 * `dirOverride` lets tests (and the db-backup-service pre-write guard) target
 * an arbitrary directory directly. When omitted, the production path does a
 * DYNAMIC import of db-backup-service.js to read its configured backup
 * directory — dynamic, not static, specifically to avoid a static circular
 * import (db-backup-service.ts statically imports checkDiskSpace/
 * isLowDiskSpace/pruneOldestFilesUntilSafe from THIS module for its own
 * pre-write guard). The dynamic import only executes at call time, after both
 * modules have finished loading, so the cycle never manifests.
 *
 * Never throws — every internal step is wrapped so a hung/failed check cannot
 * take the scheduler cron down; the caller (scheduler.ts) still wraps this in
 * withRetry() as defense-in-depth.
 */
export async function runDiskSpaceMonitor(dirOverride?: string): Promise<DiskSpaceMonitorResult> {
  let dir = dirOverride;
  if (!dir) {
    const { getLocalDir } = await import("./db-backup-service.js");
    dir = getLocalDir();
  }

  const check = await checkDiskSpace(dir);
  const low = isLowDiskSpace(check);

  if (!low) {
    return { check, low: false, pruned: [], stillLowAfterPrune: false };
  }

  logger.warn({ check }, "disk-space-monitor: low disk space detected — attempting emergency prune of oldest db backups");

  const minKeep = getDbBackupMinKeep();
  const { pruned, finalCheck } = await pruneOldestFilesUntilSafe(dir, "tf-db-backup-", ".sql", minKeep);
  const stillLowAfterPrune = isLowDiskSpace(finalCheck);

  try {
    await _emitLowSpaceSignal(check, finalCheck, pruned, stillLowAfterPrune, "disk-space-monitor");
  } catch (err) {
    // Signal emission itself must never break the monitor's return contract.
    logger.error({ err }, "disk-space-monitor: failed to emit low-space signal (audit/Discord/metric) — continuing");
  }

  return { check: finalCheck, low: true, pruned, stillLowAfterPrune };
}

/**
 * Exported for db-backup-service.ts's pre-write guard so a low-space event
 * detected right before a backup write emits the same audit/Discord/metric
 * signal as the hourly monitor, tagged with the "db-backup-pre-write" source.
 */
export async function emitLowSpaceSignalForPreWriteGuard(
  initialCheck: DiskSpaceCheck,
  finalCheck: DiskSpaceCheck,
  pruned: string[],
  stillLow: boolean,
): Promise<void> {
  try {
    await _emitLowSpaceSignal(initialCheck, finalCheck, pruned, stillLow, "db-backup-pre-write");
  } catch (err) {
    logger.error({ err }, "db-backup-pre-write-guard: failed to emit low-space signal — continuing");
  }
}
