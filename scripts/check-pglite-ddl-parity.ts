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
import { readFileSync } from "node:fs";
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

// ── 2. Extract every hand-rolled CREATE TABLE from the pglite harness + inline test DDLs ──────
const DDL_SOURCES = [
  "src/server/__tests__/helpers/pglite-db.ts",
  "src/server/__tests__/reconciliation-option-b-integration.test.ts",
];

const CONSTRAINT_KW = /^(constraint|primary|foreign|unique|check|--)/i;

/** Parse `CREATE TABLE [IF NOT EXISTS] name ( ... )` blocks → table → Set(column names). */
function parseCreateTables(src: string): Array<{ table: string; cols: Set<string>; file: string }> {
  const out: Array<{ table: string; cols: Set<string>; file: string }> = [];
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const table = m[1];
    const body = m[2];
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
      if (name) cols.add(name);
    }
    out.push({ table, cols, file: "" });
  }
  return out;
}

const problems: string[] = [];
let tablesChecked = 0;

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
      // A test DDL for a table not in schema.ts — likely a typo or a dropped table.
      problems.push(`  [${file}] table "${table}" is not in schema.ts (dropped table or typo?)`);
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
  `[check-pglite-ddl-parity] CLEAN — ${tablesChecked} hand-rolled table(s) match schema.ts (${schemaCols.size} schema tables).`,
);
