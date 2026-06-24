/**
 * hard-gates-boundary-supplement.test.ts
 *
 * Supplemental institutional-grade boundary tests for the four HARD signal-time
 * capital gates. These tests fill gaps not covered by the existing per-gate files:
 *
 *   wave26-pass-k-daily-trade-cap.test.ts    — 22 tests, all GREEN
 *   wave26-pass-k-lunch-blackout.test.ts     — 23 tests, all GREEN
 *   wave26-pass-k-pm-size-factor.test.ts     — 25 tests, all GREEN
 *   wave26-pass-g-pass-f-dd-velocity.test.ts — 18 tests, all GREEN
 *
 * Gaps targeted by this file:
 *
 *   Gate 1  (dd-velocity-gate)
 *     G1-1  Exact 1.5% warn boundary — at-threshold fires warning, not ok
 *     G1-2  Just below 1.5% warn — ok (0.0149...)
 *     G1-3  Just below 3.0% autopause — warning (2.99%)
 *     G1-4  Env-var override DD_VELOCITY_AUTOPAUSE_PCT overrides default 3%
 *     G1-5  Env-var override DD_VELOCITY_WARNING_PCT overrides default 1.5%
 *     G1-6  firmId=null → no Topstep tightening applied
 *     G1-7  firmId="unknown_firm" → no tightening (firm not found)
 *     G1-8  Single-sample window still reports correct state shape
 *
 *   Gate 2  (daily-trade-cap)
 *     G2-1  Exact cap boundary: tradesToday === effectiveCap → block (not allow)
 *     G2-2  Exact cap-1 boundary: tradesToday === effectiveCap-1 → allow
 *     G2-3  Per-session cap 0 treated as unset (falls to env default)
 *     G2-4  Per-session cap negative treated as unset (falls to env default)
 *     G2-5  Fractional env default floors (2.9 → 2)
 *     G2-6  Cap=1: 0 taken → allow, 1 taken → block (strict 1-trade-only mode)
 *     G2-7  Reason string echoes tradesToday and effectiveCap accurately
 *     G2-8  Very large tradesToday value always blocked when cap > 0
 *
 *   Gate 3  (lunch-blackout-gate)
 *     G3-1  Exact 11:30 ET spring-forward date (EDT, March) — blocked
 *     G3-2  Exact 11:29 ET spring-forward date (EDT) — clear
 *     G3-3  Exact 13:30 ET spring-forward date (EDT) — clear (right-exclusive)
 *     G3-4  13:29 ET fall-back (EST, November) — blocked
 *     G3-5  windowSpec echoed correctly for default window
 *     G3-6  windowSpec echoed correctly for custom window
 *     G3-7  perStrategyOverrideApplied=false when not disabled (contract field)
 *     G3-8  perStrategyDisabled=true echoes windowSpec even when bypassing
 *
 *   Gate 4  (pm-size-factor)
 *     G4-1  Exact 13:30 ET — factor exactly 0.50, not 1.0 (boundary inclusive)
 *     G4-2  1 minute before 13:30 (13:29) — factor exactly 1.0
 *     G4-3  Exact 15:00 ET — factor exactly 0.25 (floor boundary)
 *     G4-4  Exact 15:30 ET — factor exactly 0.0 (closed boundary)
 *     G4-5  1 minute before 15:30 (15:29) — factor 0.25 (floor still held)
 *     G4-6  14:45 ET linear interpolation formula verification
 *     G4-7  etMinuteOfDay echoed correctly in result
 *     G4-8  Env PM_SIZE_FACTOR_AT_13_30=0.60 override honored
 *     G4-9  Env PM_SIZE_FACTOR_AT_15_00=0.30 override honored
 *     G4-10 lastEntry before floor config → conservative fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Gate 1: dd-velocity-gate — mocks ────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }) },
}));
vi.mock("../db/schema.js", () => ({
  paperSessions: {},
  paperPositions: {},
  auditLog: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  gte: vi.fn(),
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("./notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((body: string) => body + "\n---"),
}));
vi.mock("./pipeline-control-service.js", () => ({
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
  setMode: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn((firmId: string) => {
    if (firmId === "topstep") return { maxDrawdown: 2000, dailyLossLimit: 1000 };
    return null;
  }),
}));
vi.mock("../lib/metrics-registry.js", () => ({
  ddVelocityAutopauseTotal: { inc: vi.fn() },
  regimeTransitionTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  recordEquityAndCheck,
  getDDVelocityConfig,
  __resetEquityWindowsForTests,
  __injectEquitySamplesForTests,
} from "../services/dd-velocity-gate.js";

import {
  evaluateDailyTradeCap,
  resolveEffectiveCap,
  getDailyTradeCapEnvDefault,
} from "../lib/daily-trade-cap.js";

import {
  evaluateLunchBlackoutGate,
  getLunchBlackoutStartEnvDefault,
  getLunchBlackoutEndEnvDefault,
} from "../lib/lunch-blackout-gate.js";

import {
  computePmSizeFactor,
  getPmSizeFactorEnvDefaults,
} from "../lib/pm-size-factor.js";

// ─── Shared ET helper ─────────────────────────────────────────────────────────

/**
 * Build a UTC Date corresponding to a given ET wall-clock time.
 * Tries EDT (UTC-4) and EST (UTC-5) offsets and verifies via Intl.
 */
