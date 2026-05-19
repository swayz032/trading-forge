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

await run('Q1: Pause history (last 10)',
  `SELECT created_at, action, decision_authority, result FROM audit_log WHERE action = 'pipeline.set-mode' ORDER BY created_at DESC LIMIT 10`);

await run('Q2: Current pipeline mode',
  `SELECT current_value FROM system_parameters WHERE param_name = 'pipeline_mode'`);

await run('Q3: Backlog by status (last 7d)',
  `SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM system_journal WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY status ORDER BY count DESC`);

await run('Q4: Scouts produced today by source',
  `SELECT source, COUNT(*) FROM system_journal WHERE created_at > CURRENT_DATE AND status = 'scouted' GROUP BY source`);

await run('Q5: Hourly scout writes last 12h',
  `SELECT DATE_TRUNC('hour', created_at) AS hour, COUNT(*) FROM system_journal WHERE created_at > NOW() - INTERVAL '12 hours' AND status = 'scouted' GROUP BY hour ORDER BY hour`);

await run('Q6 BONUS: All system_journal status counts last 12h',
  `SELECT status, COUNT(*) FROM system_journal WHERE created_at > NOW() - INTERVAL '12 hours' GROUP BY status ORDER BY 2 DESC`);

await run('Q7 BONUS: 7-day average scout writes per day',
  `SELECT DATE(created_at) AS day, COUNT(*) FROM system_journal WHERE created_at > NOW() - INTERVAL '7 days' AND status = 'scouted' GROUP BY day ORDER BY day`);

await run('Q8 BONUS: Available statuses in journal',
  `SELECT DISTINCT status FROM system_journal LIMIT 30`);

await sql.end();
console.log('\n[done]');
