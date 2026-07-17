/**
 * check:pglite-ddl-parity — deep-scan Architecture F-3 CI gate.
 *
 * The PGlite test harness (src/server/__tests__/helpers/pglite-db.ts CORE_DDL) and per-test inline
 * DDLs mirror a subset of schema.ts by hand. Nothing verified they stay in sync — a CORE_DDL column
 * that drifts from (or is stale vs) schema.ts means every gate/producer→DB test running against it is
 * validating a shape the real DB no longer has. This gate diffs each hand-rolled CREATE TABLE against
 * the Drizzle schema (the source of truth) and fails CI on any drifted column.
 *
 * Run: `node node_modules/tsx/dist/cli.mjs scripts/check-pglite-ddl-parity.ts`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/server/db/schema.js";

// ── 1. schema.ts = source of truth: table → Set(column names) ────────────────────────────────
const schemaCols = new Map<string, Set<string>>();
for (const v of Object.values(schema)) {
  try {
    const cfg = getTableConfig(v as Parameters<typeof getTableConfig>[0]);
    schemaCols.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
  } catch {
    /* not a pgTable export */
  }
}

// ── 2. Discover EVERY .ts under src/server that hand-rolls a CREATE TABLE (re-cert MED: was a
//       hardcoded 2-file list → only 2 of ≥9 files with real DDL mirrors were covered). Glob so a
//       new hand-rolled table anywhere is auto-covered. ─────────────────────────────────────────
function findDdlFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...findDdlFiles(p));
    else if (name.endsWith(".ts")) {
      try {
        if (readFileSync(p, "utf8").includes("CREATE TABLE")) out.push(p);
      } catch {
        /* unreadable — skip */
      }
    }
  }
  return out;
}
const DDL_SOURCES = findDdlFiles("src/server");

const CONSTRAINT_KW = /^(constraint|primary|foreign|unique|check|--)/i;

/** Parse `CREATE TABLE [IF NOT EXISTS] name ( ... )` blocks → table → Set(column names). */
function parseCreateTables(src: string): Array<{ table: string; cols: Set<string>; file: string }> {
  const out: Array<{ table: string; cols: Set<string>; file: string }> = [];
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const table = m[1];
    // Strip `-- ...` line comments BEFORE comma-splitting. A comment's own
    // prose commas (e.g. "...must fail like prod, not silently default...")
    // otherwise get treated as real column-definition boundaries, which both
    // fabricates phantom "columns" from comment words AND silently swallows
    // the real column definition that follows into the same bogus part —
    // a false DRIFT report that also masks the swallowed column from being
    // checked at all (deep-scan/W7 finding, 2026-07-17).
    const body = m[2].replace(/--[^\n]*/g, "");
    const cols = new Set<string>();
    // split on commas that are not inside parentheses (CHECK (...), numeric(10,2), etc.)
    let depth = 0;
    let cur = "";
    const parts: string[] = [];
    for (const ch of body) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    for (const raw of parts) {
      const line = raw.trim();
      if (!line || CONSTRAINT_KW.test(line)) continue;
      const name = line.split(/\s+/)[0].replace(/"/g, "");
      // Only accept valid SQL identifiers as columns. Guards against DDL that appears
      // inside JS string literals (e.g. boot-migration-runner-crlf-hash.test.ts holds
      // 'CREATE TABLE "alerts" (\n "id" ...)' as a hash fixture) where the escaped `\n`
      // is read as text and parsed into a phantom column named "\n" → false DRIFT
      // (deep-scan HT-1 2026-07-11). A real column name is always /^\w+$/.
      if (name && /^\w+$/.test(name)) cols.add(name);
    }
    out.push({ table, cols, file: "" });
  }
  return out;
}

const problems: string[] = [];
let tablesChecked = 0;
let skippedSynthetic = 0;

for (const file of DDL_SOURCES) {
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { table, cols } of parseCreateTables(src)) {
    const truth = schemaCols.get(table);
    if (!truth) {
      // Table not in schema.ts — a synthetic test-only table (boot-migration parse tests use
      // a/b/t2/widgets fixtures, not real mirrors). Skip: this gate checks COLUMN drift on tables
      // that actually mirror the Drizzle schema, not typo-detection on scaffolding.
      skippedSynthetic++;
      continue;
    }
    tablesChecked++;
    for (const c of cols) {
      if (!truth.has(c)) {
        problems.push(`  [${file}] ${table}.${c} — column NOT in schema.ts (drifted/removed/typo)`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(
    `[check-pglite-ddl-parity] DRIFT — ${problems.length} hand-rolled DDL column(s) do not match schema.ts:\n` +
      problems.join("\n") +
      `\n\nFix: update the CORE_DDL / inline test DDL to match src/server/db/schema.ts (the source of truth).`,
  );
  process.exit(1);
}

console.log(
  `[check-pglite-ddl-parity] CLEAN — ${tablesChecked} hand-rolled schema-mirror table(s) match schema.ts ` +
    `across ${DDL_SOURCES.length} DDL file(s) (${skippedSynthetic} synthetic test table(s) skipped; ${schemaCols.size} schema tables).`,
);