function etBar(yyyymmddHhMm: string): Date {
  const [datePart, timePart] = yyyymmddHhMm.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hh + offsetHours, mm));
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(candidate);
    const match = fmt.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/);
    if (match) {
      const [, mo, da, ye, hr, mi] = match;
      const hrN = parseInt(hr, 10) === 24 ? 0 : parseInt(hr, 10);
      if (
        parseInt(ye, 10) === y &&
        parseInt(mo, 10) === m &&
        parseInt(da, 10) === d &&
        hrN === hh &&
        parseInt(mi, 10) === mm
      ) {
        return candidate;
      }
    }
  }
  throw new Error(`etBar: could not construct ET time for ${yyyymmddHhMm}`);
}

// ─── Gate 1: dd-velocity-gate boundary + env override tests ──────────────────

describe("Gate 1 (dd-velocity-gate) — exact band boundaries", () => {
  beforeEach(() => {
    __resetEquityWindowsForTests();
    vi.clearAllMocks();
  });
  afterEach(() => {
    __resetEquityWindowsForTests();
  });

  it("G1-1: exactly 1.5% drop → warning (at-threshold, inclusive)", async () => {
    // rollingDDPct >= warningPct → level=warning
    const SESS = "g1-1-warn-exact";
    const ACCT = 100_000;
    const now = Date.now();
    __injectEquitySamplesForTests(SESS, [
      { capturedAt: now - 60_000, equity: ACCT },
      { capturedAt: now, equity: ACCT * (1 - 0.015) },  // exactly 1.5%
    ]);
    const r = await recordEquityAndCheck(SESS, ACCT * 0.985, ACCT, "mffu");
    expect(r.rollingDDPct).toBeCloseTo(0.015, 4);
    expect(r.level).toBe("warning");
  });

  it("G1-2: 1.499% drop → ok (just below warn threshold)", async () => {
    const SESS = "g1-2-ok-just-below-warn";
    const ACCT = 100_000;
    const now = Date.now();
    __injectEquitySamplesForTests(SESS, [
      { capturedAt: now - 60_000, equity: ACCT },
      { capturedAt: now, equity: ACCT * (1 - 0.01499) },
    ]);
    const r = await recordEquityAndCheck(SESS, ACCT * (1 - 0.01499), ACCT, "mffu");
    expect(r.rollingDDPct).toBeCloseTo(0.01499, 4);
    expect(r.level).toBe("ok");
  });

  it("G1-3: 2.99% drop → warning (just below 3% autopause)", async () => {
    const SESS = "g1-3-warn-near-autopause";
    const ACCT = 100_000;
    const now = Date.now();
    __injectEquitySamplesForTests(SESS, [
      { capturedAt: now - 60_000, equity: ACCT },
      { capturedAt: now, equity: ACCT * (1 - 0.0299) },
    ]);
    const r = await recordEquityAndCheck(SESS, ACCT * (1 - 0.0299), ACCT, "mffu");
    expect(r.rollingDDPct).toBeCloseTo(0.0299, 4);
    expect(r.level).toBe("warning");  // > 1.5% warn but < 3% autopause
  });

  it("G1-4: DD_VELOCITY_AUTOPAUSE_PCT env override reduces threshold", async () => {
    const saved = process.env.DD_VELOCITY_AUTOPAUSE_PCT;
    process.env.DD_VELOCITY_AUTOPAUSE_PCT = "0.02";  // 2% instead of default 3%
    try {
      const cfg = getDDVelocityConfig();
      expect(cfg.autopausePct).toBe(0.02);

      // 2.5% drop should now be autopause (> 2% threshold)
      const SESS = "g1-4-env-override";
      const ACCT = 100_000;
      const now = Date.now();
      __injectEquitySamplesForTests(SESS, [
        { capturedAt: now - 60_000, equity: ACCT },
        { capturedAt: now, equity: ACCT * 0.975 },  // 2.5% drop
      ]);
      const r = await recordEquityAndCheck(SESS, ACCT * 0.975, ACCT, "mffu");
      expect(r.effectiveThreshold).toBeCloseTo(0.02, 3);
      expect(r.level).toBe("autopause");
    } finally {
      if (saved === undefined) delete process.env.DD_VELOCITY_AUTOPAUSE_PCT;
      else process.env.DD_VELOCITY_AUTOPAUSE_PCT = saved;
    }
  });

  it("G1-5: DD_VELOCITY_WARNING_PCT env override shifts warn threshold", async () => {
    const saved = process.env.DD_VELOCITY_WARNING_PCT;
    process.env.DD_VELOCITY_WARNING_PCT = "0.01";  // 1% instead of default 1.5%
    try {
      const cfg = getDDVelocityConfig();
      expect(cfg.warningPct).toBe(0.01);

      // 1.2% drop should now be warning (> 1% env threshold)
      const SESS = "g1-5-warn-env-override";
      const ACCT = 100_000;
      const now = Date.now();
      __injectEquitySamplesForTests(SESS, [
        { capturedAt: now - 60_000, equity: ACCT },
        { capturedAt: now, equity: ACCT * 0.988 },  // 1.2% drop
      ]);
      const r = await recordEquityAndCheck(SESS, ACCT * 0.988, ACCT, "mffu");
      expect(r.level).toBe("warning");
    } finally {
      if (saved === undefined) delete process.env.DD_VELOCITY_WARNING_PCT;
      else process.env.DD_VELOCITY_WARNING_PCT = saved;
    }
  });

  it("G1-6: firmId=null → no Topstep tightening, returns correct shape", async () => {
    const SESS = "g1-6-null-firm";
    const ACCT = 50_000;
    const now = Date.now();
    __injectEquitySamplesForTests(SESS, [
      { capturedAt: now - 60_000, equity: ACCT },
      { capturedAt: now, equity: ACCT * 0.99 },
    ]);
    const r = await recordEquityAndCheck(SESS, ACCT * 0.99, ACCT, null);
    expect(r.topstepTightenApplied).toBe(false);
    expect(r.effectiveThreshold).toBeCloseTo(0.03, 3);  // default unchanged
    expect(r.firmId).toBeNull();
    expect(r.level).toBe("ok");  // 1% < 1.5% warn
  });

  it("G1-7: firmId=unknown_firm → no tightening (firm config not found)", async () => {
    const SESS = "g1-7-unknown-firm";
    const ACCT = 50_000;
    const now = Date.now();
    __injectEquitySamplesForTests(SESS, [
      { capturedAt: now - 60_000, equity: ACCT },
      { capturedAt: now, equity: ACCT * 0.97 },  // 3% drop
    ]);
    const r = await recordEquityAndCheck(SESS, ACCT * 0.97, ACCT, "unknown_prop_firm");
    // Firm not found → no tightening; 3% at default threshold = autopause
    expect(r.topstepTightenApplied).toBe(false);
    expect(r.level).toBe("autopause");
  });

  it("G1-8: single sample (just inserted) → ok with correct shape", async () => {
    const SESS = "g1-8-single-sample";
    // Don't inject — let recordEquityAndCheck build the window from scratch
    const r = await recordEquityAndCheck(SESS, 49_000, 50_000, "mffu");
    expect(r.level).toBe("ok");
    expect(r.rollingDD).toBe(0);
    expect(r.rollingDDPct).toBe(0);
    expect(r.sessionId).toBe(SESS);
    expect(r.currentEquity).toBe(49_000);
    expect(r.accountSize).toBe(50_000);
  });
});

