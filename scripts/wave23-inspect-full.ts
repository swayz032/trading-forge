import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { strategies } from "../src/server/db/schema.js";
import { inArray } from "drizzle-orm";
const ids = ["bcf0edeb-5c83-4a0e-afac-922cfe9dbfad", "c57cb511-8d5b-4dfc-9fb6-74b53f421826"];
async function main() {
  const rows = await db.select().from(strategies).where(inArray(strategies.id, ids));
  for (const r of rows) {
    console.log("\n=== " + r.name + " ===");
    console.log(JSON.stringify(r, null, 2));
  }
}
main().catch(console.error).finally(() => process.exit(0));
