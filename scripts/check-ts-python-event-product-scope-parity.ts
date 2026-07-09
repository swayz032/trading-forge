/**
 * check-ts-python-event-product-scope-parity.ts — event PRODUCT-SCOPE parity gate.
 *
 * Ratified scope fix 2026-07-08.
 *
 * PURPOSE
 * -------
 * Asserts that the Python macro-blackout product scope
 * (`src/engine/economic_calendar.py::symbol_passes_event_scope` via EVENT_PRODUCT_SCOPE)
 * AGREES with the TS reference of truth
 * (`src/server/lib/news-policy.ts::eventAffectsSymbol`) for every combination of:
 *
 *   event_type ∈ {FOMC, FOMC_MINUTES, CPI, NFP, EIA}
 *   symbol     ∈ {MES, MNQ, ES, NQ, MCL, CL, QM}
 *
 * The pin (non-negotiable):
 *   • FOMC / FOMC_MINUTES → ALL products
 *   • CPI / NFP           → equity-index ONLY
 *   • EIA                 → crude ONLY
 *
 * Any mismatch = fail-CLOSED (exit 1). This kills the silent drift failure mode where
 * someone edits EVENT_PRODUCT_SCOPE (Python) or eventAffectsSymbol (TS) without updating
 * the other — which would re-open the original bug (EIA blacking out index entries, or
 * CPI/NFP with no index-only scoping).
 *
 * IMPLEMENTATION
 * --------------
 * 1. Spawns a Python subprocess that prints, for each (event_type × symbol),
 *    symbol_passes_event_scope(event_type, symbol) as JSON.
 * 2. Compares each Python boolean against eventAffectsSymbol(event_type, symbol) (TS).
 *
 * EXIT CODES
 *   0 — full agreement (parity intact)
 *   1 — one or more mismatches (parity broken — CI FAIL) or subprocess failure
 *
 * USAGE
 *   node node_modules/tsx/dist/cli.mjs scripts/check-ts-python-event-product-scope-parity.ts
 *   npm run check:ts-python-event-scope-parity
 */

import { spawnSync } from "node:child_process";
import { eventAffectsSymbol } from "../src/server/lib/news-policy.js";

// The five event types the scope convention covers + the symbol universe spanning both
// the index and crude sets (mixing recognized index + crude symbols).
const EVENT_TYPES = ["FOMC", "FOMC_MINUTES", "CPI", "NFP", "EIA"] as const;
const SYMBOLS = ["MES", "MNQ", "ES", "NQ", "MCL", "CL", "QM"] as const;

// ─── Step 1: compute the Python scope matrix ─────────────────────────────────

const pythonScript = `
import json, sys
sys.path.insert(0, '.')
from src.engine.economic_calendar import symbol_passes_event_scope
types = ${JSON.stringify(EVENT_TYPES)}
syms = ${JSON.stringify(SYMBOLS)}
out = {}
for t in types:
    out[t] = {s: bool(symbol_passes_event_scope(t, s)) for s in syms}
print(json.dumps(out))
`;

const result = spawnSync("python", ["-c", pythonScript], {
  cwd: process.cwd(),
  encoding: "utf-8",
  timeout: 30_000,
});

if (result.status !== 0) {
  console.error("[EVENT-SCOPE PARITY GATE] Python subprocess failed:");
  console.error(result.stderr);
  process.exit(1);
}

let pyScope: Record<string, Record<string, boolean>> = {};
try {
  pyScope = JSON.parse(result.stdout.trim());
} catch (e) {
  console.error("[EVENT-SCOPE PARITY GATE] Failed to parse Python JSON output:", result.stdout);
  process.exit(1);
}

// ─── Step 2: compare against the TS reference of truth ───────────────────────

let pass = true;
let checked = 0;
const mismatches: string[] = [];

for (const eventType of EVENT_TYPES) {
  const pyRow = pyScope[eventType] ?? {};
  for (const symbol of SYMBOLS) {
    const tsVal = eventAffectsSymbol(eventType, symbol);
    const pyVal = pyRow[symbol];
    checked++;
    if (pyVal === undefined) {
      mismatches.push(`MISSING_IN_PY  ${eventType}×${symbol} (TS=${tsVal}, Python has nothing)`);
      pass = false;
    } else if (pyVal !== tsVal) {
      mismatches.push(`MISMATCH       ${eventType}×${symbol}: TS=${tsVal}, Python=${pyVal}`);
      pass = false;
    }
  }
}

// ─── Step 3: report ──────────────────────────────────────────────────────────

if (pass) {
  console.log(
    `[EVENT-SCOPE PARITY GATE] PASS — ${checked} (event_type × symbol) combinations agree ` +
    `across FOMC/FOMC_MINUTES/CPI/NFP/EIA (Python EVENT_PRODUCT_SCOPE ≡ TS eventAffectsSymbol).`
  );
  process.exit(0);
} else {
  console.error(
    `[EVENT-SCOPE PARITY GATE] FAIL — ${mismatches.length} mismatch(es) found ` +
    `(${checked} combinations checked):`
  );
  for (const m of mismatches) {
    console.error(`  ${m}`);
  }
  console.error("");
  console.error("Fix: align src/engine/economic_calendar.py EVENT_PRODUCT_SCOPE with");
  console.error("     src/server/lib/news-policy.ts eventAffectsSymbol (the pin):");
  console.error("       FOMC/FOMC_MINUTES → all products; CPI/NFP → index only; EIA → crude only.");
  process.exit(1);
}
