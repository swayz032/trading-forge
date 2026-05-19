/**
 * Wave 23 — production-DSL audit. Walks every graduated_bucket strategy and
 * checks the config blob against the CLAUDE.md §4 framework checklist.
 *
 * Wave 23 changes (W23G.1 — 2026-05-19):
 *   - Accepts direction ∈ {long, short, both}. When 'both', REQUIRES non-empty
 *     entry_long AND entry_short.
 *   - Accepts position_size.type ∈ {risk_derived_pyramid, profit_tier_pyramid}.
 *     risk_derived_pyramid (Wave 23 canonical) MUST NOT have max_contracts baked
 *     at graduation — it is computed at signal-time per CLAUDE.md §4.
 *     profit_tier_pyramid (Wave 22 legacy) still requires max_contracts ≥ base.
 *   - Accepts Style C exit_params (tp1_at_r=1, tp2_at_r=2, runner_trail object
 *     with type/period/multiplier) as well as legacy Style D exit_params
 *     (partial_at_r=1, move_stop_to='BE+1tick', trail.type=chandelier/14/2).
 *     Style C is detected by exit_params.style==='c' OR partials[] present.
 *     Style D is detected by exit_params.trail.type==='chandelier' without style.
 *
 *   structural:
 *     metadata.source === 'graduated_bucket'
 *     direction ∈ {'long', 'short', 'both'}
 *     entry_long non-empty when direction ∈ {'long', 'both'}
 *     entry_short non-empty when direction ∈ {'short', 'both'}
 *     exit_type === 'trailing_stop'
 *     stop_loss.type === 'atr' and 0.5 ≤ multiplier ≤ 5
 *
 *   exit params — Style C (Wave 23 canonical):
 *     exit_params.style === 'c'
 *     exit_params.tp1_at_r === 1  OR  exit_params.partial_at_r === 1
 *     exit_params.tp2_at_r === 2  OR  exit_params.partials[1].at_r === 2
 *     exit_params.runner.trail_fallback.{type,atr_period,multiplier} === chandelier/14/2
 *       OR exit_params.trail.{type,atr_period,multiplier} === chandelier/14/2
 *
 *   exit params — Style D (Wave 22 legacy, still accepted):
 *     exit_params.partial_at_r === 1
 *     exit_params.move_stop_to === 'BE+1tick'
 *     exit_params.trail.{type,atr_period,multiplier} === chandelier/14/2
 *
 *   time_stop:
 *     time_stop.{type, flat_at} === hard_flatten / 15:55 ET
 *
 *   position sizing (risk_derived_pyramid — Wave 23 canonical):
 *     position_size.type === 'risk_derived_pyramid'
 *     base_contracts ≥ 1
 *     tier_increment ≥ 1
 *     tier_threshold_dollars > 0
 *     max_contracts MUST be absent (computed at signal-time, never baked)
 *     personal_dll_pct ≈ 0.67
 *
 *   position sizing (profit_tier_pyramid — Wave 22 legacy):
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
 *     entry_long is non-empty when direction='long' or 'both'
 *
 * Reports each strategy's defect list. Exit 0 even if defects found (audit only).
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

export interface CheckResult { name: string; defects: string[]; warnings: string[] }

/** Detect Style C exit_params shape (Wave 23 canonical). */
function isStyleC(ep: Record<string, any>): boolean {
  return (
    ep.style === "c" ||
    (Array.isArray(ep.partials) && ep.partials.length >= 2) ||
    (typeof ep.tp1_at_r === "number") ||
    (typeof ep.tp2_at_r === "number")
  );
}

/** Detect Style D exit_params shape (Wave 22 legacy). */
function isStyleD(ep: Record<string, any>): boolean {
  const trail = ep.trail ?? {};
  return (
    ep.partial_at_r === 1 &&
    ep.move_stop_to === "BE+1tick" &&
    trail.type === "chandelier"
  );
}

