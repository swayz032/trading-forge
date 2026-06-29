#!/usr/bin/env tsx
/**
 * check-ts-python-wf-metadata-parity.ts — CI hard gate (H-3 / F-3 / F-8)
 * ─────────────────────────────────────────────────────────────────────────────
 * THE most dangerous silent-pass path to live capital this gate closes:
 *
 *   The Python walk-forward engine (src/engine/walk_forward.py) writes result keys
 *   into the `backtests.walk_forward_results` JSONB blob (+ nested `wf_metadata`).
 *   TypeScript lifecycle gates read those keys. If Python RENAMES a key
 *   (e.g. wfe_overall→wfe_score, pbo_overall→pbo, dsr_pass, bif, k_eff,
 *   bif_reliable, pbo_degenerate_reason) the TS reader silently gets `undefined`,
 *   treats it as legacy/null, and GRANDFATHER-PASSES a strategy that should BLOCK.
 *
 * This gate is the structural tripwire: it parses the GATE-consumed key families
 * (wfe_*, pbo_*, dsr_*, bif/bif_*, k_eff, b15/battery_*) that walk_forward.py writes,
 * and FAILS the build if any such key (minus a documented display-only allowlist) is
 * absent from the TS contract types `WfResultsBlob` / `WfMetadataShape` in
 * src/server/services/backtest-service.ts. A Python rename therefore breaks CI before
 * it can reach a promotion decision.
 *
 * It also enforces a positive contract: a small REQUIRED set of keys must remain
 * present in the TS types, so an accidental TS-side deletion also trips the gate.
 *
 * Behaviour unchanged elsewhere — this gate ONLY adds type coverage + a CI tripwire.
 *
 * Run: npm run check:wf-metadata-parity   (exit 0 = in sync, non-zero = drift)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename_ = fileURLToPath(import.meta.url);
const __dirname_ = dirname(__filename_);
const REPO_ROOT = resolve(__dirname_, "..");

export const PYTHON_WF_PATH = resolve(REPO_ROOT, "src/engine/walk_forward.py");
export const TS_CONTRACT_PATH = resolve(REPO_ROOT, "src/server/services/backtest-service.ts");

/**
 * The 6 known grandfather-pass key families. A key written by walk_forward.py that
 * matches one of these is a candidate that MUST be tracked in the TS contract (or
 * explicitly allowlisted as display-only).
 */
export function isGateFamilyKey(key: string): boolean {
  return /^(wfe_|pbo|dsr|bif|k_eff|b15|battery_)/.test(key);
}

/**
 * Display-only / consumed-elsewhere keys that are intentionally NOT tracked in the
 * WF-blob TS contract. Each is a diagnostic value or an audit-action carrier that no
 * lifecycle GATE reads from `backtests.walk_forward_results`:
 *   - wfe_hard_floor / wfe_warn_floor / wfe_per_window / wfe_is_basis — WFE diagnostics
 *   - pbo / pbo_pass / pbo_p_value / pbo_threshold / pbo_detail        — W27.5 PBO diagnostics
 *     (the lifecycle gate reads pbo_overall / pbo_overall_p_value, which ARE tracked)
 *   - pbo_audit_actions — audit-action name list consumed by backtest-service at INSERT
 *     time, not a gate-read blob key
 *   - bif_detail — BIF diagnostic payload (gate reads bif / k_eff / bif_reliable)
 */
export const DISPLAY_ONLY_ALLOWLIST = new Set<string>([
  "wfe_hard_floor",
  "wfe_warn_floor",
  "wfe_per_window",
  "wfe_is_basis",
  "pbo",
  "pbo_pass",
  "pbo_p_value",
  "pbo_threshold",
  "pbo_detail",
  "pbo_audit_actions",
  "bif_detail",
]);

/**
 * Positive contract — these gate keys MUST stay declared in the TS types. Catches an
 * accidental TS-side deletion (the inverse failure mode of a Python rename).
 */
export const REQUIRED_TS_KEYS = [
  "wfe_overall",
  "wfe_status",
  "pbo_overall",
  "pbo_overall_p_value",
  "pbo_degenerate_reason",
  "dsr_pass",
  "dsr_unavailable",
  "dsr",
  "bif",
  "k_eff",
  "bif_reliable",
];

