require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const url1 = 'https://youtu.be/dE4lPhAWke8';
    const url2 = 'https://www.youtube.com/watch?v=dE4lPhAWke8';
    // 1) Find strategies that reference this video by source_url
    const a = await sql`
      SELECT id, name, archived_at, config->>'source_url' as source_url, config->>'entry_indicator' as ei, config->>'source_bucket_id' as bid
      FROM strategies
      WHERE config->>'source_url' = ${url1} OR config->>'source_url' = ${url2}
      ORDER BY created_at ASC
    `;
    console.log("By source_url:", JSON.stringify(a, null, 2));

    // 2) Find via audit_log if any
    const b = await sql`
      SELECT id, name, archived_at, created_at, config->>'entry_indicator' as ei
      FROM strategies
      WHERE (name ILIKE '%dE4lPhAWke8%' OR description ILIKE '%dE4lPhAWke8%')
      ORDER BY created_at DESC
      LIMIT 20
    `;
    console.log("By name/desc match:", JSON.stringify(b, null, 2));

    // 3) Find via audit_log scout mentions
    const c = await sql`
      SELECT entity_id, action, created_at, result->>'source_url' as src
      FROM audit_log
      WHERE (result::text ILIKE '%dE4lPhAWke8%' OR input::text ILIKE '%dE4lPhAWke8%')
      ORDER BY created_at DESC
      LIMIT 20
    `;
    console.log("Audit_log refs:", JSON.stringify(c, null, 2));
  } finally { await sql.end(); }
})().catch(e => { console.error(e); process.exit(1); });
