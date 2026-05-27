// One-shot direct apply for migrations 0159, 0160, 0161, 0162.
// boot-migration-runner is disabled (BOOT_MIGRATION_ENABLED=false since
// 2026-05-24 after 0066 collision). These 4 are all idempotent (IF NOT EXISTS).
// Wave 29 Pass A/B/C + Wave 26 Pass J Phase 3 graduation requires the new
// columns + table — without them every strategy insert fails.
const pg = require('postgres');
const fs = require('fs');
const path = require('path');

const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });

const MIGRATIONS = [
  { idx: 159, file: '0159_broker_accounts_ab_paper_routing.sql' },
  { idx: 160, file: '0160_shadow_signals.sql' },
  { idx: 161, file: '0161_frozen_policy_contract.sql' },
  { idx: 162, file: '0162_needs_archetype_queue.sql' },
];

(async () => {
  for (const m of MIGRATIONS) {
    const filePath = path.join('src/server/db/migrations', m.file);
    const sqlText = fs.readFileSync(filePath, 'utf-8');
    // Drizzle uses --> statement-breakpoint to split statements per file.
    const stmts = sqlText.split(/-->\s*statement-breakpoint/).map(s => s.trim()).filter(Boolean);
    console.log(`\n=== Applying ${m.file} (${stmts.length} stmt${stmts.length === 1 ? '' : 's'}) ===`);
    try {
      await sql.begin(async (tx) => {
        for (const stmt of stmts) {
          await tx.unsafe(stmt);
        }
      });
      console.log(`  ✓ ${m.file} applied`);
    } catch (e) {
      console.error(`  ✗ ${m.file} FAILED:`, e.message?.slice(0, 300));
    }
  }

  console.log('\n=== Verify ===');
  const expected = ['paper_account_routing','shadow_mode_enabled','frozen_policy_hash','frozen_policy_set_at','regime_trained_on','frozen_policy_override_count'];
  for (const col of expected) {
    const r = await sql`SELECT 1 FROM information_schema.columns WHERE table_name='strategies' AND column_name=${col}`;
    console.log(col, '→', r.length > 0 ? 'present ✓' : 'STILL MISSING ✗');
  }
  const t = await sql`SELECT 1 FROM information_schema.tables WHERE table_name='needs_archetype_queue'`;
  console.log('needs_archetype_queue', '→', t.length > 0 ? 'present ✓' : 'STILL MISSING ✗');

  await sql.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
