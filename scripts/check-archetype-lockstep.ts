#!/usr/bin/env tsx
/**
 * FIX 5 (2026-07-02): Archetype registry lockstep CI guard.
 *
 * Parses three sources:
 *   - TypeScript: src/server/services/direct-bucket-graduator.ts  ARCHETYPE_REGISTRY
 *   - Python:     src/engine/archetype_evaluator.py              ARCHETYPE_CLASS_MAP
 *   - TypeScript: src/server/routes/live-order.ts                ARCHETYPE_REGISTRY_KEYS
 *                 (H-3, 2026-07-04 — the live-order acceptance set)
 *
 * Asserts:
 *   1. Key sets are identical (same archetype names in graduator + engine)
 *   2. strategyClass dotted-paths match for every shared key
 *      TS: strategyClass: "src.engine.strategies.X.Y"
 *      Python: derived from the import + class assignment in _get_archetype_class_map()
 *   3. live-order.ts ARCHETYPE_REGISTRY_KEYS matches the graduator registry key set
 *      (a missing key rejects LIVE orders as unknown_archetype → 0 LIVE trades)
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

// ─── Parse live-order.ts ARCHETYPE_REGISTRY_KEYS ──────────────────────────────
// Deep-scan #16 Wave 2 (H-3, 2026-07-04): live-order.ts keeps a hand-maintained
// duplicate Set of archetype keys used to accept/reject inbound live orders. It
// was NOT covered by this lockstep check (only graduator ↔ engine were compared),
// so a future archetype added to the graduator registry + engine but forgotten
// here would silently reject live orders as `unknown_archetype` (0 LIVE trades).
// Parse the Set literal and compare its keys against the graduator registry.
function parseLiveOrderArchetypeKeys(filePath: string): Set<string> {
  const src = fs.readFileSync(filePath, "utf8");

  const startMarker = "const ARCHETYPE_REGISTRY_KEYS: ReadonlySet<string> = new Set([";
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find ARCHETYPE_REGISTRY_KEYS in ${filePath}`);
  }

  // Balanced-bracket scan from the opening [ of new Set([...])
  const arrStart = src.indexOf("[", startIdx);
  let depth = 0;
  let i = arrStart;
  let arrEnd = -1;
  while (i < src.length) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) { arrEnd = i; break; }
    }
    i++;
  }
  if (arrEnd === -1) throw new Error("Could not find end of ARCHETYPE_REGISTRY_KEYS array");

  const block = src.slice(arrStart, arrEnd + 1);
  const keyRe = /"([^"]+)"/g;
  const result = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(block)) !== null) {
    result.add(m[1]);
  }

  if (result.size === 0) {
    throw new Error(`No keys found in ARCHETYPE_REGISTRY_KEYS in ${filePath}`);
  }

  return result;
}

// ─── Main comparison ──────────────────────────────────────────────────────────

function main(): void {
  const tsFile = path.join(ROOT, "src/server/services/direct-bucket-graduator.ts");
  const pyFile = path.join(ROOT, "src/engine/archetype_evaluator.py");
  const liveOrderFile = path.join(ROOT, "src/server/routes/live-order.ts");

  console.log("check-archetype-lockstep: parsing files...");

  let tsRegistry: Map<string, string>;
  let pyRegistry: Map<string, string>;
  let liveOrderKeys: Set<string>;

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

  try {
    liveOrderKeys = parseLiveOrderArchetypeKeys(liveOrderFile);
    console.log(`  live-order.ts ARCHETYPE_REGISTRY_KEYS: ${liveOrderKeys.size} keys`);
  } catch (e) {
    console.error(`ERROR parsing live-order file: ${(e as Error).message}`);
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

  // Check 4 (H-3): live-order.ts ARCHETYPE_REGISTRY_KEYS must match the graduator
  // registry key set. A graduator/engine archetype missing here rejects LIVE orders
  // (`unknown_archetype`, 0 LIVE trades); a stale key here is dead weight.
  for (const [key] of tsRegistry) {
    if (!liveOrderKeys.has(key)) {
      driftFound.push(
        `KEY MISSING FROM LIVE-ORDER: '${key}' is in graduator ARCHETYPE_REGISTRY but NOT in ` +
        `live-order.ts ARCHETYPE_REGISTRY_KEYS — live orders for this archetype would be rejected as unknown_archetype`,
      );
    }
  }
  for (const key of liveOrderKeys) {
    if (!tsRegistry.has(key)) {
      driftFound.push(
        `STALE KEY IN LIVE-ORDER: '${key}' is in live-order.ts ARCHETYPE_REGISTRY_KEYS but NOT in ` +
        `graduator ARCHETYPE_REGISTRY — remove it or add the missing registry+engine entry`,
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

  console.log(
    `\ncheck-archetype-lockstep: PASS — ${tsRegistry.size} graduator keys, ` +
    `${pyRegistry.size} engine keys, ${liveOrderKeys.size} live-order keys, all in lockstep.`,
  );
  process.exit(0);
}

main();
