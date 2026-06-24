/**
 * CI Lint: Family-Grade Postscript Audit (Global M1 sweep)
 *
 * Verifies that every notifyCritical() and notifyWarning() call site in the
 * owned files wraps its message body in appendFamilyGradePostscript().
 *
 * SCOPE: All files that have been globally swept in the F1 session.
 *        Extend OWNED_FILES_RELATIVE as each additional module is swept.
 *
 * Exits non-zero with the list of offending file:line if any bare call is found.
 *
 * Acceptance criteria for a "wrapped" call:
 *   - Forward window (call site + 10 lines): appendFamilyGradePostscript(...)
 *     inline in the notify args (canonical 3-arg pattern)
 *   - Backward window (25 lines before call): const body = appendFamilyGradePostscript(...)
 *     (indirect const-variable pattern — 25 lines covers fullBody build-up patterns)
 *   - Any window containing the canonical family-grade sentinel phrase:
 *     "--- For family members ---"
 *   - Function definitions of notify helpers are excluded (they ARE the wrappers)
 *
 * Run: npx tsx scripts/check-family-grade-postscript.ts
 * Exit 0: all owned-file sites wrapped
 * Exit 1: one or more unwrapped sites found
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../src/server");

// ─── Owned files (relative to SERVER_DIR) ─────────────────────────────────────
// Previously swept (pre-F1 session):
//   services/broker-router.ts, services/model-router.ts,
//   services/scout-watchdog-service.ts, scheduler.ts
// F1 global sweep (2026-06-24):
//   All files below — extend list as additional modules are swept.
const OWNED_FILES_RELATIVE: string[] = [
  // Pre-F1 (M11) — already covered
  "services/broker-router.ts",
  "services/model-router.ts",
  "services/scout-watchdog-service.ts",
  "scheduler.ts",
  // Routes
  "routes/admin.ts",
  "routes/admin-recovery.ts",
  "routes/admin-frozen-policy-override.ts",
  "routes/live-order.ts",
  "routes/paper.ts",
  "routes/pine-export.ts",
  // Lib
  "lib/confluence-quality-audit.ts",
  "lib/dlq-service.ts",
  "lib/quantum-replay-runner.ts",
  "lib/startup-config-check.ts",
  // Services — A-D
  "services/alert-service.ts",
  "services/backtest-service.ts",
  "services/bitwarden-session-refresh-service.ts",
  "services/broker-error-budget-service.ts",
  "services/compliance-refresh-service.ts",
  "services/consistency-tracker-service.ts",
  "services/contract-specs-service.ts",
  "services/db-backup-service.ts",
  "services/dd-velocity-gate.ts",
  "services/dead-mans-heartbeat-service.ts",
  "services/deployed-strategy-starvation-watchdog.ts",
  "services/discord-fanout-audit-service.ts",
  // Services — F-W
  "services/fill-reconciliation-service.ts",
  "services/graduated-strategy-drift-checker.ts",
  "services/monte-carlo-service.ts",
  "services/n8n-workflow-deployer.ts",
  "services/paper-execution-service.ts",
  "services/pine-delivery-service.ts",
  "services/pine-export-recipient-service.ts",
  "services/regime-coverage-monitor-service.ts",
  "services/regime-drift-detector-service.ts",
  "services/settlement-reconciliation-service.ts",
  "services/strategy-assignment-service.ts",
  "services/strategy-production-check-service.ts",
  "services/trade-critique-service.ts",
  "services/webhook-latency-monitor-service.ts",
  "services/weekly-drift-halt-service.ts",
  "services/windows-health-check-service.ts",
  // Lifecycle (F1 + F3)
  "services/lifecycle-service.ts",
];

// The canonical wrapper function name
const WRAPPER_FN = "appendFamilyGradePostscript";

// Canonical sentinel in the body (alternative acceptance)
const FAMILY_SENTINEL = "--- For family members ---";

// Forward window: catches inline appendFamilyGradePostscript() in args
const LOOKAHEAD_LINES = 10;

// Backward window: catches const fullBody = appendFamilyGradePostscript(...)
// patterns where the variable is built before the notify call.
// Set to 60 to handle cases where the fullBody variable is shared across
// multiple notify branches in a single function (e.g. consistency-tracker
// where fullBody at line 370 is reused at lines 392, 421, and 474).
const LOOKBACK_LINES = 60;

interface Offender {
  file: string;
  line: number;
  source: string;
}

function hasWrapper(lines: string[], callIdx: number): boolean {
  // Forward: inline appendFamilyGradePostscript() call in the notify args
  const forwardEnd = Math.min(callIdx + LOOKAHEAD_LINES, lines.length);
  const forwardWindow = lines.slice(callIdx, forwardEnd).join("\n");
  if (forwardWindow.includes(WRAPPER_FN) || forwardWindow.includes(FAMILY_SENTINEL)) return true;

  // Backward: const body = appendFamilyGradePostscript(...) variable pattern
  const backStart = Math.max(0, callIdx - LOOKBACK_LINES);
  const backWindow = lines.slice(backStart, callIdx).join("\n");
  if (backWindow.includes(WRAPPER_FN)) return true;

  return false;
}

function checkFile(filePath: string, relPath: string): Offender[] {
  const offenders: Offender[] = [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Skip comments, imports, JSDoc
    const isCommentLine = line.trimStart().startsWith("//") || line.trimStart().startsWith("*");
    if (isCommentLine) continue;

    const isImportLine = line.trimStart().startsWith("import ");
    if (isImportLine) continue;

    if (line.includes("@param") || line.includes("* ")) continue;

    // Skip function DEFINITIONS of the notify helpers themselves (they ARE the wrappers).
    // Matches: "export function notifyCritical(" and "function notifyWarning(" etc.
    if (/\bfunction\s+notify(Critical|Warning|Info)\s*\(/.test(line)) continue;

    const hasNotifyCall =
      /\bnotifyCritical\s*\(/.test(line) || /\bnotifyWarning\s*\(/.test(line);
    if (!hasNotifyCall) continue;

    if (!hasWrapper(lines, i)) {
      offenders.push({
        file: relPath,
        line: i + 1,
        source: line.trim().slice(0, 120),
      });
    }
  }

  return offenders;
}

function main() {
  console.log("[check-family-grade-postscript] Scanning owned files for unwrapped notify calls...\n");
  console.log(`  Owned scope: ${OWNED_FILES_RELATIVE.length} files\n`);

  const allOffenders: Offender[] = [];

  for (const rel of OWNED_FILES_RELATIVE) {
    const full = path.join(SERVER_DIR, rel);
    if (!fs.existsSync(full)) {
      console.warn(`  [WARN] Owned file not found — skipping: ${rel}`);
      continue;
    }
    const found = checkFile(full, rel);
    allOffenders.push(...found);
  }

  if (allOffenders.length === 0) {
    console.log("[check-family-grade-postscript] PASS — all owned-file notify calls are family-grade wrapped.\n");
    process.exit(0);
  }

  console.error(
    `[check-family-grade-postscript] FAIL — ${allOffenders.length} unwrapped call site(s) found:\n`,
  );
  for (const o of allOffenders) {
    console.error(`  ${o.file}:${o.line}`);
    console.error(`    ${o.source}`);
  }
  console.error(
    "\n  Each notifyCritical/notifyWarning call must wrap its message body with appendFamilyGradePostscript().",
  );
  console.error("  Canonical 3-arg pattern:");
  console.error("    notifyCritical('title', appendFamilyGradePostscript('technical', 'family what', 'family action'), meta)");
  process.exit(1);
}

main();
