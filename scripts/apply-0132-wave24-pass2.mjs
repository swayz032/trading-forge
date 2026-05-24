// Wave 24 Pass 2 operator-action automation
// Apply migration 0132_hmm_regime_overlay.sql (idempotent)

import postgres from "postgres";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf-8");
const dbUrlLine = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = dbUrlLine?.split("=").slice(1).join("=").trim();
const sql = postgres(dbUrl, { max: 1 });

async function main() {
  const migrationSql = readFileSync("src/server/db/migrations/0132_hmm_regime_overlay.sql", "utf-8");
  await sql.unsafe(migrationSql);
  console.log("[1/3] migration 0132 applied (idempotent)");

  const col = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'bias_state' AND column_name = 'hmm_probability_used'
  `;
  if (col.length === 0) throw new Error("hmm_probability_used column NOT present");
  console.log("[2/3] verified: bias_state.hmm_probability_used is", col[0].data_type);

  const tbl = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'regime_hmm_models'
  `;
  if (tbl.length === 0) throw new Error("regime_hmm_models table NOT present");
  console.log("[3/3] verified: regime_hmm_models table exists");

  await sql.end();
  console.log("\n✅ Migration 0132 finalized");
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
