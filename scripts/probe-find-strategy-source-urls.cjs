// Find source URLs for all alive strategies — collapse 3-market fan-out into unique videos.
// 117 strategy rows ÷ 3 markets = ~39 unique videos expected.
const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });
(async () => {
  console.log('=== Resolving source URLs via 4 paths ===\n');

  // Path 1: config.source_url directly
  // Path 2: source_bucket_id → strategy_pending_buckets.id → strategy_pending_mentions (most recent youtube URL)
  // Path 3: description "extracted from <title>" — title-based lookup
  // Path 4: parent_strategy_id (variant) → parent's source_url

  const rows = await sql`
    WITH alive AS (
      SELECT
        s.id, s.name, s.symbol, s.lifecycle_state,
        s.config->>'source_url' AS direct_url,
        s.config->>'source_bucket_id' AS bucket_id,
        s.parent_strategy_id,
        s.description
      FROM strategies s
      WHERE s.archived_at IS NULL
    ),
    via_bucket AS (
      SELECT DISTINCT ON (a.id) a.id, m.source_url AS bucket_url
      FROM alive a
      LEFT JOIN strategy_pending_mentions m ON m.bucket_id::text = a.bucket_id
      WHERE m.source_url ILIKE '%youtube%'
      ORDER BY a.id, m.id DESC NULLS LAST
    )
    SELECT
      a.id, a.name, a.symbol, a.lifecycle_state, a.direct_url, vb.bucket_url, a.description
    FROM alive a
    LEFT JOIN via_bucket vb ON vb.id = a.id
    ORDER BY a.name
  `;

  // Group by extracted video_id
  function extractVideoId(rawUrl) {
    if (!rawUrl) return null;
    const m = String(rawUrl).match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  const byVideoId = new Map();
  const noUrl = [];
  for (const r of rows) {
    const url = r.direct_url || r.bucket_url;
    const videoId = extractVideoId(url);
    if (!videoId) {
      noUrl.push(r);
      continue;
    }
    if (!byVideoId.has(videoId)) byVideoId.set(videoId, []);
    byVideoId.get(videoId).push(r);
  }

  console.log(`Total alive strategies: ${rows.length}`);
  console.log(`Unique videos:          ${byVideoId.size}`);
  console.log(`Strategies w/o URL:     ${noUrl.length}\n`);

  console.log('=== UNIQUE VIDEOS (grouped by video_id) ===\n');
  let i = 0;
  for (const [videoId, strats] of [...byVideoId.entries()].sort((a, b) => b[1].length - a[1].length)) {
    i++;
    const sample = strats[0];
    const url = sample.direct_url || sample.bucket_url;
    console.log(`${i}. video_id=${videoId}  (${strats.length} strategy rows)`);
    console.log(`   url:    ${url}`);
    console.log(`   names:  ${strats.map(s => s.symbol).sort().join(' / ')} — ${sample.name.replace(/_(mes|mnq|mcl)_\d+m?$/i, '')}`);
    console.log(`   states: ${[...new Set(strats.map(s => s.lifecycle_state))].join(' | ')}`);
    if (i >= 50) break;
  }

  console.log(`\n=== Strategies WITHOUT URL (first 5) ===`);
  for (const r of noUrl.slice(0, 5)) {
    console.log(`  ${r.name} (${r.symbol}) — desc: ${(r.description || '').slice(0, 80)}`);
  }

  await sql.end();
})().catch(e => console.error('ERR', e.message));
