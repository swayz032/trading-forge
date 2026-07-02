/**
 * backtester-eligibility-gate-honesty.test.ts — Band B2 (spec-onboarding-bridge, 2026-07-02)
 *
 * Verified deep-scan finding this session: `apply_eligibility_gate()` in
 * src/engine/backtester.py stamped `gate_stats["mode"] = "tf_institutional_overlay"`
 * BEFORE checking whether the strategy is registered in playbook_router.ALL_STRATS.
 * An unregistered strategy therefore silently bypassed the 7-layer confluence overlay
 * while its gate_stats blob claimed the overlay ran — indistinguishable from a genuine
 * institutional-overlay run without reading engine source. Every Mode A/B research run
 * and every onboarded-but-unregistered strategy backtest was silently unfiltered.
 *
 * This is a pure source-contract test (readFileSync + string/regex checks) — it does
 * NOT import backtester.py. Per CLAUDE.md: "bare import of any module that
 * transitively pulls the vectorbt-JIT backtester HANGS under pytest collection on the
 * tower" — the same hazard applies to any Python subprocess harness here, so this test
 * intentionally stays at the TypeScript/text level, mirroring the existing pattern in
 * lifecycle-archetype-promotion.test.ts's "source contract analysis" section.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("backtester.py apply_eligibility_gate — honest gate_stats.mode ordering", () => {
  const backtesterPath = resolve(process.cwd(), "src/engine/backtester.py");
  let source: string;

  beforeAll(() => {
    source = readFileSync(backtesterPath, "utf-8");
  });

  it("backtester.py exists", () => {
    expect(existsSync(backtesterPath)).toBe(true);
  });

  it("the unregistered-strategy bypass check appears BEFORE the tf_institutional_overlay stamp", () => {
    const bypassCheckIdx = source.indexOf("strat_normalized not in all_normalized");
    const overlayStampIdx = source.indexOf('gate_stats["mode"] = "tf_institutional_overlay"');
    expect(bypassCheckIdx, "unregistered-strategy bypass check not found").toBeGreaterThan(-1);
    expect(overlayStampIdx, '"tf_institutional_overlay" stamp not found').toBeGreaterThan(-1);
    expect(bypassCheckIdx).toBeLessThan(overlayStampIdx);
  });

  it("an unregistered-strategy bypass stamps an honest, distinct mode label", () => {
    expect(source).toContain('gate_stats["mode"] = "passthrough_strategy_unregistered"');
    // The honest mode must be set INSIDE the same conditional branch that returns early
    // for an unregistered strategy, and BEFORE that return statement.
    const modeIdx = source.indexOf('gate_stats["mode"] = "passthrough_strategy_unregistered"');
    const returnIdx = source.indexOf(
      "return entry_signals, exit_signals, gate_stats",
      modeIdx,
    );
    expect(returnIdx, "no return statement found after the honest mode stamp").toBeGreaterThan(modeIdx);
  });

  it("the bypass branch also records a passthrough_reason (mirrors the htf_cache passthrough sibling fix)", () => {
    expect(source).toContain('gate_stats["passthrough_reason"] = f"strategy_name=');
  });

  it("the sibling htf_cache passthrough fix (deep-scan #10) is still intact — this fix did not regress it", () => {
    expect(source).toContain('gate_stats["mode"] = "passthrough_htf_unavailable"');
    const htfIdx = source.indexOf('gate_stats["mode"] = "passthrough_htf_unavailable"');
    const overlayStampIdx = source.indexOf('gate_stats["mode"] = "tf_institutional_overlay"');
    expect(htfIdx).toBeLessThan(overlayStampIdx);
  });

  it("only ONE unconditional tf_institutional_overlay stamp exists (not duplicated elsewhere in the gate)", () => {
    const matches = source.match(/gate_stats\["mode"\] = "tf_institutional_overlay"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
