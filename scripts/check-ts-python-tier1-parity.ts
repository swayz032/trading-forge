/**
 * check-ts-python-tier1-parity.ts — Tier-1 event calendar parity gate.
 *
 * Wave hardening 2026-06-22, macro-blackout MFFU §5 extension.
 *
 * PURPOSE
 * -------
 * Asserts that TIER1_EVENTS in tier1-event-blackout.ts EXACTLY matches the
 * dates and times in src/engine/economic_calendar.py::STATIC_EVENTS for the
 * 6 shared Tier-1 event types: FOMC, CPI, NFP (2025-2027), GDP, ISM, PPI
 * (2026-2027).  NFP is excluded from the Python-side comparison because it is
 * computed dynamically in TS (buildNfpEvents) and treated as estimated in the
 * Python STATIC_EVENTS — date-level agreement is tested separately in the
 * Python pytest suite.
 *
 * Any date or time mismatch = fail-CLOSED (exit 1).  This kills the silent
 * calendar drift failure mode where someone updates economic_calendar.py but
 * forgets to update tier1-event-blackout.ts (or vice versa).
 *
 * IMPLEMENTATION
 * --------------
 * 1. Spawns a Python subprocess that prints STATIC_EVENTS as JSON for the
 *    target event types and years.
 * 2. Builds a lookup map from the TS TIER1_EVENTS constant.
 * 3. Asserts that every Python entry has a matching TS entry with the same
 *    date and time_et.  Also asserts the reverse (TS entries have a Python
 *    counterpart) for the statically-declared types.
 *
 * EXIT CODES
 *   0 — all fixtures match (parity intact)
 *   1 — one or more drift (parity broken — CI FAIL)
 *
 * USAGE
 *   npx tsx scripts/check-ts-python-tier1-parity.ts
 *   npm run check:ts-python-tier1-parity
 */

import { spawnSync } from "node:child_process";
import { TIER1_EVENTS } from "../src/server/lib/tier1-event-blackout.js";

// Event types we gate on: FOMC + CPI (static arrays) + GDP + ISM + PPI.
// NFP is excluded because TS uses buildNfpEvents() (dynamic) and Python uses
// estimated static dates — discrepancies are expected and acceptable at the
// day level for a ±30min blackout window.  NFP correctness is covered by the
// separate Python pytest (test_calendar_filter_blackout.py).
const PARITY_TYPES = ["FOMC", "CPI", "GDP", "ISM", "PPI"] as const;

// Year range for the parity check.  NFP is excluded per above note.
// GDP/ISM/PPI 2025-2027; FOMC/CPI 2025-2027 (matching TS constant).
const PARITY_YEARS = ["2025", "2026", "2027"];

// ─── Step 1: export STATIC_EVENTS from Python ────────────────────────────────

const pythonScript = `
import json, sys
sys.path.insert(0, '.')
from src.engine.economic_calendar import STATIC_EVENTS
types_wanted = ${JSON.stringify(PARITY_TYPES)}
years_wanted = set(${JSON.stringify(PARITY_YEARS)})
out = {}
for t in types_wanted:
    evts = STATIC_EVENTS.get(t, [])
    out[t] = [e for e in evts if e['date'][:4] in years_wanted]
print(json.dumps(out))
`;

const result = spawnSync("python", ["-c", pythonScript], {
  cwd: process.cwd(),
  encoding: "utf-8",
  timeout: 30_000,
});

if (result.status !== 0) {
  console.error("[PARITY GATE] Python subprocess failed:");
  console.error(result.stderr);
  process.exit(1);
}

let pythonEvents: Record<string, Array<{ date: string; time_et: string }>> = {};
try {
  pythonEvents = JSON.parse(result.stdout.trim());
} catch (e) {
  console.error("[PARITY GATE] Failed to parse Python JSON output:", result.stdout);
  process.exit(1);
}

// ─── Step 2: build TS lookup ──────────────────────────────────────────────────

type EventKey = string; // `${event_type}::${date}`
const tsLookup = new Map<EventKey, string>(); // key → time_et

for (const evt of TIER1_EVENTS) {
  if ((PARITY_TYPES as readonly string[]).includes(evt.event_type)) {
    const key: EventKey = `${evt.event_type}::${evt.date}`;
    tsLookup.set(key, evt.time_et);
  }
}

// ─── Step 3: compare ─────────────────────────────────────────────────────────

let pass = true;
let checked = 0;
const drifts: string[] = [];

// Python → TS direction
for (const [eventType, events] of Object.entries(pythonEvents)) {
  for (const evt of events) {
    const key: EventKey = `${eventType}::${evt.date}`;
    const tsTime = tsLookup.get(key);
    checked++;
    if (tsTime === undefined) {
      drifts.push(`MISSING_IN_TS   ${key} (Python has ${evt.time_et}, TS has nothing)`);
      pass = false;
    } else if (tsTime !== evt.time_et) {
      drifts.push(`TIME_MISMATCH   ${key}: Python=${evt.time_et}, TS=${tsTime}`);
      pass = false;
    }
  }
}

// TS → Python direction (for statically-declared types in parity years)
for (const evt of TIER1_EVENTS) {
  if (!(PARITY_TYPES as readonly string[]).includes(evt.event_type)) continue;
  if (!PARITY_YEARS.includes(evt.date.slice(0, 4))) continue;
  const key: EventKey = `${evt.event_type}::${evt.date}`;
  const pyEvents = pythonEvents[evt.event_type] ?? [];
  const pyEntry = pyEvents.find((e) => e.date === evt.date);
  if (!pyEntry) {
    drifts.push(`MISSING_IN_PY   ${key} (TS has ${evt.time_et}, Python has nothing)`);
    pass = false;
  }
  // time mismatch already caught in the Python→TS direction above
}

// ─── Step 4: report ──────────────────────────────────────────────────────────

if (pass) {
  console.log(`[PARITY GATE] PASS — ${checked} events match exactly across FOMC/CPI/GDP/ISM/PPI (2025-2027).`);
  process.exit(0);
} else {
  console.error(`[PARITY GATE] FAIL — ${drifts.length} drift(s) found (${checked} total events checked):`);
  for (const d of drifts) {
    console.error(`  ${d}`);
  }
  console.error("");
  console.error("Fix: update tier1-event-blackout.ts to match src/engine/economic_calendar.py STATIC_EVENTS,");
  console.error("     OR update economic_calendar.py if the TS values are the correct ones.");
  process.exit(1);
}
