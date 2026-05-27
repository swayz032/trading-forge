import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
dotenvConfig({ path: join(process.cwd(), ".env") });
const { db } = await import("../src/server/db/index.js");
const { sql } = await import("drizzle-orm");

const cols: any = await db.execute(sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='slumhouse_users' ORDER BY ordinal_position`);
const rows = Array.isArray(cols) ? cols : cols.rows;
console.log(`slumhouse_users — ${rows.length} columns:`);
for (const row of rows) console.log(`  ${row.column_name.padEnd(20)} ${row.data_type.padEnd(28)} nullable=${row.is_nullable}`);
process.exit(0);
