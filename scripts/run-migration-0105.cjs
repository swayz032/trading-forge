require("dotenv/config");
const postgres = require("postgres");
const fs = require("node:fs");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    const migration = fs.readFileSync("src/server/db/migrations/0105_wide_fingerprint.sql", "utf-8");
    console.log("Running migration 0105...");
    await sql.unsafe(migration);

    const c = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'strategy_pending_buckets' AND column_name = 'wide_fingerprint_hash'`;
    console.log("Column present:", c.length > 0);
    const idx = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'strategy_pending_buckets' AND indexname = 'idx_pending_buckets_wide_fingerprint'`;
    console.log("Index present:", idx.length > 0);
  } finally {
    await sql.end();
  }
})();
