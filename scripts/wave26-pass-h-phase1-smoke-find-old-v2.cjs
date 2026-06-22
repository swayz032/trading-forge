require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const bids = ['83ef2e28-c23b-407e-a3c6-1e84ddbd71aa', 'c93501e4-fd59-4a3f-b2c8-4ea074cc2a4d', '98edb174-9881-4de8-bb2c-42c3724c7b14', '80618248-222a-4521-99b4-2a4c7ce141e5'];

    // Check the buckets themselves
    const a = await sql`
      SELECT id, concept_name, status, graduated_at, graduated_strategy_id, layer_coverage_json
      FROM strategy_pending_buckets
      WHERE id = ANY(${bids})
    `;
    console.log("Buckets:", JSON.stringify(a, null, 2));

    // Check graduated strategies referencing those buckets
    const b = await sql`
      SELECT id, name, symbol, archived_at,
        config->>'entry_indicator' as ei,
        config->>'source_bucket_id' as bid,
        config->>'source_url' as src,
        config->>'entry_archetype' as ea,
        config->'entry_quality'->>'factor_quality' as fq,
        config->'entry_quality'->>'confluence_factors' as factors
      FROM strategies
      WHERE config->>'source_bucket_id' = ANY(${bids})
      ORDER BY created_at ASC
    `;
    console.log("Graduated strategies tied to these buckets:", JSON.stringify(b, null, 2));

    // Also check graduated_strategy_id linkage
    const grad_ids = a.filter(r => r.graduated_strategy_id).map(r => r.graduated_strategy_id);
    if (grad_ids.length > 0) {
      const c = await sql`
        SELECT id, name, archived_at, symbol,
          config->>'entry_indicator' as ei,
          config->>'source_bucket_id' as bid,
          config->>'source_url' as src,
          config->'entry_quality'->>'factor_quality' as fq
        FROM strategies WHERE id = ANY(${grad_ids})
      `;
      console.log("Via graduated_strategy_id linkage:", JSON.stringify(c, null, 2));
    }
  } finally { await sql.end(); }
})().catch(e => { console.error(e); process.exit(1); });
