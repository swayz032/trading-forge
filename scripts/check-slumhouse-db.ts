import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
dotenvConfig({ path: join(process.cwd(), ".env") });
const { db } = await import("../src/server/db/index.js");
const { sql } = await import("drizzle-orm");

const cols: any = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='slumhouse_users' ORDER BY ordinal_position`);
console.log("slumhouse_users columns:");
for (const row of (cols as any[])) console.log(`  ${row.column_name} ${row.data_type}`);

const ba: any = await db.execute(sql`SELECT account_id, firm_id, account_id_external FROM broker_accounts LIMIT 10`);
console.log("\nbroker_accounts available for mapping:");
for (const row of (ba as any[])) console.log(`  ${row.account_id}  ${row.firm_id}  ${row.account_id_external ?? "(no external id)"}`);
process.exit(0);
