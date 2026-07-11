/**
 * boot-migration-runner.ts — Auto-apply pending Drizzle migrations on backend boot.
 *
 * PURPOSE:
 *   drizzle-kit migrate is broken (per 0075/0076 comments). Every schema change
 *   required manual operator apply (migrations 0106, 0120-0123, 0131 all needed
 *   operator action). During vacations, migrations sit pending indefinitely.
 *   This module is called from src/server/index.ts BEFORE app.listen() to
 *   auto-apply pending migrations with pg_dump rollback safety.
 *
 * ALGORITHM:
 *   1. Read _journal.json (canonical migration list)
 *   2. Query drizzle.__drizzle_migrations (bootstrap-create if absent)
 *   3. For each pending migration in order:
 *      a. pg_dump --schema-only snapshot to BOOT_MIGRATION_BACKUP_DIR
 *         (or information_schema JSON dump if pg_dump unavailable)
 *      b. Execute migration SQL in a TRANSACTION with per-stmt breakpoint splitting
 *      c. On success: insert drizzle.__drizzle_migrations row + emit audit_log migration.auto_applied
 *      d. On failure: ROLLBACK + emit audit_log migration.auto_apply_failed +
 *         fire Discord CRITICAL + THROW (blocks boot)
 *
 * ENV VARS:
 *   BOOT_MIGRATION_ENABLED=true           (default: true)
 *   BOOT_MIGRATION_ALLOW_NO_BACKUP=false  (default: false — fail-closed)
 *   BOOT_MIGRATION_BACKUP_DIR             (default: os.tmpdir())
 *   BOOT_MIGRATION_TIMEOUT_MS=300000      (default: 5 min per migration)
 *
 * IDEMPOTENCY:
 *   Re-running with no pending migrations = no-op. No audit row, no backup.
 *
 * PARITY:
 *   Matches apply-missing-migrations.mjs exactly in SQL execution
 *   (split on --> statement-breakpoint, execute in transaction) and adds:
 *   - Backup before each migration (pg_dump or information_schema JSON)
 *   - audit_log rows (migration.auto_applied / migration.auto_apply_failed)
 *   - Discord CRITICAL on failure so operator knows to restore
 *   - THROW on failure to block boot (fail-closed)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "./logger.js";
import { insertAuditRowSafe } from "./audit-log-helper.js";
import { findDuplicateJournalWhens, computeMigrationPlan } from "./migration-journal-utils.js";

const execFileAsync = promisify(execFile);

// deepscan6 (2026-07-02): configurable pg_dump path — the tower has no system PostgreSQL
// client and the prod server is v17.10 (needs pg17 pg_dump). Point at a portable binary via
// PG_DUMP_PATH; falls back to "pg_dump" on PATH. Keeps the pre-migration backup functional.
// Resolved at CALL time (not module load) so it is correct regardless of dotenv load order.
function pgDumpBin(): string {
  return process.env["PG_DUMP_PATH"] || "pg_dump";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * Read a UTF-8 text file, strip a leading byte-order-mark (BOM), and normalize
 * CRLF line endings to LF.
 *
 * WHY (BOM): PowerShell (the operator's primary shell) writes files as UTF-8/
 * UTF-16 WITH a BOM by default. A BOM (U+FEFF) at the start of _journal.json
 * makes JSON.parse throw ("Unexpected token ï»¿"), and a BOM at the start of a
 * migration .sql makes Postgres reject the first statement — either one
 * fail-closes the boot-migration-runner and takes the WHOLE API offline
 * (2026-06-24 production-down incident).
 *
 * WHY (CRLF): this tower's git checkout has core.autocrlf=true, which silently
 * converts LF (git's canonical stored form) to CRLF on disk. hashOf() (below)
 * feeds this file's content into a sha256 used to decide "already applied" —
 * if the tracked hash was stamped from LF content (e.g. by a different
 * environment, or a stamp/backfill script) while the on-disk file is CRLF, the
 * hash never matches, the migration looks unapplied forever, and re-running it
 * collides with tables the ORIGINAL apply already created (2026-07-09
 * incident: 0000_previous_nuke.sql, CREATE TABLE "alerts" already exists →
 * fail-closed boot → NSSM crash-loop). Normalizing CRLF→LF on read makes the
 * hash (and the SQL text actually executed) invariant to this purely
 * cosmetic, OS/git-checkout-dependent difference.
 */
export function readUtf8StripBom(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  const noBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return noBom.replace(/\r\n/g, "\n");
}

// ─── Path resolution ──────────────────────────────────────────────────────────

// Works in both ESM (tsx) and compiled-to-dist contexts.
// __dirname in ESM via fileURLToPath(import.meta.url).
const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

// src/server/lib/ → resolve to repo root regardless of outDir.
// Compiled: dist/server/lib/ — three hops up to repo root.
// Dev tsx: src/server/lib/ — three hops up to repo root.
// We rely on the migrations dir relative to where the file lives during dev.
// In production (dist/), migrations are copied as data files. We use env var
// override if MIGRATIONS_DIR is set, otherwise resolve relative to this file.

// ─── FIX 2 (deepscan10): boot-failure counter (file-based) ──────────────────
// Persists a respawn-counter so NSSM-driven crash-loops during vacation are
// escalated via Discord. DB is unavailable when migrations fail — use sync fs.
// Path: <repo-root>/bin/boot-migration-failures.json  { attempt: number }

const _bootFailureCounterPath = path.resolve(_dirname, "..", "..", "..", "..", "bin", "boot-migration-failures.json");

/**
 * Pure predicate: true when the boot-failure attempt count should trigger a
 * Discord escalation. Fires on attempt 1, 3, and every 10th thereafter.
 * Exported for unit-test coverage of cadence logic.
 */
export function shouldAlertBootFailure(attempt: number): boolean {
  return attempt === 1 || attempt === 3 || attempt % 10 === 0;
}

function _readBootFailureCount(): number {
  try {
    const raw = fs.readFileSync(_bootFailureCounterPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "attempt" in parsed &&
      typeof (parsed as { attempt: unknown }).attempt === "number"
    ) {
      return (parsed as { attempt: number }).attempt;
    }
  } catch {
    // File missing or corrupt — treat as 0
  }
  return 0;
}

function _writeBootFailureCount(attempt: number): void {
  try {
    const dir = path.dirname(_bootFailureCounterPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_bootFailureCounterPath, JSON.stringify({ attempt }), "utf8");
  } catch (e) {
    logger.warn({ err: e, path: _bootFailureCounterPath }, "boot-migration: failed to write failure counter (non-fatal)");
  }
}

