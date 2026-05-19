// W23F.N — re-overlay all 4 active strategies with Style C 33/33/33
// Calls applyFrameworkOverlay() against each strategy's config, writes back.
import postgres from "postgres";
import { applyFrameworkOverlay } from "../src/server/services/framework-overlay.ts";

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });

const strats = await sql`SELECT id, name, symbol, symbols, config FROM strategies WHERE archived_at IS NULL`;
console.log(`Re-overlaying ${strats.length} strategies with Style C…`);

for (const s of strats) {
  const symbol = (s.symbols?.[0] || s.symbol) as "MES" | "MNQ" | "MCL";
  const res = applyFrameworkOverlay({
    compiled: s.config,
    source: "graduator_relegacy",
    symbol,
    bucketId: undefined,
  });
  await sql`UPDATE strategies SET config = ${res.config}::jsonb WHERE id = ${s.id}::uuid`;
  await sql`INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority) VALUES ('strategy.style_c_reoverlayed', 'strategy', ${s.id}::uuid, ${JSON.stringify({name: s.name, symbol})}::jsonb, ${JSON.stringify({applied: res.appliedRules, warnings: res.warnings, wave: "W23F.N"})}::jsonb, 'success', 'system')`;
  const style = res.config.exit_params?.style ?? "<missing>";
  const partials = res.config.exit_params?.partials ?? [];
  console.log(`  ✓ ${s.name} → exit_style=${style} partials=${JSON.stringify(partials)}`);
}

console.log(`\nDone. Verify:`);
const v = await sql`SELECT name, config->'exit_params'->>'style' AS style, config->'exit_params'->'partials' AS partials, config->'strategy'->>'exit_prose' AS prose FROM strategies WHERE archived_at IS NULL ORDER BY name`;
for (const x of v) console.log(`  ${x.name.padEnd(50)} style=${x.style} partials=${JSON.stringify(x.partials)}`);
console.log(`\nProse example:`);
console.log(`  ${v[0].prose}`);

await sql.end();
