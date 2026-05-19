// Quick heartbeat-table probe. Reads DATABASE_URL from .env and prints the
// last 5 heartbeat rows + computes age. Used to diagnose dead-man's alerts.
require("dotenv/config");
const postgres = require("postgres");

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }

(async () => {
  const sql = postgres(url, { connect_timeout: 10, max: 1 });
  try {
    const rows = await sql`SELECT ts, status, source FROM system_health_heartbeat ORDER BY ts DESC LIMIT 5`;
    console.log("Last 5 heartbeats:");
    for (const r of rows) {
      const ageMin = Math.round((Date.now() - new Date(r.ts).getTime()) / 60000);
      console.log(`  ${new Date(r.ts).toISOString()}  status=${r.status}  source=${r.source}  age=${ageMin}min`);
    }
    // Try a write to confirm DB is healthy
    const w = await sql`INSERT INTO system_health_heartbeat (ts, status, source) VALUES (NOW(), 'alive', 'manual-probe') RETURNING ts`;
    console.log(`Wrote probe heartbeat at: ${new Date(w[0].ts).toISOString()}`);
  } catch (e) {
    console.error("ERR:", e.message);
  } finally {
    await sql.end();
  }
})();
