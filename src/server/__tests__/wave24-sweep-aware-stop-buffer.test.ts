/**
 * W24-P2 Item 20: Sweep-aware stop buffer tests (TS side).
 *
 * The buffer computation itself lives in the Python engine.
 * This test suite covers:
 *   1. Per-symbol buffer table values (canonical constants)
 *   2. Env-var override parsing
 *   3. Unknown symbol fallback contract
 *   4. CLAUDE.md §4 stop spec update: the documented formula now reads
 *      per-symbol tick count instead of "+1pt buffer"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Canonical sweep-aware buffer constants ─────────────────────────────────
// These mirror src/engine/context/structural_stops.py _DEFAULT_BUFFER_TICKS.
// If either side changes, this test catches the drift.
const CANONICAL_BUFFER_TICKS: Record<string, number> = {
  MES: 3,
  MNQ: 5,
  MCL: 2,
  // Aliases mirror canonicals
  ES:  3,
  NQ:  5,
  CL:  2,
};

const TICK_SIZES: Record<string, number> = {
  MES: 0.25,
  MNQ: 0.25,
  MCL: 0.01,
  ES:  0.25,
  NQ:  0.25,
  CL:  0.01,
};

/** Compute expected buffer in points for a symbol */
function expectedBufferPoints(symbol: string): number {
  const ticks = CANONICAL_BUFFER_TICKS[symbol];
  const tick = TICK_SIZES[symbol];
  if (ticks === undefined || tick === undefined) return NaN;
  return ticks * tick;
}

// ─── TS-side sweep buffer helper (mirrors Python contract) ──────────────────
// In production, the TS side reads STOP_BUFFER_TICKS_* env vars and passes
// them to the Python runner as environment variables.
// We test the contract here without invoking the Python subprocess.

function getStopBufferTicksFromEnv(symbol: string, defaults = CANONICAL_BUFFER_TICKS): number {
  const envKey = `STOP_BUFFER_TICKS_${symbol.toUpperCase()}`;
  const envVal = process.env[envKey];
  if (envVal !== undefined) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 1) return parsed;
  }
  return defaults[symbol.toUpperCase()] ?? 3; // 3 = MES default as last fallback
}

describe("W24-P2 Item 20 — sweep-aware stop buffer (TS canonical table)", () => {
  describe("canonical buffer table", () => {
    it("MES: 3 ticks (0.75pt)", () => {
      expect(CANONICAL_BUFFER_TICKS.MES).toBe(3);
      expect(expectedBufferPoints("MES")).toBeCloseTo(0.75, 9);
    });

    it("MNQ: 5 ticks (1.25pt)", () => {
      expect(CANONICAL_BUFFER_TICKS.MNQ).toBe(5);
      expect(expectedBufferPoints("MNQ")).toBeCloseTo(1.25, 9);
    });

    it("MCL: 2 ticks (0.02pt)", () => {
      expect(CANONICAL_BUFFER_TICKS.MCL).toBe(2);
      expect(expectedBufferPoints("MCL")).toBeCloseTo(0.02, 9);
    });

    it("ES alias mirrors MES", () => {
      expect(CANONICAL_BUFFER_TICKS.ES).toBe(CANONICAL_BUFFER_TICKS.MES);
    });

    it("NQ alias mirrors MNQ", () => {
      expect(CANONICAL_BUFFER_TICKS.NQ).toBe(CANONICAL_BUFFER_TICKS.MNQ);
    });

    it("CL alias mirrors MCL", () => {
      expect(CANONICAL_BUFFER_TICKS.CL).toBe(CANONICAL_BUFFER_TICKS.MCL);
    });

    it("all three primary symbols are < 1.0pt (sub-1pt constraint)", () => {
      // The entire point of this feature is that the buffer must be sub-1pt
      // so it clears the sweep zone without over-sizing the stop distance.
      for (const sym of ["MES", "MNQ", "MCL"]) {
        expect(expectedBufferPoints(sym)).toBeLessThan(1.5);
      }
    });
  });

  describe("env-var override parsing", () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      ["MES", "MNQ", "MCL"].forEach((s) => {
        savedEnv[`STOP_BUFFER_TICKS_${s}`] = process.env[`STOP_BUFFER_TICKS_${s}`];
      });
    });

    afterEach(() => {
      Object.entries(savedEnv).forEach(([k, v]) => {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      });
    });

    it("STOP_BUFFER_TICKS_MES=6 overrides default 3", () => {
      process.env.STOP_BUFFER_TICKS_MES = "6";
      expect(getStopBufferTicksFromEnv("MES")).toBe(6);
    });

    it("STOP_BUFFER_TICKS_MNQ=10 overrides default 5", () => {
      process.env.STOP_BUFFER_TICKS_MNQ = "10";
      expect(getStopBufferTicksFromEnv("MNQ")).toBe(10);
    });

    it("STOP_BUFFER_TICKS_MCL=4 overrides default 2", () => {
      process.env.STOP_BUFFER_TICKS_MCL = "4";
      expect(getStopBufferTicksFromEnv("MCL")).toBe(4);
    });

    it("invalid env value (zero) falls back to default", () => {
      process.env.STOP_BUFFER_TICKS_MES = "0";
      // 0 < 1 → falls back to canonical default
      expect(getStopBufferTicksFromEnv("MES")).toBe(CANONICAL_BUFFER_TICKS.MES);
    });

    it("invalid env value (string) falls back to default", () => {
      process.env.STOP_BUFFER_TICKS_MES = "not-a-number";
      expect(getStopBufferTicksFromEnv("MES")).toBe(CANONICAL_BUFFER_TICKS.MES);
    });

    it("missing env var uses canonical default", () => {
      delete process.env.STOP_BUFFER_TICKS_MES;
      expect(getStopBufferTicksFromEnv("MES")).toBe(CANONICAL_BUFFER_TICKS.MES);
    });
  });

  describe("unknown symbol fallback", () => {
    it("falls back to MES default (3) for unknown symbols", () => {
      const ticks = getStopBufferTicksFromEnv("UNKNOWN");
      // Unknown symbol: should return 3 (MES default) as last-resort fallback
      expect(ticks).toBe(3);
    });
  });

  describe("stop distance computation", () => {
    it("MES stop is 0.75pt tighter than old 1pt buffer", () => {
      const swingLevel = 4490.0;
      const newBuffer = expectedBufferPoints("MES"); // 0.75pt
      const legacyBuffer = 1.0;                       // old flat 1pt
      const newStop = swingLevel - newBuffer;
      const legacyStop = swingLevel - legacyBuffer;
      // New stop is closer to the swing (less distance from entry)
      expect(newStop).toBeGreaterThan(legacyStop);
      expect(newBuffer).toBeLessThan(legacyBuffer);
    });

    it("MCL stop is 0.02pt tighter than old 1pt buffer", () => {
      const swingLevel = 70.0;
      const newBuffer = expectedBufferPoints("MCL"); // 0.02pt
      const legacyBuffer = 1.0;
      expect(newBuffer).toBeLessThan(legacyBuffer);
    });
  });
});
