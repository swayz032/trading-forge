/**
 * style-c-tp1-risk.test.ts — F-1 (deep-scan re-scan 2026-07-10, HIGH)
 *
 * RED-proof for the Style C TP1 R-basis unification. The BE+1 stop tracker in
 * paper-signal-service.ts recomputed R from the LIVE current-bar ATR while the real TP1
 * partial-close (paper-execution-service.ts) used the STATIC entry-time initialStopPrice —
 * so the BE+1 stop move fired on a floating target and failed to move to break-even when
 * the real TP1 actually filled (widened runner risk). Both now derive R via
 * styleCTp1RiskPoints(). These tests lock: static wins over live ATR; parity with the
 * exec-service basis; the pre-0179 null fallback.
 */

import { describe, it, expect } from "vitest";
import { styleCTp1RiskPoints } from "../style-c-tp1-risk.js";

describe("styleCTp1RiskPoints — static entry-time R (F-1)", () => {
  it("uses |entry - initialStopPrice| and IGNORES the live-ATR fallback when the stop is set", () => {
    // entry 5000, static stop 4994 → R = 6, regardless of a wildly different live-ATR fallback.
    const r = styleCTp1RiskPoints({ entryPrice: 5000, initialStopPrice: 4994, atrFallbackPoints: 999 });
    expect(r).toBe(6);
  });

  it("THE BUG, PROVEN: floating live-ATR would give a different R; static basis does not", () => {
    // Entry-time ATR=4 → static stop 4994 → real R = 6 (fixed).
    // Later bar ATR drifts to 6 → the OLD tracker would compute atrFallback = 6×1.5 = 9 (float).
    // The fix must return the STATIC 6, not the floating 9 — otherwise the BE+1 move fires on
    // the wrong target and the stop doesn't move when the real TP1 (entry+6) fills.
    const staticR = styleCTp1RiskPoints({ entryPrice: 5000, initialStopPrice: 4994, atrFallbackPoints: 9 });
    const floatingR = 9; // what the pre-fix live-ATR recompute produced on the drifted bar
    expect(staticR).toBe(6);
    expect(staticR).not.toBe(floatingR);
  });

  it("parity: same input → same R as the exec-service partial-close basis (|entry - initialStopPrice|)", () => {
    // Mirror the exec-service callExitHandler computation: stopPts = |entryPrice - initialStopPrice|.
    for (const [entry, stop] of [[5000, 4994], [70.5, 71.5], [18000, 17975]] as const) {
      const execBasis = Math.abs(entry - stop);
      const trackerBasis = styleCTp1RiskPoints({ entryPrice: entry, initialStopPrice: stop, atrFallbackPoints: 123 });
      expect(trackerBasis).toBe(execBasis);
    }
  });

  it("short side: abs distance (never negative) when stop is above entry", () => {
    expect(styleCTp1RiskPoints({ entryPrice: 5000, initialStopPrice: 5006, atrFallbackPoints: 0 })).toBe(6);
  });

  it("pre-0179 fallback: null initialStopPrice → uses the ATR fallback (legacy grandfather edge)", () => {
    expect(styleCTp1RiskPoints({ entryPrice: 5000, initialStopPrice: null, atrFallbackPoints: 9 })).toBe(9);
    expect(styleCTp1RiskPoints({ entryPrice: 5000, initialStopPrice: undefined, atrFallbackPoints: 7.5 })).toBe(7.5);
  });

  it("degenerate: non-finite stop → fallback; non-finite fallback → 0", () => {
    expect(styleCTp1RiskPoints({ entryPrice: 5000, initialStopPrice: NaN, atrFallbackPoints: 4 })).toBe(4);
    expect(styleCTp1RiskPoints({ entryPrice: 5000, initialStopPrice: null, atrFallbackPoints: NaN })).toBe(0);
    expect(styleCTp1RiskPoints({ entryPrice: 5000, initialStopPrice: null, atrFallbackPoints: -3 })).toBe(0);
  });
});

// ─── Wiring guard: the tracker actually uses the helper on the static basis ────
describe("wiring contract — paper-signal-service BE+1 tracker uses styleCTp1RiskPoints (F-1)", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  const { dirname, resolve } = require("node:path") as typeof import("node:path");
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../services/paper-signal-service.ts"),
    "utf-8",
  );

  it("imports and calls styleCTp1RiskPoints with initialStopPrice (not a raw live-ATR recompute)", () => {
    expect(src).toContain('from "../lib/style-c-tp1-risk.js"');
    expect(src).toMatch(/styleCTp1RiskPoints\s*\(/);
    // The initialRiskPoints used for the TP1 threshold must be the helper's output.
    expect(src).toMatch(/const\s+initialRiskPoints\s*=\s*styleCTp1RiskPoints\s*\(/);
    // And it must be fed the position's static stop.
    const callIdx = src.indexOf("styleCTp1RiskPoints({");
    expect(callIdx).toBeGreaterThan(-1);
    const callBlock = src.slice(callIdx, callIdx + 220);
    expect(callBlock).toContain("initialStopPrice: openPos.initialStopPrice");
  });
});
