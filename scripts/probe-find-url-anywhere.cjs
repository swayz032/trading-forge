const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });

(async () => {
  // Find a strategy WITHOUT config.source_url (one of the 105) and dump the full config
  const sample = await sql`
    SELECT id, name, symbol, config
    FROM strategies
    WHERE archived_at IS NULL
      AND (config->>'source_url' IS NULL OR config->>'source_url' = '')
    ORDER BY name
    LIMIT 1
  `;
  if (sample.length === 0) { console.log("no no-url rows"); return; }

  const s = sample[0];
  console.log(`Sample no-URL strategy: ${s.name} (${s.symbol})\n`);
  console.log("=== Top-level config keys ===");
  console.log(Object.keys(s.config).sort().join('\n'));

  // Recursively scan for any key whose name contains "url" OR any string value containing "youtube"
  function scan(obj, path = '') {
    if (obj === null || obj === undefined) return [];
    if (typeof obj === 'string') {
      if (obj.includes('youtube') || obj.includes('youtu.be')) {
        return [{ path, value: obj.slice(0, 200) }];
      }
      return [];
    }
    if (Array.isArray(obj)) {
      return obj.flatMap((v, i) => scan(v, `${path}[${i}]`));
    }
    if (typeof obj === 'object') {
      const found = [];
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase().includes('url') && typeof v === 'string') {
          found.push({ path: `${path}.${k}`, value: v.slice(0, 200) });
        }
        found.push(...scan(v, `${path}.${k}`));
      }
      return found;
    }
    return [];
  }

  const hits = scan(s.config);
  console.log(`\n=== URL-like values found in config (${hits.length}) ===`);
  for (const h of hits) console.log(`  ${h.path}: ${h.value}`);

  if (hits.length === 0) {
    console.log("\nNO URL FOUND IN CONFIG. Full config dump:");
    console.log(JSON.stringify(s.config, null, 2).slice(0, 4000));
  }

  // Also try the strategy_pending_buckets path — operator said URLs are in config
  console.log(`\n=== Checking bucket linkage ===`);
  const bucketId = s.config.source_bucket_id ?? s.config.bucket_id;
  if (bucketId) {
    console.log(`source_bucket_id: ${bucketId}`);
    const bucket = await sql`SELECT id, status, source_urls, video_ids, urls FROM strategy_pending_buckets WHERE id::text = ${bucketId} LIMIT 1`.catch(e => { console.log(`bucket query error: ${e.message}`); return []; });
    if (bucket.length > 0) {
      console.log("bucket row:", JSON.stringify(bucket[0], null, 2).slice(0, 1500));
    }
  }

  // Aggregate stats — for ALL 105 no-url strategies, find where their URLs live
  console.log(`\n=== Aggregate URL-location scan across all 105 no-url strategies ===`);
  const allNoUrl = await sql`
    SELECT id, config
    FROM strategies
    WHERE archived_at IS NULL
      AND (config->>'source_url' IS NULL OR config->>'source_url' = '')
  `;
  const locationCounts = new Map();
  for (const r of allNoUrl) {
    const hits = scan(r.config);
    for (const h of hits) {
      const key = h.path;
      locationCounts.set(key, (locationCounts.get(key) ?? 0) + 1);
    }
    if (hits.length === 0) locationCounts.set('<NO_URL_ANYWHERE>', (locationCounts.get('<NO_URL_ANYWHERE>') ?? 0) + 1);
  }
  console.log(`Total no-url strategies scanned: ${allNoUrl.length}`);
  for (const [path, count] of [...locationCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)}× ${path}`);
  }

  await sql.end();
})().catch(e => console.error('ERR', e.message));
