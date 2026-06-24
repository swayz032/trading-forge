/**
 * check-ts-python-firm-rules-version.ts — 2026-06-23 hardening/phase-0
 *
 * M4 CI HARD GATE: Asserts that the TypeScript and Python implementations of
 * `compute_firm_rules_version` produce identical SHA-256 fingerprints over the
 * live FIRM_CONFIGS + FIRM_RULES snapshots embedded in each side.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * src/server/lib/firm-rules-version.ts hardcodes a TS-side mirror of
 * src/engine/firm_config.py (FIRM_RULES) + src/engine/prop_compliance.py
 * (FIRM_CONFIGS).  The TS hash is stamped onto every new backtest row at INSERT
 * (backtests.firm_rules_version).  monte-carlo-service.ts then compares the
 * stored TS hash against the CURRENT Python hash before running MC — mismatch
 * raises monte_carlo.firm_rule_version_mismatch CRITICAL and REFUSES the run.
 *
 * If the TS and Python mirrors silently drift (someone edits firm_config.py
 * but not firm-rules-version.ts, or vice versa), then EVERY MC run forever
 * fires the mismatch alert.  That false-positive flood drowns the real
 * drift-detection signal the system was designed to surface.
 *
 * This script catches the drift at PR time, not at runtime.
 *
 * EXIT CODES
 *   0 — TS hash == Python hash (parity intact)
 *   1 — drift detected, OR Python subprocess failed
 *
 * USAGE
 *   npx tsx scripts/check-ts-python-firm-rules-version.ts
 *   npm run check:ts-python-firm-rules-version
 *
 * The diagnostic on failure prints BOTH hashes and BOTH canonical JSON inputs
 * (TS-side computed via canonicalJson(); Python-side via json.dumps(sort_keys=
 * True, separators=(',', ':'))) so the developer can spot which key/value
 * differs without re-running anything.
 *
 * PATTERN: mirrors scripts/check-ts-python-tier1-parity.ts (Tier-1 event parity
 * gate from 2026-06-22 hardening — operator's canonical CI-gate idiom).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  computeFirmRulesVersion,
  FIRM_CONFIGS_TS,
  FIRM_RULES_TS,
} from "../src/server/lib/firm-rules-version.js";

// ─── Step 1: compute the TS-side hash + canonical JSON ───────────────────────

const tsHash = computeFirmRulesVersion();

// Re-derive canonical JSON for diagnostic emission. Mirrors the algorithm in
// firm-rules-version.ts::canonicalJson() — sorted keys, no whitespace.
function canonicalJsonForDiagnostic(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}

const tsCanonical = canonicalJsonForDiagnostic({
  FIRM_CONFIGS: FIRM_CONFIGS_TS,
  FIRM_RULES: FIRM_RULES_TS,
});

// Sanity self-check: the TS hash function must produce the same hash a naive
// sha256 of the canonical JSON would. This catches an internal regression in
// firm-rules-version.ts's helper before we blame Python for any drift.
const tsHashSelfCheck = createHash("sha256")
  .update(tsCanonical, "utf8")
  .digest("hex")
  .slice(0, 16);

if (tsHash !== tsHashSelfCheck) {
  console.error(
    `[FIRM RULES PARITY GATE] FAIL — internal TS regression: computeFirmRulesVersion() returned ${tsHash} but a fresh sha256 over the same canonical JSON returns ${tsHashSelfCheck}. Inspect src/server/lib/firm-rules-version.ts::canonicalJson before chasing Python drift.`,
  );
  process.exit(1);
}

// ─── Step 2: spawn Python and read its hash + canonical JSON ─────────────────

// Use a heredoc-style script. Both `compute_firm_rules_version()` and the
// re-derivation of the canonical JSON are imported from the engine module so we
// hash exactly what the engine code hashes — not a re-implementation here.
const pythonScript = `
import json, sys
sys.path.insert(0, '.')
from src.engine.firm_rules_version import compute_firm_rules_version, _canonical_json
from src.engine.firm_config import FIRM_RULES
from src.engine.prop_compliance import FIRM_CONFIGS

# The combined dict matches compute_firm_rules_version()'s internal layout.
combined = {"FIRM_CONFIGS": FIRM_CONFIGS, "FIRM_RULES": FIRM_RULES}
out = {
    "hash": compute_firm_rules_version(),
    "canonical": _canonical_json(combined),
}
print(json.dumps(out))
`;

const result = spawnSync("python", ["-c", pythonScript], {
  cwd: process.cwd(),
  encoding: "utf-8",
  timeout: 30_000,
});

if (result.status !== 0) {
  console.error("[FIRM RULES PARITY GATE] FAIL — Python subprocess failed:");
  console.error(result.stderr || "<empty stderr>");
  if (result.stdout) {
    console.error("Python stdout:");
    console.error(result.stdout);
  }
  process.exit(1);
}

let pythonOut: { hash: string; canonical: string };
try {
  pythonOut = JSON.parse(result.stdout.trim());
} catch (e) {
  console.error(
    "[FIRM RULES PARITY GATE] FAIL — could not parse Python JSON output:",
  );
  console.error(result.stdout);
  process.exit(1);
}

const pythonHash = pythonOut.hash;
const pythonCanonical = pythonOut.canonical;

// ─── Step 3: compare and report ──────────────────────────────────────────────

if (tsHash === pythonHash) {
  console.log(
    `[FIRM RULES PARITY GATE] PASS — TS and Python firm_rules_version match (${tsHash}).`,
  );
  process.exit(0);
}

// FAIL — emit full diagnostic so the developer can spot the drift without
// re-running anything. The canonical JSON is the authoritative input to the
// hash; diffing it points directly at the offending key/value.
console.error("[FIRM RULES PARITY GATE] FAIL — firm rules version drift detected");
console.error("");
console.error(`  TS hash:      ${tsHash}`);
console.error(`  Python hash:  ${pythonHash}`);
console.error("");
console.error("  TS canonical JSON (sorted keys, no whitespace):");
console.error(`    ${tsCanonical}`);
console.error("");
console.error("  Python canonical JSON (sorted keys, no whitespace):");
console.error(`    ${pythonCanonical}`);
console.error("");
console.error(
  "Fix: bring src/server/lib/firm-rules-version.ts (FIRM_CONFIGS_TS / FIRM_RULES_TS)",
);
console.error(
  "     into sync with src/engine/firm_config.py + src/engine/prop_compliance.py,",
);
console.error("     OR update the Python side if the TS values are the correct ones.");
console.error("");
console.error(
  "WHY THIS BLOCKS: if these two drift in prod, every Monte Carlo run forever fires",
);
console.error(
  "monte_carlo.firm_rule_version_mismatch CRITICAL and REFUSES, drowning the real",
);
console.error("drift signal in false-positive noise.");
process.exit(1);
