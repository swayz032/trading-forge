/**
 * goalscan-crit-dll-blackout-force-close.test.ts — goalscan-crit-20260716 CRIT fix
 *
 * DEFECT (verified @61bb20a3): in paper-signal-service.ts, the cross-symbol DLL
 * coordinator (evaluateCrossSymbolDll + its 95%-DLL force_close branch, which
 * calls forceCloseAllPositions()) was wrapped in `if (!blackoutBlocked) { ... }`.
 * During the 60-minute FOMC/CPI/NFP news-blackout window (blackoutBlocked=true),
 * the ENTIRE cross-symbol DLL check — including force-close of an account already
 * past 95% of its daily loss limit — never ran. No other mechanism compensates:
 * dd-velocity-cron only autopauses new entries; kill-switch.ts's L2/L3 force-close
 * only fires from inside openPosition(), never reached during a blackout (no new
 * entries are attempted). Net: during the highest-volatility window of the day,
 * the one mechanism that flattens a bleeding account was disabled by an
 * optimization that conflated "block a new entry" with "force-close a position."
 *
 * FIX: the DLL evaluator (including force_close) now runs UNCONDITIONALLY.
 * `dllHaltBlocked` still initializes to `blackoutBlocked` so the entry-gating
 * semantics are preserved (a blackout alone still blocks new entries via
 * `lockoutBlocked = ... || blackoutBlocked || dllHaltBlocked || ...`), and
 * because `blackoutBlocked` already ORs directly into `lockoutBlocked`, a
 * "halt"/"reduce_size"/"none" DLL verdict computed during a blackout changes
 * NOTHING about whether a new entry is allowed. force_close is the one action
 * with a real effect during a blackout: it closes ALREADY-OPEN positions.
 *
 * Test strategy (mirrors the file's own established convention — see
 * paper-signal-service-deepscan-findings.test.ts F1/F2, and
 * wave23h-cross-symbol-dll.test.ts's simulateBlackoutGate): evaluateSignals()
 * has too large a gateway-dependency surface for an isolated behavioral test
 * (DB, bar buffer, indicators, broker calls, SSE, audit_log — dozens of mocks
 * with no incremental signal over a source-structure assertion). So:
 *
 *  A) SOURCE-STRUCTURE tests (the actual anti-regression proof — RED if the
 *     `if (!blackoutBlocked)` wrapper is reintroduced around the evaluator):
 *     assert the control-flow shape directly against the live file text.
 *  B) BEHAVIORAL tests against the REAL `evaluateCrossSymbolDll` (imported,
 *     not reimplemented) via a documented one-line mirror of the FIXED
 *     control flow, pinning the intended semantics: force_close fires
 *     regardless of blackoutBlocked; entries stay blocked under blackout
 *     regardless of the DLL verdict; a sub-threshold DLL result never
 *     force-closes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  evaluateCrossSymbolDll,
  type AccountSessionPnL,
} from "../services/cross-symbol-pnl.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

// ─── A. Source-structure RED-proof ───────────────────────────────────────────

describe("goalscan-crit F-3: cross-symbol DLL force_close must NOT be gated by blackoutBlocked", () => {
  it("dllHaltBlocked still initializes from blackoutBlocked (entry-gating default preserved)", () => {
    expect(SRC).toContain("let dllHaltBlocked = blackoutBlocked;");
  });

  it("the evaluator block is NOT wrapped in `if (!blackoutBlocked)` (the pre-fix vulnerable pattern)", () => {
    // Exact pre-fix text: the try{ opened immediately inside `if (!blackoutBlocked) {`.
    // This is the literal shape a naive revert (or a merge that reintroduces the
    // old block) would restore.
    expect(SRC).not.toContain("if (!blackoutBlocked) {\n      try {");
  });

  it("no `if (!blackoutBlocked)` gate exists anywhere between the dllHaltBlocked init and the evaluateCrossSymbolDll call", () => {
    const initIdx = SRC.indexOf("let dllHaltBlocked = blackoutBlocked;");
    const evalIdx = SRC.indexOf("const dllResult = evaluateCrossSymbolDll(", initIdx);
    expect(initIdx).toBeGreaterThan(-1);
    expect(evalIdx).toBeGreaterThan(initIdx);

    const between = SRC.slice(initIdx, evalIdx);
    expect(between).not.toContain("if (!blackoutBlocked)");
    expect(between).not.toContain("if (blackoutBlocked)");
  });

  it("the force_close branch (forceCloseAllPositions call) is NOT nested under any blackoutBlocked conditional between the evaluator call and the force-close await", () => {
    // NOTE: `evaluateCrossSymbolDll(` is called from TWO sites in this file (this
    // signal-time coordinator at ~3554, and an unrelated H3 pending-entry-fill
    // re-check gate at ~2725) — anchor the search to the dllHaltBlocked init
    // (unique in the file) so this test targets the SAME block the fix touched,
    // not the first occurrence in the file.
    const initIdx = SRC.indexOf("let dllHaltBlocked = blackoutBlocked;");
    const evalIdx = SRC.indexOf("const dllResult = evaluateCrossSymbolDll(", initIdx);
    const forceCloseCallIdx = SRC.indexOf("await forceCloseAllPositions(", evalIdx);
    expect(initIdx).toBeGreaterThan(-1);
    expect(evalIdx).toBeGreaterThan(initIdx);
    expect(forceCloseCallIdx).toBeGreaterThan(evalIdx);

    const between = SRC.slice(evalIdx, forceCloseCallIdx);
    expect(between).not.toContain("if (!blackoutBlocked)");
    expect(between).not.toContain("if (blackoutBlocked)");
  });

  it("the force_close action check + forceCloseAllPositions call still exist (fix did not delete the safety mechanism)", () => {
    expect(SRC).toContain('dllResult.action === "force_close"');
    expect(SRC).toContain("await forceCloseAllPositions(");
    expect(SRC).toContain("cross_symbol_dll_force_close");
  });

  it("blackoutBlocked-derived entries-only semantics are documented at the fix site (no silent behavior change beyond force_close)", () => {
    expect(SRC).toContain("goalscan-crit-20260716 CAPITAL-SAFETY FIX");
  });
});

// ─── B. Behavioral pin — real evaluateCrossSymbolDll + the fixed control flow ─

/**
 * Mirrors the FIXED control flow in paper-signal-service.ts ~3504-3691: the
 * evaluator runs unconditionally; dllHaltBlocked initializes to blackoutBlocked
 * and can only be pushed to `true` by the DLL result (never back to `false`).
 * Uses the REAL evaluateCrossSymbolDll (imported above) for the threshold math
 * — this harness only reproduces the SURROUNDING control-flow decision, which
 * is what the CRIT defect broke.
 */
