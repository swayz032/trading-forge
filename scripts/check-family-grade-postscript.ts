/**
 * CI Lint: Family-Grade Postscript Audit (M1 sweep scope)
 *
 * Verifies that every notifyCritical() and notifyWarning() call site in the
 * M11+M1 owned files wraps its message body in appendFamilyGradePostscript().
 *
 * SCOPE: M11+M1 owned files only (broker-router, model-router,
 *        scout-watchdog-service, scheduler). The remaining ~73 legacy sites
 *        in src/server/ are future work (a dedicated "global M1 audit" session).
 *        Widen the OWNED_FILES list as each module is swept.
 *
 * Exits non-zero with the list of offending file:line if any bare call is found.
 *
 * Acceptance criteria for a "wrapped" call:
 *   - Forward window (call site + 10 lines): appendFamilyGradePostscript(...)
 *     inline in the notify args (canonical 3-arg pattern)
 *   - Backward window (10 lines before call): const body = appendFamilyGradePostscript(...)
 *     (indirect const-variable pattern)
 *   - Any window containing the canonical family-grade sentinel phrase:
 *     "--- For family members ---"
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

// ─── M11+M1 owned files (relative to SERVER_DIR) ─────────────────────────────
// Extend this list as additional modules get the family-grade postscript sweep.
const OWNED_FILES_RELATIVE: string[] = [
  "services/broker-router.ts",
  "services/model-router.ts",
  "services/scout-watchdog-service.ts",
  "scheduler.ts",
];

// The canonical wrapper function name
const WRAPPER_FN = "appendFamilyGradePostscript";

// Canonical sentinel in the body (alternative acceptance)
const FAMILY_SENTINEL = "--- For family members ---";

const LOOKAHEAD_LINES = 10;
const LOOKBACK_LINES = 10;

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
  console.log("[check-family-grade-postscript] Scanning M11+M1 owned files for unwrapped notify calls...\n");
  console.log(`  Owned scope: ${OWNED_FILES_RELATIVE.join(", ")}\n`);

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
    console.log("[check-family-grade-postscript] PASS — all M11+M1 owned file notify calls are family-grade wrapped.\n");
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
