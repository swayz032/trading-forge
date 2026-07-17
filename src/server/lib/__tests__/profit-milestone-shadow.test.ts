/**
 * profit-milestone-shadow.test.ts — Wave 6 ($250-1K campaign) shadow profit-milestone
 * governor: pure-module tests.
 *
 * Covers:
 *   - Zone boundary semantics (exact numbers from the wave plan)
 *   - Negative P&L / non-finite input handling (fail-open, never throws)
 *   - Module export surface (no exit-related exports leak in)
 *   - resolveProfitMilestoneShadowEnabled lane/env precedence (default-ON, the ONE
 *     deliberate inversion of consistency-lane's default-OFF)
 *   - decideProfitMilestoneTransition dedup/transition algorithm
 *   - A synthetic session P&L progression (100 -> 300 -> 600) proving exactly one
 *     STRONG-zone shadow row's worth of emission fires, matching the exact algorithm
 *     wired into paper-signal-service.ts (see the wiring test for source-level proof
 *     that the production code calls this same function).
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as profitMilestoneShadow from "../profit-milestone-shadow.js";
import {
  evaluateProfitMilestone,
  resolveProfitMilestoneShadowEnabled,
  decideProfitMilestoneTransition,
  type ProfitMilestoneZone,
} from "../profit-milestone-shadow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("evaluateProfitMilestone — zone boundaries", () => {
  it("249.99 -> NORMAL", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 249.99 }).zone).toBe("NORMAL");
  });
  it("250 -> BASE (inclusive lower bound)", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 250 }).zone).toBe("BASE");
  });
  it("499.99 -> BASE", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 499.99 }).zone).toBe("BASE");
  });
  it("500 -> STRONG (inclusive lower bound)", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 500 }).zone).toBe("STRONG");
  });
  it("999.99 -> STRONG", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 999.99 }).zone).toBe("STRONG");
  });
  it("1000 -> EXCEPTIONAL (inclusive lower bound)", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 1000 }).zone).toBe("EXCEPTIONAL");
  });
  it("well above 1000 stays EXCEPTIONAL (no ceiling — uncapped upside)", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 50000 }).zone).toBe("EXCEPTIONAL");
  });
  it("0 -> NORMAL", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 0 }).zone).toBe("NORMAL");
  });

  it("echoes back the exact finite sessionPnl supplied", () => {
    expect(evaluateProfitMilestone({ sessionPnl: 733.21 }).sessionPnl).toBe(733.21);
  });
});

describe("evaluateProfitMilestone — negative P&L", () => {
  it("-500 -> NORMAL (no negative-milestone concept)", () => {
    const result = evaluateProfitMilestone({ sessionPnl: -500 });
    expect(result.zone).toBe("NORMAL");
    expect(result.sessionPnl).toBe(-500);
  });
  it("deeply negative P&L -> NORMAL, never throws", () => {
    expect(() => evaluateProfitMilestone({ sessionPnl: -1_000_000 })).not.toThrow();
    expect(evaluateProfitMilestone({ sessionPnl: -1_000_000 }).zone).toBe("NORMAL");
  });
});

describe("evaluateProfitMilestone — non-finite / malformed input never throws", () => {
  it("NaN -> NORMAL, does not throw", () => {
    expect(() => evaluateProfitMilestone({ sessionPnl: NaN })).not.toThrow();
    const result = evaluateProfitMilestone({ sessionPnl: NaN });
    expect(result.zone).toBe("NORMAL");
    expect(result.sessionPnl).toBe(0);
  });
  it("Infinity -> NORMAL, does not throw", () => {
    const result = evaluateProfitMilestone({ sessionPnl: Infinity });
    expect(result.zone).toBe("NORMAL");
    expect(result.sessionPnl).toBe(0);
  });
  it("-Infinity -> NORMAL, does not throw", () => {
    const result = evaluateProfitMilestone({ sessionPnl: -Infinity });
    expect(result.zone).toBe("NORMAL");
    expect(result.sessionPnl).toBe(0);
  });
  it("non-number sessionPnl (any-typed caller) -> NORMAL, does not throw", () => {
    // Simulates a loosely-typed JS caller passing a bad value past the TS boundary.
    const badInput = { sessionPnl: "not a number" as unknown as number };
    expect(() => evaluateProfitMilestone(badInput)).not.toThrow();
    expect(evaluateProfitMilestone(badInput).zone).toBe("NORMAL");
  });
  it("null/undefined input object -> NORMAL, does not throw (structural fail-open)", () => {
    expect(() => evaluateProfitMilestone(null as unknown as { sessionPnl: number })).not.toThrow();
    expect(evaluateProfitMilestone(null as unknown as { sessionPnl: number }).zone).toBe("NORMAL");
    expect(() => evaluateProfitMilestone(undefined as unknown as { sessionPnl: number })).not.toThrow();
    expect(evaluateProfitMilestone(undefined as unknown as { sessionPnl: number }).zone).toBe("NORMAL");
  });
});

describe("module export surface — no exit-related exports, pure module only", () => {
  it("exports exactly the evaluator + resolver + transition-decider functions (no exit/DB/broker exports)", () => {
    const exportedNames = Object.keys(profitMilestoneShadow).sort();
    expect(exportedNames).toEqual(
      ["decideProfitMilestoneTransition", "evaluateProfitMilestone", "resolveProfitMilestoneShadowEnabled"].sort(),
    );
  });

  it("has zero imports — no DB/network/exit module can be reachable from this file", () => {
    // Read the module's own source text (not the compiled output) to prove, structurally,
    // that this file cannot call into any exit/position/DB/broker module: it imports nothing.
    // This is the "exits never evaluated" guarantee for the pure module half of the wave.
    const src = readFileSync(
      resolve(__dirname, "../profit-milestone-shadow.ts"),
      "utf-8",
    ).replace(/\r\n/g, "\n");
    expect(src).not.toMatch(/^\s*import /m);
    // Belt-and-suspenders: explicitly confirm no reference to any exit/close/broker/DB
    // identifier anywhere in the file text.
    const forbidden = [
      "closePosition", "applyExitDecision", "bookPartialClose", "forceCloseAllPositions",
      "openPosition", "routeOrder", "broadcastSSE", "insertAuditRow", "db.insert", "db.select",
    ];
    for (const token of forbidden) {
      expect(src).not.toContain(token);
    }
  });
});

describe("decideProfitMilestoneTransition — dedup/transition algorithm", () => {
  it("first entry into STRONG (marker null -> STRONG) emits", () => {
    const decision = decideProfitMilestoneTransition(null, "STRONG");
    expect(decision.emit).toBe(true);
    expect(decision.nextMarker).toBe("STRONG");
  });

  it("staying in STRONG on a later bar (marker already STRONG) does NOT re-emit", () => {
    const decision = decideProfitMilestoneTransition("STRONG", "STRONG");
    expect(decision.emit).toBe(false);
    expect(decision.nextMarker).toBe("STRONG");
  });

  it("STRONG -> EXCEPTIONAL is a fresh transition and emits again", () => {
    const decision = decideProfitMilestoneTransition("STRONG", "EXCEPTIONAL");
    expect(decision.emit).toBe(true);
    expect(decision.nextMarker).toBe("EXCEPTIONAL");
  });

  it("staying in EXCEPTIONAL does NOT re-emit", () => {
    const decision = decideProfitMilestoneTransition("EXCEPTIONAL", "EXCEPTIONAL");
    expect(decision.emit).toBe(false);
    expect(decision.nextMarker).toBe("EXCEPTIONAL");
  });

  it("BASE never emits even with no prior marker", () => {
    const decision = decideProfitMilestoneTransition(null, "BASE");
    expect(decision.emit).toBe(false);
    expect(decision.nextMarker).toBeNull();
  });

  it("NORMAL never emits", () => {
    const decision = decideProfitMilestoneTransition(null, "NORMAL");
    expect(decision.emit).toBe(false);
    expect(decision.nextMarker).toBeNull();
  });

  it("falling back from STRONG to BASE clears the marker (no emit)", () => {
    const decision = decideProfitMilestoneTransition("STRONG", "BASE");
    expect(decision.emit).toBe(false);
    expect(decision.nextMarker).toBeNull();
  });

  it("re-entering STRONG after falling back logs a FRESH transition", () => {
    // Simulates: STRONG (logged) -> BASE (marker cleared) -> STRONG again (re-logs)
    const fallback = decideProfitMilestoneTransition("STRONG", "BASE");
    expect(fallback.nextMarker).toBeNull();
    const reentry = decideProfitMilestoneTransition(fallback.nextMarker, "STRONG");
    expect(reentry.emit).toBe(true);
    expect(reentry.nextMarker).toBe("STRONG");
  });
});

describe("synthetic session P&L progression — 100 -> 300 -> 600", () => {
  it("emits exactly one STRONG-zone shadow row at the 600 point, none at 100 or 300", () => {
    let marker: ProfitMilestoneZone | null = null;
    const emitted: Array<{ pnl: number; zone: ProfitMilestoneZone }> = [];

    for (const pnl of [100, 300, 600]) {
      const result = evaluateProfitMilestone({ sessionPnl: pnl });
      const decision = decideProfitMilestoneTransition(marker, result.zone);
      marker = decision.nextMarker;
      if (decision.emit) {
        emitted.push({ pnl, zone: result.zone });
      }
    }

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({ pnl: 600, zone: "STRONG" });
  });
});

describe("resolveProfitMilestoneShadowEnabled — lane/env precedence (default ON)", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it("DEFAULT is ON when nothing is set — the deliberate inversion of consistency-lane's default-OFF", () => {
    delete process.env.PROFIT_MILESTONE_SHADOW_ENABLED;
    expect(resolveProfitMilestoneShadowEnabled(null)).toBe(true);
    expect(resolveProfitMilestoneShadowEnabled(undefined)).toBe(true);
    expect(resolveProfitMilestoneShadowEnabled({})).toBe(true);
  });

  it("env PROFIT_MILESTONE_SHADOW_ENABLED=false flips default OFF", () => {
    process.env.PROFIT_MILESTONE_SHADOW_ENABLED = "false";
    expect(resolveProfitMilestoneShadowEnabled(null)).toBe(false);
  });

  it("env PROFIT_MILESTONE_SHADOW_ENABLED=0 flips default OFF", () => {
    process.env.PROFIT_MILESTONE_SHADOW_ENABLED = "0";
    expect(resolveProfitMilestoneShadowEnabled(undefined)).toBe(false);
  });

  it("env PROFIT_MILESTONE_SHADOW_ENABLED=true / 1 stays ON (redundant with default, but explicit)", () => {
    process.env.PROFIT_MILESTONE_SHADOW_ENABLED = "true";
    expect(resolveProfitMilestoneShadowEnabled(null)).toBe(true);
    process.env.PROFIT_MILESTONE_SHADOW_ENABLED = "1";
    expect(resolveProfitMilestoneShadowEnabled(null)).toBe(true);
  });

  it("explicit per-session true wins over env false", () => {
    process.env.PROFIT_MILESTONE_SHADOW_ENABLED = "false";
    expect(resolveProfitMilestoneShadowEnabled({ profit_milestone_shadow_enabled: true })).toBe(true);
  });

  it("explicit per-session false wins over env true and over the ON default", () => {
    process.env.PROFIT_MILESTONE_SHADOW_ENABLED = "true";
    expect(resolveProfitMilestoneShadowEnabled({ profit_milestone_shadow_enabled: false })).toBe(false);
    delete process.env.PROFIT_MILESTONE_SHADOW_ENABLED;
    expect(resolveProfitMilestoneShadowEnabled({ profit_milestone_shadow_enabled: false })).toBe(false);
  });
});
