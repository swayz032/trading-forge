import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL, { ssl: "require" });
const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='n8n' ORDER BY table_name`;
console.log("n8n schema tables:");
for (const r of tables) console.log(" ", r.table_name);
await sql.end();
