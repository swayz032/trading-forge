/**
 * CI hard gate: Python and TypeScript must fingerprint the exact same
 * canonical stage rule book. A mismatch would otherwise reject every new MC
 * run as stale or, worse, allow a stage-only rule change to go unnoticed.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { FIRM_STAGE_RULES } from "../src/shared/firm-stage-rules.js";
import {
  computeFirmRulesVersion,
} from "../src/server/lib/firm-rules-version.js";

function canonicalJsonForDiagnostic(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = (value as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return value;
  });
}

const stageEnvelope = { FIRM_STAGE_RULES };
const tsCanonical = canonicalJsonForDiagnostic(stageEnvelope);
const tsHash = computeFirmRulesVersion();
const tsHashSelfCheck = createHash("sha256")
  .update(tsCanonical, "utf8")
  .digest("hex")
  .slice(0, 16);

if (tsHash !== tsHashSelfCheck) {
  console.error(
    `[FIRM RULES PARITY GATE] FAIL — internal TS regression: ${tsHash} != ${tsHashSelfCheck}.`,
  );
  process.exit(1);
}

const pythonScript = `
import json, sys
sys.path.insert(0, '.')
from src.engine.firm_rules_version import compute_firm_rules_version, _canonical_json
try:
    from src.engine.firm_stage_rules import FIRM_STAGE_RULES
    canonical = _canonical_json({"FIRM_STAGE_RULES": FIRM_STAGE_RULES})
except Exception:
    # Keeps the gate's intentional drift-test stub diagnostic-friendly.
    canonical = ""
print(json.dumps({"hash": compute_firm_rules_version(), "canonical": canonical}))
`;

const result = spawnSync("python", ["-c", pythonScript], {
  cwd: process.cwd(),
  encoding: "utf-8",
  timeout: 30_000,
});

if (result.status !== 0) {
  console.error("[FIRM RULES PARITY GATE] FAIL — Python subprocess failed:");
  console.error(result.stderr || "<empty stderr>");
  process.exit(1);
}

let pythonOut: { hash: string; canonical: string };
try {
  pythonOut = JSON.parse(result.stdout.trim()) as { hash: string; canonical: string };
} catch {
  console.error("[FIRM RULES PARITY GATE] FAIL — could not parse Python JSON output:");
  console.error(result.stdout);
  process.exit(1);
}

if (tsHash === pythonOut.hash) {
  console.log(
    `[FIRM RULES PARITY GATE] PASS — TS and Python stage-rule versions match (${tsHash}).`,
  );
  process.exit(0);
}

console.error("[FIRM RULES PARITY GATE] FAIL — firm rules version drift detected");
console.error(`  TS hash:      ${tsHash}`);
console.error(`  Python hash:  ${pythonOut.hash}`);
console.error("  TS canonical JSON (sorted keys, no whitespace):");
console.error(`    ${tsCanonical}`);
console.error("  Python canonical JSON (sorted keys, no whitespace):");
console.error(`    ${pythonOut.canonical}`);
console.error(
  "Fix: update src/shared/firm-stage-rules.json or one of its loaders; do not add a second rule mirror.",
);
process.exit(1);
