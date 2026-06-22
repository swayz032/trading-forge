const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });
(async () => {
  console.log('=== Mechanic portability classification for N7uP9V0Iktc ===');
  const a = await sql`
    SELECT created_at, action, result FROM audit_log
    WHERE created_at > NOW() - INTERVAL '90 minutes'
      AND result::text LIKE '%N7uP9%'
      AND action LIKE 'extraction%'
    ORDER BY created_at DESC LIMIT 5
  `;
  for (const r of a) {
    console.log('---', r.created_at, r.action, '---');
    console.log(JSON.stringify(r.result, null, 2).slice(0, 800));
  }

  console.log('\n=== Latest vwap_ema strategies in last 60 min ===');
  const s = await sql`
    SELECT id, name, symbol, lifecycle_state, source_url_first_seen, created_at,
           config->'entry_quality'->'confluence_factors' AS confluences,
           config->'strategy'->'indicators' AS indicators
    FROM strategies
    WHERE created_at > NOW() - INTERVAL '60 minutes'
      AND (name ILIKE '%vwap%' OR name ILIKE '%ema_retest%')
    ORDER BY created_at DESC LIMIT 6
  `;
  for (const row of s) {
    console.log('---', row.created_at, row.name, row.symbol, '---');
    console.log('  confluences:', JSON.stringify(row.confluences));
    console.log('  indicators :', JSON.stringify(row.indicators)?.slice(0, 200));
  }
  await sql.end();
})().catch(e => console.error('ERR', e.message));
