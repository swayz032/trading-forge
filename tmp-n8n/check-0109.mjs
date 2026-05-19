import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("no DATABASE_URL");
  const sql = postgres(url, { ssl: "require" });
  try {
    const mig = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 6`;
    console.log("recent migrations:");
    for (const r of mig) console.log(" ", r.hash, r.created_at);

    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='strategies' AND column_name IN ('archived_at','archive_reason')`;
    console.log("\nWave9 columns present:", cols.map((c) => c.column_name));

    const counts = await sql`SELECT lifecycle_state, COUNT(*)::int AS n FROM strategies GROUP BY lifecycle_state ORDER BY n DESC`;
    console.log("\nlifecycle counts:");
    for (const r of counts) console.log(" ", r.lifecycle_state, r.n);

    const arch = await sql`SELECT COUNT(*)::int AS n FROM strategies WHERE archived_at IS NOT NULL`;
    console.log("\narchived_at populated:", arch[0]?.n);

    const active = await sql`SELECT id, name, lifecycle_state FROM strategies WHERE archived_at IS NULL AND lifecycle_state NOT IN ('GRAVEYARD','RETIRED') ORDER BY updated_at DESC LIMIT 10`;
    console.log("\nactive strategies (sample):");
    for (const r of active) console.log(" ", r.id?.slice(0, 8), r.lifecycle_state, r.name);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
