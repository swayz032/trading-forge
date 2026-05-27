const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });
(async () => {
  console.log('=== last self_restart_requested events ===');
  const r1 = await sql`
    SELECT created_at, input, result FROM audit_log
    WHERE action='system.self_restart_requested'
    ORDER BY created_at DESC LIMIT 5
  `;
  for (const r of r1) console.log(r.created_at, JSON.stringify(r.input).slice(0, 200));

  console.log('\n=== Just-now scout.cross_market_demo_remap + no_symbol_defaulted ===');
  const r2 = await sql`
    SELECT created_at, action, input, result FROM audit_log
    WHERE action IN ('scout.cross_market_demo_remap', 'scout.no_symbol_defaulted_to_mes')
      AND created_at > NOW() - INTERVAL '20 minutes'
    ORDER BY created_at DESC LIMIT 5
  `;
  console.log('found', r2.length, 'rows');
  for (const r of r2) {
    console.log('---', r.created_at, r.action);
    console.log('IN:', JSON.stringify(r.input).slice(0, 250));
    console.log('RES:', JSON.stringify(r.result).slice(0, 250));
  }

  console.log('\n=== Pass K Phase 7 markers in the JUST-restarted process ===');
  const r3 = await sql`
    SELECT created_at, action FROM audit_log
    WHERE created_at > NOW() - INTERVAL '5 minutes'
      AND action LIKE 'extraction%'
    ORDER BY created_at DESC LIMIT 10
  `;
  for (const r of r3) console.log(r.created_at, r.action);

  await sql.end();
})().catch(e => console.error('ERR', e.message));
