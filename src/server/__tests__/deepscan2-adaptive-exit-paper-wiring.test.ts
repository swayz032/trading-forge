/**
 * deep-scan #2 (2026-07-11) — adaptive-exit engine was DORMANT on the paper deferred-fill path.
 *
 * openPosition() only computes the adaptive exit plan when `adaptiveExitInput` is passed, but the
 * paper deferred-fill call site (paper-signal-service.ts — the sole paper entry path) never passed
 * it, so every `exit_style="adaptive"` strategy silently ran static_styleC on paper while the
 * backtester ran adaptive (a paper/backtest parity gap). This locks in the two wiring points:
 *
 *   (A) paper-signal-service forwards adaptiveExitInput on the deferred fill, gated to adaptive-opted
 *       strategies, with narrativePhase=null and NO explicit entry.stop.
 *   (B) paper-execution-service derives the exit-plan R-basis stop from actualEntry ∓ atr×2.0 when the
 *       caller omits entry.stop, and uses that SAME value as the position's initialStopPrice (zero
 *       drift between the managed stop and the R-basis the TP levels are computed off).
 *
 * Source-structure assertions (the idiom used by cf4-cf5 + paper-execution deep-scan tests): a
 * silent revert of either wiring point re-introduces the dormancy, and these greps catch it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) =>
  readFileSync(resolve(__dirnameLocal, "../services", rel), "utf8");

const SIGNAL = readSrc("paper-signal-service.ts");
const EXEC = readSrc("paper-execution-service.ts");

describe("deep-scan #2 — adaptive exit paper wiring", () => {
  it("(A) deferred-fill forwards adaptiveExitInput gated to exit_style=adaptive", () => {
    // the deferred-fill openPosition call now carries adaptiveExitInput...
    expect(SIGNAL).toContain("adaptiveExitInput:");
    // ...gated to the opt-in exit_style so default static_styleC strategies stay byte-identical
    expect(SIGNAL).toContain('sessionConfig.exitPlanConfig?.exit_style === "adaptive"');
    // ...forwarding the strategy's exit_plan_config + a null narrativePhase (parity-faithful:
    // the backtester's compute_exit_plan_python passes no narrative_phase)
    expect(SIGNAL).toMatch(/exit_plan_config:\s*sessionConfig\.exitPlanConfig/);
    expect(SIGNAL).toMatch(/narrativePhase:\s*null/);
  });

  it("(A) CachedSession carries the strategy's separate exit_plan_config column", () => {
    expect(SIGNAL).toMatch(/exitPlanConfig:\s*ExitPlanConfig\s*\|\s*null/);
    expect(SIGNAL).toMatch(/exitPlanConfig:\s*\(strategy\.exitPlanConfig/);
  });

  it("(B) openPosition derives the exit-plan R-basis stop when the caller omits it", () => {
    expect(EXEC).toContain("resolvedExitBasisStop");
    // explicit caller stop wins; else derive from ATR
    expect(EXEC).toMatch(/adaptiveInput\?\.entry\?\.stop/);
    // fresh-scan HIGH#2 (2026-07-12): ADAPTIVE strategies derive min(ceiling, atr*1.5) to match the
    // backtester's _apply_adaptive_management; static_styleC keeps atr*2.0. (Was atr*2.0 for both.)
    expect(EXEC).toMatch(/Math\.min\(getStopCeilingPts\(params\.symbol\),\s*params\.atr\s*\*\s*1\.5\)/);
    expect(EXEC).toMatch(/params\.atr\s*\*\s*2\.0/); // static_styleC branch still present
  });

  it("(B) the managed initialStopPrice uses the SAME resolved basis (zero drift)", () => {
    // initialStopPriceForInsert precedence-1 returns resolvedExitBasisStop
    expect(EXEC).toMatch(/if\s*\(resolvedExitBasisStop\s*!=\s*null\)\s*\{\s*\n\s*return resolvedExitBasisStop;/);
    // both exit-plan branches are guarded on a non-null resolved stop (fail-soft otherwise)
    expect(EXEC).toContain('exitStyle === "adaptive" && adaptiveInput != null && resolvedExitBasisStop != null');
    expect(EXEC).toContain('exitStyle === "static_styleC" && adaptiveInput != null && resolvedExitBasisStop != null');
  });

  it("(B) entry.stop is OPTIONAL in the adaptiveExitInput contract", () => {
    // the type must allow omission so openPosition can source the stop internally
    expect(EXEC).toMatch(/entry\?:\s*\{\s*stop:\s*number\s*\}/);
  });
});
