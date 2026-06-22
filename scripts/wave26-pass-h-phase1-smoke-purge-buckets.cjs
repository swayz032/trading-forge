require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const bids = [
      '83ef2e28-c23b-407e-a3c6-1e84ddbd71aa',
      '98edb174-9881-4de8-bb2c-42c3724c7b14',
      '80618248-222a-4521-99b4-2a4c7ce141e5',
      'c93501e4-fd59-4a3f-b2c8-4ea074cc2a4d',
    ];
    // delete mentions first (FK)
    const m = await sql`DELETE FROM strategy_concept_mentions WHERE bucket_id = ANY(${bids}) RETURNING id`.catch(() => []);
    console.log("Deleted mentions:", m.length);
    const b = await sql`DELETE FROM strategy_pending_buckets WHERE id = ANY(${bids}) RETURNING id, concept_name`;
    console.log("Deleted buckets:");
    console.log(JSON.stringify(b, null, 2));
  } finally { await sql.end(); }
})().catch(e => { console.error(e); process.exit(1); });
