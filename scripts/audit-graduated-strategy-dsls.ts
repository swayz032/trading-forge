/**
 * Pass 21 — production-DSL audit. Walks every graduated_bucket strategy and
 * checks the config blob against the CLAUDE.md §4 framework checklist:
 *
 *   structural:
 *     metadata.source === 'graduated_bucket'
 *     direction is 'long' | 'short' (NOT 'both')
 *     entry_short is empty when direction='long' and vice versa
 *     exit_type === 'trailing_stop' (Style D normalized)
 *     stop_loss.type === 'atr' and 0.5 ≤ multiplier ≤ 5
 *
 *   Style D:
 *     exit_params.partial_at_r === 1
 *     exit_params.move_stop_to === 'BE+1tick'
 *     exit_params.trail.{type,atr_period,multiplier} === chandelier/14/2
 *     time_stop.{type, flat_at} === hard_flatten / 15:55 ET
 *
 *   position sizing:
 *     position_size.type === 'profit_tier_pyramid'
 *     base_contracts ≥ 1
 *     tier_increment ≥ 1
 *     tier_threshold_dollars > 0
 *     max_contracts ≥ base_contracts
 *     personal_dll_pct ≈ 0.67
 *
 *   gates:
 *     regime_gate.enabled === true
 *     session_filter.enabled === true and session === 'RTH_ONLY'
 *
 *   no template holes:
 *     strategy.exit prose does NOT match /\bN\/?A\b|\{\{|<[A-Z_]+>/
 *     entry_long is non-empty when direction='long'
 *
 * Reports each strategy's defect list. Exit 0 even if defects found (audit only).
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

interface CheckResult { name: string; defects: string[]; warnings: string[] }

function audit(s: { name: string; symbol: string; config: any }): CheckResult {
  const defects: string[] = [];
  const warnings: string[] = [];
  const c = s.config ?? {};

  // metadata
  if (c?.metadata?.source !== "graduated_bucket") {
    defects.push(`metadata.source = ${JSON.stringify(c?.metadata?.source)} (expected 'graduated_bucket')`);
  }

  // direction
  const dir = c.direction;
  if (dir !== "long" && dir !== "short") {
    defects.push(`direction = ${JSON.stringify(dir)} (expected 'long' or 'short', never 'both')`);
  }
  const elong = String(c.strategy?.entry_long ?? "");
  const eshort = String(c.strategy?.entry_short ?? "");
  if (dir === "long" && elong.trim().length === 0) {
    defects.push(`direction='long' but entry_long is empty`);
  }
  if (dir === "long" && eshort.trim().length > 0) {
    warnings.push(`direction='long' but entry_short is non-empty (${eshort.length} chars)`);
  }
  if (dir === "short" && eshort.trim().length === 0) {
    defects.push(`direction='short' but entry_short is empty`);
  }

  // exit_type — should be normalized to trailing_stop
  if (c.exit_type !== "trailing_stop") {
    defects.push(`exit_type = ${JSON.stringify(c.exit_type)} (framework expects trailing_stop after overlay)`);
  }

  // stop loss
  const sl = c.strategy?.stop_loss;
  if (!sl || sl.type !== "atr") {
    defects.push(`stop_loss.type = ${JSON.stringify(sl?.type)} (expected 'atr' — fixed-point stops forbidden per CLAUDE.md §13)`);
  } else if (typeof sl.multiplier !== "number" || sl.multiplier < 0.5 || sl.multiplier > 5) {
    defects.push(`stop_loss.multiplier = ${sl.multiplier} (expected 0.5–5)`);
  }

  // Style D exit_params
  const ep = c.exit_params ?? {};
  if (ep.partial_at_r !== 1) defects.push(`exit_params.partial_at_r = ${ep.partial_at_r} (expected 1)`);
  if (ep.move_stop_to !== "BE+1tick") defects.push(`exit_params.move_stop_to = ${JSON.stringify(ep.move_stop_to)} (expected 'BE+1tick')`);
  const trail = ep.trail ?? {};
  if (trail.type !== "chandelier") defects.push(`exit_params.trail.type = ${JSON.stringify(trail.type)} (expected 'chandelier')`);
  if (trail.atr_period !== 14) defects.push(`exit_params.trail.atr_period = ${trail.atr_period} (expected 14)`);
  if (trail.multiplier !== 2) defects.push(`exit_params.trail.multiplier = ${trail.multiplier} (expected 2)`);

  // time_stop
  const ts = c.time_stop ?? {};
  if (ts.type !== "hard_flatten") defects.push(`time_stop.type = ${JSON.stringify(ts.type)} (expected 'hard_flatten')`);
  if (ts.flat_at !== "15:55 ET") defects.push(`time_stop.flat_at = ${JSON.stringify(ts.flat_at)} (expected '15:55 ET')`);

  // position sizing
  const ps = c.strategy?.position_size ?? {};
  if (ps.type !== "profit_tier_pyramid") defects.push(`position_size.type = ${JSON.stringify(ps.type)} (expected 'profit_tier_pyramid')`);
  if (typeof ps.base_contracts !== "number" || ps.base_contracts < 1) defects.push(`position_size.base_contracts = ${ps.base_contracts}`);
  if (typeof ps.tier_increment !== "number" || ps.tier_increment < 1) defects.push(`position_size.tier_increment = ${ps.tier_increment}`);
  if (typeof ps.tier_threshold_dollars !== "number" || ps.tier_threshold_dollars <= 0) defects.push(`position_size.tier_threshold_dollars = ${ps.tier_threshold_dollars}`);
  if (typeof ps.max_contracts !== "number" || ps.max_contracts < (ps.base_contracts ?? 1)) defects.push(`position_size.max_contracts = ${ps.max_contracts}`);
  if (typeof ps.personal_dll_pct !== "number" || Math.abs(ps.personal_dll_pct - 0.67) > 0.001) {
    defects.push(`position_size.personal_dll_pct = ${ps.personal_dll_pct} (expected 0.67)`);
  }

  // gates
  if (c.regime_gate?.enabled !== true) defects.push(`regime_gate.enabled = ${c.regime_gate?.enabled}`);
  if (c.session_filter?.enabled !== true || c.session_filter?.session !== "RTH_ONLY") {
    defects.push(`session_filter = ${JSON.stringify(c.session_filter)} (expected enabled+RTH_ONLY)`);
  }

  // template holes
  const exitProse = String(c.strategy?.exit ?? "");
  if (/\bN\/?A\b|\{\{|<[A-Z_]+>/i.test(exitProse)) {
    defects.push(`strategy.exit prose contains template hole: "${exitProse.slice(0, 80)}"`);
  }
  if (exitProse.length === 0) {
    warnings.push("strategy.exit prose is empty (overlay should have populated it)");
  }

  // entry_type basic sanity
  if (c.entry_type === "unknown" || !c.entry_type) {
    warnings.push(`entry_type = ${JSON.stringify(c.entry_type)} (vague — concept didn't map to a known archetype)`);
  }

  // indicators
  const inds = c.strategy?.indicators ?? [];
  if (!Array.isArray(inds) || inds.length === 0) {
    defects.push("strategy.indicators is empty (need at least 1 entry indicator)");
  }

  return { name: s.name, defects, warnings };
}

async function main() {
  const rows = await sql<Array<{ name: string; symbol: string; config: any }>>`
    SELECT name, symbol, config FROM strategies WHERE source = 'graduated_bucket' ORDER BY created_at ASC
  `;
  console.log(`Auditing ${rows.length} graduated strategies\n`);
  let cleanCount = 0;
  let defectCount = 0;
  let totalDefects = 0;
  const summary = new Map<string, number>();

  for (const r of rows) {
    const res = audit(r);
    if (res.defects.length === 0 && res.warnings.length === 0) {
      cleanCount++;
      console.log(`✓  ${r.name}  — clean`);
      continue;
    }
    if (res.defects.length > 0) {
      defectCount++;
      totalDefects += res.defects.length;
      console.log(`✗  ${r.name}`);
      for (const d of res.defects) {
        console.log(`     defect : ${d}`);
        const key = d.split(" = ")[0].split(" ")[0];
        summary.set(key, (summary.get(key) ?? 0) + 1);
      }
    } else {
      console.log(`~  ${r.name}  — clean (warnings only)`);
    }
    for (const w of res.warnings) {
      console.log(`     warn   : ${w}`);
      const key = w.split(" = ")[0].split(" ")[0];
      summary.set(`warn:${key}`, (summary.get(`warn:${key}`) ?? 0) + 1);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Clean: ${cleanCount} / ${rows.length}`);
  console.log(`With defects: ${defectCount} / ${rows.length}`);
  console.log(`Total defect lines: ${totalDefects}`);
  console.log(`\n=== Defect frequency (most-common-first) ===`);
  const sorted = [...summary.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, n] of sorted) console.log(`  ${n.toString().padStart(3)}  ${key}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
