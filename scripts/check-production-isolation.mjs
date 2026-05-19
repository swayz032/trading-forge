#!/usr/bin/env node
/**
 * scripts/check-production-isolation.mjs
 *
 * CI lint script: fails if any file in src/server/production/ imports from
 * the research surface (agent-service, critic-optimizer, quantum_*, scout-*,
 * synthetic_market_simulator, challenger_only modules).
 *
 * Exit 0 = clean.
 * Exit 1 = violation(s) found.
 *
 * Usage: node scripts/check-production-isolation.mjs
 * NPM:   npm run check:production-isolation
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const PRODUCTION_DIR = join(REPO_ROOT, "src", "server", "production");

// Forbidden import patterns — matched against the import path string.
// Order: most-specific first (avoids false positives on broad patterns).
const FORBIDDEN_PATTERNS = [
  {
    pattern: /agent-service/,
    label: "agent-service (LLM research loop)",
  },
  {
    pattern: /critic-optimizer-service/,
    label: "critic-optimizer-service (Optuna search)",
  },
  {
    pattern: /quantum[_-]/i,
    label: "quantum_* or quantum-* module (challenger-only)",
  },
  {
    pattern: /scout-[a-z]/i,
    label: "scout-*-service (strategy generation pipeline)",
  },
  {
    pattern: /synthetic[_-]market[_-]simulator/i,
    label: "synthetic_market_simulator (research simulator)",
  },
  {
    pattern: /challenger[_-]only/i,
    label: "challenger_only tagged module",
  },
];

// Import statement regex — matches both static and dynamic imports.
// Captures the module path string (single or double-quoted).
const IMPORT_RE =
  /^\s*(?:import\s+.*?from\s+|import\s*\(|export\s+.*?from\s+|require\s*\()['"]([^'"]+)['"]/gm;

/**
 * Recursively collect all .ts and .tsx files in a directory,
 * skipping *.test.ts and *.spec.ts.
 */
function collectSourceFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (
      stat.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract all import paths from a TypeScript file, with line numbers.
 */
function extractImports(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const imports = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // Reset lastIndex for each line
    const re = /(?:import\s+.*?from\s+|import\s*\(|export\s+.*?from\s+|require\s*\()['"]([^'"]+)['"]/g;
    let match;
    while ((match = re.exec(line)) !== null) {
      imports.push({ path: match[1], line: lineIdx + 1 });
    }
  }

  return imports;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let files;
try {
  files = collectSourceFiles(PRODUCTION_DIR);
} catch (err) {
  if (err.code === "ENOENT") {
    console.log(
      `[check-production-isolation] src/server/production/ does not exist — nothing to check.`
    );
    process.exit(0);
  }
  throw err;
}

if (files.length === 0) {
  console.log(
    `[check-production-isolation] No source files found in src/server/production/ — clean.`
  );
  process.exit(0);
}

const violations = [];

for (const filePath of files) {
  const relPath = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  const imports = extractImports(filePath);

  for (const { path: importPath, line } of imports) {
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      if (pattern.test(importPath)) {
        violations.push({ file: relPath, line, importPath, label });
        break; // Only report first matching pattern per import
      }
    }
  }
}

if (violations.length === 0) {
  console.log(
    `[check-production-isolation] CLEAN — ${files.length} file(s) checked, 0 violations.`
  );
  process.exit(0);
}

// Report violations
console.error(
  `\n[check-production-isolation] VIOLATION(S) FOUND — production path isolation broken!\n`
);
console.error(
  `The following files in src/server/production/ import from the research surface:\n`
);

for (const { file, line, importPath, label } of violations) {
  console.error(`  ${file}:${line}`);
  console.error(`    Import: "${importPath}"`);
  console.error(`    Reason: forbidden module — ${label}`);
  console.error();
}

console.error(
  `Isolation rule: src/server/production/* must NEVER import from:
  - agent-service.ts                (LLM research loop)
  - critic-optimizer-service.ts     (Optuna search)
  - quantum_* / quantum-* modules   (challenger-only)
  - scout-*-service.ts              (strategy generation)
  - synthetic_market_simulator.py   (research simulator)
  - Any module tagged challenger_only

See: src/server/production/README.md for the allowed-import list.
`
);

process.exit(1);
