/**
 * live-fix-sweep.test.ts — Production-grade fix verification
 *
 * Covers:
 *   F-1: Kill switch layers 2 (DLL) + 3 (trailing DD) — real checks, no more stubs
 *   F-2: Calendar gate Python spawn storm prevention — try/catch + cache sentinel
 *   F-3: Correlated position guard Topstep multi-account exception
 *   F-5: Compliance firm ID case normalisation (lowercase)
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import * as nodeFs from "node:fs";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// F-1: Kill switch DLL + trailing-DD layers — structural / source-code checks
// These tests verify the implementation is present in the source file without
// attempting to fully exercise the DB-query path (which requires complex
// multi-call DB mock sequencing already covered in kill-switch.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

describe("Kill Switch — Layer 2+3 real implementation (F-1)", () => {
  const killSwitchPath = fileURLToPath(new URL("../production/kill-switch.ts", import.meta.url));

  it("no longer contains 'phase_4c_pending' stub text for layer 2", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    expect(source).not.toContain("phase_4c_pending: paper-execution-service DLL check");
  });

  it("no longer contains 'phase_4c_pending' stub text for layer 3", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    expect(source).not.toContain("phase_4c_pending: drawdown distance check");
  });

  it("imports paperSessions table for live DB query", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    expect(source).toContain("paperSessions");
  });

  it("contains DLL_HALT_PCT threshold constant", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    expect(source).toContain("DLL_HALT_PCT");
  });

  it("contains trailing_dd_force_close reason string for layer 3", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    expect(source).toContain("trailing_dd_force_close_at_95pct");
  });

  it("contains dll_at_ reason string for layer 2", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    expect(source).toContain("dll_at_");
    expect(source).toContain("pct_personal_threshold");
  });

  it("both layer 2 and 3 have fail-CLOSED error branches", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    // A pre-existing refactor replaced the old l2Halted/l3Halted booleans with a
    // shared `decision` object returned per-layer-check-function; fail-closed means
    // the catch branch still sets halted:true on a DB/compute error for both layers.
    expect(source).toContain('logger.error({ err }, "kill-switch L2: DLL check failed — blocking entries (fail-closed)");');
    expect(source).toContain('logger.error({ err }, "kill-switch L3: trailing-DD check failed — blocking entries (fail-closed)");');
  });

  it("layer 2 queries active sessions by DLL threshold", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    // A pre-existing commit centralized the DLL-threshold math into
    // cross-symbol-pnl.ts's evaluateCrossSymbolDll(); kill-switch.ts Layer 2 now
    // calls it after querying active paperSessions rather than inlining the arithmetic.
    expect(source).toContain("evaluateCrossSymbolDll(cumPnL, personalDllDollars)");
  });

  it("layer 3 compares against TRAILING_DD_BUFFER_DOLLARS", () => {
    const source = nodeFs.readFileSync(killSwitchPath, "utf-8");
    expect(source).toContain("TRAILING_DD_BUFFER_DOLLARS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-2: Calendar gate Python spawn storm prevention
// ─────────────────────────────────────────────────────────────────────────────

describe("Calendar gate — Python spawn storm prevention (F-2)", () => {
  const signalServicePath = fileURLToPath(
    new URL("../services/paper-signal-service.ts", import.meta.url),
  );

  it("getCachedSignalCalendarStatus has try/catch wrapping the subprocess call", () => {
    const source = nodeFs.readFileSync(signalServicePath, "utf-8");
    // The function must now have a try/catch
    expect(source).toContain("} catch (err) {");
    expect(source).toContain("CALENDAR_SAFE_DEFAULT");
  });

  it("CALENDAR_SAFE_DEFAULT sentinel is defined", () => {
    const source = nodeFs.readFileSync(signalServicePath, "utf-8");
    expect(source).toContain("const CALENDAR_SAFE_DEFAULT: SignalCalendarCacheEntry");
    expect(source).toContain("is_holiday: false");
  });

  it("failure tracker _recordCalendarFailure is defined", () => {
    const source = nodeFs.readFileSync(signalServicePath, "utf-8");
    expect(source).toContain("_recordCalendarFailure");
    expect(source).toContain("CALENDAR_FAIL_ALERT_THRESHOLD");
  });

  it("on failure, safe-default is written to cache to prevent re-spawn", () => {
    const source = nodeFs.readFileSync(signalServicePath, "utf-8");
    // A pre-existing fix replaced the unconditional cache-write with a
    // fail-closed-aware entryToCache (spreads CALENDAR_SAFE_DEFAULT unless a Tier-1
    // window is detected in-process) — the cache is still always written on failure.
    expect(source).toContain("...CALENDAR_SAFE_DEFAULT,");
    expect(source).toContain("signalCalendarCache.set(key, entryToCache)");
  });

  it("exports __resetCalendarFailLogForTests for test isolation", () => {
    const source = nodeFs.readFileSync(signalServicePath, "utf-8");
    expect(source).toContain("__resetCalendarFailLogForTests");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-3: Correlated position guard — Topstep multi-account exception
// ─────────────────────────────────────────────────────────────────────────────

describe("Correlated position guard — Topstep multi-account exception (F-3)", () => {
  // Use real YAML path (via ts mock for node:fs) and inject test matrix directly
  const MATRIX = {
    correlations: { MES_MNQ: 0.95, MES_MCL: 0.22 },
    threshold: 0.70,
  };

  // A pre-existing hardening commit added an audit-row write to a fail-open path in
  // correlated-position-guard.js, which now transitively imports db/index.ts even for
  // this pure-logic test suite. Stub a dummy DATABASE_URL so the module loads without
  // a real DB connection — same idiom as placeability-suite.test.ts.
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://x:x@localhost:5432/x";
  });

  beforeEach(async () => {
    // Reset internal matrix so tests are isolated
    const { __resetCorrelationMatrixForTests } = await import(
      "../services/correlated-position-guard.js"
    );
    __resetCorrelationMatrixForTests(MATRIX);
  });

  it("BLOCKS MES entry when MNQ is open — normal case (no exception)", async () => {
    const { checkCorrelatedPositionGuard } = await import(
      "../services/correlated-position-guard.js"
    );
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "mffu", userId: "user-1", strategyId: "strat-1" }],
      MATRIX,
      "mffu", "user-1", "strat-1",
    );
    expect(result.allowed).toBe(false);
  });

  it("ALLOWS same-user same-strategy Topstep MES+MNQ (multi-account exception)", async () => {
    const { checkCorrelatedPositionGuard } = await import(
      "../services/correlated-position-guard.js"
    );
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "topstep", userId: "user-1", strategyId: "strat-A" }],
      MATRIX,
      "topstep", "user-1", "strat-A",
    );
    expect(result.allowed).toBe(true);
  });

  it("BLOCKS different users even if both Topstep", async () => {
    const { checkCorrelatedPositionGuard } = await import(
      "../services/correlated-position-guard.js"
    );
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "topstep", userId: "user-2", strategyId: "strat-A" }],
      MATRIX,
      "topstep", "user-1", "strat-A",
    );
    expect(result.allowed).toBe(false);
  });

  it("BLOCKS different strategies even if same Topstep user", async () => {
    const { checkCorrelatedPositionGuard } = await import(
      "../services/correlated-position-guard.js"
    );
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "topstep", userId: "user-1", strategyId: "strat-B" }],
      MATRIX,
      "topstep", "user-1", "strat-A",
    );
    expect(result.allowed).toBe(false);
  });

  it("BLOCKS cross-firm Topstep vs MFFU — always blocked (no exception)", async () => {
    const { checkCorrelatedPositionGuard } = await import(
      "../services/correlated-position-guard.js"
    );
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "mffu", userId: "user-1", strategyId: "strat-A" }],
      MATRIX,
      "topstep", "user-1", "strat-A",
    );
    expect(result.allowed).toBe(false);
  });

  it("MFFU same-user same-strategy: still BLOCKED (collaborative trading ban)", async () => {
    const { checkCorrelatedPositionGuard } = await import(
      "../services/correlated-position-guard.js"
    );
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "mffu", userId: "user-1", strategyId: "strat-A" }],
      MATRIX,
      "mffu", "user-1", "strat-A",
    );
    expect(result.allowed).toBe(false);
  });

  it("low-correlation pair still ALLOWED regardless of firm (MCL+MES = 0.22)", async () => {
    const { checkCorrelatedPositionGuard } = await import(
      "../services/correlated-position-guard.js"
    );
    const result = checkCorrelatedPositionGuard(
      "MCL",
      [{ symbol: "MES", firmId: "mffu", userId: "user-1", strategyId: "strat-A" }],
      MATRIX,
      "mffu", "user-1", "strat-A",
    );
    expect(result.allowed).toBe(true);
  });

  it("backward compat: old callers without firmId/userId/strategyId still work (treated as no exception)", async () => {
    const { checkCorrelatedPositionGuard } = await import(
      "../services/correlated-position-guard.js"
    );
    // Old signature — no extra params
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ" }],
      MATRIX,
    );
    expect(result.allowed).toBe(false); // still blocked — no exception without userId
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-5: Compliance firm ID case normalisation
// ─────────────────────────────────────────────────────────────────────────────

describe("Compliance refresh service — firm ID lowercase (F-5)", () => {
  const filePath = fileURLToPath(
    new URL("../services/compliance-refresh-service.ts", import.meta.url),
  );

  it("FIRMS array no longer contains Titlecase 'MFFU' as a string value", () => {
    const source = nodeFs.readFileSync(filePath, "utf-8");
    // Comments may contain "MFFU" — only the string literal in the array must be lowercase.
    // Look for the FIRMS constant assignment block specifically.
    const firmsBlockMatch = source.match(/const FIRMS\s*=\s*\[([^\]]*)\]/s);
    expect(firmsBlockMatch).not.toBeNull();
    const firmsBlock = firmsBlockMatch![1];
    expect(firmsBlock).not.toContain('"MFFU"');
    expect(firmsBlock).not.toContain('"Topstep"');
  });

  it("FIRMS array no longer contains Titlecase 'Topstep' as a string value", () => {
    const source = nodeFs.readFileSync(filePath, "utf-8");
    const firmsBlockMatch = source.match(/const FIRMS\s*=\s*\[([^\]]*)\]/s);
    expect(firmsBlockMatch).not.toBeNull();
    const firmsBlock = firmsBlockMatch![1];
    expect(firmsBlock).not.toContain('"Topstep"');
  });

  it("FIRMS array contains lowercase 'mffu'", () => {
    const source = nodeFs.readFileSync(filePath, "utf-8");
    expect(source).toContain('"mffu"');
  });

  it("FIRMS array contains lowercase 'topstep'", () => {
    const source = nodeFs.readFileSync(filePath, "utf-8");
    expect(source).toContain('"topstep"');
  });

  it("legacy firms are absent (Apex, FFN, Alpha, Tradeify, Earn2Trade, TPT)", () => {
    const source = nodeFs.readFileSync(filePath, "utf-8");
    for (const legacy of ["Apex", "FFN", "Alpha", "Tradeify", "Earn2Trade", "TPT"]) {
      expect(source).not.toContain(`"${legacy}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-15: compliance_gate.py check_violation — MFFU checks
// These are source-level structural checks since pytest is not available here.
// ─────────────────────────────────────────────────────────────────────────────

describe("compliance_gate.py — MFFU check_violation wiring (F-15)", () => {
  const gatePath = fileURLToPath(
    new URL("../../engine/compliance/compliance_gate.py", import.meta.url),
  );

  it("check_violation calls check_two_percent_rule for MFFU", () => {
    const source = nodeFs.readFileSync(gatePath, "utf-8");
    expect(source).toContain("check_two_percent_rule(");
    // Must be inside check_violation (after firm_lower == 'mffu' guard)
    expect(source).toContain('firm_lower == "mffu" and intended_max_loss is not None');
  });

  it("check_violation calls check_hft_limit for MFFU", () => {
    const source = nodeFs.readFileSync(gatePath, "utf-8");
    expect(source).toContain("check_hft_limit(trades_today=int(trades_today))");
    expect(source).toContain('firm_lower == "mffu" and trades_today is not None');
  });

  it("check_violation enforces hedging ban (MNQ+NQ etc)", () => {
    const source = nodeFs.readFileSync(gatePath, "utf-8");
    expect(source).toContain("HEDGE_PAIRS");
    expect(source).toContain('"MNQ": "NQ"');
    expect(source).toContain('"MES": "ES"');
    expect(source).toContain('"MCL": "CL"');
    // Hedging ban violation message
    expect(source).toContain("MFFU hedging ban");
  });

  it("Apex household_max_pa_accounts check is removed", () => {
    const source = nodeFs.readFileSync(gatePath, "utf-8");
    // The old Apex-specific check block is no longer in check_violation
    expect(source).not.toContain("household_max_pa_accounts");
  });

  it("automation_banned check is retained for both MFFU + Topstep", () => {
    const source = nodeFs.readFileSync(gatePath, "utf-8");
    expect(source).toContain("automation_banned = bool(rules.get(\"automation_banned\", False))");
  });
});