function _resetBootFailureCount(): void {
  try {
    if (fs.existsSync(_bootFailureCounterPath)) fs.unlinkSync(_bootFailureCounterPath);
  } catch (e) {
    logger.warn({ err: e, path: _bootFailureCounterPath }, "boot-migration: failed to reset failure counter (non-fatal)");
  }
}

// ds21-w2 (deep-scan #21 alert-fatigue fix): 24h dedup for the duplicate-`when` Discord alert.
// The audit row still writes on EVERY boot (durable, queryable record); this throttles ONLY the
// Discord CRITICAL so an unchanged collision set doesn't re-ping the operator on every restart.
// Re-fires if the collision signature changes (new/removed collision) or 24h elapse. File-based
// on purpose — no DB query added to the fail-closed boot path.
const _dupWhenAlertMarkerPath = path.resolve(_dirname, "..", "..", "..", "..", "bin", "boot-migration-dupwhen-alert.json");
const _DUP_WHEN_ALERT_DEDUP_MS = 24 * 60 * 60 * 1000;

function _shouldFireDupWhenDiscord(signature: string): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(_dupWhenAlertMarkerPath, "utf8")) as { signature?: string; ts?: number };
    if (m.signature === signature && typeof m.ts === "number" && Date.now() - m.ts < _DUP_WHEN_ALERT_DEDUP_MS) {
      return false; // identical collision set already alerted < 24h ago
    }
  } catch {
    // missing/corrupt marker → fire
  }
  try {
    const dir = path.dirname(_dupWhenAlertMarkerPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_dupWhenAlertMarkerPath, JSON.stringify({ signature, ts: Date.now() }), "utf8");
  } catch (e) {
    logger.warn({ err: e, path: _dupWhenAlertMarkerPath }, "boot-migration: failed to write dup-when alert marker (non-fatal)");
  }
  return true;
}

function resolveMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  // Go up from lib/ → server/ → src/ → root
  const repoRoot = path.resolve(_dirname, "..", "..", "..");
  return path.join(repoRoot, "src", "server", "db", "migrations");
}

function resolveJournalPath(): string {
  return path.join(resolveMigrationsDir(), "meta", "_journal.json");
}

// ─── pg_dump availability ─────────────────────────────────────────────────────

/**
 * Check if pg_dump is available on the host.
 * On Windows tower, PostgreSQL CLI may not be on PATH.
 */