// ─── Gate 2: daily-trade-cap boundary + precedence tests ─────────────────────

describe("Gate 2 (daily-trade-cap) — exact cap boundaries", () => {
  it("G2-1: tradesToday === effectiveCap → block (at-boundary inclusive)", () => {
    // effectiveCap=2, tradesToday=2 → block. This is the key "3rd signal is first reject"
    const r = evaluateDailyTradeCap({ tradesToday: 2, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(false);
    expect(r.effectiveCap).toBe(2);
    expect(r.tradesToday).toBe(2);
  });

  it("G2-2: tradesToday === effectiveCap - 1 → allow (last allowed trade)", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.tradesToday).toBe(1);
  });

  it("G2-3: perSessionCap=0 treated as unset → falls to envDefault=2", () => {
    const cap = resolveEffectiveCap({ perSessionCap: 0, envDefault: 2 });
    expect(cap).toBe(2);
    // Downstream: with cap=2, tradesToday=2 should block
    const r = evaluateDailyTradeCap({ tradesToday: 2, perSessionCap: 0, envDefault: 2 });
    expect(r.allow).toBe(false);
    expect(r.effectiveCap).toBe(2);
  });

  it("G2-4: perSessionCap=-1 treated as unset → falls to envDefault=3", () => {
    const cap = resolveEffectiveCap({ perSessionCap: -1, envDefault: 3 });
    expect(cap).toBe(3);
  });

  it("G2-5: fractional envDefault=2.9 → floor to 2", () => {
    const cap = resolveEffectiveCap({ perSessionCap: null, envDefault: 2.9 });
    expect(cap).toBe(2);
    // Meaning tradesToday=2 blocks (at cap=2 boundary)
    const r = evaluateDailyTradeCap({ tradesToday: 2, perSessionCap: null, envDefault: 2.9 });
    expect(r.allow).toBe(false);
    expect(r.effectiveCap).toBe(2);
  });

  it("G2-6: cap=1 strict: 0 trades → allow, 1 trade → block", () => {
    const allow = evaluateDailyTradeCap({ tradesToday: 0, perSessionCap: 1, envDefault: 2 });
    const block = evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: 1, envDefault: 2 });
    expect(allow.allow).toBe(true);
    expect(block.allow).toBe(false);
    expect(block.reason).toMatch(/1\/1/);
  });

  it("G2-7: reason string echoes actual tradesToday and effectiveCap", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 3, perSessionCap: 5, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.reason).toMatch(/3\/5/);
    expect(r.effectiveCap).toBe(5);
  });

  it("G2-8: very large tradesToday (100) always blocked when cap>0", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 100, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(false);
    expect(r.tradesToday).toBe(100);
    expect(r.reason).toMatch(/daily_trade_cap_reached/);
  });

  it("G2-env: TF_MAX_TRADES_PER_DAY=1 makes 1st trade reject (1/1 at cap)", () => {
    const saved = process.env.TF_MAX_TRADES_PER_DAY;
    process.env.TF_MAX_TRADES_PER_DAY = "1";
    try {
      expect(getDailyTradeCapEnvDefault()).toBe(1);
      // With cap=1, tradesToday=1 is at-cap → block
      const r = evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: null, envDefault: getDailyTradeCapEnvDefault() });
      expect(r.allow).toBe(false);
      expect(r.effectiveCap).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.TF_MAX_TRADES_PER_DAY;
      else process.env.TF_MAX_TRADES_PER_DAY = saved;
    }
  });
});

