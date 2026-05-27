/**
 * check-ts-python-pm-factor-parity.ts — Wave 26 Pass K Phase 3 CI hard gate.
 *
 * Verifies that TS src/server/lib/pm-size-factor.ts and Python
 * src/engine/pm_size_factor.py produce IDENTICAL outputs for the same UTC
 * bar timestamps across all phases (am / pm_taper / pm_floor / pm_closed)
 * and across DST boundaries.
 *
 * Without this gate: backtest (Python) and paper (TS) will silently diverge
 * on PM entries — strategy sizing would be different in the two engines and
 * backtest P&L wouldn't predict live P&L for any strategy that fires
 * entries in the 13:30-15:30 ET window.
 *
 * Exit codes:
 *   0 — all 14 fixtures pass (parity intact)
 *   1 — one or more fixtures drift (parity broken — CI FAIL)
 *
 * Usage:
 *   npx tsx scripts/check-ts-python-pm-factor-parity.ts
 *   npm run check:ts-python-pm-factor-parity
 *
 * PARITY TOLERANCE:
 *   factor: ±1e-5 (floating-point round-trip + Python round(...,6) vs
 *     TS toFixed(6) string rounding differences)
 *   phase: exact string match
 *   et_minute_of_day: exact int match
 */

import { spawnSync } from "node:child_process";
import { computePmSizeFactor } from "../src/server/lib/pm-size-factor.js";

interface Fixture {
  name: string;
  /** UTC ISO 8601 timestamp. */
  isoUtc: string;
}

// Helper: build ET wall-clock -> UTC ISO. DST-aware via Date round-trip.
function etToIsoUtc(yyyymmddHhMm: string): string {
  const [datePart, timePart] = yyyymmddHhMm.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hh + offsetHours, mm));
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(candidate);
    const match = fmt.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/);
    if (match) {
      const [, mo, da, ye, hr, mi] = match;
      const hrN = parseInt(hr, 10) === 24 ? 0 : parseInt(hr, 10);
      if (
        parseInt(ye, 10) === y && parseInt(mo, 10) === m && parseInt(da, 10) === d &&
        hrN === hh && parseInt(mi, 10) === mm
      ) return candidate.toISOString();
    }
  }
  throw new Error(`etToIsoUtc: could not construct ET time for ${yyyymmddHhMm}`);
}

const FIXTURES: Fixture[] = [
  // AM phase
  { name: "AM 09:45 ET (May EDT)", isoUtc: etToIsoUtc("2026-05-26 09:45") },
  { name: "AM 13:29 ET (last AM minute)", isoUtc: etToIsoUtc("2026-05-26 13:29") },
  // PM taper
  { name: "PM start 13:30 ET", isoUtc: etToIsoUtc("2026-05-26 13:30") },
  { name: "PM mid-taper 14:00 ET", isoUtc: etToIsoUtc("2026-05-26 14:00") },
  { name: "PM 14:15 ET (halfway)", isoUtc: etToIsoUtc("2026-05-26 14:15") },
  { name: "PM 14:45 ET (3/4 through)", isoUtc: etToIsoUtc("2026-05-26 14:45") },
  { name: "PM 14:59 ET (1 min before floor)", isoUtc: etToIsoUtc("2026-05-26 14:59") },
  // PM floor
  { name: "PM floor 15:00 ET (floor reached)", isoUtc: etToIsoUtc("2026-05-26 15:00") },
  { name: "PM floor 15:15 ET (held)", isoUtc: etToIsoUtc("2026-05-26 15:15") },
  { name: "PM floor 15:29 ET (last entry)", isoUtc: etToIsoUtc("2026-05-26 15:29") },
  // PM closed
  { name: "PM closed 15:30 ET", isoUtc: etToIsoUtc("2026-05-26 15:30") },
  { name: "PM closed 16:30 ET (post-flatten)", isoUtc: etToIsoUtc("2026-05-26 16:30") },
  // DST boundaries
  { name: "DST: PM start in EDT (March)", isoUtc: etToIsoUtc("2026-03-09 13:30") },
  { name: "DST: PM start in EST (January)", isoUtc: etToIsoUtc("2026-01-15 13:30") },
];

