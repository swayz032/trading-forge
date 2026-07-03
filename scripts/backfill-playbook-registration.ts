/**
 * backfill-playbook-registration.ts — Band B2 follow-up (2026-07-02)
 *
 * Scans every existing `strategies` row and reports which are UNREGISTERED
 * in playbook_router.py's ALL_STRATS — i.e. whose past AND future Mode A/B
 * research runs are silently missing the 7-layer confluence overlay, per the
 * apply_eligibility_gate() unregistered-strategy bypass (verified deep-scan
 * finding, honesty-fixed this session in src/engine/backtester.py).
 *
 * Dry-run by default (reports only, mutates nothing). --apply registers
 * every UNREGISTERED row's exact name into its derived category — the
 * operator decides whether to run --apply, because registering ~100
 * pre-existing strategies changes research-run semantics for the existing
 * library (previously-unfiltered runs will start seeing the overlay).
 *
 * Usage:
 *   npx tsx scripts/backfill-playbook-registration.ts                 # dry run (default)
 *   npx tsx scripts/backfill-playbook-registration.ts --apply          # writes to playbook_router.py
 *   npx tsx scripts/backfill-playbook-registration.ts --playbook-router <path>
 *
 * This script does NOT import direct-bucket-graduator.ts or agent-service.ts
 * (no Gate 1/2/DSL-critic dependency here — this is a pure registration scan,
 * not a strategy-creation path) — it is unaffected by the circular-import
 * fragility documented in docs/spec-onboarding-runbook.md / spec-onboarding-
 * service.ts, and runs standalone with no special handling required.
 */
import { resolve } from "node:path";
import { db } from "../src/server/db/index.js";
import { strategies } from "../src/server/db/schema.js";
import {
  readAllRegisteredNames,
  registerStrategiesInPlaybook,
} from "../src/server/lib/playbook-registration.js";
import {
  classifyStrategyForBackfill,
  type StrategyRowForBackfill,
  type BackfillClassification,
} from "../src/server/lib/playbook-registration-backfill.js";

function parseArgs(argv: string[]) {
  const get = (flag: string): string | null => {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx + 1 >= argv.length) return null;
    return argv[idx + 1];
  };
  return {
    apply: argv.includes("--apply"),
    playbookRouterPath: get("--playbook-router") ?? resolve(process.cwd(), "src/engine/context/playbook_router.py"),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`${args.apply ? "APPLY" : "DRY RUN"}: playbook-registration backfill scan`);
  console.log(`playbook_router.py: ${args.playbookRouterPath}`);

  const registeredNames = readAllRegisteredNames(args.playbookRouterPath);
  console.log(`Currently registered (union of all 4 categories): ${registeredNames.size} names\n`);

  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      symbol: strategies.symbol,
      source: strategies.source,
      lifecycleState: strategies.lifecycleState,
      config: strategies.config,
    })
    .from(strategies);

  const classifications: BackfillClassification[] = rows.map((row) =>
    classifyStrategyForBackfill(row as StrategyRowForBackfill, registeredNames),
  );

  const registered = classifications.filter((c) => c.status === "registered");
  const unregistered = classifications.filter((c) => c.status === "unregistered");
  const unresolvable = classifications.filter((c) => c.status === "unresolvable");

  console.log(`Total strategies scanned: ${classifications.length}`);
  console.log(`  registered:    ${registered.length}`);
  console.log(`  unregistered:  ${unregistered.length}`);
  console.log(`  unresolvable:  ${unresolvable.length}\n`);

  if (unresolvable.length > 0) {
    console.log("UNRESOLVABLE (surfaced, not decided — manual review required):");
    for (const c of unresolvable) {
      console.log(`  ${c.id}: reason=${c.reason}`);
    }
    console.log("");
  }

  console.log("UNREGISTERED (would register into the listed category with --apply):");
  for (const c of unregistered) {
    console.log(
      `  ${c.id}: name=${c.name} symbol=${c.symbol ?? "?"} lifecycle=${c.lifecycleState ?? "?"} ` +
        `archetype=${c.archetypeKey ?? "none"} -> ${c.proposedCategory}`,
    );
  }

  if (!args.apply) {
    console.log(
      `\nDRY RUN complete. ${unregistered.length} strategies would be registered. ` +
        `Re-run with --apply to write playbook_router.py (operator decision — this changes research-run ` +
        `semantics for the existing library; previously-unfiltered runs will start seeing the overlay).`,
    );
    return 0;
  }

  console.log(`\nAPPLY: registering ${unregistered.length} strategies...`);
  const byCategory = new Map<string, string[]>();
  for (const c of unregistered) {
    if (!c.proposedCategory) continue;
    const list = byCategory.get(c.proposedCategory) ?? [];
    list.push(c.name);
    byCategory.set(c.proposedCategory, list);
  }

  let totalAdded = 0;
  let anyFailed = false;
  for (const [category, names] of byCategory) {
    const result = registerStrategiesInPlaybook(args.playbookRouterPath, names, category as never);
    if (!result.ok) {
      console.error(`  FAILED registering into ${category}: ${result.reason}`);
      anyFailed = true;
      continue;
    }
    console.log(`  ${category}: added ${result.added.length}, already-present ${result.alreadyPresent.length}`);
    totalAdded += result.added.length;
  }

  console.log(`\nAPPLY complete. ${totalAdded} strategy names added to playbook_router.py.`);
  return anyFailed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("backfill-playbook-registration.ts fatal error:", err);
    process.exit(1);
  });