function simulateFixedDllGate(
  pnl: AccountSessionPnL,
  personalDllDollars: number,
  blackoutBlocked: boolean,
): {
  dllHaltBlocked: boolean;
  forceCloseWouldFire: boolean;
  lockoutBlocked: boolean; // mirrors line ~3963: blackoutBlocked || dllHaltBlocked || ...
} {
  let dllHaltBlocked = blackoutBlocked;
  let forceCloseWouldFire = false;

  // Runs UNCONDITIONALLY post-fix — no `if (!blackoutBlocked)` guard here.
  const dllResult = evaluateCrossSymbolDll(pnl, personalDllDollars);
  if (dllResult.action === "force_close") {
    forceCloseWouldFire = true;
    dllHaltBlocked = true;
  } else if (dllResult.action === "halt") {
    dllHaltBlocked = true;
  }
  // "reduce_size" and "none" do not touch dllHaltBlocked.

  return {
    dllHaltBlocked,
    forceCloseWouldFire,
    lockoutBlocked: blackoutBlocked || dllHaltBlocked,
  };
}

describe("goalscan-crit F-3: behavioral pin (real evaluateCrossSymbolDll)", () => {
  it("blackout=true + DLL at 95%+ (force_close level) → forceCloseAllPositions WOULD be invoked", () => {
    const pnl: AccountSessionPnL = {
      firmId: "topstep",
      sessionDate: "2026-07-16",
      realizedPnL: -960,
      openPnLMtm: 0,
      totalPnL: -960, // 96% of $1000 personal DLL — past the 95% force_close threshold
      pnLBySymbol: { MES: -960 },
    };

    const result = simulateFixedDllGate(pnl, 1000, /* blackoutBlocked */ true);

    expect(result.forceCloseWouldFire).toBe(true);
    expect(result.dllHaltBlocked).toBe(true);
    expect(result.lockoutBlocked).toBe(true);
  });

  it("blackout=true + DLL below the 60% reduce band → entries still blocked (by blackout alone), but NO force_close", () => {
    const pnl: AccountSessionPnL = {
      firmId: "topstep",
      sessionDate: "2026-07-16",
      realizedPnL: -100,
      openPnLMtm: 0,
      totalPnL: -100, // 10% of $1000 — well below every DLL band
      pnLBySymbol: { MES: -100 },
    };

    const result = simulateFixedDllGate(pnl, 1000, /* blackoutBlocked */ true);

    expect(result.forceCloseWouldFire).toBe(false);
    // Entries remain blocked — driven by blackoutBlocked itself, not by the DLL result.
    expect(result.dllHaltBlocked).toBe(true);
    expect(result.lockoutBlocked).toBe(true);
  });

  it("blackout=false + DLL at 95%+ → force_close fires exactly as it did pre-fix (no regression on the non-blackout path)", () => {
    const pnl: AccountSessionPnL = {
      firmId: "topstep",
      sessionDate: "2026-07-16",
      realizedPnL: -960,
      openPnLMtm: 0,
      totalPnL: -960,
      pnLBySymbol: { MES: -960 },
    };

    const result = simulateFixedDllGate(pnl, 1000, /* blackoutBlocked */ false);

    expect(result.forceCloseWouldFire).toBe(true);
    expect(result.dllHaltBlocked).toBe(true);
    expect(result.lockoutBlocked).toBe(true);
  });

  it("blackout=false + DLL below all bands → no force_close, no halt, entries open (unchanged baseline)", () => {
    const pnl: AccountSessionPnL = {
      firmId: "topstep",
      sessionDate: "2026-07-16",
      realizedPnL: -100,
      openPnLMtm: 0,
      totalPnL: -100,
      pnLBySymbol: { MES: -100 },
    };

    const result = simulateFixedDllGate(pnl, 1000, /* blackoutBlocked */ false);

    expect(result.forceCloseWouldFire).toBe(false);
    expect(result.dllHaltBlocked).toBe(false);
    expect(result.lockoutBlocked).toBe(false);
  });

  it("REGRESSION GUARD — reproduces the exact pre-fix defect shape: if the evaluator were skipped under blackout (as it was pre-fix), force_close would NEVER fire regardless of DLL level", () => {
    // This test documents what the OLD (buggy) behavior looked like, so a
    // future reader can see precisely what class of bug the fix + the tests
    // above guard against: skipping the evaluator entirely under blackout
    // meant `dllResult` was never computed, so `force_close` could never fire
    // no matter how far past 95% DLL the account was.
    const pnl: AccountSessionPnL = {
      firmId: "topstep",
      sessionDate: "2026-07-16",
      realizedPnL: -990,
      openPnLMtm: 0,
      totalPnL: -990, // 99% of DLL — deep past the 95% force_close threshold
      pnLBySymbol: { MES: -990 },
    };

    const preFixBlackoutBlocked = true;
    // Pre-fix: `if (!blackoutBlocked) { ...evaluate... }` — evaluator body
    // simply never executes when blackoutBlocked is true.
    const preFixForceCloseWouldFire = preFixBlackoutBlocked
      ? false // evaluator skipped entirely — this was the bug
      : evaluateCrossSymbolDll(pnl, 1000).action === "force_close";

    expect(preFixForceCloseWouldFire).toBe(false); // documents the bug

    // The FIXED gate, on the identical inputs, correctly force-closes.
    const fixedResult = simulateFixedDllGate(pnl, 1000, preFixBlackoutBlocked);
    expect(fixedResult.forceCloseWouldFire).toBe(true);
  });
});
