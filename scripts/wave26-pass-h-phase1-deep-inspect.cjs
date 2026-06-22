require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const r = await sql`
      SELECT id, name,
        config->'entry_quality'->'factor_quality' as fq_json,
        jsonb_typeof(config->'entry_quality'->'factor_quality') as fq_type,
        length(config->'entry_quality'->>'factor_quality') as text_len,
        config->'entry_quality'->>'factor_quality' as fq_text
      FROM strategies
      WHERE archived_at IS NULL
      LIMIT 5
    `;
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await sql.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
