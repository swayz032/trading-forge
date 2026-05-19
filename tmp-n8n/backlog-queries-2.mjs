import postgres from 'postgres';

const sql = postgres('postgresql://postgres:AigUZpOqoXkUfhuTTZuvzoSCbDOjfAKh@switchback.proxy.rlwy.net:36475/railway', { ssl: 'require', idle_timeout: 5, max: 1 });

async function run(label, q) {
  console.log(`\n=== ${label} ===`);
  try {
    const r = await sql.unsafe(q);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

// Look for any audit_log mode-related rows under any naming convention
await run('A1: audit_log actions matching pause/mode (any)',
  `SELECT action, COUNT(*) FROM audit_log WHERE action ILIKE '%mode%' OR action ILIKE '%pause%' OR action ILIKE '%pipeline%' GROUP BY action ORDER BY 2 DESC LIMIT 30`);

await run('A2: audit_log most recent 15 rows of any kind',
  `SELECT created_at, action, decision_authority FROM audit_log ORDER BY created_at DESC LIMIT 15`);

await run('A3: system_parameters all rows (small table)',
  `SELECT param_name, current_value, updated_at FROM system_parameters ORDER BY updated_at DESC NULLS LAST LIMIT 30`);

await run('A4: scout count today by source AGAIN with timestamp range',
  `SELECT source, MIN(created_at) AS oldest, MAX(created_at) AS newest, COUNT(*) FROM system_journal WHERE created_at > CURRENT_DATE GROUP BY source`);

await run('A5: strategies created in last 7 days by source',
  `SELECT source, COUNT(*), MIN(created_at) AS oldest, MAX(created_at) AS newest FROM strategies WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY source ORDER BY 2 DESC`);

await run('A6: strategies in last 24h by lifecycle_state',
  `SELECT lifecycle_state, COUNT(*) FROM strategies WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY lifecycle_state ORDER BY 2 DESC`);

await run('A7: scouted but NOT drained — system_journal where status=scouted AND no synthesized strategy referenced',
  `SELECT COUNT(*) FROM system_journal WHERE status = 'scouted' AND created_at > NOW() - INTERVAL '7 days'`);

await sql.end();
console.log('\n[done]');
