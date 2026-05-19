require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    const rows = await sql`
      SELECT s.name,
             s.symbol,
             b.concept_name,
             b.distinct_providers,
             b.source_count,
             b.layer_coverage_json,
             (SELECT array_agg(m.source_url ORDER BY m.id)
                FROM strategy_pending_mentions m
               WHERE m.bucket_id = b.id) AS mention_urls,
             s.created_at
        FROM strategies s
        LEFT JOIN strategy_pending_buckets b ON b.graduated_strategy_id = s.id
       WHERE s.config->'metadata'->>'source' = 'graduated_bucket'
       ORDER BY s.created_at DESC
    `;
    console.log(JSON.stringify(rows.map((r) => ({
      name: r.name,
      symbol: r.symbol,
      concept: r.concept_name,
      providers: r.distinct_providers,
      sources: r.source_count,
      layers: r.layer_coverage_json,
      urls: r.mention_urls,
      created: r.created_at?.toISOString(),
    })), null, 2));
  } finally {
    await sql.end();
  }
})();