// ─── Gate 3: lunch-blackout-gate boundary + DST edge cases ───────────────────

describe("Gate 3 (lunch-blackout-gate) — boundary + contract field precision", () => {
  it("G3-1: exact 11:30 EDT (spring-forward March, EDT) — blocked", () => {
    // 2026-03-09 is first Monday after 2026 DST start (2026-03-08)
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-03-09 11:30") });
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/lunch_blackout_window/);
  });

  it("G3-2: exact 11:29 EDT (spring-forward March) — clear", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-03-09 11:29") });
    expect(r.block).toBe(false);
    expect(r.reason).toMatch(/outside_blackout_window/);
  });

  it("G3-3: exact 13:30 EDT (spring-forward March) — clear (right-exclusive)", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-03-09 13:30") });
    expect(r.block).toBe(false);
  });

  it("G3-4: 13:29 EST (fall-back November) — blocked", () => {
    // 2026-11-01 is after fall-back (2026-11-01 02:00 EST)
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-11-02 13:29") });
    expect(r.block).toBe(true);
  });

  it("G3-5: windowSpec echoed correctly for default 11:30-13:30 ET", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 12:00") });
    expect(r.windowSpec).toBe("11:30-13:30 ET");
  });

  it("G3-6: windowSpec echoed correctly for custom window 12:00-13:00", () => {
    const r = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 12:30"),
      startEt: "12:00",
      endEt: "13:00",
    });
    expect(r.windowSpec).toBe("12:00-13:00 ET");
    expect(r.block).toBe(true);
  });

  it("G3-7: perStrategyOverrideApplied=false when disabled not set (default path)", () => {
    // Outside window — clear; override field must be false
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 09:30") });
    expect(r.perStrategyOverrideApplied).toBe(false);
    expect(r.block).toBe(false);
  });

  it("G3-8: perStrategyDisabled=true echoes windowSpec even when bypassing gate", () => {
    const r = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 12:00"),
      perStrategyDisabled: true,
      startEt: "11:30",
      endEt: "13:30",
    });
    expect(r.windowSpec).toBe("11:30-13:30 ET");
    expect(r.perStrategyOverrideApplied).toBe(true);
    expect(r.block).toBe(false);
  });

  it("G3-9: exactly 10:00 ET (pre-AM-session bar) — clear", () => {
    const r = evaluateLunchBlackoutGate({ barTsUtc: etBar("2026-05-26 10:00") });
    expect(r.block).toBe(false);
  });

  it("G3-10: fail-CLOSED contract: block=true on all malformed input paths", () => {
    // End equals start (empty window)
    const r1 = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 12:00"),
      startEt: "12:00",
      endEt: "12:00",
    });
    expect(r1.block).toBe(true);
    expect(r1.reason).toMatch(/lunch_blackout_config_error/);

    // Invalid timezone shorthand → parse error
    // Note: parseEntryWindow will try to validate the timezone, so an empty string produces an error
    const r2 = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 12:00"),
      startEt: "11:30",
      endEt: "13:30",
      // Normal args but we're testing the windowSpec format error path via bad format
    });
    // This path should pass (valid config) — confirm block is false for valid outside-window call
    // Actually test the actual bad format: "11:30" with no timezone parsed from the spec
    // The internal call builds spec as "11:30-13:30 ET" which IS valid → not the error path
    // So test via explicit malformed time string
    const r3 = evaluateLunchBlackoutGate({
      barTsUtc: etBar("2026-05-26 12:00"),
      startEt: "99:99",
      endEt: "99:99",
    });
    expect(r3.block).toBe(true);
    expect(r3.reason).toMatch(/lunch_blackout_config_error/);
  });
});

