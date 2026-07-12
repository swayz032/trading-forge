// stamp-applied-migrations.cjs — Wave 26 Pass K Phase 4 (2026-05-26)
//
// Backfill drizzle.__drizzle_migrations tracking table for migrations that
// are physically applied to the DB but never got their tracking row written
// (because boot-migration-runner was disabled since 2026-05-24 after the 0066
// IF NOT EXISTS collision).
//
// SAFETY:
//  - Applies migration 0163 first (relaxes broker_accounts CHECK + seeds the
//    Wave 29 Pass C A/B routing rows).
//  - For each journal entry, INSERT INTO drizzle.__drizzle_migrations
//    (hash, created_at) ON CONFLICT DO NOTHING.
//  - Hash is computed from the SQL file contents (same as boot-migration-runner
//    will compute on next boot).
//  - created_at uses the journal's `when` field (matches the runner's expected
//    keying logic in boot-migration-runner.ts:294-298).
//  - Skips entries already tracked.
//
// AFTER RUNNING:
//  - Set BOOT_MIGRATION_ENABLED=true in .env.
//  - Next API restart → runner reports "no pending migrations" and proceeds.

const pg = require('postgres');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });

const MIG_DIR = 'src/server/db/migrations';
const JOURNAL_PATH = path.join(MIG_DIR, 'meta/_journal.json');

function hashOfMigrationFile(tag) {
  const filePath = path.join(MIG_DIR, `${tag}.sql`);
  if (!fs.existsSync(filePath)) return null;
  let sqlText = fs.readFileSync(filePath, 'utf-8');
  // Must EXACTLY mirror boot-migration-runner's readUtf8StripBom (BOM strip + CRLF→LF normalize) so
  // the stamped ledger hash EQUALS the runtime hashOf. Without a byte-identical match, the applied
  // migration is misclassified as pending on the next boot and re-applied → for a pre-idempotency
  // baseline (bare ADD COLUMN) that raises "column already exists" → tx rollback → boot crash-loop.
  // - BOM strip: guards recurring PowerShell-authored BOM corruption (per CLAUDE.md).
  // - CRLF→LF: deep-scan 2026-07-11 HIGH fix. This tool previously stripped BOM ONLY. On this tower
  //   (core.autocrlf=true → CRLF working-tree files) the runtime normalizes CRLF→LF but the stamp did
  //   not, so a post-DB-restore stamp (this tool's documented purpose) seeded CRLF-content hashes the
  //   runtime could NEVER match → every stamped baseline re-executed on the next boot → crash-loop.
  if (sqlText.charCodeAt(0) === 0xFEFF) sqlText = sqlText.slice(1);
  sqlText = sqlText.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(sqlText).digest('hex');
}

(async () => {
  console.log('=== Step 1: Apply 0163 (broker_accounts CHECK relax + Wave 29 Pass C seed) ===');
  // LOW (freshscan6 2026-07-12): the 0163 read was OUTSIDE the try/catch — if the file has been
  // deleted/consolidated (it has), readFileSync THREW here and crashed the whole IIFE BEFORE Steps 2-3
  // (the actual journal-stamping — this tool's real purpose after a DB restore), making the recovery
  // tool DOA. Step 1 is a one-time historical migration application; skip it gracefully when the file
  // is absent and proceed to the stamping that matters.
  const _p163 = path.join(MIG_DIR, '0163_broker_accounts_allow_paper_firm.sql');
  if (!fs.existsSync(_p163)) {
    console.log('  ⊘ 0163 file absent (deleted/consolidated) — skipping Step 1; proceeding to stamp.');
  } else {
    const sql163 = fs.readFileSync(_p163, 'utf-8');
    const stmts = sql163.split(/-->\s*statement-breakpoint/).map(s => s.trim()).filter(Boolean);
    try {
      await sql.begin(async (tx) => {
        for (const stmt of stmts) await tx.unsafe(stmt);
      });
      console.log('  ✓ 0163 applied');
    } catch (e) {
      console.error('  ✗ 0163 FAILED:', e.message?.slice(0, 300));
    }
  }

  console.log('\n=== Step 2: Bootstrap drizzle.__drizzle_migrations if absent ===');
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`;
    console.log('  ✓ schema + table ensured');
  } catch (e) {
    console.error('  ✗ bootstrap failed:', e.message?.slice(0, 200));
  }

  console.log('\n=== Step 3: Stamp every journal entry into drizzle.__drizzle_migrations ===');
  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf-8'));
  let stamped = 0;
  let skipped = 0;
  let missing = 0;

  for (const entry of journal.entries) {
    const hash = hashOfMigrationFile(entry.tag);
    if (!hash) {
      missing++;
      console.log(`  · missing SQL file for tag ${entry.tag} (idx ${entry.idx}) — skipping`);
      continue;
    }
    // Check if any row with this created_at already exists
    const exist = await sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when} LIMIT 1`;
    if (exist.length > 0) {
      skipped++;
      continue;
    }
    await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`;
    stamped++;
  }
  console.log(`  ✓ stamped ${stamped} entries; skipped ${skipped} already-tracked; ${missing} missing SQL files`);

  console.log('\n=== Step 4: Verify ===');
  const totalApplied = await sql`SELECT COUNT(*)::int AS c FROM drizzle.__drizzle_migrations`;
  console.log(`  drizzle.__drizzle_migrations row count: ${totalApplied[0].c}`);
  console.log(`  journal entries count: ${journal.entries.length}`);
  const broker = await sql`SELECT COUNT(*)::int AS c FROM broker_accounts WHERE firm_id='paper'`;
  console.log(`  broker_accounts firm_id='paper' rows: ${broker[0].c}`);

  await sql.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
