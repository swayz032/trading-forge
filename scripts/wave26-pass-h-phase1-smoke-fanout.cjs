require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    // For each known bucket-graduation pair, find all variant rows by name root + same archetype
    const concepts = ['daily_bias_market_structure', 'market_structure_shift'];
    for (const c of concepts) {
      const rows = await sql`
        SELECT id, name, symbol, archived_at,
          config->>'entry_indicator' as ei,
          config->'entry_quality'->>'factor_quality' as fq,
          config->'entry_quality'->>'confluence_factors' as factors,
          config->'entry_quality'->>'factor_sources' as sources
        FROM strategies
        WHERE name LIKE ${c + '%'} AND archived_at IS NULL
        ORDER BY symbol, name
      `;
      console.log("Concept:", c, "rows:", JSON.stringify(rows, null, 2));
    }

    // Also: was the ict_bias_aligned_continuation archetype ever emitted from this video?
    const r = await sql`
      SELECT id, name, created_at, config->>'entry_indicator' as ei, config->>'source_url' as src
      FROM strategies
      WHERE config->>'entry_indicator' LIKE 'archetype:ict_bias_aligned_continuation%'
      ORDER BY created_at DESC
      LIMIT 10
    `;
    console.log("ict_bias_aligned_continuation grads anywhere:", JSON.stringify(r, null, 2));
  } finally { await sql.end(); }
})().catch(e => { console.error(e); process.exit(1); });
