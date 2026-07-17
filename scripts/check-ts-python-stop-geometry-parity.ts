/**
 * check-ts-python-stop-geometry-parity.ts — Wave 2 (2026-07-16) CI hard gate.
 *
 * Verifies that the TS stop-geometry helpers (src/server/lib/stop-geometry.ts:
 * managedStopPts / sizingStopPts) and the Python mirror
 * (src/engine/stop_geometry.py: managed_stop_pts / sizing_stop_pts) produce
 * IDENTICAL geometry across a symbol × ATR × multiplier grid, AND that the
 * core invariant sizingStopPts >= managedStopPts holds in BOTH languages for
 * every cell.
 *
 * Without this gate: the paper engine (TS) and the backtester (Python) could
 * silently drift on the stop distance a trade is managed and sized against —
 * the exact defect Wave 2 fixed. A drift here means backtest P&L no longer
 * predicts paper P&L and promotion evidence is measured on a different trade
 * than the one that shipped.
 *
 * Mechanics mirror scripts/check-ts-python-pm-factor-parity.ts: import the REAL
 * TS helpers in-process, spawn Python ONCE per env-config to evaluate the REAL
 * src.engine.stop_geometry over the SAME fixture grid, compare within 1e-9.
 * Fail-CLOSED: any mismatch, any invariant violation, or any Python error → exit 1.
 *
 * Coverage:
 *   - Base grid: {MES,MNQ,MCL,ZZZ} × ATR {0.5,3,4,8,9.34,50} × mult {1.5,2.0,5.0}
 *   - Two env-override subprocess runs proving env floor semantics stay in parity:
 *       STOP_FLOOR_PTS_MNQ=12  (opt-in floor widens MNQ sizing)
 *       STOP_FLOOR_PTS_MES=0   (disables the default MES floor)
 *
 * Exit codes:
 *   0 — every cell matches within tolerance and the invariant holds
 *   1 — any drift / invariant violation / Python error (parity broken — CI FAIL)
 *
 * Usage:
 *   npx tsx scripts/check-ts-python-stop-geometry-parity.ts
 *   npm run check:ts-python-stop-geometry-parity
 */

import { spawnSync } from "node:child_process";
import { managedStopPts, sizingStopPts } from "../src/server/lib/stop-geometry.js";

const TOLERANCE = 1e-9;

const SYMBOLS = ["MES", "MNQ", "MCL", "ZZZ"] as const;
const ATRS = [0.5, 3, 4, 8, 9.34, 50] as const;
const MULTS = [1.5, 2.0, 5.0] as const;

type Cell = [symbol: string, atr: number, mult: number];
type PyResult = { managed: number; sizing: number };

const PYTHON_EXE =
  process.env.PYTHON_EXE ??
  process.env.PYTHON_PATH ??
  (process.platform === "win32" ? "python" : "python3");

function buildGrid(): Cell[] {
  const cells: Cell[] = [];
  for (const s of SYMBOLS) for (const a of ATRS) for (const m of MULTS) cells.push([s, a, m]);
  return cells;
}

function callPython(cells: Cell[], extraEnv: Record<string, string> = {}): PyResult[] | { error: string } {
  const result = spawnSync(
    PYTHON_EXE,
    ["-m", "src.engine.stop_geometry"],
    {
      encoding: "utf-8",
      timeout: 30_000,
      cwd: process.cwd(),
      input: JSON.stringify({ cells }),
      env: { ...process.env, ...extraEnv },
    },
  );
  if (result.status !== 0) {
    return { error: `python exit=${result.status} stderr=${(result.stderr ?? "").slice(0, 300)}` };
  }
  try {
    return JSON.parse((result.stdout ?? "").trim()) as PyResult[];
  } catch (e) {
    return { error: `parse: ${e instanceof Error ? e.message : String(e)}, stdout=${(result.stdout ?? "").slice(0, 200)}` };
  }
}

interface Drift {
  label: string;
  cell: Cell;
  field: string;
  ts: number;
  py: number;
  delta?: number;
}

const drifts: Drift[] = [];
let cellCount = 0;

/**
 * Evaluate one grid under an env config. `extraEnv` is applied to BOTH the
 * spawned Python (via env) and the in-process TS helpers (via process.env, read
 * at call time by getStopFloorPts). Restores process.env after.
 */
function checkGrid(label: string, cells: Cell[], extraEnv: Record<string, string> = {}): void {
  // Apply env for the TS in-process helpers (getStopFloorPts reads process.env fresh).
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(extraEnv)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const py = callPython(cells, extraEnv);
    if ("error" in py) {
      drifts.push({ label, cell: ["<n/a>", 0, 0], field: "python_error", ts: NaN, py: NaN, delta: NaN });
      console.error(`  ✗ [${label}] python error: ${py.error}`);
      return;
    }
    for (let i = 0; i < cells.length; i++) {
      const [sym, atr, mult] = cells[i];
      cellCount++;
      const tsManaged = managedStopPts(sym, atr, mult);
      const tsSizing = sizingStopPts(sym, atr, mult);
      const pyManaged = py[i].managed;
      const pySizing = py[i].sizing;

      const dManaged = Math.abs(tsManaged - pyManaged);
      const dSizing = Math.abs(tsSizing - pySizing);
      if (dManaged > TOLERANCE) drifts.push({ label, cell: cells[i], field: "managed", ts: tsManaged, py: pyManaged, delta: dManaged });
      if (dSizing > TOLERANCE) drifts.push({ label, cell: cells[i], field: "sizing", ts: tsSizing, py: pySizing, delta: dSizing });

      // INVARIANT: sizing >= managed, in BOTH languages (tolerance-guarded).
      if (tsSizing - tsManaged < -TOLERANCE) {
        drifts.push({ label, cell: cells[i], field: "invariant_ts(sizing>=managed)", ts: tsSizing, py: tsManaged });
      }
      if (pySizing - pyManaged < -TOLERANCE) {
        drifts.push({ label, cell: cells[i], field: "invariant_py(sizing>=managed)", ts: pySizing, py: pyManaged });
      }
    }
    console.log(`  ✓ [${label}] ${cells.length} cells checked (both helpers + invariant)`);
  } finally {
    for (const [k, prev] of Object.entries(saved)) {
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
  }
}

console.log(`\nWave 2 — TS↔Python stop-geometry parity check`);
console.log(`Python: ${PYTHON_EXE}`);
console.log(`Grid: ${SYMBOLS.length} symbols × ${ATRS.length} ATRs × ${MULTS.length} mults = ${SYMBOLS.length * ATRS.length * MULTS.length} cells/config\n`);

const grid = buildGrid();
checkGrid("base (default env)", grid);
checkGrid("env STOP_FLOOR_PTS_MNQ=12", grid, { STOP_FLOOR_PTS_MNQ: "12" });
checkGrid("env STOP_FLOOR_PTS_MES=0", grid, { STOP_FLOOR_PTS_MES: "0" });

console.log("");
if (drifts.length === 0) {
  console.log(`✓ TS↔Python stop-geometry parity: ALL ${cellCount} CELLS MATCH + invariant holds`);
  process.exit(0);
} else {
  console.error(`✗ PARITY DRIFT: ${drifts.length} mismatch(es)`);
  for (const d of drifts) {
    console.error(
      `    [${d.label}] ${JSON.stringify(d.cell)} | ${d.field}: ts=${d.ts} py=${d.py}` +
      (d.delta !== undefined ? ` (Δ=${Number.isNaN(d.delta) ? "n/a" : d.delta.toExponential(2)})` : ""),
    );
  }
  process.exit(1);
}