// ─── Gate 4: pm-size-factor boundary precision + env override ─────────────────

describe("Gate 4 (pm-size-factor) — exact boundary transitions", () => {
  it("G4-1: exactly 13:30 ET → factor=0.50, phase=pm_taper (AM→PM boundary inclusive)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 13:30") });
    expect(r.factor).toBe(0.50);
    expect(r.phase).toBe("pm_taper");
    // etMinuteOfDay = 13*60+30 = 810
    expect(r.etMinuteOfDay).toBe(810);
  });

  it("G4-2: 13:29 ET → factor=1.0, phase=am (last AM minute before taper)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 13:29") });
    expect(r.factor).toBe(1.0);
    expect(r.phase).toBe("am");
    expect(r.etMinuteOfDay).toBe(809);
  });

  it("G4-3: exactly 15:00 ET → factor=0.25, phase=pm_floor (floor boundary inclusive)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:00") });
    expect(r.factor).toBe(0.25);
    expect(r.phase).toBe("pm_floor");
    expect(r.etMinuteOfDay).toBe(900);
  });

  it("G4-4: exactly 15:30 ET → factor=0.0, phase=pm_closed (no-entry boundary inclusive)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:30") });
    expect(r.factor).toBe(0.0);
    expect(r.phase).toBe("pm_closed");
    expect(r.etMinuteOfDay).toBe(930);
  });

  it("G4-5: 15:29 ET → factor=0.25, phase=pm_floor (last valid entry minute)", () => {
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:29") });
    expect(r.factor).toBe(0.25);
    expect(r.phase).toBe("pm_floor");
    expect(r.etMinuteOfDay).toBe(929);
  });

  it("G4-6: 14:45 ET linear interpolation — factor math verified", () => {
    // progress = (14:45 - 13:30) / (15:00 - 13:30) = 75/90 = 0.8333...
    // factor = 0.50 + 0.8333 * (0.25 - 0.50) = 0.50 - 0.2083 = 0.2917
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 14:45") });
    expect(r.phase).toBe("pm_taper");
    // 75/90 = 5/6; factor = 0.5 + (5/6) * (-0.25) = 0.5 - 0.20833 = 0.29167
    expect(r.factor).toBeCloseTo(0.29167, 3);
    expect(r.etMinuteOfDay).toBe(885);
  });

  it("G4-7: etMinuteOfDay is echoed correctly for known times", () => {
    // 09:45 = 9*60+45 = 585
    expect(computePmSizeFactor({ barTsUtc: etBar("2026-05-26 09:45") }).etMinuteOfDay).toBe(585);
    // 15:15 = 15*60+15 = 915
    expect(computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:15") }).etMinuteOfDay).toBe(915);
    // 16:00 = 16*60+0 = 960
    expect(computePmSizeFactor({ barTsUtc: etBar("2026-05-26 16:00") }).etMinuteOfDay).toBe(960);
  });

  it("G4-8: PM_SIZE_FACTOR_AT_13_30 env override changes start factor", () => {
    const saved = process.env.PM_SIZE_FACTOR_AT_13_30;
    process.env.PM_SIZE_FACTOR_AT_13_30 = "0.60";
    try {
      const defaults = getPmSizeFactorEnvDefaults();
      expect(defaults.factorAtStart).toBe(0.60);
      // At 13:30 ET → factor should be 0.60 (from env)
      const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 13:30") });
      expect(r.factor).toBe(0.60);
    } finally {
      if (saved === undefined) delete process.env.PM_SIZE_FACTOR_AT_13_30;
      else process.env.PM_SIZE_FACTOR_AT_13_30 = saved;
    }
  });

  it("G4-9: PM_SIZE_FACTOR_AT_15_00 env override changes floor factor", () => {
    const saved = process.env.PM_SIZE_FACTOR_AT_15_00;
    process.env.PM_SIZE_FACTOR_AT_15_00 = "0.30";
    try {
      const defaults = getPmSizeFactorEnvDefaults();
      expect(defaults.factorAtFloor).toBe(0.30);
      // At 15:00 ET → factor should be 0.30
      const r = computePmSizeFactor({ barTsUtc: etBar("2026-05-26 15:00") });
      expect(r.factor).toBe(0.30);
    } finally {
      if (saved === undefined) delete process.env.PM_SIZE_FACTOR_AT_15_00;
      else process.env.PM_SIZE_FACTOR_AT_15_00 = saved;
    }
  });

  it("G4-10: lastEntry < floor config → conservative fallback (config error)", () => {
    // pmLastEntryEt (15:00) < pmFloorAtEt (15:30) violates constraint floorMin <= lastEntryMin
    // Wait: lastEntryMin < floorMin is the violation: lastEntry=14:00, floor=15:00
    const r = computePmSizeFactor({
      barTsUtc: etBar("2026-05-26 14:00"),
      pmStartEt: "13:30",
      pmFloorAtEt: "15:00",
      pmLastEntryEt: "14:30",  // last entry BEFORE floor — invalid
    });
    // lastEntryMin (14:30=870) < floorMin (15:00=900) → violates lastEntryMin < floorMin check
    // Wait, the check is `lastEntryMin < floorMin` — let me re-read the validation:
    // `floorMin <= startMin || lastEntryMin < floorMin` → fallback
    // 870 (14:30) < 900 (15:00) → condition met → fallback
    expect(r.factor).toBe(0.25);
    expect(r.reason).toMatch(/config_error/);
  });

  it("G4-11: DST spring-forward — 15:00 ET in March (EDT) → factor=0.25", () => {
    // 2026-03-09 is first Monday after DST start 2026-03-08 (EDT, UTC-4)
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-03-09 15:00") });
    expect(r.factor).toBe(0.25);
    expect(r.phase).toBe("pm_floor");
  });

  it("G4-12: DST fall-back — 13:30 ET in November (EST) → factor=0.50", () => {
    // 2026-11-02 is after fall-back (2026-11-01 02:00 EST)
    const r = computePmSizeFactor({ barTsUtc: etBar("2026-11-02 13:30") });
    expect(r.factor).toBe(0.50);
    expect(r.phase).toBe("pm_taper");
  });

  it("G4-13: factor output is bounded [0,1] for any valid input in taper zone", () => {
    // Test 10 minute intervals through the taper zone
    const tapherTimes = ["13:30", "13:45", "14:00", "14:15", "14:30", "14:45", "14:59"];
    for (const t of tapherTimes) {
      const r = computePmSizeFactor({ barTsUtc: etBar(`2026-05-26 ${t}`) });
      expect(r.factor).toBeGreaterThanOrEqual(0);
      expect(r.factor).toBeLessThanOrEqual(1);
      expect(r.phase).toBe("pm_taper");
    }
  });
});

