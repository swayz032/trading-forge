require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    const rows = await sql`
      SELECT s.id, s.name, s.symbol, s.created_at,
             s.config->'strategy'->'indicators'->0->>'type' AS indicator,
             s.config->'strategy'->>'timeframe' AS tf,
             s.config->>'direction' AS dir,
             s.config->'entry_params' AS params
      FROM strategies s
      WHERE s.config->'metadata'->>'source' = 'graduated_bucket'
        AND NOT ('archived_duplicate' = ANY(COALESCE(s.tags, ARRAY[]::text[])))
      ORDER BY s.name ASC
    `;
    console.log(`══ Final active library: ${rows.length} unique strategies ══\n`);
    for (const r of rows) {
      console.log(`  ${r.name}`);
      console.log(`     indicator=${r.indicator}  tf=${r.tf}  dir=${r.dir}  params=${JSON.stringify(r.params || {})}`);
    }
    console.log("");
    console.log(`══ By indicator ══`);
    const byInd = {};
    for (const r of rows) byInd[r.indicator] = (byInd[r.indicator] || 0) + 1;
    for (const [k, v] of Object.entries(byInd).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(30)} ${v}`);
    }
    console.log("");
    console.log(`══ Archive count ══`);
    const arch = await sql`SELECT COUNT(*)::int AS n FROM strategies WHERE 'archived_duplicate' = ANY(tags)`;
    console.log(`  Archived duplicates: ${arch[0].n}`);
  } finally {
    await sql.end();
  }
})();
