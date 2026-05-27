const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });
(async () => {
  console.log('=== drizzle migration table — latest applied ===');
  try {
    const m = await sql`SELECT * FROM "drizzle"."__drizzle_migrations" ORDER BY id DESC LIMIT 10`;
    for (const r of m) console.log(r.id, '|', new Date(Number(r.created_at)).toISOString(), '|', r.hash?.slice(0, 12));
  } catch (e) {
    console.log('drizzle table err:', e.message);
  }

  console.log('\n=== which Wave 29 columns are MISSING from strategies ===');
  const expected = ['paper_account_routing','shadow_mode_enabled','frozen_policy_hash','frozen_policy_set_at','regime_trained_on','frozen_policy_override_count'];
  for (const col of expected) {
    const r = await sql`SELECT 1 FROM information_schema.columns WHERE table_name='strategies' AND column_name=${col}`;
    console.log(col, '→', r.length > 0 ? 'present' : 'MISSING');
  }

  console.log('\n=== needs_archetype_queue table exists? ===');
  const t = await sql`SELECT 1 FROM information_schema.tables WHERE table_name='needs_archetype_queue'`;
  console.log('needs_archetype_queue', '→', t.length > 0 ? 'present' : 'MISSING');

  await sql.end();
})().catch(e => console.error('ERR', e.message));
