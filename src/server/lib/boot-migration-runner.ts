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
 * Deep-Scan #19 D-1 (2026-07-05): the Drizzle journal `when` timestamp is NOT
 * unique — 5 twin pairs share an identical `when` (0044a/0052, 0147/0159,
 * 0148/0160, 0152/0162, 0153/0164). The applied-set was keyed ONLY on `when`
 * (`__drizzle_migrations.created_at`), so on an INCREMENTAL deploy the second
 * migration of any twin was silently filtered out of `pending` and NEVER ran
 * (no audit, no Discord, no orphan warning — fail-soft downstreams masked it as
 * "quietly not working"). Prod escaped an outage only because the current twins
 * happened to land via a fresh-bootstrap pass or reconcile migrations.
 *
 * Fix (surgical, no mass re-run risk): for NON-colliding `when`s keep the fast
 * when-check — byte-identical to legacy, no file read. For duplicate `when`s,
 * disambiguate on the UNIQUE sha256 file hash (the `hash` column already stored
 * per row). `hashOfTag` returns null when the .sql is missing/unreadable → the
 * entry is treated as pending so the apply-loop's existing missing/read-error
 * alerting fires (never silently swallowed).
 */
export function computePendingMigrations(
  entries: JournalEntry[],
  appliedWhens: Set<string>,
  appliedHashes: Set<string>,
  hashOfTag: (entry: JournalEntry) => string | null,
): JournalEntry[] {
  const whenCounts = new Map<number, number>();
  for (const e of entries) whenCounts.set(e.when, (whenCounts.get(e.when) ?? 0) + 1);

  return entries.filter((e) => {
    const isDuplicateWhen = (whenCounts.get(e.when) ?? 0) > 1;
    if (!isDuplicateWhen) {
      // legacy fast path — unchanged behavior for the 183 unique-`when` entries
      return !appliedWhens.has(String(e.when));
    }
    // duplicate `when` — the D-1 collision zone; disambiguate by file hash
    const h = hashOfTag(e);
    if (h === null) return true; // can't hash → pending; apply loop reports missing/unreadable
    return !appliedHashes.has(h);
  });
}

/**
 * Read a UTF-8 text file and strip a leading byte-order-mark (BOM) if present.
 *
 * WHY: PowerShell (the operator's primary shell) writes files as UTF-8/UTF-16
 * WITH a BOM by default. A BOM (U+FEFF) at the start of _journal.json makes
 * JSON.parse throw ("Unexpected token ï»¿"), and a BOM at the start of a
 * migration .sql makes Postgres reject the first statement — either one
 * fail-closes the boot-migration-runner and takes the WHOLE API offline
 * (2026-06-24 production-down incident). Stripping the BOM on read makes the
 * boot path robust to this entire class of file-encoding corruption.
 */
function readUtf8StripBom(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
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

/**
 * Fire Discord CRITICAL via the local relay (matches alert-service.ts pattern),
 * falling back to direct webhook. Fire-and-forget — never throws.
 */
export async function fireDiscordCritical(title: string, message: string): Promise<void> {
  const discordPort = process.env.DISCORD_ALERT_PORT || "4100";

  // Primary: local relay (same pattern as alert-service.ts)
  try {
    await fetch(`http://localhost:${discordPort}/alert/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, message, severity: "critical" }),
      signal: AbortSignal.timeout(4000),
    });
    return;
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

  // ─── Query applied ──────────────────────────────────────────────────────────
  // DS19 D-1: also read `hash` (unique per file) to disambiguate duplicate-`when`
  // twins that the created_at-only key silently dropped.
  type AppliedRow = { created_at: string; hash: string };
  const appliedResult = await db.execute<AppliedRow>(
    sql`SELECT created_at::text AS created_at, hash FROM drizzle.__drizzle_migrations`,
  );
  // drizzle-orm returns { rows: [...] } for raw execute; normalise either shape
  const appliedRows: AppliedRow[] =
    (appliedResult as { rows?: AppliedRow[] }).rows ??
    (appliedResult as unknown as AppliedRow[]);
  const appliedWhens = new Set(appliedRows.map((r) => String(r.created_at)));
  const appliedHashes = new Set(appliedRows.map((r) => r.hash).filter(Boolean));

  // DS19 D-1: warn once if the journal contains colliding `when` values so the
  // hazard is visible in boot logs even after the dedup is hash-safe.
  const _dupWhens = new Map<number, string[]>();
  for (const e of journal.entries) {
    const arr = _dupWhens.get(e.when) ?? [];
    arr.push(e.tag);
    _dupWhens.set(e.when, arr);
  }
  const _collisions = [..._dupWhens.entries()].filter(([, tags]) => tags.length > 1);
  if (_collisions.length > 0) {
    logger.warn(
      { collisions: _collisions.map(([when, tags]) => ({ when, tags })) },
      "boot-migration: journal has duplicate `when` values — dedup falls back to sha256 hash for these (DS19 D-1)",
    );
  }

  // ─── Compute pending (DS19 D-1: hash-disambiguated for duplicate-`when` twins) ─
  const _migrationsDirForHash = resolveMigrationsDir();
  const pending = computePendingMigrations(
    journal.entries,
    appliedWhens,
    appliedHashes,
    (entry) => {
      // Only called for duplicate-`when` entries. Read + sha256 the file; null on
      // any error so the entry is treated pending and the apply loop reports it.
      try {
        const p = path.join(_migrationsDirForHash, `${entry.tag}.sql`);
        if (!fs.existsSync(p)) return null;
        return crypto.createHash("sha256").update(readUtf8StripBom(p)).digest("hex");
      } catch {
        return null;
      }
    },
  );

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

  const migrationsDir = resolveMigrationsDir();
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
