require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const r1 = await sql`SELECT config->'entry_quality'->>'factor_quality' as fq, COUNT(*)::int as n FROM strategies WHERE archived_at IS NULL GROUP BY 1 ORDER BY 2 DESC`;
    console.log("=== POST DISTRIBUTION ==="); console.log(JSON.stringify(r1, null, 2));

    const r2 = await sql`SELECT COUNT(*) FILTER (WHERE config->>'source_url' IS NOT NULL)::int as src, COUNT(*) FILTER (WHERE config->>'entry_archetype' IS NOT NULL)::int as ea, COUNT(*) FILTER (WHERE config->>'source_bucket_id' IS NOT NULL)::int as bid, COUNT(*)::int as total FROM strategies WHERE archived_at IS NULL`;
    console.log("=== STAMPING ==="); console.log(JSON.stringify(r2, null, 2));

    const r3 = await sql`SELECT config->>'entry_indicator' as ei, COUNT(*)::int as n FROM strategies WHERE archived_at IS NULL AND config->'entry_quality'->>'factor_quality' = 'thin' GROUP BY 1 ORDER BY 2 DESC`;
    console.log("=== THIN BREAKDOWN ==="); console.log(JSON.stringify(r3, null, 2));

    const r4 = await sql`SELECT current_value FROM system_parameters WHERE param_name='pipeline_mode'`;
    console.log("=== PIPELINE_MODE ==="); console.log(JSON.stringify(r4, null, 2));
  } finally { await sql.end(); }
})().catch(e => { console.error(e); process.exit(1); });
