/**
 * paper-execution-service.w3a-kill-switch-trade-cap.test.ts
 *
 * Ratify-packet W3A (Execution Hardening, 2026-07-17), Item 1 — kill-switch
 * trade-cap backstop.
 *
 * DEFECT (verified against live code @ c45f4766): `maxTradesPerSession` at
 * paper-execution-service.ts:~1279-1281 was derived as
 * `sessionCfg?.max_trades_per_day != null ? Number(...) : undefined` — NO env
 * fallback. The arming condition at ~1303
 * (`dailyLossLimit > 0 || (maxTradesPerSession !== undefined && maxTradesPerSession > 0)`)
 * then never armed for a session relying purely on the TF_MAX_TRADES_PER_DAY
 * env default (no daily_loss_limit, no per-session max_trades_per_day) — so
 * the ENTIRE Python check_kill_switch call (trade-cap + daily-loss +
 * consecutive-loss, bundled in one invocation) was skipped for that session.
 *
 * NAIVE FIX REJECTED (documented in the ratify packet): falling back directly
 * to `getDailyTradeCapEnvDefault()` breaks the TF_MAX_TRADES_PER_DAY=0
 * debug-disable contract when a session ALSO has daily_loss_limit set — `0 ??
 * null` evaluates to `0` (not `null`), so Python's `is not None` check trips
 * on trade #1 (`0 >= 0`).
 *
 * FIX: reuse `resolveEffectiveCap()` from daily-trade-cap.ts — the SAME
 * DB-override > env-default precedence the signal-time daily-trade-cap gate
 * already uses — and only produce a defined `maxTradesPerSession` when the
 * resolved effective cap is > 0. This closes the env-default-only arming gap
 * AND a dormant pre-existing bug where an explicit session-level
 * `max_trades_per_day: 0` also tipped through the same `?? null` gap.
 *
 * Test strategy: `resolveKillSwitchMaxTradesPerSession()` is a pure, DB-free,
 * directly-exported function (paper-execution-service.ts convention — see
 * `applyLatency`, `computeFillProbabilityByVolume`, `classifySessionType`) —
 * behavioral tests exercise the REAL function (not a mirror). Source-structure
 * tests pin the call site + the untouched arming/payload lines so a future
 * edit can't silently reintroduce the gap or drift the derivation from its
 * call site.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ─── DB + side-effect mocks (this file imports the real module for the real
// pure function — mirrors the established convention in
// paper-execution-service.fix-bugs.test.ts, whose DB mock skeleton this
// reuses verbatim so the module can load without a live DATABASE_URL) ───────
vi.mock("../db/index.js", () => {
  function makeChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      then: (onFulfilled: unknown) => (onFulfilled as (v: unknown) => unknown)([]),
      catch: () => chain,
      finally: (onFinally: unknown) => { (onFinally as () => unknown)(); return chain; },
    };
    const chainFn = () => chain;
    chain.from = chainFn;
    chain.where = chainFn;
    chain.limit = chainFn;
    chain.orderBy = chainFn;
    chain.returning = chainFn;
    chain.values = () => ({ catch: () => {} });
    return chain;
  }
  return {
    db: {
      select: vi.fn(makeChain),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ catch: vi.fn() })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
        select: vi.fn(makeChain),
        insert: vi.fn(() => ({ values: vi.fn(() => ({ catch: vi.fn() })) })),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
      })),
    },
  };
});
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn(), PAPER_EXIT_EVENTS: {} }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }) },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn().mockReturnValue("2026-07-17"),
  toFuturesTradingDayString: vi.fn().mockReturnValue("2026-07-17"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn().mockResolvedValue({ estimatedSpreadCost: 0, rollDates: [] }),
}));
vi.mock("./alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), criticalAlert: vi.fn(), driftAlert: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn().mockReturnValue(-240) }));
vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn(async (_: unknown, fn: () => unknown) => fn()),
}));
vi.mock("./pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));

import { resolveKillSwitchMaxTradesPerSession } from "./paper-execution-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "./paper-execution-service.ts"), "utf-8");

// ─── A. Behavioral — real resolveKillSwitchMaxTradesPerSession ──────────────

describe("W3A item 1: resolveKillSwitchMaxTradesPerSession — behavioral", () => {
  it("env-default-only session (no per-session override) resolves to the env default (arms the kill switch)", () => {
    // Pre-fix: sessionCfg.max_trades_per_day is undefined -> old derivation
    // produced `undefined` regardless of env -> arming condition never true
    // for a session with no daily_loss_limit either.
    expect(resolveKillSwitchMaxTradesPerSession(null, 2)).toBe(2);
    expect(resolveKillSwitchMaxTradesPerSession(undefined, 2)).toBe(2);
  });

  it("TF_MAX_TRADES_PER_DAY=0 (debug-disable) resolves to undefined — does NOT arm/trip", () => {
    // envDefault=0 is what getDailyTradeCapEnvDefault() returns when the operator
    // sets TF_MAX_TRADES_PER_DAY=0 to disable the cap for debugging.
    expect(resolveKillSwitchMaxTradesPerSession(null, 0)).toBeUndefined();
    expect(resolveKillSwitchMaxTradesPerSession(undefined, 0)).toBeUndefined();
  });

  it("dormant bug fix: explicit session max_trades_per_day=0 resolves to the env default, NOT 0", () => {
    // resolveEffectiveCap treats perSessionCap===0 as "not meaningfully set" (its
    // `> 0` guard) and falls through to envDefault — so an explicit 0 behaves
    // exactly like "no override," matching the signal-time gate's own contract.
    // CRITICAL: this must NEVER be 0 — Python's `max_trades_per_session is not
    // None and trades_today >= max_trades_per_session` would trip on `0 >= 0`
    // (trade #1) if a literal 0 ever reached the payload.
    expect(resolveKillSwitchMaxTradesPerSession(0, 2)).toBe(2);
    expect(resolveKillSwitchMaxTradesPerSession(0, 2)).not.toBe(0);
  });

  it("explicit non-zero per-session override wins over the env default (DB > env precedence, unchanged)", () => {
    expect(resolveKillSwitchMaxTradesPerSession(5, 2)).toBe(5);
    expect(resolveKillSwitchMaxTradesPerSession(1, 2)).toBe(1);
  });

  it("explicit per-session override wins even when the env default is the 0 debug-disable value", () => {
    expect(resolveKillSwitchMaxTradesPerSession(3, 0)).toBe(3);
  });

  it("never returns 0 — the function's contract guarantees undefined OR a positive integer", () => {
    const cases: Array<[number | null | undefined, number]> = [
      [null, 0], [null, 2], [undefined, 0], [undefined, 5],
      [0, 0], [0, 2], [0, 5],
      [3, 0], [3, 2],
      [-1, 2], // negative per-session cap also falls through to env (resolveEffectiveCap contract)
    ];
    for (const [perSessionCap, envDefault] of cases) {
      const result = resolveKillSwitchMaxTradesPerSession(perSessionCap, envDefault);
      expect(result).not.toBe(0);
      if (result !== undefined) {
        expect(result).toBeGreaterThan(0);
        expect(Number.isInteger(result)).toBe(true);
      }
    }
  });

  it("REGRESSION GUARD — reproduces the exact pre-fix defect shape for documentation", () => {
    // Pre-fix derivation (mirrors the OLD code verbatim, NOT used in production):
    function preFixDerivation(sessionCfgMaxTradesPerDay: unknown): number | undefined {
      return sessionCfgMaxTradesPerDay != null ? Number(sessionCfgMaxTradesPerDay) : undefined;
    }

    // Env-default-only session: pre-fix produced `undefined` regardless of the
    // env default -> kill switch never armed for trade-cap-only enforcement.
    expect(preFixDerivation(undefined)).toBeUndefined();
    // Post-fix: the SAME session now correctly arms via the env default.
    expect(resolveKillSwitchMaxTradesPerSession(undefined, 2)).toBe(2);

    // Dormant bug: pre-fix, an explicit session-level 0 produced a literal `0`,
    // which (combined with `?? null` at the Python payload site) sent `0` to
    // Python and tripped `0 >= 0` on trade #1.
    expect(preFixDerivation(0)).toBe(0);
    // Post-fix: the same input now resolves to the env default instead.
    expect(resolveKillSwitchMaxTradesPerSession(0, 2)).toBe(2);
  });
});

// ─── B. Source-structure — call site wiring + untouched arming/payload ──────

describe("W3A item 1: source-structure pins", () => {
  it("resolveKillSwitchMaxTradesPerSession is exported (pure, DB-free, directly testable)", () => {
    expect(SRC).toContain("export function resolveKillSwitchMaxTradesPerSession(");
  });

  it("the kill-switch block derives maxTradesPerSession via the new resolver (not the old bare ?? derivation)", () => {
    expect(SRC).toContain("const maxTradesPerSession = resolveKillSwitchMaxTradesPerSession(");
    // The old buggy line must be gone — this is the exact pre-fix text.
    expect(SRC).not.toContain(
      "const maxTradesPerSession = sessionCfg?.max_trades_per_day != null\n          ? Number(sessionCfg.max_trades_per_day)\n          : undefined;",
    );
  });

  it("daily-trade-cap.ts helpers are imported (resolveEffectiveCap + getDailyTradeCapEnvDefault)", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*resolveEffectiveCap[^}]*\}\s*from\s*"\.\.\/lib\/daily-trade-cap\.js"/);
    expect(SRC).toMatch(/import\s*\{[^}]*getDailyTradeCapEnvDefault[^}]*\}\s*from\s*"\.\.\/lib\/daily-trade-cap\.js"/);
  });

  it("the arming condition at the kill-switch gate is untouched (dailyLossLimit path independent)", () => {
    expect(SRC).toContain(
      "if (dailyLossLimit > 0 || (maxTradesPerSession !== undefined && maxTradesPerSession > 0)) {",
    );
  });

  it("the Python payload still sends maxTradesPerSession ?? null (untouched wire contract)", () => {
    expect(SRC).toContain("maxTradesPerSession: maxTradesPerSession ?? null,");
  });

  it("call site passes getDailyTradeCapEnvDefault() as the env default argument", () => {
    const callIdx = SRC.indexOf("const maxTradesPerSession = resolveKillSwitchMaxTradesPerSession(");
    expect(callIdx).toBeGreaterThan(-1);
    const nextChunk = SRC.slice(callIdx, callIdx + 400);
    expect(nextChunk).toContain("getDailyTradeCapEnvDefault()");
  });
});
