const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });

const TESTED = new Set([
  "iU8ww5MC2FQ", "N7uP9V0Iktc", "UBvfsImdI2U",      // Round 1
  "gddYspvW0_w", "ktkqq7QsN9Q", "LOcaRWcc1xI",      // Round 2
  "1HFoStW_wsc", "aHLIE_TXjpo", "FqxEKDxemtI",      // Test 2
]);

(async () => {
  // Same resolution path the probe uses: config.source_url OR bucket→mentions
  const rows = await sql`
    WITH bucket_urls AS (
      SELECT DISTINCT ON (b.concept_name)
        b.concept_name, b.graduated_strategy_id, m.source_url
      FROM strategy_pending_buckets b
      JOIN strategy_pending_mentions m ON m.bucket_id = b.id
      WHERE m.source_url ILIKE '%youtube%'
      ORDER BY b.concept_name, m.created_at DESC NULLS LAST
    )
    SELECT DISTINCT
      regexp_replace(COALESCE(s.config->>'source_url', bu.source_url), '.*v=([A-Za-z0-9_-]{11}).*', '\\1') AS video_id,
      regexp_replace(s.name, '_(mes|mnq|mcl)_\\d+m?$', '', 'i') AS concept_name
    FROM strategies s
    LEFT JOIN bucket_urls bu ON bu.graduated_strategy_id = s.id
    WHERE s.archived_at IS NULL
      AND COALESCE(s.config->>'source_url', bu.source_url) IS NOT NULL
      AND COALESCE(s.config->>'source_url', bu.source_url) ILIKE '%youtube%'
    ORDER BY concept_name
  `;
  const seen = new Set();
  const fresh = [];
  for (const r of rows) {
    if (!r.video_id || seen.has(r.video_id)) continue;
    seen.add(r.video_id);
    if (TESTED.has(r.video_id)) continue;
    fresh.push({ video_id: r.video_id, concept: r.concept_name });
  }
  console.log(`Total unique resolvable videos: ${seen.size}`);
  console.log(`Already tested: ${TESTED.size}`);
  console.log(`FRESH (untested):`);
  for (const f of fresh) console.log(`  ${f.video_id}   ${f.concept}`);
  await sql.end();
})();
