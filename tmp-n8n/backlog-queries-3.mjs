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

await run('Q1 CORRECTED: pipeline.mode_change last 10',
  `SELECT created_at, action, decision_authority, result FROM audit_log WHERE action = 'pipeline.mode_change' ORDER BY created_at DESC LIMIT 10`);

await sql.end();
