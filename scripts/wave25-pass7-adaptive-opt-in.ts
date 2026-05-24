/**
 * Wave 25 Pass 7 — Adaptive Exit Engine Opt-In (SCAFFOLD-ONLY)
 *
 * ⚠️  IMPORTANT — SCAFFOLD-ONLY, NO LIVE EFFECT UNTIL WAVE 25.5  ⚠️
 *
 * This script flips `strategies.exit_plan_config.exit_style` from
 * "static_styleC" → "adaptive" on selected strategies.
 *
 * BUT THE LIVE SIGNAL FLOW DOES NOT YET CONSUME THIS FLAG. Pass 7 shipped
 * the adaptive engine + scaffold + tests; the 3 wiring gaps remain open
 * and are scheduled for Wave 25.5:
 *
 *   Gap A — `paper-signal-service.ts` does NOT yet call
 *           `computeExitPlan()` at position-open. A new
 *           `paper_positions.exit_plan JSONB` column (migration 0145
 *           proposed) will persist the per-position plan.
 *
 *   Gap B — `backtester._apply_trade_management()` does NOT yet branch
 *           on `exit_engine="adaptive"`. The TS→Python liquidity
 *           transport contract is still pending operator decision
 *           (recommendation: snapshot via existing risk-sizing.ts pattern
 *           at run launch).
 *
 *   Gap C — `updatePositionPrices()` does NOT yet execute runner trails
 *           by `trail_method`. Per-position AVWAP state (running
 *           ΣP·V/ΣV from entry) + structure-trail swing tracker are
 *           pending.
 *
 * Until Wave 25.5 ships:
 *   - Strategies with `exit_style="adaptive"` continue to execute Style C
 *     33/33/34 in both live paper and backtest paths.
 *   - The `exit_plan_config` JSONB is written but is data-only — no
 *     consumer in the trade-management loop.
 *   - This is intentional. Pass 7 closes contract-safely as scaffold.
 *
 * What this script DOES today:
 *   - Writes `exit_plan_config.exit_style = "adaptive"` on selected rows
 *   - Writes an audit_log row per mutation
 *   - Dry-run by default; `--apply` mutates
 *
 * What this script DOES NOT do today:
 *   - Change live exit behavior (Wave 25.5 wiring is the trigger)
 *   - Override Style C in backtests (Wave 25.5 backtester branching is the trigger)
 *   - Run runner trails by trail_method (Wave 25.5 updatePositionPrices branching)
 *
 * Recommended operator action: leave all strategies on default
 * `static_styleC` until Wave 25.5 closes the wiring. Use this script
 * ONLY after Wave 25.5 ships, when adaptive becomes a real production
 * switch rather than a data-only flag.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/wave25-pass7-adaptive-opt-in.ts          # dry-run
 *   npx tsx -r dotenv/config scripts/wave25-pass7-adaptive-opt-in.ts --apply  # mutate
 *
 * Backward-compat:
 *   - Only touches strategies where `exit_plan_config.exit_style` is
 *     missing OR "static_styleC". Never reverts an opted-in strategy.
 *   - Skips PAPER + DEPLOYED strategies by default — only CANDIDATE /
 *     TESTING are eligible for scaffold-only flip-up. Operator must
 *     explicitly pass `--include-live` to touch PAPER/DEPLOYED (which
 *     is anyway a no-op until Wave 25.5).
 *
 * Out of scope:
 *   - Does not modify entry_quality blocks
 *   - Does not change confluence weights / threshold
 *   - Does not auto-promote graduated → TESTING / PAPER
 *   - Does not run any adaptive engine computation
 */
import { db } from "../src/server/db/index.js";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { sql, eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const INCLUDE_LIVE = process.argv.includes("--include-live");
const FIX_REF = "wave26-cohort-opt-in";

// --strategy <name_fragment>: restrict opt-in to strategies whose name CONTAINS this fragment
// Wave 26 Group B: cohort discipline — only silver_bullet this pass
const STRATEGY_FILTER: string | null = (() => {
  const idx = process.argv.indexOf("--strategy");
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1]! : null;
})();

type ExitPlanConfig = {
  exit_style?: "adaptive" | "static_styleC";
  [k: string]: unknown;
};

