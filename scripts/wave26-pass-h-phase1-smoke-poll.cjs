require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const bid = '080520be-5a07-44b5-8fee-5ad5a0930e25';
    // Latest audit rows for this bucket
    const r = await sql`
      SELECT action, status, created_at, entity_id, result
      FROM audit_log
      WHERE input::text ILIKE ${'%' + bid + '%'} OR result::text ILIKE ${'%' + bid + '%'}
      ORDER BY created_at DESC
      LIMIT 30
    `;
    console.log("Audit trail:");
    for (const row of r) {
      console.log("  ", row.created_at, row.action, row.status, row.entity_id || '');
    }

    // Bucket state
    const b = await sql`SELECT id, concept_name, status, graduated_at, graduated_strategy_id FROM strategy_pending_buckets WHERE id = ${bid}`;
    console.log("\nBucket:", JSON.stringify(b, null, 2));

    // Recently created strategies (last 5 min)
    const s = await sql`
      SELECT id, name, symbol, created_at,
        config->>'entry_indicator' as ei,
        config->>'source_bucket_id' as bid,
        config->>'source_url' as src,
        config->>'entry_archetype' as ea,
        config->'entry_quality'->>'factor_quality' as fq,
        config->'entry_quality'->'confluence_factors' as factors,
        config->'entry_quality'->'factor_sources' as sources
      FROM strategies
      WHERE created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
    `;
    console.log("\nRecent strategies (last 10 min):");
    console.log(JSON.stringify(s, null, 2));
  } finally { await sql.end(); }
})().catch(e => { console.error(e); process.exit(1); });
