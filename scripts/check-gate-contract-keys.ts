/**
 * check:gate-contract-keys — deep-scan Paper F-1 (persisting HIGH, flagged across 3 audits).
 *
 * The promotion hard gates read their inputs from JSONB blobs by string key:
 *   - walk_forward_metadata.wfe_overall / .pbo_overall   (wfe-gate / pbo-gate)
 *   - monte_carlo probability_of_ruin_ci.ci_high          (b14-ci-gate)
 *   - backtests.bif                                        (bif-gate)
 * A gate that reads a key which the producer has renamed gets `undefined` → the gate's legacy
 * fallback → a SILENT grandfather-PASS, with NO existing test failing. This is exactly the
 * producer→consumer silent-drift class that has bitten this project repeatedly.
 *
 * This gate pins the contract: each canonical key MUST appear in BOTH its Python producer and its TS
 * gate consumer. A rename on either side drops the key here → CI fails LOUDLY, surfacing the drift
 * before it can silently disable a promotion gate on live-capital decisions.
 *
 * Run: `node node_modules/tsx/dist/cli.mjs scripts/check-gate-contract-keys.ts`
 */
import { readFileSync } from "node:fs";

interface Contract {
  key: string;
  producer: string;
  consumer: string;
}

const CONTRACT: Contract[] = [
  { key: "wfe_overall", producer: "src/engine/walk_forward.py", consumer: "src/server/lib/wfe-gate.ts" },
  { key: "pbo_overall", producer: "src/engine/walk_forward.py", consumer: "src/server/lib/pbo-gate.ts" },
  { key: "probability_of_ruin_ci", producer: "src/engine/mc_confidence.py", consumer: "src/server/lib/b14-ci-gate.ts" },
  { key: "bif", producer: "src/engine/statistics/backtest_inflation_factor.py", consumer: "src/server/lib/bif-gate.ts" },
  // deep-scan #22 fix #7: 3 additional surfaces that were live gate-input contracts but unpinned.
  // B15 Parameter Robustness Battery — lifecycle-service.ts reads `b15.passed` off the
  // `backtests.b15Battery` JSONB (PAPER → DEPLOY_READY, ~lifecycle-service.ts:5838). The
  // producer emits the "passed" field directly (parameter_jitter_battery.py:563); the
  // wrapping key name is "b15_battery" (backtester.py:8334), pinned via the comment usage
  // of that literal in both files.
  { key: "passed", producer: "src/engine/parameter_jitter_battery.py", consumer: "src/server/services/lifecycle-service.ts" },
  // Frozen-policy SHA-256 contract — lifecycle-service.ts reads `strategies.frozenPolicyHash`
  // (frozen_policy_hash column) at the PAPER → DEPLOY_READY drift gate. Producer is the hash
  // computation module that stamps the column.
  { key: "frozen_policy_hash", producer: "src/server/lib/frozen-policy-contract.ts", consumer: "src/server/services/lifecycle-service.ts" },
  // BIF gate companion metric — effective trial count used to compute expected inflation
  // (sqrt(2*ln(k_eff))). Same producer/consumer pairing as the `bif` entry above.
  { key: "k_eff", producer: "src/engine/statistics/backtest_inflation_factor.py", consumer: "src/server/lib/bif-gate.ts" },
];

const problems: string[] = [];

function has(file: string, key: string): boolean | null {
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    return null; // file missing
  }
  const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  return re.test(src);
}

for (const { key, producer, consumer } of CONTRACT) {
  for (const [role, file] of [
    ["producer", producer],
    ["consumer", consumer],
  ] as const) {
    const present = has(file, key);
    if (present === null) {
      problems.push(`  [${key}] ${role} file missing: ${file}`);
    } else if (!present) {
      problems.push(
        `  [${key}] NOT found in ${role} ${file} — gate-input JSONB key renamed on one side; the ` +
          `${key} promotion gate would silently grandfather-PASS every strategy.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(
    `[check-gate-contract-keys] BROKEN CONTRACT — ${problems.length} canonical gate key(s) out of sync:\n` +
      problems.join("\n") +
      `\n\nRe-align the producer + consumer for each key (or update this contract if a rename is intentional).`,
  );
  process.exit(1);
}

console.log(
  `[check-gate-contract-keys] CLEAN — ${CONTRACT.length} gate-contract key(s) present in both producer + consumer.`,
);