/** Extract every `"key":` dict-literal string key from a Python source string. */
export function extractPythonDictKeys(source: string): Set<string> {
  const keys = new Set<string>();
  const re = /["']([a-z_][a-z0-9_]*)["']\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

/** Gate-family subset of the Python keys (the ones that must be TS-tracked or allowlisted). */
export function extractPythonGateKeys(source: string): Set<string> {
  const out = new Set<string>();
  for (const k of extractPythonDictKeys(source)) {
    if (isGateFamilyKey(k)) out.add(k);
  }
  return out;
}

/**
 * Extract declared property names from the WF-blob TS contract interfaces
 * (WfResultsBlob, WfMetadataShape, ParamStabilityShape). Index signatures
 * (`[key: string]: unknown`) are skipped. Returns the union across the three.
 */
export function extractTsContractKeys(source: string): Set<string> {
  const keys = new Set<string>();
  const interfaceNames = ["WfResultsBlob", "WfMetadataShape", "ParamStabilityShape"];
  for (const name of interfaceNames) {
    const startIdx = source.indexOf(`interface ${name}`);
    if (startIdx === -1) continue;
    const braceOpen = source.indexOf("{", startIdx);
    if (braceOpen === -1) continue;
    // Walk to the matching closing brace.
    let depth = 0;
    let end = braceOpen;
    for (let i = braceOpen; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = source.slice(braceOpen + 1, end);
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("/")) continue;
      if (line.startsWith("[")) continue; // index signature
      const propMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
      if (propMatch) keys.add(propMatch[1]);
    }
  }
  return keys;
}

/**
 * Core diff: Python gate keys that are absent from the TS contract and not allowlisted.
 * This is the function the test exercises to prove the tripwire actually trips.
 */
export function computeMissingGateKeys(
  pythonGateKeys: Set<string>,
  tsKeys: Set<string>,
  allowlist: Set<string>,
): string[] {
  const missing: string[] = [];
  for (const k of pythonGateKeys) {
    if (allowlist.has(k)) continue;
    if (!tsKeys.has(k)) missing.push(k);
  }
  return missing.sort();
}

export interface ParityResult {
  ok: boolean;
  missingFromTs: string[];      // Python gate keys absent from TS contract (a Python rename, likely)
  missingRequired: string[];    // REQUIRED TS keys that vanished from the TS contract (a TS deletion)
  pythonGateKeyCount: number;
  tsKeyCount: number;
}

/** Run the full parity check against the live source files. Pure — never exits. */
export function runParityCheck(
  pythonPath: string = PYTHON_WF_PATH,
  tsPath: string = TS_CONTRACT_PATH,
): ParityResult {
  const pySource = readFileSync(pythonPath, "utf8");
  const tsSource = readFileSync(tsPath, "utf8");

  const pythonGateKeys = extractPythonGateKeys(pySource);
  const tsKeys = extractTsContractKeys(tsSource);

  const missingFromTs = computeMissingGateKeys(pythonGateKeys, tsKeys, DISPLAY_ONLY_ALLOWLIST);
  const missingRequired = REQUIRED_TS_KEYS.filter((k) => !tsKeys.has(k)).sort();

  return {
    ok: missingFromTs.length === 0 && missingRequired.length === 0,
    missingFromTs,
    missingRequired,
    pythonGateKeyCount: pythonGateKeys.size,
    tsKeyCount: tsKeys.size,
  };
}

function main(): void {
  let result: ParityResult;
  try {
    result = runParityCheck();
  } catch (err) {
    console.error("[wf-metadata-parity] FATAL: could not read source files:", err);
    process.exit(2);
    return;
  }

  if (result.ok) {
    console.log(
      `[wf-metadata-parity] PASS — ${result.pythonGateKeyCount} Python gate keys covered by ` +
        `${result.tsKeyCount} TS contract keys (WfResultsBlob + WfMetadataShape + ParamStabilityShape).`,
    );
    process.exit(0);
  }

  console.error("[wf-metadata-parity] FAIL — Python↔TS walk-forward metadata contract DRIFT.\n");
  if (result.missingFromTs.length > 0) {
    console.error(
      "  Python writes these GATE keys but they are ABSENT from the TS contract\n" +
        "  (WfResultsBlob / WfMetadataShape in backtest-service.ts). A rename here\n" +
        "  silently grandfather-PASSES strategies that should BLOCK:\n",
    );
    for (const k of result.missingFromTs) console.error(`    - ${k}`);
    console.error(
      "\n  Fix: add each key to the matching TS interface, OR add it to\n" +
        "  DISPLAY_ONLY_ALLOWLIST in this script if it is genuinely display-only.\n",
    );
  }
  if (result.missingRequired.length > 0) {
    console.error(
      "  REQUIRED TS gate keys were removed from the TS contract (a TS-side deletion):\n",
    );
    for (const k of result.missingRequired) console.error(`    - ${k}`);
    console.error("\n  Fix: restore these keys to WfResultsBlob / WfMetadataShape.\n");
  }
  process.exit(1);
}

// Only run main() when invoked as a CLI, not when imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === __filename_) {
  main();
}
