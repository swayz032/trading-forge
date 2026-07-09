/**
 * fade-the-losers.ts — Wave B CLI (2026-07-03)
 *
 * Selects the fadeable cohort from `strategy_graveyard` (proven DIRECTIONAL
 * losers with statistical significance + a performance-failure death) and, in
 * --apply mode, creates each inversion as a NEW CANDIDATE through the SAME
 * unchanged gate ladder every other strategy walks (fade-the-losers-service.ts).
 *
 * DRY RUN IS THE DEFAULT — reports the cohort + planned inversions per strategy
 * and writes NOTHING. Pass --apply to create them.
 *
 * Usage (invoked with the .env preloaded by node, NOT dotenv):
 *   node --env-file=.env --import tsx scripts/fade-the-losers.ts                 # dry run (default)
 *   node --env-file=.env --import tsx scripts/fade-the-losers.ts --apply         # writes to DB
 *   node --env-file=.env --import tsx scripts/fade-the-losers.ts --min-trades 50
 *   node --env-file=.env --import tsx scripts/fade-the-losers.ts --apply --limit 5
 *   node --env-file=.env --import tsx scripts/fade-the-losers.ts --apply --with-dsl-critic
 *
 * FLAG NAMING NOTE (same hazard as onboard-compiled-specs.ts): this CLI
 * transitively loads `duckdb`, whose @mapbox/node-pre-gyp binding loader parses
 * the FULL process.argv through `nopt` (configDefs: help/arch/debug/directory/
 * proxy/loglevel/acl). Never name a flag as a prefix of those. `--min-trades`,
 * `--limit`, `--apply`, `--playbook-router` are all safe.
 *
 * Exit code: 0 always in dry-run; in --apply, 1 if ANY planned fade ended in a
 * gate rejection / registration failure (signals a silent no-op to the operator).
 */
import { resolve } from "node:path";
import {
  runFadeTheLosers,
  type RunFadeResult,
} from "../src/server/services/fade-the-losers-service.js";

interface Args {
  apply: boolean;
  minTrades: number | undefined;
  limit: number | undefined;
  playbookRouterPath: string;
  withDslCritic: boolean;
}

function parseArgs(argv: string[]): Args {
  const getNum = (flag: string): number | undefined => {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx + 1 >= argv.length) return undefined;
    const n = Number(argv[idx + 1]);
    return Number.isFinite(n) ? n : undefined;
  };
  const getStr = (flag: string, def: string): string => {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx + 1 >= argv.length) return def;
    return argv[idx + 1];
  };
  return {
    apply: argv.includes("--apply"),
    minTrades: getNum("--min-trades"),
    limit: getNum("--limit"),
    playbookRouterPath: getStr(
      "--playbook-router",
      resolve(process.cwd(), "src/engine/context/playbook_router.py"),
    ),
    withDslCritic: argv.includes("--with-dsl-critic"),
  };
}

function report(result: RunFadeResult, args: Args): void {
  console.log(
    `${result.dryRun ? "DRY RUN" : "APPLY"}: scanned ${result.scanned} graveyard row(s), ` +
      `${result.cohortSize} fadeable, ${result.skipped.length} skipped`,
  );
  if (result.dryRun) {
    console.log("(pass --apply to create the faded CANDIDATEs; this run computes + reports only)\n");
  }

  // Skip tally by reason.
  const skipTally = new Map<string, number>();
  for (const s of result.skipped) skipTally.set(s.reason, (skipTally.get(s.reason) ?? 0) + 1);
  if (skipTally.size > 0) {
    console.log("Skipped (by reason):");
    for (const [reason, count] of skipTally) console.log(`  ${reason}: ${count}`);
    console.log("");
  }

  console.log(`Planned inversions (${result.created.length}):`);
  for (const c of result.created) {
    const origin = c.originalId ?? "(no strategy row)";
    const detail = c.reason ? ` (${c.reason})` : c.strategyId ? ` -> ${c.strategyId}` : "";
    console.log(
      `  ${c.symbol}  ${c.originalName} -> ${c.fadeName || "(no name)"}  [${c.status}]${detail}  origin=${origin}`,
    );
  }
}

function exitCode(result: RunFadeResult): number {
  if (result.dryRun) return 0;
  // skipped_invert = the inverter refused a member the cohort selector accepted
  // (a real classifier/inverter disagreement worth surfacing) — treat as a
  // failure alongside gate rejections so an apply-mode no-op is never silent.
  // skipped_duplicate is benign (per-run dedupe) and does NOT fail the run.
  const failed = result.created.some(
    (c) =>
      c.status === "rejected_gate1" ||
      c.status === "rejected_auditor" ||
      c.status === "rejected_dsl_critic" ||
      c.status === "registration_failed" ||
      c.status === "skipped_invert",
  );
  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const result = await runFadeTheLosers({
    dryRun: !args.apply,
    minTrades: args.minTrades,
    limit: args.limit,
    playbookRouterPath: args.playbookRouterPath,
    // Batch CLI skips the live LLM critic by default (keeps a large cohort from
    // making N network calls); the auditor + Gate 1/2 (deterministic) still gate.
    skipDslCritic: !args.withDslCritic,
  });

  report(result, args);
  return exitCode(result);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("fade-the-losers.ts fatal error:", err);
    process.exit(1);
  });
