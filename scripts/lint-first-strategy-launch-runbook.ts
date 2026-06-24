/**
 * lint-first-strategy-launch-runbook.ts
 *
 * Smoke-test for docs/first-strategy-launch-runbook.md (Pass 4 Track D).
 * Verifies that the Path B / LIVE_ORDER_GATEWAY_URL canonical flip is
 * correctly documented and that legacy placeholder text has been scrubbed.
 *
 * Exit 0 on all checks pass; exit 1 with diagnostic messages on any failure.
 *
 * Usage:
 *   tsx scripts/lint-first-strategy-launch-runbook.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Use process.cwd() for Windows compatibility — tsx sets cwd to the project root
// when invoked as `tsx scripts/lint-*.ts`.
const RUNBOOK_PATH = resolve(
  process.cwd(),
  "docs/first-strategy-launch-runbook.md"
);

function readRunbook(): string {
  try {
    return readFileSync(RUNBOOK_PATH, "utf8");
  } catch (err) {
    console.error(`[FAIL] Cannot read runbook at ${RUNBOOK_PATH}: ${err}`);
    process.exit(1);
  }
}

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

function checkMinOccurrences(
  content: string,
  pattern: string,
  minCount: number,
  checkName: string
): CheckResult {
  const count = (content.split(pattern).length - 1);
  const passed = count >= minCount;
  return {
    name: checkName,
    passed,
    message: passed
      ? `OK — found ${count} occurrence(s) of "${pattern}" (required ≥${minCount})`
      : `FAIL — found ${count} occurrence(s) of "${pattern}" (required ≥${minCount})`,
  };
}

function checkAbsent(
  content: string,
  pattern: string,
  checkName: string
): CheckResult {
  const count = (content.split(pattern).length - 1);
  const passed = count === 0;
  return {
    name: checkName,
    passed,
    message: passed
      ? `OK — "${pattern}" not found in runbook (correctly absent)`
      : `FAIL — found ${count} occurrence(s) of "${pattern}" — this placeholder must be removed`,
  };
}

function checkContains(
  content: string,
  pattern: string,
  checkName: string
): CheckResult {
  const passed = content.includes(pattern);
  return {
    name: checkName,
    passed,
    message: passed
      ? `OK — found required text: "${pattern.slice(0, 80)}..."`
      : `FAIL — required text not found: "${pattern.slice(0, 80)}..."`,
  };
}

function main(): void {
  console.log(`Linting runbook: ${RUNBOOK_PATH}\n`);

  const content = readRunbook();
  const results: CheckResult[] = [];

  // Check 1: LIVE_ORDER_GATEWAY_URL mentioned at least 2 times
  results.push(
    checkMinOccurrences(
      content,
      "LIVE_ORDER_GATEWAY_URL",
      2,
      "LIVE_ORDER_GATEWAY_URL appears ≥2 times"
    )
  );

  // Check 2: Path A section has the "DO NOT use for new strategies" warning
  results.push(
    checkContains(
      content,
      "DO NOT use Path A for new strategies",
      "Path A 'DO NOT use for new strategies' warning present"
    )
  );

  // Check 3: Comparison table is present (all 7 rows must exist)
  results.push(
    checkContains(
      content,
      "| Webhook URL | per-strategy traderspost.io URL | `LIVE_ORDER_GATEWAY_URL`",
      "Path A vs Path B comparison table — Webhook URL row present"
    )
  );
  results.push(
    checkContains(
      content,
      "| Kill-switch | bypassed | enforced |",
      "Path A vs Path B comparison table — Kill-switch row present"
    )
  );
  results.push(
    checkContains(
      content,
      "| HMAC validation | not enforced | enforced via `LIVE_ORDER_HMAC_SECRET` |",
      "Path A vs Path B comparison table — HMAC validation row present"
    )
  );
  results.push(
    checkContains(
      content,
      "| Per-account routing | manual | via `account_strategy_assignments` |",
      "Path A vs Path B comparison table — Per-account routing row present"
    )
  );

  // Check 4: Runbook does NOT contain old `your-url-here` placeholder
  // (Pass 1 scrubbed it from TRADERSPOST_WEBHOOK_URL; ensure it did not creep back into the runbook)
  results.push(
    checkAbsent(
      content,
      "your-url-here",
      "Old 'your-url-here' placeholder absent from runbook"
    )
  );

  // Check 5: B.1a section with LIVE_ORDER_GATEWAY_URL setup present
  results.push(
    checkContains(
      content,
      "## B.1a Set LIVE_ORDER_GATEWAY_URL (one-time, before first deploy)",
      "B.1a 'Set LIVE_ORDER_GATEWAY_URL' section header present"
    )
  );

  // Check 6: Path B canonical recommendation is the primary instruction
  results.push(
    checkContains(
      content,
      "Path B (canonical, recommended)",
      "B.2.3 labels Path B as canonical/recommended"
    )
  );

  // Print results
  let allPassed = true;
  for (const result of results) {
    const prefix = result.passed ? "✔" : "✘";
    console.log(`  ${prefix} [${result.name}]`);
    console.log(`      ${result.message}`);
    if (!result.passed) {
      allPassed = false;
    }
  }

  console.log();
  if (allPassed) {
    console.log("All checks passed. Runbook lint OK.");
    process.exit(0);
  } else {
    const failCount = results.filter((r) => !r.passed).length;
    console.error(
      `${failCount} of ${results.length} checks FAILED. Fix the runbook before merging.`
    );
    process.exit(1);
  }
}

main();
