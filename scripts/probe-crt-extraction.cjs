const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });
(async () => {
  console.log('=== Most recent scout.operator_ingested for CRT video ===');
  const rows = await sql`
    SELECT created_at, result FROM audit_log
    WHERE action='scout.operator_ingested' AND input::text LIKE '%UBvfsImdI2U%'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (rows[0]) console.log(JSON.stringify(rows[0].result, null, 2));

  console.log('\n=== Most recent CRT strategy row in DB ===');
  const s = await sql`
    SELECT id, name, lifecycle_state, created_at, config
    FROM strategies
    WHERE name LIKE '%candle_range%' OR name LIKE '%crt%'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (s[0]) {
    console.log('id:', s[0].id);
    console.log('name:', s[0].name);
    console.log('lifecycle:', s[0].lifecycle_state);
    console.log('created:', s[0].created_at);
    console.log('---config---');
    console.log(JSON.stringify(s[0].config, null, 2).slice(0, 5000));
  }

  console.log('\n=== speaker_concepts attached by server-side NLP? ===');
  const sc = await sql`
    SELECT created_at, action, result FROM audit_log
    WHERE action LIKE '%speaker_concept%' AND created_at > NOW() - INTERVAL '15 minutes'
    ORDER BY created_at DESC LIMIT 3
  `;
  for (const r of sc) {
    console.log('---', r.created_at, r.action, '---');
    console.log(JSON.stringify(r.result).slice(0, 600));
  }

  await sql.end();
})().catch(e => console.error('ERR', e.message));