export async function checkPgDumpAvailable(): Promise<boolean> {
  try {
    await execFileAsync(pgDumpBin(), ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Take a pg_dump --schema-only snapshot of the public schema.
 * Returns the path to the written .sql backup file.
 */
export async function takePgDumpBackup(
  backupDir: string,
  migrationTag: string,
  timestamp: number,
  databaseUrl: string,
): Promise<string> {
  const filename = `tf-backup-${timestamp}-pre-${migrationTag}.sql`;
  const filePath = path.join(backupDir, filename);

  // pg_dump uses PGPASSWORD env var for non-interactive auth
  const pgPassword = extractPgPassword(databaseUrl);
  await execFileAsync(
    pgDumpBin(),
    ["--schema-only", "--schema=public", `--file=${filePath}`],
    {
      env: { ...process.env, PGPASSWORD: pgPassword },
      timeout: 60_000,
    },
  );

  return filePath;
}

/**
 * Fallback backup: dump DDL via information_schema queries to a JSON file.
 * Captures table/column/index definitions so operators can reconstruct
 * the schema without pg_dump. Not a full rollback artifact — purely
 * a reference document.
 */
export async function takeInformationSchemaBackup(
  backupDir: string,
  migrationTag: string,
  timestamp: number,
): Promise<string> {
  const filename = `tf-backup-${timestamp}-pre-${migrationTag}.json`;
  const filePath = path.join(backupDir, filename);

  const [tablesResult, columnsResult, indexesResult] = await Promise.all([
    db.execute(sql.raw(
      "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    )),
    db.execute(sql.raw(
      "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
    )),
    db.execute(sql.raw(
      "SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname",
    )),
  ]);

  const snapshot = {
    captured_at: new Date(timestamp).toISOString(),
    migration_tag: migrationTag,
    backup_type: "information_schema_json",
    restore_note:
      "This is a logical schema snapshot, NOT a pg_dump. Use as reference to manually reconstruct schema on rollback.",
    tables: tablesResult,
    columns: columnsResult,
    indexes: indexesResult,
  };

  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  return filePath;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPgPassword(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return url.password || "";
  } catch {
    return "";
  }
}

// 2026-07-09 incident (alert-fatigue fix, generalizes the ds21-w2 dup-when pattern above to
// EVERY fireDiscordCritical call): a crash-loop with no rate limiting on this function sent an
// unbounded stream of identical Discord CRITICALs — ~9000 restart attempts, one alert per
// restart, no backoff. This throttles the SEND only (never the underlying failure detection or
// any audit_log row a caller writes) so an unchanged failure doesn't re-ping the operator every
// few seconds. Keyed on a hash of (title + message) so a genuinely NEW/different failure always
// fires immediately — only an EXACT repeat within the window is suppressed. File-based, same as
// the dup-when marker, for the same reason: no DB query added to the fail-closed boot path.
// Env override lets tests (and any future alternate deployment layout) point this at a
// throwaway path instead of the real bin/ directory — mirrors the MIGRATIONS_DIR override
// pattern already used in this file.
const _criticalAlertDedupPath =
  process.env.BOOT_MIGRATION_CRITICAL_ALERT_DEDUP_PATH ||
  path.resolve(_dirname, "..", "..", "..", "..", "bin", "boot-migration-critical-alert-dedup.json");
const _CRITICAL_ALERT_DEDUP_MS = 15 * 60 * 1000; // 15 min — informative cadence, not a spam flood

function _shouldFireCriticalDiscord(title: string, message: string): boolean {
  const signature = crypto.createHash("sha256").update(`${title}\n${message}`).digest("hex");
  try {
    const all = JSON.parse(fs.readFileSync(_criticalAlertDedupPath, "utf8")) as Record<
      string,
      number
    >;
    const last = all[signature];
    if (typeof last === "number" && Date.now() - last < _CRITICAL_ALERT_DEDUP_MS) {
      return false; // identical title+message already alerted within the window
    }
    all[signature] = Date.now();
    // Prune stale entries opportunistically so this file never grows unbounded across
    // many distinct failure types over the life of the process.
    for (const k of Object.keys(all)) {
      if (Date.now() - all[k] >= _CRITICAL_ALERT_DEDUP_MS) delete all[k];
    }
    const dir = path.dirname(_criticalAlertDedupPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_criticalAlertDedupPath, JSON.stringify(all), "utf8");
  } catch {
    // missing/corrupt marker file → fire (fail-open on the dedup mechanism itself; never let a
    // dedup bug silently swallow a real CRITICAL)
    try {
      const dir = path.dirname(_criticalAlertDedupPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(_criticalAlertDedupPath, JSON.stringify({ [signature]: Date.now() }), "utf8");
    } catch (e) {
      logger.warn({ err: e, path: _criticalAlertDedupPath }, "boot-migration: failed to write critical-alert dedup marker (non-fatal)");
    }
  }
  return true;
}

/**
 * Fire Discord CRITICAL via the local relay (matches alert-service.ts pattern),
 * falling back to direct webhook. Fire-and-forget — never throws.
 *
 * Rate-limited to at most one identical (title+message) alert per 15 minutes
 * (see _shouldFireCriticalDiscord) so a crash-loop cannot flood Discord.
 */
export async function fireDiscordCritical(title: string, message: string): Promise<void> {
  if (!_shouldFireCriticalDiscord(title, message)) {
    logger.warn(
      { title },
      "boot-migration: Discord CRITICAL suppressed (identical alert fired within the last 15 min)",
    );
    return;
  }
  const discordPort = process.env.DISCORD_ALERT_PORT || "4100";

  // Primary: local relay (same pattern as alert-service.ts C2 fix, 2026-06-29).
  // Bearer header required — the sidecar returns 401 without it. fetch() only
  // throws on network failure, never on a non-2xx status, so response.ok MUST
  // be checked or a 401 resolves normally and silently drops the alert instead
  // of falling through to the webhook fallback below.
  try {
    const apiKey = process.env.API_KEY;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const response = await fetch(`http://localhost:${discordPort}/alert/alerts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, message, severity: "critical" }),
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) return;
    // Non-2xx (e.g. missing/invalid API_KEY) — fall through to direct webhook.
  } catch {
    // Fall through to direct webhook
  }

  // Fallback: direct Discord webhook URL
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title,
            description: message,
            color: 0xff0000,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Best-effort — never throw from notification path
  }
}

/**
 * Deep-scan #16 E-5: extracted from the per-migration failure catch (below) so
 * the SAME crash-loop counter + escalation cadence fires for EVERY boot-migration
 * failure class — not just SQL-execution failures. Bumps the file-based attempt
 * counter and fires a Discord CRITICAL on the configured cadence (attempt 1, 3,
 * every 10th thereafter) so a vacation-mode NSSM respawn loop never runs
 * silently. Never throws — mirrors fireDiscordCritical's fire-and-forget contract.
 */
async function bumpBootFailureCrashLoopAlert(latestFailureDescription: string): Promise<void> {
  const _failureAttempt = _readBootFailureCount() + 1;
  _writeBootFailureCount(_failureAttempt);
  if (shouldAlertBootFailure(_failureAttempt)) {
    await fireDiscordCritical(
      `BOOT BLOCKED — Migration Crash-Loop: ${_failureAttempt} attempt(s)`,
      `boot-migration has failed ${_failureAttempt} time(s) in a row.\n\nLatest failure: ${latestFailureDescription}\n\nNSSM will respawn the backend automatically. On vacation, this loop continues until manually resolved. Check the Railway log and the bin/boot-migration-failures.json counter.`,
    );
  }
}

// ─── deepscan15 C1: guarded _journal.json read ──────────────────────────────────
/**
 * Read + parse _journal.json behind the SAME failure-signalling path a migration
 * failure uses: audit row + Discord CRITICAL + crash-loop escalation, THEN
 * rethrow (fail-closed boot). Previously `JSON.parse` here was unguarded — a
 * corrupt journal (bad merge, unresolved rebase conflict markers, partial disk
 * write, non-BOM encoding damage) threw a raw SyntaxError BEFORE any of the
 * runner's alerting could fire. Because index.ts awaits runPendingMigrations at
 * top-level module scope (before the process error handlers register), that raw
 * throw exited the process with zero Discord signal, zero audit row, and NSSM
 * respawned straight back into the same corrupt file — an indefinite silent
 * crash-loop (a 30-day-vacation dark-bot). This guard makes the failure LOUD
 * while preserving the fail-closed boot-block. `deps` are injectable for tests.
 */
export async function readJournalOrAlert(
  journalPath: string,
  correlationId: string | null,
  deps: {
    notify?: (title: string, message: string) => Promise<void>;
    audit?: (row: Record<string, unknown>) => Promise<unknown>;
    incrementFailure?: () => number;
  } = {},
): Promise<Journal> {
  const notify = deps.notify ?? fireDiscordCritical;
  const audit =
    deps.audit ?? ((row: Record<string, unknown>) => insertAuditRowSafe(row as never));
  const bumpFailure =
    deps.incrementFailure ??
    (() => {
      const attempt = _readBootFailureCount() + 1;
      _writeBootFailureCount(attempt);
      return attempt;
    });

  // Deep-scan #16 E-5: this file read used to be OUTSIDE the try/catch below —
  // it only guarded JSON.parse, not the read itself. A TOCTOU race (file
  // removed/replaced after the existsSync check in runPendingMigrations), an
  // AV-scanner lock, or a corrupt/truncated file threw straight past this
  // function's alerting and crash-looped the boot with zero Discord signal.
  // Guard the read with the SAME notify/audit/bumpFailure deps as the parse
  // failure below so every read failure alerts before it rethrows.
  let raw: string;
  try {
    raw = readUtf8StripBom(journalPath);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { journalPath, err: errMsg },
      "boot-migration: _journal.json FAILED to read (file I/O) — boot blocked",
    );
    await audit({
      action: "migration.journal_parse_failed",
      entityType: "system",
      entityId: null,
      decisionAuthority: "gate",
      input: { journal_path: journalPath, phase: "file_read" } as Record<string, unknown>,
      result: { error: errMsg } as Record<string, unknown>,
      status: "failure",
      correlationId,
    });
    await notify(
      "BOOT BLOCKED — Migration Journal Unreadable",
      `_journal.json could not be read: ${errMsg}\n\n` +
        `This is often a transient file-lock (AV scanner) or TOCTOU race (file removed/replaced ` +
        `after the existence check). The backend cannot determine which migrations are pending ` +
        `and will NOT boot (fail-closed). NSSM will keep respawning into the same failure until ` +
        `this is fixed.\n\nInspect src/server/db/migrations/meta/_journal.json for existence, ` +
        `permissions, and corruption.`,
    );
    const attempt = bumpFailure();
    if (shouldAlertBootFailure(attempt)) {
      await notify(
        `BOOT BLOCKED — Migration Crash-Loop: ${attempt} attempt(s)`,
        `boot-migration has failed ${attempt} time(s) in a row on journal read. ` +
          `On vacation this loop continues until manually resolved. ` +
          `Check bin/boot-migration-failures.json.`,
      );
    }
    throw new Error(`boot-migration: _journal.json read failed: ${errMsg}`);
  }
  try {
    return JSON.parse(raw) as Journal;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { journalPath, err: errMsg },
      "boot-migration: _journal.json parse FAILED — boot blocked",
    );
    await audit({
      action: "migration.journal_parse_failed",
      entityType: "system",
      entityId: null,
      decisionAuthority: "gate",
      input: { journal_path: journalPath } as Record<string, unknown>,
      result: { error: errMsg } as Record<string, unknown>,
      status: "failure",
      correlationId,
    });
    await notify(
      "BOOT BLOCKED — Migration Journal Corrupt",
      `_journal.json failed to parse: ${errMsg}\n\n` +
        `The backend cannot determine which migrations are pending and will NOT boot (fail-closed). ` +
        `NSSM will keep respawning into the same corrupt file until this is fixed.\n\n` +
        `Inspect src/server/db/migrations/meta/_journal.json for corruption ` +
        `(bad merge / conflict markers / truncation) and restore from git.`,
    );
    const attempt = bumpFailure();
    if (shouldAlertBootFailure(attempt)) {
      await notify(
        `BOOT BLOCKED — Migration Crash-Loop: ${attempt} attempt(s)`,
        `boot-migration has failed ${attempt} time(s) in a row on journal parse. ` +
          `On vacation this loop continues until manually resolved. ` +
          `Check bin/boot-migration-failures.json.`,
      );
    }
    throw new Error(`boot-migration: _journal.json parse failed: ${errMsg}`);
  }
}

// ─── Post-apply object verification (deepscan6 O6) ──────────────────────────────
// The runner keys idempotency on drizzle.__drizzle_migrations (when/hash) — it does NOT
// verify that a migration actually produced its schema objects. The pinned "phantom-apply"
// class (0146/0148, strategy_health_scores, quantum_rl_runs) shipped a journal row marked
// applied while the table/column was missing, and only surfaced when a LATER migration
// collided and halted boot. This adds a cheap post-apply check: parse CREATE TABLE targets
// out of the just-applied SQL and confirm they exist in information_schema. A mismatch is a
// LOUD, AUDITED signal (not a boot-block — a parser false-negative must not fail-close boot).

export function extractCreatedTables(statements: string[]): string[] {
  const tables = new Set<string>();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?["']?([a-z0-9_]+(?:\.[a-z0-9_]+)?)["']?/gi;
  for (const stmt of statements) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(stmt)) !== null) {
      const raw = m[1];
      const name = raw.includes(".") ? raw.split(".").pop()! : raw;
      // Skip the migrations bookkeeping table itself.
      if (name.toLowerCase() === "__drizzle_migrations") continue;
      tables.add(name.toLowerCase());
    }
  }
  return [...tables];
}

async function findMissingTables(tables: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const t of tables) {
    try {
      const res = await db.execute<{ exists: number }>(
        sql`SELECT 1 AS exists FROM information_schema.tables WHERE table_name = ${t} LIMIT 1`,
      );
      const rows =
        (res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
      if (!Array.isArray(rows) || rows.length === 0) missing.push(t);
    } catch (verifyErr) {
      // A verification-query failure is itself worth surfacing, but must not block boot.
      logger.warn({ table: t, err: String(verifyErr) }, "boot-migration: post-apply verify query failed");
    }
  }
  return missing;
}

// deepscan7 D1 (2026-07-02): the O6 check above only covers CREATE TABLE targets.
// Pure-ALTER migrations (ADD COLUMN — the exact class behind the 0146/0148
// phantom-applies) previously received ZERO post-apply verification: the journal
// said applied while the column was missing, surfacing only when a later
// migration collided or a runtime query hit "column does not exist". Mirror the
// O6 approach: parse ALTER TABLE ... ADD COLUMN targets and verify each
// (table, column) pair against information_schema.columns. Same NON-BLOCKING
// contract — mismatch is a loud, audited warning, never a boot block.

export interface AlteredColumn {
  table: string;
  column: string;
}

export function extractAlteredColumns(statements: string[]): AlteredColumn[] {
  const seen = new Set<string>();
  const out: AlteredColumn[] = [];
  const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?["']?([a-z0-9_]+(?:\.[a-z0-9_]+)?)["']?/gi;
  const addColRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?["']?([a-z0-9_]+)["']?/gi;
  for (const stmt of statements) {
    // A single breakpoint-split chunk may still hold several ;-separated statements.
    for (const piece of stmt.split(";")) {
      alterRe.lastIndex = 0;
      const alterMatch = alterRe.exec(piece);
      if (!alterMatch) continue;
      const rawTable = alterMatch[1];
      const table = (rawTable.includes(".") ? rawTable.split(".").pop()! : rawTable).toLowerCase();
      if (table === "__drizzle_migrations") continue;
      addColRe.lastIndex = 0;
      let colMatch: RegExpExecArray | null;
      while ((colMatch = addColRe.exec(piece)) !== null) {
        const column = colMatch[1].toLowerCase();
        const key = `${table}.${column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ table, column });
      }
    }
  }
  return out;
}

async function findMissingColumns(columns: AlteredColumn[]): Promise<AlteredColumn[]> {
  const missing: AlteredColumn[] = [];
  for (const c of columns) {
    try {
      const res = await db.execute<{ exists: number }>(
        sql`SELECT 1 AS exists FROM information_schema.columns WHERE table_name = ${c.table} AND column_name = ${c.column} LIMIT 1`,
      );
      const rows =
        (res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
      if (!Array.isArray(rows) || rows.length === 0) missing.push(c);
    } catch (verifyErr) {
      // Same non-blocking contract as findMissingTables.
      logger.warn({ table: c.table, column: c.column, err: String(verifyErr) }, "boot-migration: post-apply column verify query failed");
    }
  }
  return missing;
}

// ─── deepscan14 F2: orphan .sql file detection ───────────────────────────────
// Symmetric counterpart to the "journal entry, .sql missing" check further down
// (loud since 2026-06-28). Diffs migrations/*.sql on disk against journal.entries
// tags; any .sql file with no matching tag is an orphan that `pending` (computed
// strictly from the journal) can never see. Non-blocking by design — see the
// call-site comment above for why this must never fail-close boot.

export function findOrphanSqlFiles(migrationsDir: string, journal: Journal): string[] {
  const journalTags = new Set(journal.entries.map((e) => e.tag));
  let files: string[];
  try {
    files = fs.readdirSync(migrationsDir);
  } catch {
    return [];
  }
  const orphans: string[] = [];
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".sql")) continue;
    const tag = f.slice(0, -4); // strip ".sql"
    if (!journalTags.has(tag)) orphans.push(tag);
  }
  return orphans.sort();
}

export async function checkForOrphanSqlFiles(journal: Journal, correlationId: string | null): Promise<void> {
  const migrationsDir = resolveMigrationsDir();
  const orphans = findOrphanSqlFiles(migrationsDir, journal);
  if (orphans.length === 0) return;

  logger.warn(
    { orphanTags: orphans, migrationsDir },
    "boot-migration: orphan .sql file(s) found with NO matching _journal.json entry — these will NEVER auto-apply",
  );
  // Both dispatches are individually guarded — insertAuditRowSafe is documented as
  // "never throws" but a mocked/misbehaving implementation must not be able to
  // escape this non-blocking check and take down boot.
  try {
    await insertAuditRowSafe({
      action: "boot_migration.orphan_sql_file_no_journal_entry",
      entityType: "migration",
      entityId: null,
      decisionAuthority: "system",
      input: { orphanTags: orphans, migrationsDir } as Record<string, unknown>,
      result: { count: orphans.length } as Record<string, unknown>,
      status: "warning",
      correlationId,
    });
  } catch (auditErr) {
    logger.warn({ err: String(auditErr) }, "boot-migration: orphan-sql-file audit row write failed (non-blocking)");
  }
  try {
    await fireDiscordCritical(
      "Boot migration: orphan .sql file(s) with no journal entry",
      `${orphans.length} migration .sql file(s) exist on disk with NO corresponding entry in ` +
        `meta/_journal.json — they will NEVER be applied by boot-migration-runner:\n\n` +
        orphans.map((t) => `  • ${t}.sql`).join("\n") +
        `\n\nRegister them in _journal.json (or delete if they're stale/abandoned drafts). ` +
        `Not blocking boot.`,
    );
  } catch (discordErr) {
    logger.warn({ err: String(discordErr) }, "boot-migration: orphan-sql-file Discord dispatch failed (non-blocking)");
  }
}

// ─── Core migration runner ────────────────────────────────────────────────────

/**
 * Main entry point. Call from src/server/index.ts BEFORE app.listen().
 *
 * Throws on migration failure so the server boot is blocked (fail-closed).
 * No-ops cleanly when:
 *   - BOOT_MIGRATION_ENABLED=false
 *   - No pending migrations exist
 *   - Journal file is absent (bare repo / test environment)
 */
export async function runPendingMigrations(
  // deepscan7 D1 (2026-07-02): optional boot correlationId so migration.* audit
  // rows join the same boot trace as boot.started/boot.completed (was hardcoded
  // null). Default preserves prior behavior for any caller not threading one.
  correlationId: string | null = null,
): Promise<void> {
  // ─── Kill-switch gate ───────────────────────────────────────────────────────
  const enabled = (process.env.BOOT_MIGRATION_ENABLED ?? "true").toLowerCase();
  if (enabled === "false" || enabled === "0") {
    logger.info("boot-migration: disabled via BOOT_MIGRATION_ENABLED=false — skipping");
    return;
  }

  const allowNoBackup =
    (process.env.BOOT_MIGRATION_ALLOW_NO_BACKUP ?? "false").toLowerCase() === "true";
  const backupDir = process.env.BOOT_MIGRATION_BACKUP_DIR || os.tmpdir();
  const timeoutMs = Math.max(
    1000,
    Number(process.env.BOOT_MIGRATION_TIMEOUT_MS ?? "300000"),
  );

  // ─── Journal ────────────────────────────────────────────────────────────────
  const journalPath = resolveJournalPath();
  if (!fs.existsSync(journalPath)) {
    logger.warn({ journalPath }, "boot-migration: _journal.json not found — skipping (bare env?)");
    return;
  }

  // deepscan15 C1: guarded parse — a corrupt journal now fires audit + Discord
  // CRITICAL + crash-loop escalation BEFORE the fail-closed rethrow, instead of
  // a silent raw SyntaxError that bricked boot with zero signal.
  const journal: Journal = await readJournalOrAlert(journalPath, correlationId);

  // ─── deepscan14 F2: orphan .sql file with no journal entry ──────────────────
  // The opposite gap from the "journal entry, file missing" case below (which is
  // already loud): a .sql file dropped on disk without a corresponding
  // meta/_journal.json entry is INVISIBLE to `pending` (computed strictly from
  // journal.entries below) — it silently never applies, no error, no warning,
  // no audit row. This happens from a bad merge, a forgotten
  // `drizzle-kit generate` journal write, or a manually-copied migration file.
  // Non-blocking (skip-and-continue) — the same fail-open contract as the
  // missing-file case, because an unreachable migration is a schema gap the
  // operator needs to see, not a reason to brick autonomous boot.
  try {
    await checkForOrphanSqlFiles(journal, correlationId);
  } catch (orphanCheckErr) {
    logger.warn({ err: String(orphanCheckErr) }, "boot-migration: orphan-sql-file check itself failed (non-blocking)");
  }

  // ds21 CRITICAL (deep-scan #21 Band F): the pending filter (below) keys "already
  // applied" on the journal `when` epoch (recorded as drizzle.__drizzle_migrations.created_at),
  // NOT on the per-migration tag/hash. If two journal entries share an identical `when`,
  // applying the first records that `when` and the SECOND is then treated as applied and
  // SILENTLY, PERMANENTLY skipped — no audit, no alert — surfacing only later as an opaque
  // "column/table does not exist" runtime error. This has already occurred 5 times
  // (0044a/0052, 0147/0159, 0148/0160, 0152/0162, 0153/0164 — each later sibling was applied
  // out-of-band, leaving the ledger inconsistent — schema exists in prod, verified read-only
  // 2026-07-05; the missing ledger row is inert because pending keys on `when`). We do NOT
  // auto-re-apply here — not because the migrations are unsafe (they ARE idempotent, e.g. 0052
  // uses DROP CONSTRAINT IF EXISTS before each ADD; an earlier note wrongly called it
  // non-idempotent, corrected after an independent grader disproved it) — but simply because
  // no re-apply is needed (schema already present) and detecting the collision loudly keeps the
  // operator in the loop for every collision, existing or future. Full remediation (key pending
  // on hash) is a documented follow-up; it is now safe since the colliding migrations are idempotent.
  try {
    const dupWhens = findDuplicateJournalWhens(journal.entries);
    if (dupWhens.length > 0) {
      const detail = dupWhens
        .map((g) => `when=${g.when}: [${g.tags.join(", ")}]`)
        .join("; ");
      logger.error(
        { duplicateWhenGroups: dupWhens },
        "boot-migration: DUPLICATE journal `when` values detected — a later colliding migration " +
          "can be silently skipped by the when-keyed pending filter",
      );
      await insertAuditRowSafe({
        action: "boot_migration.duplicate_journal_when_detected",
        entityType: "migration",
        entityId: null,
        decisionAuthority: "system",
        input: { duplicateWhenGroups: dupWhens } as Record<string, unknown>,
        result: { count: dupWhens.length } as Record<string, unknown>,
        status: "error",
        errorMessage: `duplicate journal when values: ${detail}`,
        correlationId,
      });
      // ds21-w2: audit row above records EVERY boot; Discord CRITICAL is 24h-deduped per collision
      // signature so an unchanged (dormant) collision set doesn't re-ping the operator each restart.
      const dupSignature = dupWhens.map((g) => g.when).sort((a, b) => a - b).join(",");
      if (_shouldFireDupWhenDiscord(dupSignature)) {
        await fireDiscordCritical(
          "Boot migration — duplicate journal `when` detected",
          `The migration journal has ${dupWhens.length} group(s) of entries sharing an identical \`when\` ` +
            `timestamp:\n\n${detail}\n\nThe boot-migration pending filter keys on \`when\`, so the LATER migration ` +
            `in each group can be silently skipped (never applied, no ledger row). Verify each later sibling's ` +
            `schema actually exists in the DB; give it a unique \`when\` in meta/_journal.json (only after confirming ` +
            `the migration is idempotent) so future boots track it correctly.`,
        );
      } else {
        logger.info({ dupSignature }, "boot-migration: duplicate-when Discord alert deduped (<24h since last identical alert)");
      }
    }
  } catch (dupCheckErr) {
    logger.warn({ err: String(dupCheckErr) }, "boot-migration: duplicate-when check itself failed (non-blocking)");
  }

  // ─── Bootstrap __drizzle_migrations table ───────────────────────────────────
  // First deploy may not have the tracking table yet (drizzle creates it on
  // first `drizzle-kit migrate` run, which is broken on this project).
  try {
    await db.execute(sql`
      CREATE SCHEMA IF NOT EXISTS drizzle;
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id         SERIAL      PRIMARY KEY,
        hash       TEXT        NOT NULL,
        created_at BIGINT      NOT NULL
      )
    `);
  } catch (bootstrapErr) {
    const msg = bootstrapErr instanceof Error ? bootstrapErr.message : String(bootstrapErr);
    // "already exists" is always safe to ignore
    if (!msg.toLowerCase().includes("already exists")) {
      logger.warn({ err: bootstrapErr }, "boot-migration: __drizzle_migrations bootstrap warning (tolerated)");
    }
  }

  // ─── Query applied (hash + when) ─────────────────────────────────────────────
  type AppliedRow = { created_at: string; hash: string };
  const appliedResult = await db.execute<AppliedRow>(
    sql`SELECT created_at::text AS created_at, hash FROM drizzle.__drizzle_migrations`,
  );
  // drizzle-orm returns { rows: [...] } for raw execute; normalise either shape
  const appliedRows: AppliedRow[] =
    (appliedResult as { rows?: AppliedRow[] }).rows ??
    (appliedResult as unknown as AppliedRow[]);
  const appliedWhens = new Set(appliedRows.map((r) => String(r.created_at)));
  const appliedHashes = new Set(appliedRows.map((r) => r.hash));

  // ─── Compute the plan keyed on migration HASH, not `when` (F1 fix, deep-scan Autonomy HIGH) ──
  // Closes the silent-skip class: two journal entries sharing a `when` no longer cause the second
  // to be treated as applied. hashOf reads + sha256s each .sql; null (missing/locked) → the plan
  // falls back to the legacy when-based check for that entry, so behavior is never worse than before.
  const migrationsDir = resolveMigrationsDir();
  const hashOf = (e: { when: number; tag: string }): string | null => {
    try {
      const p = path.join(migrationsDir, `${e.tag}.sql`);
      if (!fs.existsSync(p)) return null;
      return crypto.createHash("sha256").update(readUtf8StripBom(p)).digest("hex");
    } catch {
      return null;
    }
  };
  const { toApply, toBackfill } = computeMigrationPlan(
    journal.entries,
    appliedWhens,
    appliedHashes,
    hashOf,
  );

  // ─── Backfill ledger drift for the 5 verified out-of-band collision siblings ─────────────────
  // Their schema is already present in prod (verified read-only 2026-07-05) — record the missing
  // ledger row (hash + when) so future boots track them by identity; do NOT re-run the SQL.
  for (const entry of toBackfill) {
    const h = hashOf(entry);
    if (h === null) continue; // defensive: backfill entries always hash non-null
    try {
      await db.execute(
        sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${h}, ${entry.when})`,
      );
      logger.warn(
        { tag: entry.tag, when: entry.when },
        "boot-migration: BACKFILLED ledger row for a verified out-of-band collision sibling (hash recorded, SQL NOT re-run — schema already present)",
      );
      await insertAuditRowSafe({
        action: "boot_migration.ledger_backfilled",
        entityType: "migration",
        entityId: entry.tag,
        decisionAuthority: "system",
        input: { tag: entry.tag, when: entry.when } as Record<string, unknown>,
        result: { backfilled: true, reran_sql: false } as Record<string, unknown>,
        status: "success",
        correlationId,
      });
    } catch (backfillErr) {
      logger.warn(
        { err: String(backfillErr), tag: entry.tag },
        "boot-migration: ledger backfill failed (non-blocking — will retry next boot)",
      );
    }
  }

  // ─── Pending = genuinely-unapplied migrations (hash-keyed) ───────────────────
  const pending = toApply;

  if (pending.length === 0) {
    logger.info(
      { total: journal.entries.length },
      "boot-migration: no pending migrations — boot proceeds",
    );
    // FIX 2 (deepscan10): clean boot = reset the crash-loop counter so the
    // next real failure starts the cadence fresh.
    _resetBootFailureCount();
    return;
  }

  logger.info(
    { count: pending.length, tags: pending.map((e) => e.tag) },
    "boot-migration: pending migrations found — applying",
  );

  // ─── pg_dump availability (check once) ──────────────────────────────────────
  const pgDumpAvailable = await checkPgDumpAvailable();
  if (!pgDumpAvailable) {
    if (!allowNoBackup) {
      const msg =
        "boot-migration BLOCKED: pg_dump not found and BOOT_MIGRATION_ALLOW_NO_BACKUP=false. " +
        "Install postgresql-client or set BOOT_MIGRATION_ALLOW_NO_BACKUP=true to proceed with " +
        "information_schema JSON backup only.";
      logger.error(msg);
      await fireDiscordCritical(
        "Boot Migration Blocked — pg_dump Unavailable",
        `${msg}\n\nPending: ${pending.map((e) => e.tag).join(", ")}`,
      );
      throw new Error(msg);
    }
    logger.warn(
      "boot-migration: pg_dump unavailable — using information_schema JSON backup (BOOT_MIGRATION_ALLOW_NO_BACKUP=true)",
    );
  }

  // ─── Ensure backup dir ──────────────────────────────────────────────────────
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
  } catch (mkdirErr) {
    logger.warn({ err: mkdirErr, backupDir }, "boot-migration: failed to create backup dir (will use os.tmpdir())");
  }

  // migrationsDir already resolved above (for the hash-keyed plan); reuse it here.
  const databaseUrl = process.env.DATABASE_URL ?? "";

  // ─── Apply each pending migration in journal order ───────────────────────────
  for (const entry of pending) {
    const sqlFilePath = path.join(migrationsDir, `${entry.tag}.sql`);

    if (!fs.existsSync(sqlFilePath)) {
      // Deep-scan 2026-06-28: a journal entry whose .sql file is missing used to
      // be a SILENT logger.warn skip — an invisible, permanent schema gap (git
      // conflict / incomplete push / renamed-away migration). Now it writes an
      // audit row + fires Discord CRITICAL so the gap is attributable at boot,
      // not at a downstream "column does not exist" runtime error. Default stays
      // SKIP-AND-CONTINUE (not fail-closed) so a benign journal/disk drift can
      // never brick the live autonomous boot during a vacation; set
      // BOOT_MIGRATION_FAIL_ON_MISSING_SQL=true to opt into hard-fail boot block.
      logger.error({ tag: entry.tag, sqlFilePath }, "boot-migration: SQL file MISSING for pending journal entry — schema may be incomplete");
      await insertAuditRowSafe({
        action: "boot_migration.sql_file_missing",
        entityType: "migration",
        entityId: entry.tag,
        decisionAuthority: "system",
        input: { tag: entry.tag, idx: entry.idx, sqlFilePath } as Record<string, unknown>,
        result: { skipped: true } as Record<string, unknown>,
        status: "error",
        errorMessage: `boot-migration SQL file missing: ${sqlFilePath}`,
        correlationId,
      });
      await fireDiscordCritical(
        "Boot migration SQL file missing",
        `Migration ${entry.tag} is pending in the journal but its .sql file is missing (${sqlFilePath}). The database schema may be incomplete. Investigate before relying on any feature that touches this migration's tables/columns.`,
      );
      const failOnMissing =
        (process.env.BOOT_MIGRATION_FAIL_ON_MISSING_SQL ?? "false").toLowerCase() === "true";
      if (failOnMissing) {
        throw new Error(
          `boot-migration: SQL file missing for pending journal entry ${entry.tag} (${sqlFilePath}). ` +
            `Restore the file or set BOOT_MIGRATION_FAIL_ON_MISSING_SQL=false to skip and continue.`,
        );
      }
      continue;
    }

    // Deep-scan #16 E-5: guard the per-migration read the same way as the
    // journal read above — a TOCTOU race (the file existed at the existsSync
    // check a few lines up but was removed/replaced before this read), an
    // AV-scanner lock, or disk I/O flake here used to propagate straight out
    // of the loop, past every alerting path below, without ever firing the
    // Discord+audit signal.
    let migrationSql: string;
    try {
      migrationSql = readUtf8StripBom(sqlFilePath);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { tag: entry.tag, sqlFilePath, err: errMsg },
        "boot-migration: FAILED to read migration SQL file — boot blocked",
      );
      await insertAuditRowSafe({
        action: "migration.auto_apply_failed",
        entityType: "system",
        entityId: null,
        decisionAuthority: "gate",
        input: { tag: entry.tag, idx: entry.idx, sqlFilePath, phase: "migration_sql_read" } as Record<string, unknown>,
        result: { error: errMsg } as Record<string, unknown>,
        status: "failure",
        correlationId,
      });
      await fireDiscordCritical(
        `BOOT BLOCKED — Migration File Read Failed: ${entry.tag}`,
        `boot-migration could not read the SQL file for pending migration ${entry.tag} (${sqlFilePath}).\n\n` +
          `Error: ${errMsg}\n\nServer boot is BLOCKED. This is often a transient file-lock (AV scanner) or ` +
          `TOCTOU race — retrying the boot may succeed on its own. If it persists, inspect the file for ` +
          `corruption/truncation.`,
      );
      await bumpBootFailureCrashLoopAlert(`${entry.tag} (file read) — ${errMsg}`);
      throw new Error(`boot-migration: failed to read SQL file for ${entry.tag}: ${errMsg}`);
    }
    const hash = crypto.createHash("sha256").update(migrationSql).digest("hex");

    // Split on Drizzle statement-breakpoint markers (matches apply-missing-migrations.mjs)
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      // MIG-2 (deep-scan 2026-07-11): strip standalone transaction-control statements (BEGIN;/COMMIT;).
      // The runner already wraps every migration in db.transaction() below; a migration that embeds its
      // own BEGIN;...COMMIT; (9 pre-0126 files do) would COMMIT the OUTER transaction early, so the
      // ledger INSERT + post-apply verification would run OUTSIDE the transaction — voiding the
      // atomic-apply/rollback contract (a crash between the embedded COMMIT and the ledger write leaves
      // the DDL applied but unrecorded -> re-run next boot). Applied to EXECUTION statements ONLY: the
      // `hash` above is computed on the ORIGINAL migrationSql so it stays byte-stable vs drizzle's
      // applied-hash + the immutability manifest (stripping before hashing would force a spurious
      // re-run). The regex matches only a line that is exactly BEGIN;/BEGIN TRANSACTION;/COMMIT; — a
      // PL/pgSQL DO-block `BEGIN` (no trailing semicolon on its own line) is NOT matched.
      .map((s) => s.replace(/^[ \t]*(?:BEGIN(?:[ \t]+TRANSACTION)?|COMMIT)[ \t]*;[ \t]*$/gim, "").trim())
      .filter((s) => s.length > 0);

    const startTs = Date.now();
    let backupPath: string | null = null;

    logger.info(
      { tag: entry.tag, idx: entry.idx, stmtCount: statements.length },
      "boot-migration: starting migration",
    );

    // ── Step 1: Backup ──────────────────────────────────────────────────────
    try {
      if (pgDumpAvailable) {
        backupPath = await takePgDumpBackup(backupDir, entry.tag, startTs, databaseUrl);
        logger.info({ tag: entry.tag, backupPath }, "boot-migration: pg_dump backup written");
      } else {
        // ALLOW_NO_BACKUP=true path — information_schema JSON fallback
        backupPath = await takeInformationSchemaBackup(backupDir, entry.tag, startTs);
        logger.info({ tag: entry.tag, backupPath }, "boot-migration: information_schema JSON backup written");
      }
    } catch (backupErr) {
      const backupErrMsg =
        `boot-migration: backup failed for ${entry.tag}: ` +
        (backupErr instanceof Error ? backupErr.message : String(backupErr));
      logger.error({ tag: entry.tag, err: backupErr }, backupErrMsg);

      if (!allowNoBackup) {
        await fireDiscordCritical(
          `Boot Migration Blocked — Backup Failed: ${entry.tag}`,
          `${backupErrMsg}\n\nSet BOOT_MIGRATION_ALLOW_NO_BACKUP=true to skip backup requirement.`,
        );
        throw new Error(backupErrMsg);
      }
      // Proceed without backup — ALLOW_NO_BACKUP=true
      logger.warn({ tag: entry.tag }, "boot-migration: proceeding without backup (BOOT_MIGRATION_ALLOW_NO_BACKUP=true)");
    }

    // ── Step 2: Execute migration in transaction with timeout ───────────────
    try {
      await Promise.race([
        db.transaction(async (tx) => {
          for (const stmt of statements) {
            await tx.execute(sql.raw(stmt));
          }
          // Record in drizzle.__drizzle_migrations
          await tx.execute(
            sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`,
          );
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`boot-migration: timeout after ${timeoutMs}ms for ${entry.tag}`),
              ),
            timeoutMs,
          ),
        ),
      ]);

      const durationMs = Date.now() - startTs;
      logger.info(
        { tag: entry.tag, idx: entry.idx, durationMs, backupPath },
        "boot-migration: migration applied successfully",
      );

      // Audit success (non-blocking via insertAuditRowSafe)
      await insertAuditRowSafe({
        action: "migration.auto_applied",
        entityType: "system",
        entityId: null,
        decisionAuthority: "gate",
        input: {
          migration_name: entry.tag,
          journal_idx: entry.idx,
          backup_path: backupPath,
        } as Record<string, unknown>,
        result: { duration_ms: durationMs, hash } as Record<string, unknown>,
        status: "success",
        correlationId,
      });

      // O6: verify the migration's CREATE TABLE targets actually exist post-commit.
      // deepscan7 D1 (2026-07-02): extended to ALTER TABLE ... ADD COLUMN targets —
      // the pure-ALTER class (0146/0148) previously got zero verification.
      // Loud + audited on mismatch; never blocks boot (avoid false-close on parser gaps).
      try {
        const expectedTables = extractCreatedTables(statements);
        const missingTables = expectedTables.length ? await findMissingTables(expectedTables) : [];
        const expectedColumns = extractAlteredColumns(statements);
        const missingColumns = expectedColumns.length ? await findMissingColumns(expectedColumns) : [];
        if (missingTables.length > 0 || missingColumns.length > 0) {
          logger.error(
            { tag: entry.tag, missingTables, missingColumns },
            "boot-migration: POST-APPLY VERIFICATION FAILED — migration committed but schema object(s) missing (phantom-apply)",
          );
          await insertAuditRowSafe({
            action: "migration.post_apply_verification_failed",
            entityType: "system",
            entityId: null,
            decisionAuthority: "gate",
            input: {
              migration_name: entry.tag,
              journal_idx: entry.idx,
              expected_tables: expectedTables,
              expected_columns: expectedColumns,
            } as Record<string, unknown>,
            result: { missing_tables: missingTables, missing_columns: missingColumns } as Record<string, unknown>,
            status: "warning",
            correlationId,
          });
          const missingColumnDescs = missingColumns.map((c) => `${c.table}.${c.column}`);
          const missingParts = [
            ...(missingTables.length ? [`table(s): ${missingTables.join(", ")}`] : []),
            ...(missingColumnDescs.length ? [`column(s): ${missingColumnDescs.join(", ")}`] : []),
          ];
          await fireDiscordCritical(
            `Migration verification mismatch: ${entry.tag}`,
            `Migration ${entry.tag} committed but expected schema object(s) are missing from the DB — ${missingParts.join("; ")}.\n\n` +
              `This is the phantom-apply class (journal says applied, schema object absent). Investigate before the next migration collides. Not blocking boot.`,
          );
        }
      } catch (verifyOuterErr) {
        logger.warn({ tag: entry.tag, err: String(verifyOuterErr) }, "boot-migration: post-apply verification skipped (non-blocking)");
      }
    } catch (err) {
      const durationMs = Date.now() - startTs;
      const errMsg = err instanceof Error ? err.message : String(err);

      const restoreCommand = backupPath
        ? `psql "$DATABASE_URL" < "${backupPath}"`
        : "No backup available — inspect DB state manually before proceeding";

      const criticalMsg =
        `Migration ${entry.tag} (idx=${entry.idx}) failed during auto-apply.\n\n` +
        `Error: ${errMsg}\n\n` +
        `Backup path: ${backupPath ?? "none"}\n` +
        `Restore command: ${restoreCommand}\n\n` +
        `Server boot is BLOCKED. Options:\n` +
        `  1. Fix the migration SQL and restart\n` +
        `  2. Set BOOT_MIGRATION_ENABLED=false to skip auto-apply and apply manually\n` +
        `  3. Restore DB from backup above`;

      logger.error(
        { tag: entry.tag, idx: entry.idx, err, backupPath, durationMs },
        "boot-migration: migration FAILED — boot blocked",
      );

      // Audit failure (non-blocking)
      await insertAuditRowSafe({
        action: "migration.auto_apply_failed",
        entityType: "system",
        entityId: null,
        decisionAuthority: "gate",
        input: {
          migration_name: entry.tag,
          journal_idx: entry.idx,
          backup_path: backupPath,
        } as Record<string, unknown>,
        result: { error: errMsg, duration_ms: durationMs } as Record<string, unknown>,
        status: "failure",
        correlationId,
      });

      // Discord CRITICAL — fire-and-forget, never blocks
      await fireDiscordCritical(
        `BOOT BLOCKED — Migration Failed: ${entry.tag}`,
        criticalMsg,
      );

      // FIX 2 (deepscan10) / deep-scan #16 E-5: increment the file-based
      // crash-loop counter and send an escalation alert on the configured
      // cadence (1, 3, every 10th) so a vacation-mode NSSM respawn loop never
      // runs silently for 14 days. Extracted to bumpBootFailureCrashLoopAlert
      // so the SAME cadence logic covers the file-read failure paths above.
      await bumpBootFailureCrashLoopAlert(`${entry.tag} — ${errMsg}`);

      // Throw to block boot (fail-closed)
      throw new Error(`boot-migration: failed to apply ${entry.tag}: ${errMsg}`);
    }
  }

  logger.info(
    { applied: pending.length, tags: pending.map((e) => e.tag) },
    "boot-migration: all pending migrations applied — boot proceeds",
  );
  // FIX 2 (deepscan10): successful boot = reset crash-loop counter
  _resetBootFailureCount();
}