const PYTHON_EXE =
  process.env.PYTHON_EXE ??
  process.env.PYTHON_PATH ??
  (process.platform === "win32" ? "python" : "python3");

function callPython(isoUtc: string): { factor: number; phase: string; et_minute_of_day: number; error?: string } {
  const result = spawnSync(
    PYTHON_EXE,
    ["-m", "src.engine.pm_size_factor", isoUtc],
    { encoding: "utf-8", timeout: 15_000, cwd: process.cwd() },
  );
  if (result.status !== 0) {
    return {
      factor: NaN, phase: "ERROR", et_minute_of_day: -1,
      error: `python exit=${result.status} stderr=${result.stderr?.slice(0, 200)}`,
    };
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch (e) {
    return {
      factor: NaN, phase: "ERROR", et_minute_of_day: -1,
      error: `parse: ${e instanceof Error ? e.message : String(e)}, stdout=${result.stdout.slice(0, 200)}`,
    };
  }
}

interface Drift {
  fixture: string;
  field: string;
  ts: unknown;
  py: unknown;
  delta?: number;
}

const FACTOR_TOLERANCE = 1e-5;
const drifts: Drift[] = [];

console.log(`\nWave 26 Pass K Phase 3 — TS↔Python PM size factor parity check`);
console.log(`Python: ${PYTHON_EXE}`);
console.log(`Fixtures: ${FIXTURES.length}\n`);

for (const fx of FIXTURES) {
  const tsResult = computePmSizeFactor({ barTsUtc: new Date(fx.isoUtc) });
  const pyResult = callPython(fx.isoUtc);

  if (pyResult.error) {
    drifts.push({ fixture: fx.name, field: "python_error", ts: "n/a", py: pyResult.error });
    console.log(`  ✗ ${fx.name}: ${pyResult.error}`);
    continue;
  }

  const factorDelta = Math.abs(tsResult.factor - pyResult.factor);
  const phaseMatch = tsResult.phase === pyResult.phase;
  const etMinMatch = tsResult.etMinuteOfDay === pyResult.et_minute_of_day;
  const factorMatch = factorDelta <= FACTOR_TOLERANCE;

  if (factorMatch && phaseMatch && etMinMatch) {
    console.log(`  ✓ ${fx.name.padEnd(40)} TS=${tsResult.factor.toFixed(4)} phase=${tsResult.phase}`);
  } else {
    if (!factorMatch) {
      drifts.push({
        fixture: fx.name, field: "factor",
        ts: tsResult.factor, py: pyResult.factor, delta: factorDelta,
      });
    }
    if (!phaseMatch) {
      drifts.push({ fixture: fx.name, field: "phase", ts: tsResult.phase, py: pyResult.phase });
    }
    if (!etMinMatch) {
      drifts.push({
        fixture: fx.name, field: "et_minute_of_day",
        ts: tsResult.etMinuteOfDay, py: pyResult.et_minute_of_day,
      });
    }
    console.log(
      `  ✗ ${fx.name}: factor ts=${tsResult.factor} py=${pyResult.factor} ` +
      `(Δ=${factorDelta.toExponential(2)}) phase ts=${tsResult.phase} py=${pyResult.phase} ` +
      `etMin ts=${tsResult.etMinuteOfDay} py=${pyResult.et_minute_of_day}`,
    );
  }
}

console.log("");
if (drifts.length === 0) {
  console.log(`✓ TS↔Python PM size factor parity: ALL ${FIXTURES.length} FIXTURES MATCH`);
  process.exit(0);
} else {
  console.error(`✗ PARITY DRIFT: ${drifts.length} mismatch(es) across ${FIXTURES.length} fixtures`);
  for (const d of drifts) {
    console.error(`    ${d.fixture} | ${d.field}: ts=${JSON.stringify(d.ts)} py=${JSON.stringify(d.py)}${d.delta !== undefined ? ` (Δ=${d.delta.toExponential(2)})` : ""}`);
  }
  process.exit(1);
}
