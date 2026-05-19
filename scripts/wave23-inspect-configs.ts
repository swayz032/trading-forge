import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { strategies } from "../src/server/db/schema.js";
import { inArray } from "drizzle-orm";
const ids = ["bcf0edeb-5c83-4a0e-afac-922cfe9dbfad", "c57cb511-8d5b-4dfc-9fb6-74b53f421826"];
async function main() {
  const rows = await db.select({ id: strategies.id, name: strategies.name, symbol: strategies.symbol, timeframe: strategies.timeframe, config: strategies.config })
    .from(strategies).where(inArray(strategies.id, ids));
  for (const r of rows) {
    const c = r.config as any;
    console.log("\n=== " + r.name + " ===");
    console.log("  symbol:", r.symbol, "timeframe:", r.timeframe);
    console.log("  entry_long:", c?.entry_long);
    console.log("  entry_short:", c?.entry_short);
    console.log("  stop_loss:", JSON.stringify(c?.stop_loss));
    console.log("  position_size:", JSON.stringify(c?.position_size));
    console.log("  indicators:", JSON.stringify(c?.indicators?.map((i: any) => i.type || i.name)));
  }
}
main().catch(console.error).finally(() => process.exit(0));
