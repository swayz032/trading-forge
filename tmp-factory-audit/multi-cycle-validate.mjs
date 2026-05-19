// W23F robustness validation — fire 4 cycles + audit all strategies
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });
const API = "http://localhost:4000";

async function fireCycle(label) {
  console.log(`\n[${new Date().toISOString().slice(11,19)}] ↻ Firing ${label}…`);
  const r = await fetch(`${API}/api/admin/scout/run-autonomous-cycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const j = await r.json();
  console.log(`  trigger: ${j.status} — ${j.note}`);
}

async function waitMinutes(min) {
  const ms = min * 60 * 1000;
  await new Promise(r => setTimeout(r, ms));
}

async function snapshotState(label) {
  const cycles = await sql`SELECT created_at, result->>'cycle_index' AS idx, result->>'seeded_symbol' AS sym FROM audit_log WHERE action='scout_cycle.started' ORDER BY created_at DESC LIMIT 1`;
  const grads = await sql`SELECT action, COUNT(*)::int n FROM audit_log WHERE action LIKE 'graduation.%' AND created_at > NOW() - INTERVAL '12 minutes' GROUP BY action ORDER BY n DESC`;
  const strats = await sql`SELECT COUNT(*)::int n FROM strategies WHERE archived_at IS NULL`;
  console.log(`\n[${label}] last cycle: ${cycles[0]?.idx} ${cycles[0]?.sym} | strategies: ${strats[0].n} | graduation events last 12min:`);
  for (const g of grads) console.log(`    ${g.action}: ${g.n}`);
}

console.log("=== W23F multi-cycle robustness validation — 4 cycles + final audit ===");
console.log(`Started: ${new Date().toISOString()}`);

await snapshotState("BEFORE");

await fireCycle("cycle 5");
await waitMinutes(8);
await snapshotState("after cycle 5");

await fireCycle("cycle 6");
await waitMinutes(8);
await snapshotState("after cycle 6");

await fireCycle("cycle 7");
await waitMinutes(8);
await snapshotState("after cycle 7");

await fireCycle("cycle 8");
await waitMinutes(8);
await snapshotState("after cycle 8");

console.log("\n\n========================================");
console.log("=== FINAL STRATEGY AUDIT (all active strategies) ===");
console.log("========================================");

const strats = await sql`
  SELECT s.name, s.symbol, s.symbols, s.timeframe, s.lifecycle_state, s.created_at,
    s.config->>'direction' AS direction,
    s.config->'entry_quality'->>'extraction_provenance' AS provenance,
    s.config->'entry_quality'->'confluence_factors' AS confluence_factors,
    s.config->'entry_quality'->>'min_factors_satisfied' AS min_fs,
    s.config->'entry_quality'->>'source_claim_win_rate' AS source_wr,
    s.config->'entry_quality'->>'source_claim_avg_r' AS source_r,
    s.config->'strategy'->>'entry_indicator' AS entry_indicator,
    s.config->'strategy'->>'entry_long' AS entry_long,
    s.config->'strategy'->>'entry_short' AS entry_short,
    s.config->'strategy'->'entry_params' AS entry_params,
    s.config->'strategy'->>'preferred_regime' AS regime,
    s.config->'strategy'->>'exit_type' AS exit_type,
    s.config->'risk'->>'stop_loss_atr_multiple' AS stop_atr,
    s.config->'position_size'->>'type' AS pos_type,
    s.config->'position_size'->>'base_contracts' AS base,
    s.config->'position_size'->>'tier_increment' AS tier_inc,
    s.config->'position_size'->>'max_risk_pct_per_trade' AS max_risk_pct,
    s.config->'position_size'->>'personal_dll_pct' AS dll,
    s.config->'risk'->'time_stop' AS time_stop
  FROM strategies s
  WHERE s.archived_at IS NULL
  ORDER BY s.created_at DESC`;

console.log(`\nTotal active strategies: ${strats.length}\n`);

for (const s of strats) {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 ${s.name}`);
  console.log(`   Created:  ${s.created_at.toISOString()}`);
  console.log(`   Market:   ${s.symbol} (legacy) → symbols=${JSON.stringify(s.symbols)}`);
  console.log(`   TF:       ${s.timeframe}`);
  console.log(`   State:    ${s.lifecycle_state}`);
  console.log(`   Direction: ${s.direction || '?'}`);
  console.log("");
  console.log(`   ── W23F Entry Quality ─────────────────────`);
  console.log(`   provenance:        ${s.provenance || '<legacy>'}`);
  console.log(`   confluence_factors: ${JSON.stringify(s.confluence_factors)}`);
  console.log(`   min_factors_sat:   ${s.min_fs || '<n/a>'}`);
  console.log(`   source_claim_wr:   ${s.source_wr ?? 'null'}`);
  console.log(`   source_claim_avg_r:${s.source_r ?? 'null'}`);
  console.log("");
  console.log(`   ── Entry Logic ────────────────────────────`);
  console.log(`   entry_indicator:  ${s.entry_indicator || '?'}`);
  console.log(`   entry_long:       ${s.entry_long || '?'}`);
  console.log(`   entry_short:      ${s.entry_short || '?'}`);
  console.log(`   entry_params:     ${JSON.stringify(s.entry_params)}`);
  console.log(`   preferred_regime: ${s.regime || '?'}`);
  console.log("");
  console.log(`   ── Risk + Framework Overlay ──────────────`);
  console.log(`   exit_type:        ${s.exit_type || '?'}`);
  console.log(`   stop_loss_atr:    ${s.stop_atr || '?'}x ATR`);
  console.log(`   position_type:    ${s.pos_type || '?'}`);
  console.log(`   base_contracts:   ${s.base || '?'}`);
  console.log(`   tier_increment:   ${s.tier_inc || '?'}`);
  console.log(`   max_risk_pct:     ${s.max_risk_pct || '?'}`);
  console.log(`   personal_dll:     ${s.dll || '?'}`);
  console.log(`   time_stop:        ${JSON.stringify(s.time_stop) || '?'}`);

  // Quality assessment
  const issues = [];
  if (!s.entry_long || s.entry_long === "high < low") issues.push("entry_long is sentinel — strategy may not fire long");
  if (s.entry_short !== "high < low" && s.direction === "long") issues.push(`entry_short=${s.entry_short} but direction=long`);
  if (s.pos_type !== "risk_derived_pyramid" && s.pos_type !== "profit_tier_pyramid") issues.push(`position_size.type='${s.pos_type}' not canonical`);
  if (s.stop_atr && Number(s.stop_atr) < 1.0) issues.push(`stop_loss_atr=${s.stop_atr} below 1.0× floor`);
  if (s.stop_atr && Number(s.stop_atr) > 3.0) issues.push(`stop_loss_atr=${s.stop_atr} above 3.0× ceiling`);
  if (s.dll && Math.abs(Number(s.dll) - 0.67) > 0.05) issues.push(`personal_dll=${s.dll} drift from 0.67`);
  if (!s.time_stop) issues.push("time_stop missing — Wave 23 requires 15:55 ET hard flat");

  console.log("");
  if (issues.length === 0) {
    console.log("   ✅ AUDIT PASS — all W23F invariants intact");
  } else {
    console.log("   ⚠️  AUDIT ISSUES:");
    for (const i of issues) console.log(`      - ${i}`);
  }
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`\nValidation complete: ${new Date().toISOString()}`);
await sql.end();
