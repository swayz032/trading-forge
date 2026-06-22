import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

const pm: any = await db.execute(sql`SELECT param_name, current_value FROM system_parameters WHERE param_name='pipeline_mode'`);
console.log("PIPELINE_MODE:", JSON.stringify(pm));
const dist: any = await db.execute(sql`
  SELECT config->'entry_quality'->>'factor_quality' as fq, COUNT(*) as n
  FROM strategies WHERE archived_at IS NULL GROUP BY 1 ORDER BY 2 DESC
`);
console.log("FACTOR_QUALITY DISTRIBUTION (active):", JSON.stringify(dist));
const total: any = await db.execute(sql`SELECT COUNT(*) as n FROM strategies WHERE archived_at IS NULL`);
console.log("ACTIVE TOTAL:", JSON.stringify(total));
const dE4live: any = await db.execute(sql`
  SELECT COUNT(*) as n FROM strategies WHERE config->>'source_url' LIKE '%dE4lPhAWke8%' AND archived_at IS NULL
`);
console.log("dE4lPhAWke8 LIVE STRATEGIES:", JSON.stringify(dE4live));
process.exit(0);
