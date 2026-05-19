import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { backtests } from "../src/server/db/schema.js";
import { eq } from "drizzle-orm";

const btIds = [
  "b3eb9204-f5eb-4c29-86d0-0a2ccbb5898b",  // ema_9_21
  "6e0eca32-bfe3-4f87-923b-2795a351dee2",  // orb_15m_mes
];

async function main() {
  for (const id of btIds) {
    const [bt] = await db.select({ id: backtests.id, config: backtests.config, errorMessage: backtests.errorMessage })
      .from(backtests).where(eq(backtests.id, id));
    if (bt) {
      const cfg = bt.config as any;
      const strat = cfg?.strategy ?? cfg;
      console.log(`\n${id}:`);
      console.log("  timeframe:", strat?.timeframe);
      console.log("  symbol:", strat?.symbol);
      console.log("  start_date:", cfg?.start_date);
      console.log("  error:", bt.errorMessage);
    }
  }
}
main().catch(console.error).finally(() => process.exit(0));
