// E2E driver — fire 3 cycles, audit each + compare to n8n parallel activity
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });
const API = "http://127.0.0.1:4000";

async function fire(label) {
  console.log(`\n[${new Date().toISOString().slice(11,19)}] ↻ Firing ${label}…`);
  const r = await fetch(`${API}/api/admin/scout/run-autonomous-cycle`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const j = await r.json();
  console.log(`  trigger: ${j.status} | ${j.note}`);
}
async function wait(min) { await new Promise(r => setTimeout(r, min * 60000)); }

async function snapshot(label) {
  const cycles = await sql`SELECT result->>'cycle_index' AS idx, result->>'seeded_symbol' AS sym, created_at FROM audit_log WHERE action='scout_cycle.started' ORDER BY created_at DESC LIMIT 1`;
  const acts = await sql`SELECT action, COUNT(*)::int n FROM audit_log WHERE created_at > NOW() - INTERVAL '10 minutes' AND (action LIKE 'scout_%' OR action LIKE 'graduation.%' OR action LIKE 'pending_bucket.%') GROUP BY action ORDER BY n DESC LIMIT 8`;
  const strats = await sql`SELECT COUNT(*)::int n FROM strategies WHERE archived_at IS NULL`;
  console.log(`\n[${label}] strategies: ${strats[0].n} | last cycle: ${cycles[0]?.idx ?? '-'} ${cycles[0]?.sym ?? '-'}`);
  for (const a of acts) console.log(`  ${a.action.padEnd(40)} ${a.n}`);
}

console.log("=== E2E DRIVER: 3-cycle orchestration ===");
console.log(`Start: ${new Date().toISOString()}`);
await snapshot("PRE");

// Cycle 13
await fire("cycle 13 (MNQ rotation expected)");
await wait(8);
await snapshot("after cycle 13");

// Cycle 14
await fire("cycle 14 (MCL rotation expected)");
await wait(8);
await snapshot("after cycle 14");

// Cycle 15
await fire("cycle 15 (MES rotation expected)");
await wait(8);
await snapshot("after cycle 15");

console.log("\n\n=========================================");
console.log("=== COMPREHENSIVE E2E AUDIT ===");
console.log("=========================================");

// ── 1. Cycles fired ──
const cycles = await sql`SELECT created_at, result->>'cycle_index' AS idx, result->>'seeded_symbol' AS sym, result->>'query_count' AS qc FROM audit_log WHERE action='scout_cycle.started' AND created_at > NOW() - INTERVAL '40 minutes' ORDER BY created_at DESC`;
console.log("\n── Cycles fired in last 40 min ──");
for (const c of cycles) console.log(`  ${c.created_at.toISOString().slice(11,19)} | cycle ${c.idx} | seeded ${c.sym} | ${c.qc} queries`);

// ── 2. Full factory activity ──
console.log("\n── Factory activity (last 40 min) ──");
const acts = await sql`SELECT action, COUNT(*)::int n FROM audit_log WHERE created_at > NOW() - INTERVAL '40 minutes' AND (action LIKE 'scout_%' OR action LIKE 'pending_bucket.%' OR action LIKE 'graduation.%' OR action='strategy.cross_validated' OR action='llm.gpt5mini_call') GROUP BY action ORDER BY n DESC`;
for (const a of acts) console.log(`  ${a.action.padEnd(48)} ${a.n}`);

// ── 3. Bucket diversity ──
const buckets = await sql`SELECT market, concept_name, source_count, layer_coverage_json FROM strategy_pending_buckets WHERE first_seen_at > NOW() - INTERVAL '40 minutes' ORDER BY source_count DESC`;
const familyCount = { SMC_ICT:0, WYCKOFF:0, VP:0, ORDERFLOW:0, INDICATOR:0, MEAN_REVERT:0, SESSION:0, ORB:0, OTHER:0 };
const familyOfConcept = (cn) => {
  const c = (cn||'').toLowerCase();
  if (/order.block|liquidity.sweep|fair.value.gap|fvg|smc|smart.money|ict|breaker|judas|silver.bullet|mss|bos|choch|cisd|ote/.test(c)) return 'SMC_ICT';
  if (/wyckoff|spring|utad|accumulation|distribution/.test(c)) return 'WYCKOFF';
  if (/volume.profile|poc|vah|val|hvn|lvn/.test(c)) return 'VP';
  if (/order.flow|footprint|delta|cumulative/.test(c)) return 'ORDERFLOW';
  if (/macd|rsi|bollinger|keltner|stochastic|ichimoku|supertrend|donchian|atr|(^|_)ema/.test(c)) return 'INDICATOR';
  if (/mean.revert|z.score|range.trad/.test(c)) return 'MEAN_REVERT';
  if (/london.open|ny.open|asian.range|lunch.reversal/.test(c)) return 'SESSION';
  if (/orb|opening.range/.test(c)) return 'ORB';
  return 'OTHER';
};
console.log(`\n── NEW buckets (last 40 min): ${buckets.length} ──`);
for (const b of buckets) {
  const f = familyOfConcept(b.concept_name);
  familyCount[f]++;
  console.log(`  ${b.market} | ${(b.concept_name||'?').slice(0,52).padEnd(52)} | src=${b.source_count} | ${f}`);
}
console.log("\nFamily distribution:");
for (const [f, n] of Object.entries(familyCount)) console.log(`  ${f.padEnd(14)} ${n}`);

// ── 4. Graduations ──
const grads = await sql`SELECT created_at, result FROM audit_log WHERE action='graduation.entry_quality_attached' AND created_at > NOW() - INTERVAL '40 minutes' ORDER BY created_at DESC`;
console.log(`\n── Graduations (full W23F shape): ${grads.length} ──`);
for (const g of grads) console.log(`  ${g.created_at.toISOString().slice(11,19)} | ${JSON.stringify(g.result)}`);

// ── 5. Rejections ──
const rejs = await sql`SELECT action, COUNT(*)::int n FROM audit_log WHERE action LIKE 'graduation.rejected_%' AND created_at > NOW() - INTERVAL '40 minutes' GROUP BY action ORDER BY n DESC`;
console.log(`\n── Rejections by gate ──`);
for (const r of rejs) console.log(`  ${r.action.padEnd(48)} ${r.n}`);

// ── 6. Final strategy library ──
console.log("\n── Final library state ──");
const all = await sql`SELECT name, symbols, config->>'entry_indicator' AS ind, lifecycle_state, created_at FROM strategies WHERE archived_at IS NULL ORDER BY created_at DESC`;
console.log(`Total active strategies: ${all.length}`);
const fams = { ORB:0, INDICATOR:0, ORDERFLOW:0, SMC_ICT:0, WYCKOFF:0, OTHER:0 };
for (const s of all) {
  const ind = s.ind || '';
  let f = 'OTHER';
  if (/session_open_breakout|opening_range/.test(ind)) f = 'ORB';
  else if (/bollinger|keltner|macd|rsi|stochastic|donchian|atr|ema_cross|sma_cross|vwap|supertrend|ichimoku/.test(ind)) f = 'INDICATOR';
  else if (/cumulative_delta|order_flow|footprint/.test(ind)) f = 'ORDERFLOW';
  else if (/liquidity_sweep|order_block|fvg|breaker|silver_bullet|judas/.test(ind)) f = 'SMC_ICT';
  else if (/wyckoff/.test(ind)) f = 'WYCKOFF';
  fams[f]++;
  console.log(`  ${s.created_at.toISOString().slice(0,19)} | ${s.name.padEnd(48)} | ${JSON.stringify(s.symbols).padEnd(12)} | ${ind || '?'}`);
}
console.log("\nLibrary family distribution:");
for (const [f, n] of Object.entries(fams)) console.log(`  ${f.padEnd(14)} ${n}`);
const symCount = {};
for (const s of all) { const sym = s.symbols?.[0] ?? s.symbol; symCount[sym] = (symCount[sym]||0)+1; }
console.log("\nLibrary symbol distribution:");
for (const [sym, n] of Object.entries(symCount)) console.log(`  ${sym.padEnd(6)} ${n}`);

// ── 7. n8n workflow comparison ──
console.log("\n── n8n PARALLEL pipeline activity (same 40 min) ──");
const n8n = await sql`SELECT workflow_id, COUNT(*)::int n FROM n8n_execution_log WHERE created_at > NOW() - INTERVAL '40 minutes' GROUP BY workflow_id ORDER BY n DESC LIMIT 10`;
console.log(`n8n executions: ${n8n.length}`);
for (const w of n8n) console.log(`  ${w.workflow_id} : ${w.n}`);

console.log(`\nFinish: ${new Date().toISOString()}`);
await sql.end();
