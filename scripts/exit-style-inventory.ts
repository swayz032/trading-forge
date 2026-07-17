/**
 * exit-style-inventory.ts — campaign W4#2 (2026-07-17)
 *
 * READ-ONLY inventory of every strategy's exit style + lifecycle state.
 * Answers: which strategies run adaptive vs static_styleC, and where they
 * sit in the lifecycle — so the operator can see the adaptive cohort at a
 * glance without touching the DB.
 *
 * DELIBERATELY has NO --apply pathway (CLAUDE.md §13: never auto-expand the
 * adaptive cohort; opt-in is scripts/wave25-pass7-adaptive-opt-in.ts --apply,
 * operator-run, cohort-disciplined). This script only SELECTs and prints.
 *
 * Run: npx tsx scripts/exit-style-inventory.ts
 */
import "../src/server/load-env.js"; // side-effect: loads .env BEFORE db reads DATABASE_URL
import { db } from "../src/server/db/index.js";
import { strategies } from "../src/server/db/schema.js";

type ExitPlanConfig = {
  exit_style?: "adaptive" | "static_styleC";
  [k: string]: unknown;
};

async function main(): Promise<void> {
  console.log("Exit-style inventory (READ-ONLY — no mutations, no --apply pathway)");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log();

  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      lifecycleState: strategies.lifecycleState,
      exitPlanConfig: strategies.exitPlanConfig,
    })
    .from(strategies);

  const byStyle: Record<string, number> = {};
  const byStyleAndState: Record<string, Record<string, number>> = {};
  const adaptiveRows: { name: string; state: string }[] = [];

  for (const row of rows) {
    const cfg = (row.exitPlanConfig as ExitPlanConfig | null) ?? {};
    // Absent/undeclared exit_style = static_styleC (the live default per CLAUDE.md §4).
    const style = cfg.exit_style ?? "static_styleC(default-absent)";
    const state = row.lifecycleState ?? "UNKNOWN";
    byStyle[style] = (byStyle[style] ?? 0) + 1;
    byStyleAndState[style] ??= {};
    byStyleAndState[style][state] = (byStyleAndState[style][state] ?? 0) + 1;
    if (style === "adaptive") adaptiveRows.push({ name: row.name ?? row.id, state });
  }

  console.log(`Total strategies: ${rows.length}`);
  console.log();
  console.log("By exit style:");
  for (const [style, n] of Object.entries(byStyle).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${style.padEnd(30)} ${n}`);
    const states = byStyleAndState[style]!;
    for (const [state, sn] of Object.entries(states).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${state.padEnd(26)} ${sn}`);
    }
  }
  console.log();
  if (adaptiveRows.length > 0) {
    console.log("Adaptive cohort (explicit opt-ins):");
    for (const r of adaptiveRows) console.log(`  [${r.state}] ${r.name}`);
  } else {
    console.log("Adaptive cohort: EMPTY — every strategy runs static_styleC.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("exit-style-inventory failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
