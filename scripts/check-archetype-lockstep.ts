#!/usr/bin/env tsx
/**
 * FIX 5 (2026-07-02): Archetype registry lockstep CI guard.
 *
 * Parses both:
 *   - TypeScript: src/server/services/direct-bucket-graduator.ts  ARCHETYPE_REGISTRY
 *   - Python:     src/engine/archetype_evaluator.py              ARCHETYPE_CLASS_MAP
 *
 * Asserts:
 *   1. Key sets are identical (same archetype names in both files)
 *   2. strategyClass dotted-paths match for every shared key
 *      TS: strategyClass: "src.engine.strategies.X.Y"
 *      Python: derived from the import + class assignment in _get_archetype_class_map()
 *
 * Exits non-zero on any drift so CI fails loudly.
 *
 * Usage:
 *   npx tsx scripts/check-archetype-lockstep.ts
 *   npm run check:archetype-lockstep
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Parse TypeScript ARCHETYPE_REGISTRY ──────────────────────────────────────

function parseTsArchetypeRegistry(filePath: string): Map<string, string> {
  const src = fs.readFileSync(filePath, "utf8");

  // Find the ARCHETYPE_REGISTRY block
  const startMarker = "const ARCHETYPE_REGISTRY: Record<string, { engineSpec: string; strategyClass: string; description: string }> = {";
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find ARCHETYPE_REGISTRY in ${filePath}`);
  }

  // Find the closing brace (balanced brace scan from the opening {)
  let depth = 0;
  let registryStart = src.indexOf("{", startIdx + startMarker.length - 1);
  let i = registryStart;
  let registryEnd = -1;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) { registryEnd = i; break; }
    }
    i++;
  }
  if (registryEnd === -1) throw new Error("Could not find end of ARCHETYPE_REGISTRY");

  const registryBlock = src.slice(registryStart, registryEnd + 1);

  // Extract key → strategyClass pairs via regex
  // Pattern: <key>: { engineSpec: "...", strategyClass: "...", description: "..." }
  const result = new Map<string, string>();
  const entryRe = /^\s{2}(\w+):\s*\{[^}]*strategyClass:\s*"([^"]+)"/gm;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(registryBlock)) !== null) {
    result.set(match[1], match[2]);
  }

  if (result.size === 0) {
    throw new Error(`No entries found in ARCHETYPE_REGISTRY in ${filePath}`);
  }

  return result;
}

// ─── Parse Python ARCHETYPE_CLASS_MAP ─────────────────────────────────────────

function parsePythonArchetypeClassMap(filePath: string): Map<string, string> {
  const src = fs.readFileSync(filePath, "utf8");

  // Step 1: Build class-name → dotted-module-path map from import statements.
  // Handles both single-line and parenthesized multi-line forms:
  //   from src.engine.strategies.X import Y
  //   from src.engine.strategies.X import (
  //       Y,
  //   )
  const classToModule = new Map<string, string>();

  // Match `from <module> import <single_name>` (single-line)
  const singleImportRe = /^\s+from\s+(src\.engine\.strategies\.\S+)\s+import\s+(\w+)\s*$/gm;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = singleImportRe.exec(src)) !== null) {
    classToModule.set(importMatch[2], `${importMatch[1]}.${importMatch[2]}`);
  }

  // Match `from <module> import (` then capture class names on following lines
  const multiImportRe = /^\s+from\s+(src\.engine\.strategies\.\S+)\s+import\s+\(/gm;
  while ((importMatch = multiImportRe.exec(src)) !== null) {
    const modulePath = importMatch[1];
    // Scan from end of `(` to the matching `)`
    const parenStart = src.indexOf("(", importMatch.index + importMatch[0].length - 1);
    let depth = 0;
    let k = parenStart;
    let parenEnd = -1;
    while (k < src.length) {
      if (src[k] === "(") depth++;
      else if (src[k] === ")") { depth--; if (depth === 0) { parenEnd = k; break; } }
      k++;
    }
    if (parenEnd === -1) continue;
    const inner = src.slice(parenStart + 1, parenEnd);
    // Extract class names (one per line, allow trailing comma)
    const classRe = /^\s+(\w+),?\s*$/gm;
    let cm: RegExpExecArray | null;
    while ((cm = classRe.exec(inner)) !== null) {
      classToModule.set(cm[1], `${modulePath}.${cm[1]}`);
    }
  }

  if (classToModule.size === 0) {
    throw new Error(`No import statements found in ${filePath}`);
  }

  // Step 2: Find _get_archetype_class_map() function body, then find its return { block.
  // We anchor on the function definition to avoid matching other return { blocks in the file.
  const funcMarker = "def _get_archetype_class_map()";
  const funcIdx = src.indexOf(funcMarker);
  if (funcIdx === -1) throw new Error(`Could not find '${funcMarker}' in ${filePath}`);

  // Find the first `return {` after the function definition
  const returnMarker = "    return {";
  const returnIdx = src.indexOf(returnMarker, funcIdx);
  if (returnIdx === -1) throw new Error("Could not find return { in _get_archetype_class_map");

  // Find the matching closing brace
  let depth = 0;
  let blockStart = src.indexOf("{", returnIdx);
  let j = blockStart;
  let blockEnd = -1;
  while (j < src.length) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) { blockEnd = j; break; }
    }
    j++;
  }
  if (blockEnd === -1) throw new Error("Could not find end of return dict in _get_archetype_class_map");

  const dictBlock = src.slice(blockStart, blockEnd + 1);

  // Step 3: Extract key → class-name pairs
  // Pattern: "key": ClassName,  or "key": ClassName  # comment
  const pairRe = /^\s+"([^"]+)":\s+(\w+),?\s*(?:#.*)?$/gm;
  const result = new Map<string, string>();
  let pairMatch: RegExpExecArray | null;
  while ((pairMatch = pairRe.exec(dictBlock)) !== null) {
    const key = pairMatch[1];
    const className = pairMatch[2];
    const dottedPath = classToModule.get(className);
    if (!dottedPath) {
      throw new Error(`Class '${className}' mapped to key '${key}' not found in imports of ${filePath}`);
    }
    result.set(key, dottedPath);
  }

  if (result.size === 0) {
    throw new Error(`No entries found in ARCHETYPE_CLASS_MAP return dict in ${filePath}`);
  }

  return result;
}

// ─── Main comparison ──────────────────────────────────────────────────────────

function main(): void {
  const tsFile = path.join(ROOT, "src/server/services/direct-bucket-graduator.ts");
  const pyFile = path.join(ROOT, "src/engine/archetype_evaluator.py");

  console.log("check-archetype-lockstep: parsing files...");

  let tsRegistry: Map<string, string>;
  let pyRegistry: Map<string, string>;

  try {
    tsRegistry = parseTsArchetypeRegistry(tsFile);
    console.log(`  TS ARCHETYPE_REGISTRY: ${tsRegistry.size} keys`);
  } catch (e) {
    console.error(`ERROR parsing TS file: ${(e as Error).message}`);
    process.exit(1);
  }

  try {
    pyRegistry = parsePythonArchetypeClassMap(pyFile);
    console.log(`  Python ARCHETYPE_CLASS_MAP: ${pyRegistry.size} keys`);
  } catch (e) {
    console.error(`ERROR parsing Python file: ${(e as Error).message}`);
    process.exit(1);
  }

  const driftFound: string[] = [];

  // Check 1: Keys in TS but not Python
  for (const [key] of tsRegistry) {
    if (!pyRegistry.has(key)) {
      driftFound.push(`KEY MISSING FROM PYTHON: '${key}' is in TS ARCHETYPE_REGISTRY but NOT in Python ARCHETYPE_CLASS_MAP`);
    }
  }

  // Check 2: Keys in Python but not TS
  for (const [key] of pyRegistry) {
    if (!tsRegistry.has(key)) {
      driftFound.push(`KEY MISSING FROM TS: '${key}' is in Python ARCHETYPE_CLASS_MAP but NOT in TS ARCHETYPE_REGISTRY`);
    }
  }

  // Check 3: strategyClass path mismatch for shared keys
  for (const [key, tsPath] of tsRegistry) {
    const pyPath = pyRegistry.get(key);
    if (pyPath !== undefined && tsPath !== pyPath) {
      driftFound.push(
        `STRATEGY_CLASS MISMATCH for '${key}':\n` +
        `  TS strategyClass:      "${tsPath}"\n` +
        `  Python dotted path:    "${pyPath}"`,
      );
    }
  }

  if (driftFound.length > 0) {
    console.error("\ncheck-archetype-lockstep: DRIFT DETECTED\n");
    for (const d of driftFound) {
      console.error(`  [DRIFT] ${d}`);
    }
    console.error(`\n${driftFound.length} drift(s) found. Update ARCHETYPE_REGISTRY and ARCHETYPE_CLASS_MAP in lockstep.`);
    process.exit(1);
  }

  console.log(`\ncheck-archetype-lockstep: PASS — ${tsRegistry.size} keys, all in lockstep.`);
  process.exit(0);
}

main();
