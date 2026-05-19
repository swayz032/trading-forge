require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    const [r] = await sql`
      SELECT id, name, symbol, config FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
      ORDER BY created_at DESC LIMIT 1
    `;
    console.log("=== FULL CONFIG (latest graduated) ===");
    console.log("name:", r.name);
    console.log("metadata keys:", Object.keys(r.config.metadata ?? {}));
    console.log("metadata FULL:", JSON.stringify(r.config.metadata, null, 2));
    console.log("\ntop-level config keys:", Object.keys(r.config));
    console.log("\nregime_gate:", JSON.stringify(r.config.regime_gate));
    console.log("session_filter:", JSON.stringify(r.config.session_filter));
    console.log("time_stop:", JSON.stringify(r.config.time_stop));
    console.log("\nstrategy.position_size:", JSON.stringify(r.config.strategy?.position_size));
  } finally {
    await sql.end();
  }
})();