export function audit(s: { name: string; symbol: string; config: any }): CheckResult {
  const defects: string[] = [];
  const warnings: string[] = [];
  const c = s.config ?? {};

  // metadata
  if (c?.metadata?.source !== "graduated_bucket") {
    defects.push(`metadata.source = ${JSON.stringify(c?.metadata?.source)} (expected 'graduated_bucket')`);
  }

  // direction — Wave 23 accepts long | short | both
  const dir = c.direction;
  if (dir !== "long" && dir !== "short" && dir !== "both") {
    defects.push(`direction = ${JSON.stringify(dir)} (expected 'long', 'short', or 'both')`);
  }
  const elong = String(c.strategy?.entry_long ?? "");
  const eshort = String(c.strategy?.entry_short ?? "");
  if ((dir === "long" || dir === "both") && elong.trim().length === 0) {
    defects.push(`direction='${dir}' but entry_long is empty`);
  }
  if ((dir === "short" || dir === "both") && eshort.trim().length === 0) {
    defects.push(`direction='${dir}' but entry_short is empty`);
  }
  // warn (not defect) if single-direction strategy has extra entry text
  if (dir === "long" && eshort.trim().length > 0) {
    warnings.push(`direction='long' but entry_short is non-empty (${eshort.length} chars)`);
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

  // exit_params — accept Style C (Wave 23) or legacy Style D (Wave 22)
  const ep = c.exit_params ?? {};
  const styleC = isStyleC(ep);
  const styleD = isStyleD(ep);

  if (!styleC && !styleD) {
    // Neither style recognized — check common missing fields to give useful error
    defects.push(
      `exit_params not recognized as Style C (tp1_at_r/partials/style='c') or Style D (partial_at_r=1 + move_stop_to='BE+1tick' + trail.type='chandelier'). ` +
      `Got: ${JSON.stringify(ep).slice(0, 120)}`
    );
  } else if (styleC) {
    // Style C validation — check runner trail fallback
    const runner = ep.runner ?? {};
    const trailFallback = runner.trail_fallback ?? ep.trail ?? {};
    if (trailFallback.type !== "chandelier") {
      defects.push(`exit_params Style C: runner trail_fallback.type = ${JSON.stringify(trailFallback.type)} (expected 'chandelier')`);
    }
    if (trailFallback.atr_period !== 14) {
      defects.push(`exit_params Style C: runner trail_fallback.atr_period = ${trailFallback.atr_period} (expected 14)`);
    }
    if (trailFallback.multiplier !== 2 && trailFallback.multiplier !== 2.0) {
      defects.push(`exit_params Style C: runner trail_fallback.multiplier = ${trailFallback.multiplier} (expected 2)`);
    }
    // tp1 check — style C stores in partials[0].at_r or tp1_at_r or partial_at_r
    const tp1 = ep.tp1_at_r ?? ep.partials?.[0]?.at_r ?? ep.partial_at_r;
    if (tp1 !== 1 && tp1 !== 1.0) {
      defects.push(`exit_params Style C: tp1_at_r = ${tp1} (expected 1)`);
    }
    // tp2 check — style C stores in partials[1].at_r or tp2_at_r
    const tp2 = ep.tp2_at_r ?? ep.partials?.[1]?.at_r;
    if (tp2 !== 2 && tp2 !== 2.0) {
      defects.push(`exit_params Style C: tp2_at_r = ${tp2} (expected 2)`);
    }
  } else {
    // Style D validation (legacy)
    if (ep.partial_at_r !== 1) defects.push(`exit_params.partial_at_r = ${ep.partial_at_r} (expected 1)`);
    if (ep.move_stop_to !== "BE+1tick") defects.push(`exit_params.move_stop_to = ${JSON.stringify(ep.move_stop_to)} (expected 'BE+1tick')`);
    const trail = ep.trail ?? {};
    if (trail.type !== "chandelier") defects.push(`exit_params.trail.type = ${JSON.stringify(trail.type)} (expected 'chandelier')`);
    if (trail.atr_period !== 14) defects.push(`exit_params.trail.atr_period = ${trail.atr_period} (expected 14)`);
    if (trail.multiplier !== 2) defects.push(`exit_params.trail.multiplier = ${trail.multiplier} (expected 2)`);
  }

  // time_stop
  const ts = c.time_stop ?? {};
  if (ts.type !== "hard_flatten") defects.push(`time_stop.type = ${JSON.stringify(ts.type)} (expected 'hard_flatten')`);
  if (ts.flat_at !== "15:55 ET") defects.push(`time_stop.flat_at = ${JSON.stringify(ts.flat_at)} (expected '15:55 ET')`);

  // position sizing
  const ps = c.strategy?.position_size ?? {};
  const psType = ps.type;

  if (psType !== "risk_derived_pyramid" && psType !== "profit_tier_pyramid") {
    defects.push(`position_size.type = ${JSON.stringify(psType)} (expected 'risk_derived_pyramid' or 'profit_tier_pyramid')`);
  } else {
    // Fields common to both pyramid types
    if (typeof ps.base_contracts !== "number" || ps.base_contracts < 1) {
      defects.push(`position_size.base_contracts = ${ps.base_contracts}`);
    }
    if (typeof ps.tier_increment !== "number" || ps.tier_increment < 1) {
      defects.push(`position_size.tier_increment = ${ps.tier_increment}`);
    }
    if (typeof ps.tier_threshold_dollars !== "number" || ps.tier_threshold_dollars <= 0) {
      defects.push(`position_size.tier_threshold_dollars = ${ps.tier_threshold_dollars}`);
    }
    if (typeof ps.personal_dll_pct !== "number" || Math.abs(ps.personal_dll_pct - 0.67) > 0.001) {
      defects.push(`position_size.personal_dll_pct = ${ps.personal_dll_pct} (expected 0.67)`);
    }

    if (psType === "risk_derived_pyramid") {
      // Wave 23 canonical: max_contracts MUST be absent (computed at signal-time)
      // Presence of a baked max_contracts is a defect per CLAUDE.md §4
      if ("max_contracts" in ps) {
        defects.push(`position_size.max_contracts = ${ps.max_contracts} must be absent for risk_derived_pyramid (computed at signal-time per CLAUDE.md §4)`);
      }
    } else {
      // profit_tier_pyramid (Wave 22 legacy): max_contracts required
      if (typeof ps.max_contracts !== "number" || ps.max_contracts < (ps.base_contracts ?? 1)) {
        defects.push(`position_size.max_contracts = ${ps.max_contracts} (legacy profit_tier_pyramid requires max_contracts ≥ base_contracts)`);
      }
    }
  }

  // gates
  if (c.regime_gate?.enabled !== true) defects.push(`regime_gate.enabled = ${c.regime_gate?.enabled}`);
  if (c.session_filter?.enabled !== true || c.session_filter?.session !== "RTH_ONLY") {
    defects.push(`session_filter = ${JSON.stringify(c.session_filter)} (expected enabled+RTH_ONLY)`);
  }

  // template holes — strategy.exit is the compiled grammar sentinel ("high < low")
  // or prose; check it does not still contain LLM template artifacts
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