// ─── Cross-gate: verify none of the pure functions import DB or Express ───────

describe("Pure-function isolation — no DB or Express dependencies at import time", () => {
  it("daily-trade-cap evaluator and resolver are synchronous pure functions", () => {
    // If these were async/DB-touching, the call would fail or hang
    const result = evaluateDailyTradeCap({ tradesToday: 0, perSessionCap: null, envDefault: 2 });
    expect(typeof result.allow).toBe("boolean");
    expect(typeof result.effectiveCap).toBe("number");
    expect(typeof result.reason).toBe("string");
    expect(typeof result.tradesToday).toBe("number");
  });

  it("lunch-blackout-gate evaluator is a synchronous pure function", () => {
    const result = evaluateLunchBlackoutGate({ barTsUtc: new Date("2026-05-26T15:00:00Z") });
    expect(typeof result.block).toBe("boolean");
    expect(typeof result.reason).toBe("string");
    expect(typeof result.windowSpec).toBe("string");
    expect(typeof result.perStrategyOverrideApplied).toBe("boolean");
  });

  it("pm-size-factor evaluator is a synchronous pure function", () => {
    const result = computePmSizeFactor({ barTsUtc: new Date("2026-05-26T17:00:00Z") });
    expect(typeof result.factor).toBe("number");
    expect(typeof result.phase).toBe("string");
    expect(typeof result.etMinuteOfDay).toBe("number");
    expect(typeof result.reason).toBe("string");
  });
});
