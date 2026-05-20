/**
 * wave23h-entry-windows-signal-time.test.ts — W23H.3
 *
 * Tests for the signal-time entry window gate in paper-signal-service.ts.
 *
 * Uses a simulation harness that mirrors the exact logic from the window-gate
 * block in paper-signal-service.ts. This avoids the 30-module bootstrap chain
 * while keeping the behavioral contract verifiable.
 *
 * Coverage:
 *  1.  Empty allowed_entry_windows → windowFiltered=false (current behavior preserved)
 *  2.  Undefined allowed_entry_windows → windowFiltered=false
 *  3.  Bar at 09:30 ET with ["09:45-12:00 ET"] → windowFiltered=true
 *  4.  Bar at 10:00 ET with ["09:45-12:00 ET"] → windowFiltered=false
 *  5.  Bar between two windows (12:15 ET) with two-window config → windowFiltered=true
 *  6.  Bar in second window (14:00 ET) → windowFiltered=false
 *  7.  Audit row written when bar is outside window — signalType="skipped_outside_window"
 *  8.  Audit row shape: windows_configured array matches strategy config
 *  9.  No audit row when bar is inside window
 *  10. Fail-open: malformed window spec → windowFiltered=false (warning logged, not throw)
 *  11. Boundary: bar at 09:45 ET → inside (left-inclusive)
 *  12. Boundary: bar at 12:00 ET → outside (right-exclusive)
 *
 * Pure simulation — no DB, no Express, no service imports.
 */

import { describe, it, expect, vi } from "vitest";
import { parseEntryWindows, isBarInAnyWindow } from "../lib/entry-windows.js";

// ─── Simulation harness ───────────────────────────────────────────────────────
// Mirrors the try/catch block from paper-signal-service.ts W23H.3 window gate.
// If the service implementation changes, this harness must be kept in sync.

interface AuditRow {
  signalType: string;
  price: string;
  indicatorSnapshot: Record<string, unknown>;
  acted: boolean;
  reason: string;
}

interface GateResult {
  windowFiltered: boolean;
  auditRows: AuditRow[];
  warnLogged: boolean;
  spanAttributes: Record<string, unknown>;
}