async function main(): Promise<void> {
  console.log("Wave 25 Pass 7 — adaptive exit engine opt-in (SCAFFOLD-ONLY)");
  console.log(`Mode: ${APPLY ? "APPLY (will mutate)" : "DRY-RUN (no mutations)"}`);
  console.log(`Lifecycle scope: ${INCLUDE_LIVE ? "ALL (incl. PAPER/DEPLOYED)" : "CANDIDATE + TESTING only"}`);
  console.log();
  console.log("⚠️  SCAFFOLD-ONLY: exit_style flip has NO LIVE EFFECT until Wave 25.5 ships.");
  console.log("    Live paper + backtest paths continue to execute Style C 33/33/34.");
  if (STRATEGY_FILTER) {
    console.log(`Strategy filter: --strategy ${STRATEGY_FILTER}  (cohort discipline — only matching strategies opted in)`);
  }
  console.log();

  // Pre-flight: confirm migration 0144 has been applied.
  const colCheck = await db.execute(
    sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'strategies' AND column_name = 'exit_plan_config'`,
  );
  // postgres.js driver returns rows as the direct array; node-postgres wraps in {rows:[]}
  const colRows = Array.isArray(colCheck) ? colCheck : ((colCheck as { rows?: unknown[] }).rows ?? []);
  const present = colRows.length > 0;
  if (!present) {
    console.error("❌ Migration 0144_strategies_adaptive_exits.sql NOT applied to this DB.");
    console.error("   Missing column on strategies: exit_plan_config");
    console.error("   Apply the migration first (boot-migration runner or 'npm run db:migrate') and re-run.");
    process.exit(2);
  }

  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      lifecycleState: strategies.lifecycleState,
      exitPlanConfig: strategies.exitPlanConfig,
    })
    .from(strategies);

  let scanned = 0;
  let eligible = 0;
  let updated = 0;
  let skippedAlreadyAdaptive = 0;
  let skippedLifecycle = 0;

  for (const row of rows) {
    scanned++;
    const cfg = (row.exitPlanConfig as ExitPlanConfig | null) ?? {};
    const currentStyle = cfg.exit_style ?? "static_styleC";

    if (currentStyle === "adaptive") {
      skippedAlreadyAdaptive++;
      continue;
    }

    // Cohort filter: --strategy <fragment> restricts to matching names only
    if (STRATEGY_FILTER && !String(row.name ?? "").toLowerCase().includes(STRATEGY_FILTER.toLowerCase())) {
      continue;
    }

    const lifecycle = String(row.lifecycleState ?? "").toUpperCase();
    const isLive = lifecycle === "PAPER" || lifecycle === "DEPLOYED" || lifecycle === "PILOT" || lifecycle === "DEPLOY_READY";
    if (isLive && !INCLUDE_LIVE) {
      skippedLifecycle++;
      continue;
    }

    eligible++;
    console.log(
      `[${row.lifecycleState}] ${row.name}  exit_style: ${currentStyle} → adaptive  (NOTE: no live effect until Wave 25.5)`,
    );

    if (!APPLY) continue;

    const newCfg: ExitPlanConfig = { ...cfg, exit_style: "adaptive" };

    await db
      .update(strategies)
      .set({ exitPlanConfig: newCfg as never } as never)
      .where(eq(strategies.id, row.id));

    await db.insert(auditLog).values({
      action: "strategy.wave26_cohort_opt_in",
      entityType: "strategy",
      entityId: row.id,
      decisionAuthority: "system",
      status: "success",
      result: {
        name: row.name,
        lifecycle_state: row.lifecycleState,
        prior_exit_style: currentStyle,
        new_exit_style: "adaptive",
        cohort: "silver_bullet",
        applied_by: "wave26_dispatch",
        wave: "wave26_group_b",
        fix_ref: FIX_REF,
        note:
          "Wave 26 cohort opt-in: silver_bullet strategy opts into adaptive exits. " +
          "Wave 25.5 wiring is LIVE — adaptive engine is active for this strategy.",
      } as Record<string, unknown>,
    });

    updated++;
  }

  console.log();
  console.log("=== Summary ===");
  console.log(`Scanned:                          ${scanned}`);
  console.log(`Eligible (would flip):            ${eligible}`);
  console.log(`Already adaptive (skipped):       ${skippedAlreadyAdaptive}`);
  console.log(`Skipped (PAPER/DEPLOYED scope):   ${skippedLifecycle}${INCLUDE_LIVE ? " (--include-live overrides this)" : " (use --include-live to include)"}`);
  console.log(`Updated:                          ${updated}${APPLY ? "" : " (dry-run — pass --apply to mutate)"}`);
  console.log();
  console.log("Reminder: exit_style=\"adaptive\" is a data-only flag until Wave 25.5 ships.");

  await db.execute(sql`SELECT 1`);
  process.exit(0);
}

main().catch((err) => {
  console.error("wave25-pass7-adaptive-opt-in failed:", err);
  process.exit(1);
});
