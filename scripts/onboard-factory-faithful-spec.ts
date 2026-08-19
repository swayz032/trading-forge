/**
 * Receipt-gated onboarding for Strategy Factory survivors.
 *
 * This is deliberately NOT a second semantic onboarding implementation. Python owns the
 * Factory/certificate/source identity verification; this thin TypeScript bridge verifies the
 * exact spec bytes did not change after that check, then calls the existing onboardSpecArtifact
 * service unchanged.
 *
 * Usage:
 *   npx tsx scripts/onboard-factory-faithful-spec.ts --spec <x.spec.json> --receipt <x.factory-handoff.json>
 *   npx tsx scripts/onboard-factory-faithful-spec.ts --spec ... --receipt ... --apply
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { onboardSpecArtifact } from "../src/server/services/spec-onboarding-service.js";

interface Args {
  spec: string;
  receipt: string;
  apply: boolean;
  timeframe?: string;
  playbookRouterPath: string;
  skipDslCritic: boolean;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
}

function parseArgs(argv: string[]): Args {
  const spec = valueAfter(argv, "--spec");
  const receipt = valueAfter(argv, "--receipt");
  if (!spec || !receipt) {
    throw new Error("--spec and --receipt are required");
  }
  return {
    spec: resolve(process.cwd(), spec),
    receipt: resolve(process.cwd(), receipt),
    apply: argv.includes("--apply"),
    timeframe: valueAfter(argv, "--timeframe"),
    playbookRouterPath:
      valueAfter(argv, "--playbook-router") ??
      resolve(process.cwd(), "src/engine/context/playbook_router.py"),
    skipDslCritic: argv.includes("--skip-dsl-critic"),
  };
}

interface VerifiedHandoff {
  status: string;
  video_id: string;
  strategy_index: number;
  spec_id: string;
  spec_file_sha256: string;
  spec_hash: string;
  handoff_identity_sha256: string;
  source_mode: string;
}

function verifyFactoryHandoff(args: Args): VerifiedHandoff {
  const verifier = resolve(process.cwd(), "scripts/strategy_factory_verify_handoff.py");
  const proc = spawnSync(
    "python",
    [verifier, "--receipt", args.receipt, "--spec", args.spec],
    { cwd: process.cwd(), encoding: "utf-8" },
  );
  if (proc.error) {
    throw new Error(`factory_handoff_verifier_spawn_failed: ${proc.error.message}`);
  }
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  if (proc.status !== 0) {
    throw new Error(
      `factory_handoff_refused: exit=${proc.status} stdout=${stdout.trim()} stderr=${stderr.trim()}`,
    );
  }
  let parsed: VerifiedHandoff;
  try {
    parsed = JSON.parse(stdout) as VerifiedHandoff;
  } catch (err) {
    throw new Error(`factory_handoff_verifier_non_json: ${String(err)} stdout=${stdout}`);
  }
  if (parsed.status !== "VERIFIED_FACTORY_FAITHFUL_HANDOFF") {
    throw new Error(`factory_handoff_verifier_wrong_status: ${parsed.status}`);
  }
  if (parsed.source_mode !== "SOURCE_FAITHFUL") {
    throw new Error(`factory_handoff_source_mode_refused: ${parsed.source_mode}`);
  }
  return parsed;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // Verify the receipt/source/certificate/projection FIRST.
  const verified = verifyFactoryHandoff(args);

  // Then read the exact bytes that will be parsed by onboarding and re-hash them locally.
  // This closes the verifier->read TOCTOU window for a file changed between the Python return
  // and the TypeScript parse: the bytes we parse must still be the bytes Python approved.
  const specBytes = readFileSync(args.spec);
  const actualSha = createHash("sha256").update(specBytes).digest("hex");
  if (actualSha !== verified.spec_file_sha256) {
    throw new Error(
      `factory_spec_changed_after_verification: verified=${verified.spec_file_sha256} actual=${actualSha}`,
    );
  }
  const raw = JSON.parse(specBytes.toString("utf-8")) as Record<string, unknown>;
  if (raw.video !== verified.spec_id || raw.spec_hash !== verified.spec_hash) {
    throw new Error(
      `factory_spec_identity_changed_after_verification: video=${String(raw.video)} spec_hash=${String(raw.spec_hash)}`,
    );
  }

  const result = await onboardSpecArtifact(raw, {
    dryRun: !args.apply,
    timeframe: args.timeframe,
    playbookRouterPath: args.playbookRouterPath,
    skipDslCritic: args.skipDslCritic,
  });

  const successful = result.ok
    ? result.perSymbol.filter((p) =>
        p.status === "inserted" || p.status === "dry_run_planned" || p.status === "skipped_duplicate"
      ).length
    : 0;

  console.log(JSON.stringify({
    factory_handoff: verified,
    onboarding: result,
    apply: args.apply,
    successful_rows: successful,
  }, null, 2));

  return result.ok && successful > 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`FACTORY ONBOARD REFUSED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