function simulateWindowGate(
  barTimestamp: string,
  barClose: number,
  rawWindowSpecs: unknown,
  indicators: Record<string, number> = {},
): GateResult {
  const auditRows: AuditRow[] = [];
  const spanAttributes: Record<string, unknown> = {};
  let windowFiltered = false;
  let warnLogged = false;

  // Mirror of paper-signal-service.ts W23H.3 block
  try {
    const windowSpecs = Array.isArray(rawWindowSpecs) ? (rawWindowSpecs as string[]) : [];
    if (windowSpecs.length > 0) {
      const parsedWindows = parseEntryWindows(windowSpecs);
      const barTsUtc = new Date(barTimestamp);
      const inAnyWindow = isBarInAnyWindow(barTsUtc, parsedWindows);
      if (!inAnyWindow) {
        windowFiltered = true;
        spanAttributes["entry_window_filtered"] = true;
        spanAttributes["entry_window_specs"] = windowSpecs.join("|");
        // Simulate audit row insert
        auditRows.push({
          signalType: "skipped_outside_window",
          price: String(barClose),
          indicatorSnapshot: {
            ...indicators,
            _windows_configured: windowSpecs,
            _bar_timestamp: barTimestamp,
          },
          acted: false,
          reason: `signal.skipped_outside_window: bar at ${barTimestamp} not in windows [${windowSpecs.join(", ")}]`,
        });
      }
    }
  } catch (_err) {
    warnLogged = true;
    // fail-open: windowFiltered remains false
  }

  return { windowFiltered, auditRows, warnLogged, spanAttributes };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a UTC ISO timestamp that corresponds to a given ET hour:min.
 * Uses January (EST, UTC-5) for winter and July (EDT, UTC-4) for summer. */
function makeEtTimestamp(etHour: number, etMin: number, summer = false): string {
  const offset = summer ? 4 : 5; // EDT=-4h from UTC, EST=-5h
  const utcHour = etHour + offset;
  const date = summer ? "2025-07-15" : "2025-01-15";
  return `${date}T${String(utcHour).padStart(2, "0")}:${String(etMin).padStart(2, "0")}:00.000Z`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("W23H.3 window gate — empty/absent config", () => {
  it("empty array → windowFiltered=false (current behavior preserved)", () => {
    const result = simulateWindowGate(makeEtTimestamp(9, 30), 5000, []);
    expect(result.windowFiltered).toBe(false);
    expect(result.auditRows).toHaveLength(0);
  });

  it("undefined → windowFiltered=false", () => {
    const result = simulateWindowGate(makeEtTimestamp(9, 30), 5000, undefined);
    expect(result.windowFiltered).toBe(false);
  });

  it("null → windowFiltered=false", () => {
    const result = simulateWindowGate(makeEtTimestamp(9, 30), 5000, null);
    expect(result.windowFiltered).toBe(false);
  });

  it("non-array value → windowFiltered=false (graceful)", () => {
    const result = simulateWindowGate(makeEtTimestamp(9, 30), 5000, "09:45-12:00 ET");
    expect(result.windowFiltered).toBe(false);
  });
});

describe("W23H.3 window gate — single window", () => {
  const windows = ["09:45-12:00 ET"];

  it("bar at 09:30 ET → blocked (before window start)", () => {
    const ts = makeEtTimestamp(9, 30);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(true);
  });

  it("bar at 09:45 ET → not blocked (left-inclusive boundary)", () => {
    const ts = makeEtTimestamp(9, 45);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(false);
  });

  it("bar at 10:00 ET → not blocked (inside window)", () => {
    const ts = makeEtTimestamp(10, 0);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(false);
  });

  it("bar at 11:59 ET → not blocked (just before end)", () => {
    const ts = makeEtTimestamp(11, 59);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(false);
  });

  it("bar at 12:00 ET → blocked (right-exclusive boundary)", () => {
    const ts = makeEtTimestamp(12, 0);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(true);
  });

  it("bar at 13:00 ET → blocked (after window)", () => {
    const ts = makeEtTimestamp(13, 0);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(true);
  });
});

describe("W23H.3 window gate — multiple windows", () => {
  const windows = ["09:45-12:00 ET", "13:30-15:30 ET"];

  it("bar at 12:15 ET (between windows) → blocked", () => {
    const ts = makeEtTimestamp(12, 15);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(true);
  });

  it("bar at 14:00 ET → not blocked (in second window)", () => {
    const ts = makeEtTimestamp(14, 0);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(false);
  });

  it("bar at 09:00 ET (before both windows) → blocked", () => {
    const ts = makeEtTimestamp(9, 0);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(true);
  });

  it("bar at 16:00 ET (after both windows) → blocked", () => {
    const ts = makeEtTimestamp(16, 0);
    const result = simulateWindowGate(ts, 5000, windows);
    expect(result.windowFiltered).toBe(true);
  });
});

describe("W23H.3 audit row", () => {
  const windows = ["09:45-12:00 ET"];
  const barTs = makeEtTimestamp(9, 30);
  const barClose = 5000.25;

  it("audit row written when bar is outside window", () => {
    const result = simulateWindowGate(barTs, barClose, windows, { atr_14: 4.5 });
    expect(result.auditRows).toHaveLength(1);
  });

  it("audit row has signalType=skipped_outside_window", () => {
    const result = simulateWindowGate(barTs, barClose, windows);
    expect(result.auditRows[0].signalType).toBe("skipped_outside_window");
  });

  it("audit row has acted=false", () => {
    const result = simulateWindowGate(barTs, barClose, windows);
    expect(result.auditRows[0].acted).toBe(false);
  });

  it("audit row indicatorSnapshot contains windows_configured matching config", () => {
    const result = simulateWindowGate(barTs, barClose, windows, { rsi_14: 55 });
    const snap = result.auditRows[0].indicatorSnapshot;
    expect(snap._windows_configured).toEqual(windows);
  });

  it("audit row indicatorSnapshot contains bar timestamp", () => {
    const result = simulateWindowGate(barTs, barClose, windows);
    expect(result.auditRows[0].indicatorSnapshot._bar_timestamp).toBe(barTs);
  });

  it("audit row reason contains 'signal.skipped_outside_window'", () => {
    const result = simulateWindowGate(barTs, barClose, windows);
    expect(result.auditRows[0].reason).toContain("signal.skipped_outside_window");
  });

  it("no audit row when bar is inside window", () => {
    const insideTs = makeEtTimestamp(10, 0);
    const result = simulateWindowGate(insideTs, barClose, windows);
    expect(result.auditRows).toHaveLength(0);
  });

  it("span attribute entry_window_filtered=true when blocked", () => {
    const result = simulateWindowGate(barTs, barClose, windows);
    expect(result.spanAttributes["entry_window_filtered"]).toBe(true);
  });

  it("span attribute entry_window_specs contains window string when blocked", () => {
    const result = simulateWindowGate(barTs, barClose, windows);
    expect(result.spanAttributes["entry_window_specs"]).toBe(windows[0]);
  });

  it("multi-window audit row windows_configured has all windows", () => {
    const multiWindows = ["09:45-12:00 ET", "13:30-15:30 ET"];
    const result = simulateWindowGate(makeEtTimestamp(12, 15), barClose, multiWindows);
    expect(result.auditRows[0].indicatorSnapshot._windows_configured).toEqual(multiWindows);
  });
});

describe("W23H.3 fail-open behavior", () => {
  it("malformed window spec → warnLogged=true, windowFiltered=false", () => {
    // "bad spec" will throw in parseEntryWindows; gate must fail-open
    const result = simulateWindowGate(makeEtTimestamp(9, 30), 5000, ["bad spec"]);
    expect(result.warnLogged).toBe(true);
    expect(result.windowFiltered).toBe(false);
  });
});
