import postgres from 'postgres';
const sql = postgres('postgresql://postgres:AigUZpOqoXkUfhuTTZuvzoSCbDOjfAKh@switchback.proxy.rlwy.net:36475/railway', { ssl: 'require', idle_timeout: 5, max: 1 });

const r = await sql`SELECT created_at, decision_authority, input FROM audit_log WHERE action='pipeline.mode_change' ORDER BY created_at DESC LIMIT 10`;
console.log(JSON.stringify(r, null, 2));

await sql.end();
