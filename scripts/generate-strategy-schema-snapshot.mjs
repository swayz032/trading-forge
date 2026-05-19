#!/usr/bin/env node
/**
 * Strategy Schema Snapshot Generator (Scout Architecture Fix — Pass 1 Branch C)
 *
 * Reads `src/engine/compiler/strategy_schema.py` (Pydantic v2 model) and emits
 * `src/agents/kb/strategy-schema-snapshot.json` deterministically. Computes a
 * SHA256 of the JSON content and writes it alongside as `.sha256`.
 *
 * Purpose: eliminate DSL schema drift between the Python compiler (source of
 * truth) and the GPT-5-mini KB cards loaded at LLM call time. The JSON snapshot
 * is what the strategy_proposer / dsl_quality_critic / transcript_extractor
 * roles read into their system prompt. If the Python model changes and this
 * script is not re-run, the LLM keeps proposing strategies against a stale
 * schema and the Python compiler rejects them at validate-time — a silent
 * cross-language drift.
 *
 * Pre-commit hook (Husky): rerun this when `strategy_schema.py` is staged. If
 * the regenerated snapshot differs from the committed copy, fail the commit
 * with a clear "run npm run kb:schema-snapshot" remediation message.
 *
 * Exit codes: 0 success, 1 failure (any error during spawn / parse / write).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const SCHEMA_PY_PATH = resolve(
  PROJECT_ROOT,
  "src/engine/compiler/strategy_schema.py",
);
const KB_DIR = resolve(PROJECT_ROOT, "src/agents/kb");
const SNAPSHOT_JSON = resolve(KB_DIR, "strategy-schema-snapshot.json");
const SNAPSHOT_SHA = resolve(KB_DIR, "strategy-schema-snapshot.sha256");

function fail(message, err) {
  process.stderr.write(`[kb:schema-snapshot] ERROR: ${message}\n`);
  if (err) process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
}

function main() {
  if (!existsSync(SCHEMA_PY_PATH)) {
    fail(`strategy_schema.py not found at ${SCHEMA_PY_PATH}`);
  }

  if (!existsSync(KB_DIR)) {
    mkdirSync(KB_DIR, { recursive: true });
  }

  // Spawn Python to dump the Pydantic v2 JSON schema. We add the compiler
  // directory to sys.path so the import statement resolves without needing
  // a package install.
  const pyScript = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(dirname(SCHEMA_PY_PATH))})`,
    "from strategy_schema import StrategyDSL",
    "schema = StrategyDSL.model_json_schema()",
    "print(json.dumps(schema, indent=2, sort_keys=True))",
  ].join("\n");

  // Try `python` then `python3` for cross-platform robustness.
  const candidates = ["python", "python3"];
  let result = null;
  let lastErr = null;
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ["-c", pyScript], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.error) {
      lastErr = r.error;
      continue;
    }
    if (r.status === 0) {
      result = r;
      break;
    }
    lastErr = new Error(
      `${cmd} exited with status ${r.status}: ${r.stderr || "(no stderr)"}`,
    );
  }
  if (!result) {
    fail("Could not invoke Python (tried python, python3)", lastErr);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    fail("Python output was not valid JSON", err);
  }

  // Deterministic stringification with sorted keys for stable diffs.
  const json = `${JSON.stringify(parsed, sortedReplacer(), 2)}\n`;
  const sha = createHash("sha256").update(json).digest("hex");

  writeFileSync(SNAPSHOT_JSON, json, "utf-8");
  writeFileSync(SNAPSHOT_SHA, `${sha}\n`, "utf-8");

  // Sanity check: top-level keys we expect from the Pydantic schema.
  const requiredKeys = ["properties", "required", "title"];
  const missing = requiredKeys.filter((k) => !(k in parsed));
  if (missing.length > 0) {
    fail(
      `Snapshot missing expected top-level keys: ${missing.join(", ")} — ` +
        `did strategy_schema.py change shape?`,
    );
  }

  process.stdout.write(
    `[kb:schema-snapshot] wrote ${SNAPSHOT_JSON} (${json.length} bytes, sha256=${sha.slice(0, 12)}…)\n`,
  );
  process.exit(0);
}

/**
 * JSON.stringify replacer that sorts object keys recursively so the output is
 * stable regardless of Pydantic's internal dict ordering. Arrays preserve
 * order — only object keys are sorted.
 */
function sortedReplacer() {
  return (_key, value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  };
}

// Pre-commit hook helper: if invoked with --check, re-generate in memory and
// compare against on-disk snapshot. Exit 1 if mismatched.
if (process.argv.includes("--check")) {
  if (!existsSync(SNAPSHOT_JSON)) {
    fail(
      "Snapshot file does not exist. Run `npm run kb:schema-snapshot` and commit the result.",
    );
  }
  // Re-run main() but write to a temp buffer instead. Easier: run main() and
  // let it overwrite, then compare. For a pre-commit check we want NOT to
  // mutate working tree, so we read existing then regenerate to a temp.
  const existingJson = readFileSync(SNAPSHOT_JSON, "utf-8");
  const existingSha = createHash("sha256").update(existingJson).digest("hex");

  // Spawn Python identically to main() and produce in-memory JSON.
  const pyScript = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(dirname(SCHEMA_PY_PATH))})`,
    "from strategy_schema import StrategyDSL",
    "schema = StrategyDSL.model_json_schema()",
    "print(json.dumps(schema, indent=2, sort_keys=True))",
  ].join("\n");
  const candidates = ["python", "python3"];
  let result = null;
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ["-c", pyScript], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!r.error && r.status === 0) {
      result = r;
      break;
    }
  }
  if (!result) fail("Could not invoke Python during --check");
  const parsed = JSON.parse(result.stdout);
  const regenJson = `${JSON.stringify(parsed, sortedReplacer(), 2)}\n`;
  const regenSha = createHash("sha256").update(regenJson).digest("hex");

  if (regenSha !== existingSha) {
    process.stderr.write(
      "[kb:schema-snapshot] ERROR: strategy-schema-snapshot.json is STALE.\n" +
        "  strategy_schema.py has changed since the snapshot was generated.\n" +
        "  Run: npm run kb:schema-snapshot\n" +
        "  Then re-stage src/agents/kb/strategy-schema-snapshot.json + .sha256.\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    "[kb:schema-snapshot] --check OK (snapshot matches strategy_schema.py)\n",
  );
  process.exit(0);
}

main();
