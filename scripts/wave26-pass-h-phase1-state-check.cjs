require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const r1 = await sql`SELECT config->'entry_quality'->'factor_quality' as fq_raw, config->'entry_quality'->>'factor_quality' as fq_text, COUNT(*)::int as n FROM strategies WHERE archived_at IS NULL GROUP BY 1,2 ORDER BY 3 DESC`;
    console.log("DISTRIBUTION:");
    console.log(JSON.stringify(r1, null, 2));

    const r2 = await sql`SELECT COUNT(*) FILTER (WHERE config->>'source_url' IS NOT NULL)::int as src, COUNT(*) FILTER (WHERE config->>'entry_archetype' IS NOT NULL)::int as ea, COUNT(*) FILTER (WHERE config->>'source_bucket_id' IS NOT NULL)::int as bid, COUNT(*)::int as total FROM strategies WHERE archived_at IS NULL`;
    console.log("STAMPING:");
    console.log(JSON.stringify(r2, null, 2));

    const r3 = await sql`SELECT config->>'entry_indicator' as ei, COUNT(*)::int as n FROM strategies WHERE archived_at IS NULL AND config->'entry_quality'->>'factor_quality' = 'thin' GROUP BY 1 ORDER BY 2 DESC`;
    console.log("THIN BREAKDOWN:");
    console.log(JSON.stringify(r3, null, 2));

    const r5 = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='system_parameters' ORDER BY ordinal_position`;
    console.log("system_parameters columns:");
    console.log(JSON.stringify(r5, null, 2));

    // Try common column names
    try {
      const r4 = await sql`SELECT * FROM system_parameters LIMIT 20`;
      console.log("system_parameters rows (first 20):");
      console.log(JSON.stringify(r4, null, 2));
    } catch (e) { console.log("system_parameters select failed:", e.message); }
  } finally {
    await sql.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
