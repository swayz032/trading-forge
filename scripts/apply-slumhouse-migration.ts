import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
dotenvConfig({ path: join(process.cwd(), ".env") });
const { db } = await import("../src/server/db/index.js");
const { sql } = await import("drizzle-orm");
const { readFileSync } = await import("node:fs");
const { resolve } = await import("node:path");

const file = resolve(process.cwd(), "src/server/db/migrations/0164_slumhouse_users.sql");
const content = readFileSync(file, "utf-8");
const stmts = content
  .split("\n")
  .filter((l: string) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s: string) => s.trim())
  .filter((s: string) => s.length > 2);

console.log(`Applying 0164_slumhouse_users.sql (${stmts.length} statements)...`);
for (const stmt of stmts) {
  await db.execute(sql.raw(stmt));
}
console.log("✓ Applied.");

const cols: any = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='slumhouse_users' ORDER BY ordinal_position`);
console.log("\nslumhouse_users columns now:");
for (const row of (cols as any[])) console.log(`  ${row.column_name}  ${row.data_type}`);
process.exit(0);
