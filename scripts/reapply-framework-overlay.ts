/**
 * One-shot — re-apply framework overlay to existing strategies.
 * Use after expanding framework-overlay.ts so already-stored configs pick up
 * the new rules (fixed_target → trailing_stop normalize, base_contracts fill,
 * template-hole safety net).
 */
import "dotenv/config";
import postgres from "postgres";
import { applyFrameworkOverlay } from "../src/server/services/framework-overlay.js";

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const rows = await sql<Array<{ id: string; name: string; symbol: string; source: string; config: any }>>`
    SELECT id::text, name, symbol, source, config FROM strategies WHERE source = 'graduated_bucket'
  `;
  console.log(`Re-applying overlay to ${rows.length} strategies`);
  for (const r of rows) {
    const result = applyFrameworkOverlay({
      compiled: r.config,
      source: r.source as any,
      symbol: r.symbol as "MES" | "MNQ" | "MCL",
    });
    await sql`UPDATE strategies SET config = ${sql.json(result.config as unknown as import("postgres").JSONValue)} WHERE id = ${r.id}`;
    console.log(`  ${r.name}: ${result.appliedRules.length} rules applied`);
    for (const rule of result.appliedRules) console.log(`    - ${rule}`);
    if (result.warnings.length) for (const w of result.warnings) console.log(`    [warn] ${w}`);
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
