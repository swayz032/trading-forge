/**
 * onboard-compiled-specs.ts — Band B CLI (spec-onboarding-bridge, 2026-07-02)
 *
 * Onboards a directory of *.spec.json artifacts (+ optional manifest.json)
 * produced by the certified compiler into production `strategies` rows via
 * spec-onboarding-service.ts. Designed against the LIVE 40-video re-extraction
 * batch's expected output shape — takes a directory, not hardcoded filenames.
 *
 * Usage:
 *   npx tsx scripts/onboard-compiled-specs.ts --specs-dir <path>                  # dry run (default)
 *   npx tsx scripts/onboard-compiled-specs.ts --specs-dir <path> --apply          # writes to DB
 *   npx tsx scripts/onboard-compiled-specs.ts --specs-dir <path> --manifest <path.json>
 *   npx tsx scripts/onboard-compiled-specs.ts --specs-dir <path> --timeframe 15m
 *
 * FLAG NAMING NOTE: this CLI dynamically imports spec-onboarding-service.ts,
 * which (via direct-bucket-graduator.ts / agent-service.ts) transitively
 * loads `duckdb`. duckdb's `@mapbox/node-pre-gyp` binding loader parses the
 * FULL `process.argv` through `nopt` with its own configDefs (`help, arch,
 * debug, directory, proxy, loglevel, acl`) and shorthand `-C = --directory`.
 * `nopt` abbreviation-matches unrecognized long flags against known ones —
 * a flag named `--dir` was silently expanded to node-pre-gyp's own
 * `--directory`, corrupting its `package_json_path` lookup
 * (`path.join(opts.directory, package_json_path)` against an already-
 * absolute path). Verified this session. Never name a CLI flag here as a
 * prefix of `help`/`arch`/`debug`/`directory`/`proxy`/`loglevel`/`acl` —
 * hence `--specs-dir`, not `--dir`.
 *
 * Exit code: 0 if every spec produced at least one non-rejected row (inserted,
 * skipped_duplicate, or dry_run_planned); 1 if ANY spec had zero successful
 * per-symbol outcomes (all rows rejected/failed) — signals the operator that
 * a spec silently produced nothing.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  onboardSpecArtifact,
  type OnboardSpecResult,
} from "../src/server/services/spec-onboarding-service.js";

interface Args {
  dir: string;
  manifest: string | null;
  apply: boolean;
  timeframe: string;
  playbookRouterPath: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, def: string | null = null): string | null => {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx + 1 >= argv.length) return def;
    return argv[idx + 1];
  };
  return {
    dir: get("--specs-dir") ?? "tmp/generalization",
    manifest: get("--manifest"),
    apply: argv.includes("--apply"),
    timeframe: get("--timeframe") ?? "5m",
    playbookRouterPath: get("--playbook-router") ?? resolve(process.cwd(), "src/engine/context/playbook_router.py"),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(process.cwd(), args.dir);
  if (!existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    return 1;
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".spec.json"));
  if (files.length === 0) {
    console.error(`No *.spec.json files found in ${dir}`);
    return 1;
  }

  let manifestData: Record<string, unknown> | null = null;
  if (args.manifest) {
    const manifestPath = resolve(process.cwd(), args.manifest);
    if (existsSync(manifestPath)) {
      manifestData = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } else {
      console.warn(`Manifest not found (continuing without it): ${manifestPath}`);
    }
  }

  console.log(`${args.apply ? "APPLY" : "DRY RUN"}: onboarding ${files.length} spec artifact(s) from ${dir}`);
  if (!args.apply) {
    console.log("(pass --apply to write to the database; this run computes + reports only)");
  }

  const results: OnboardSpecResult[] = [];
  let mappedCount = 0;
  let queuedCount = 0;
  let zeroSuccessSpecs = 0;

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    if (manifestData && typeof raw === "object" && raw !== null && !("pipeline_version" in raw)) {
      const pv = (manifestData as Record<string, unknown>).pipeline_version;
      if (typeof pv === "string") (raw as Record<string, unknown>).pipeline_version = pv;
    }

    const result = await onboardSpecArtifact(raw, {
      dryRun: !args.apply,
      timeframe: args.timeframe,
      playbookRouterPath: args.playbookRouterPath,
      // Batch CLI runs skip the live LLM critic by default to keep a 40-video
      // batch from making 40+ network calls to Ollama/OpenAI on every run;
      // the auditor + Gate 1/2/3 (deterministic, no LLM) still fully gate.
      // Set --with-dsl-critic to opt in.
      skipDslCritic: !process.argv.includes("--with-dsl-critic"),
    });
    results.push(result);

    if (!result.ok) {
      console.log(`  REJECTED (malformed artifact): ${file} — ${result.reason}`);
      zeroSuccessSpecs++;
      continue;
    }

    const matched = result.archetypeMatch?.matched ?? false;
    if (matched) mappedCount++;
    else queuedCount++;

    const successCount = result.perSymbol.filter(
      (p) => p.status === "inserted" || p.status === "dry_run_planned" || p.status === "skipped_duplicate",
    ).length;
    if (successCount === 0) zeroSuccessSpecs++;

    console.log(
      `  ${file}: concept="${result.conceptName}" archetype=${matched ? result.archetypeMatch?.archetypeKey : "UNMAPPED->needs_archetype_queue"} ` +
        `factors=[${result.confluenceFactors?.join(",")}]`,
    );
    for (const p of result.perSymbol) {
      console.log(`    ${p.symbol}: ${p.status}${p.reason ? ` (${p.reason})` : ""} name=${p.strategyName}`);
    }
  }

  console.log(
    `\nSummary: ${files.length} specs, ${mappedCount} archetype-mapped, ${queuedCount} needs_archetype_queue, ` +
      `${zeroSuccessSpecs} spec(s) with ZERO successful rows`,
  );

  return zeroSuccessSpecs > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("onboard-compiled-specs.ts fatal error:", err);
    process.exit(1);
  });
