require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
(async () => {
  try {
    // Test the EXACT same SQL the API uses
    const filteredCount = await sql`
      SELECT COUNT(*)::int AS n
        FROM strategies
       WHERE NOT ('archived_duplicate' = ANY(COALESCE(tags, ARRAY[]::text[])))
    `;
    console.log("Filter SQL (excludes archived):", filteredCount[0].n);

    const totalCount = await sql`SELECT COUNT(*)::int AS n FROM strategies`;
    console.log("Total strategies:", totalCount[0].n);

    const archivedCount = await sql`SELECT COUNT(*)::int AS n FROM strategies WHERE 'archived_duplicate' = ANY(tags)`;
    console.log("Archived strategies:", archivedCount[0].n);

    const gradActive = await sql`
      SELECT COUNT(*)::int AS n FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
        AND NOT ('archived_duplicate' = ANY(COALESCE(tags, ARRAY[]::text[])))
    `;
    console.log("graduated_bucket non-archived:", gradActive[0].n);
  } finally {
    await sql.end();
  }
})();
