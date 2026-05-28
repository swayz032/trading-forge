const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });

(async () => {
  // List columns on strategy_pending_buckets so we know what URL fields exist there
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='strategy_pending_buckets' ORDER BY ordinal_position`;
  console.log("=== strategy_pending_buckets columns ===");
  for (const c of cols) console.log(`  ${c.column_name} :: ${c.data_type}`);

  // Pick a no-URL strategy and try to find its bucket by concept_name
  const sample = await sql`
    SELECT id, name, symbol, config
    FROM strategies
    WHERE name='200_ma_ceiling_floor_mes_15m' AND archived_at IS NULL
    LIMIT 1
  `;
  if (sample.length === 0) { console.log("no sample"); await sql.end(); return; }
  const s = sample[0];
  const conceptName = '200_ma_ceiling_floor';
  console.log(`\n=== Searching buckets for concept '${conceptName}' ===`);
  const buckets = await sql`
    SELECT * FROM strategy_pending_buckets
    WHERE concept_name = ${conceptName}
    LIMIT 5
  `.catch(e => { console.log("ERR:", e.message); return []; });
  for (const b of buckets) {
    console.log("bucket id:", b.id, " concept:", b.concept_name);
    console.log("  ALL fields:", JSON.stringify(b, null, 2).slice(0, 2500));
  }

  // Also check strategy_pending_mentions
  console.log(`\n=== Mentions table columns ===`);
  const colsM = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='strategy_pending_mentions' ORDER BY ordinal_position`;
  console.log("  ", colsM.map(c => c.column_name).join(", "));

  if (buckets.length > 0) {
    const bId = buckets[0].id;
    const mentions = await sql`SELECT * FROM strategy_pending_mentions WHERE bucket_id=${bId} LIMIT 5`.catch(e => { console.log("mention err:", e.message); return []; });
    console.log(`\nMentions for bucket ${bId}: ${mentions.length}`);
    for (const m of mentions.slice(0, 3)) {
      console.log("  ", JSON.stringify(m).slice(0, 400));
    }
  }

  // Aggregate: for all 105 no-url strategies, derive concept_name from strategy name, look up bucket, look up mention URLs
  console.log(`\n=== Trying mention-table URL recovery for all 105 ===`);
  const allNoUrl = await sql`
    SELECT id, name FROM strategies
    WHERE archived_at IS NULL
      AND (config->>'source_url' IS NULL OR config->>'source_url' = '')
  `;
  let resolved = 0, unresolved = 0;
  const conceptUrls = new Map(); // concept_name → Set of youtube urls
  for (const r of allNoUrl) {
    const concept = r.name.replace(/_(mes|mnq|mcl)_\d+m?$/i, '');
    if (!conceptUrls.has(concept)) {
      const mentions = await sql`
        SELECT m.source_url FROM strategy_pending_mentions m
        JOIN strategy_pending_buckets b ON b.id = m.bucket_id
        WHERE b.concept_name = ${concept}
          AND m.source_url ILIKE '%youtube%'
        LIMIT 1
      `.catch(() => []);
      conceptUrls.set(concept, mentions.length > 0 ? mentions[0].source_url : null);
    }
    if (conceptUrls.get(concept)) resolved++;
    else unresolved++;
  }
  console.log(`Resolved via mentions: ${resolved}`);
  console.log(`Unresolved:           ${unresolved}`);
  console.log(`Unique concepts:      ${conceptUrls.size}`);
  console.log(`Concepts with URL:    ${[...conceptUrls.values()].filter(v => v).length}`);
  console.log(`\nFirst 20 concept → URL mappings:`);
  let i = 0;
  for (const [c, u] of conceptUrls) {
    console.log(`  ${(c || '?').padEnd(45)} ${u ?? '<no URL in mentions>'}`);
    if (++i >= 20) break;
  }

  await sql.end();
})().catch(e => console.error('ERR', e.message));
