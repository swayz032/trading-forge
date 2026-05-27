const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });
(async () => {
  console.log('=== Most recent migration.* audit rows ===');
  const rows = await sql`
    SELECT created_at, action, status, result FROM audit_log
    WHERE action LIKE 'migration.%'
    ORDER BY created_at DESC LIMIT 10
  `;
  for (const r of rows) {
    console.log(r.created_at, r.action, r.status);
    if (r.result) console.log('  ', JSON.stringify(r.result).slice(0, 200));
  }
  console.log('\n=== drizzle.__drizzle_migrations row count ===');
  const c = await sql`SELECT COUNT(*)::int AS c FROM drizzle.__drizzle_migrations`;
  console.log('count:', c[0].c);
  console.log('\n=== broker_accounts firm_id=paper rows ===');
  const ba = await sql`SELECT firm_id, broker_type, account_id_external, enabled FROM broker_accounts WHERE firm_id='paper'`;
  for (const r of ba) console.log(' ', r.firm_id, r.broker_type, r.account_id_external, r.enabled);
  await sql.end();
})().catch(e => console.error('ERR', e.message));
