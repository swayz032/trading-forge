/**
 * DD Velocity Gate Hardening Tests — F-1/F-2/F-3/F-4
 *
 * F-3: vacation auto-recovery fires ONLY when operator-absent AND condition resolved
 *       (new CME day boundary passed OR triggering session closed), NOT mid-session,
 *       NOT when operator is present. Emits audit + Discord. Fail-soft.
 * F-2: dd-velocity-cron listed in _PIPELINE_GATE_EXEMPT (source inspection).
 * F-4: Topstep tighten uses in-memory session peak equity, not startingCapital,
 *       for totalAccountDD. Profitable-account fixture: peak $53K, equity $51.5K
 *       should tighten.
 *
 * Run: npx vitest run src/server/__tests__/dd-velocity-hardening.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions: {},
  paperPositions: {},
  auditLog: {},
  systemState: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
  desc: vi.fn(),
  count: vi.fn().mockReturnValue("count_expr"),
  inArray: vi.fn(),
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

vi.mock("./notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((body: string, _a: string, _b: string) => body + "\n[family]"),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
  setMode: vi.fn().mockResolvedValue({ previousMode: "AUTOPAUSE_DD_VELOCITY", newMode: "ACTIVE" }),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn((firmId: string) => {
    if (firmId === "topstep") return { maxDrawdown: 2000, dailyLossLimit: 1000 };
    if (firmId === "mffu") return { maxDrawdown: 2000, dailyLossLimit: null };
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

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  recordEquityAndCheck,
  getDDVelocityConfig,
  __resetEquityWindowsForTests,
  __injectEquitySamplesForTests,
  checkVacationAutoRecovery,
  getSessionPeakEquity,
} from "../services/dd-velocity-gate.js";

import { setMode, getMode } from "../services/pipeline-control-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowMs(): number { return Date.now(); }

/** Build a synthetic equity window showing a breach (≥3% 2hr DD) */
function buildBreachCurve(
  startEquity: number,
  dropPct: number,
  windowMinutes: number,
  now: number = nowMs(),
): { capturedAt: number; equity: number }[] {
  const samples: { capturedAt: number; equity: number }[] = [];
  const dropPerMinute = (startEquity * dropPct) / windowMinutes;
  for (let i = windowMinutes; i >= 0; i--) {
    samples.push({
      capturedAt: now - i * 60_000,
      equity: startEquity - dropPerMinute * (windowMinutes - i),
    });
  }
  return samples;
}

// ─── F-2: _PIPELINE_GATE_EXEMPT source inspection ─────────────────────────────

describe("F-2: dd-velocity-cron in _PIPELINE_GATE_EXEMPT", () => {
  it("scheduler.ts exempts dd-velocity-cron from pipeline gate so it runs when paused", () => {
    // Source inspection — verify the exemption is in scheduler.ts
    const schedulerPath = path.resolve(
      __dirname,
      "../scheduler.ts",
    );
    const source = fs.readFileSync(schedulerPath, "utf8");
    // The exemption must appear somewhere in the scheduler source.
    // We accept either the add() call OR the job being listed inside ALWAYS_RUN_JOBS.
    const hasExemption =
      source.includes('_PIPELINE_GATE_EXEMPT.add("dd-velocity-cron")') ||
      source.includes("'dd-velocity-cron'") && source.includes("ALWAYS_RUN_JOBS");
    expect(
      hasExemption,
      "scheduler.ts must exempt dd-velocity-cron via _PIPELINE_GATE_EXEMPT.add() or ALWAYS_RUN_JOBS so it keeps sampling equity when the pipeline is paused",
    ).toBe(true);
  });
});

// ─── F-3: vacation auto-recovery ─────────────────────────────────────────────

describe("F-3: vacation auto-recovery — checkVacationAutoRecovery", () => {
  beforeEach(() => {
    __resetEquityWindowsForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetEquityWindowsForTests();
  });

  it("exports checkVacationAutoRecovery function", () => {
    expect(typeof checkVacationAutoRecovery).toBe("function");
  });

  it("does NOT resume when operator is PRESENT (operatorAbsentSince null) — behavior unchanged", async () => {
    // Operator present: operatorAbsentSince = null → must never auto-resume
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              operatorAbsentSince: null,  // operator IS present
              operatorAbsentPending: null,
            },
          ]),
        }),
      }),
    } as any);
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");

    await checkVacationAutoRecovery();

    expect(vi.mocked(setMode)).not.toHaveBeenCalled();
  });

  it("does NOT resume when operator-absent but pipeline is NOT AUTOPAUSE_DD_VELOCITY", async () => {
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              operatorAbsentSince: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
              operatorAbsentPending: null,
            },
          ]),
        }),
      }),
    } as any);
    // Pipeline mode is PAUSED (not AUTOPAUSE_DD_VELOCITY)
    vi.mocked(getMode).mockResolvedValue("PAUSED");

    await checkVacationAutoRecovery();

    expect(vi.mocked(setMode)).not.toHaveBeenCalled();
  });

  it("does NOT resume mid-session — condition NOT resolved (samples within current day, no new CME day boundary)", async () => {
    // Operator IS absent, pipeline IS AUTOPAUSE_DD_VELOCITY, but we're still in
    // the same CME trading day (no new day boundary passed since autopause).
    const SESSION = "sess-mid-session";
    const ACCOUNT_SIZE = 50_000;
    const now = nowMs();
    // Inject a breach curve so window has samples (no recovery yet — still bleeding)
    const samples = buildBreachCurve(ACCOUNT_SIZE, 0.04, 120, now);
    __injectEquitySamplesForTests(SESSION, samples);

    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              operatorAbsentSince: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
              operatorAbsentPending: null,
            },
          ]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              // audit row showing autopause happened within current CME day (< 17h ago)
              { createdAt: new Date(Date.now() - 30 * 60 * 1000) },
            ]),
          }),
        }),
      }),
    } as any);
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");

    await checkVacationAutoRecovery({ sessionId: SESSION, autopausedAtMs: now - 30 * 60_000 });

    // Must NOT have resumed — still mid-session, condition unresolved
    expect(vi.mocked(setMode)).not.toHaveBeenCalled();
  });

  it("resumes when operator-absent AND a new CME trading day has passed since autopause", async () => {
    // Operator absent, pipeline AUTOPAUSE_DD_VELOCITY, autopause happened yesterday
    // → new CME day boundary has crossed → safe to auto-recover.
    //
    // Strategy: we mock getMode to return AUTOPAUSE_DD_VELOCITY.
    // The db.select for system_state must return operatorAbsentSince=set.
    // We do this by replacing the db.select mock for this test only.
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");

    const { db } = await import("../db/index.js");
    // Override select to return operator-absent state for system_state query
    const selectSpy = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { operatorAbsentSince: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
          ]),
        }),
      }),
    });
    vi.mocked(db).select = selectSpy;

    const SESSION = "sess-new-day";
    __injectEquitySamplesForTests(SESSION, [
      { capturedAt: nowMs() - 2 * 60_000, equity: 50_000 },
      { capturedAt: nowMs() - 60_000, equity: 50_000 },
    ]);

    // Autopause happened MORE THAN 17h ago (full CME day boundary crossed)
    const autopausedAtMs = nowMs() - 20 * 60 * 60_000;
    await checkVacationAutoRecovery({ sessionId: SESSION, autopausedAtMs });

    // Must have called setMode("ACTIVE")
    expect(vi.mocked(setMode)).toHaveBeenCalledWith(
      "ACTIVE",
      expect.stringContaining("dd_velocity_vacation_auto_recovery"),
    );
  });

  it("emits audit row on successful auto-recovery", async () => {
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");

    const { db } = await import("../db/index.js");
    const selectSpy = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { operatorAbsentSince: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
          ]),
        }),
      }),
    });
    vi.mocked(db).select = selectSpy;

    const SESSION = "sess-audit-check";
    __injectEquitySamplesForTests(SESSION, [
      { capturedAt: nowMs() - 2 * 60_000, equity: 50_000 },
      { capturedAt: nowMs() - 60_000, equity: 50_000 },
    ]);

    await checkVacationAutoRecovery({
      sessionId: SESSION,
      autopausedAtMs: nowMs() - 20 * 60 * 60_000,
    });

    const insertMock = vi.mocked(db.insert);
    expect(insertMock).toHaveBeenCalled();
  });

  it("is fail-soft — a DB error during recovery check does NOT throw", async () => {
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockImplementation(() => {
      throw new Error("simulated DB failure");
    });
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");

    // Must resolve (not reject) even when DB throws
    await expect(checkVacationAutoRecovery()).resolves.not.toThrow();
  });

  it("does NOT resume when operator-absent but session is still open (triggering session NOT closed)", async () => {
    // Same-day scenario: autopause happened 30 min ago, same CME day, session still active
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { operatorAbsentSince: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), operatorAbsentPending: null },
          ]),
        }),
      }),
    } as any);
    vi.mocked(getMode).mockResolvedValue("AUTOPAUSE_DD_VELOCITY");

    // Autopause only 30 min ago — NOT a new CME day
    const autopausedAtMs = nowMs() - 30 * 60_000;
    await checkVacationAutoRecovery({ autopausedAtMs });

    expect(vi.mocked(setMode)).not.toHaveBeenCalled();
  });
});

// ─── F-4: session peak equity for Topstep tightening ─────────────────────────

describe("F-4: Topstep tighten uses session peak equity (not startingCapital)", () => {
  beforeEach(() => {
    __resetEquityWindowsForTests();
    vi.clearAllMocks();
    vi.mocked(getMode).mockResolvedValue("ACTIVE");
  });

  afterEach(() => {
    __resetEquityWindowsForTests();
  });

  it("exports getSessionPeakEquity helper", () => {
    expect(typeof getSessionPeakEquity).toBe("function");
  });

  it("profitable-account fixture: peak $53K, equity $51.5K → tightening fires with peak-based HWM", async () => {
    // Topstep: startingCapital=$50K, but the account has grown to $53K peak.
    // Real trailing-DD floor moves UP with profitable trading.
    // totalAccountDD must be (peakEquity - currentEquity) = $53K - $51.5K = $1.5K
    // Remaining buffer = $2K - $1.5K = $500 → 25% of buffer remaining < 30% tighten threshold
    // → tighten FIRES.
    // Without the fix (using startingCapital=$50K):
    //   totalAccountDD = $50K - $51.5K = -$1.5K → clamped to 0 → remainingBuffer=$2K
    //   → no tighten (50K account in profit doesn't "look" close to floor)
    const SESSION = "sess-profitable-topstep";
    const STARTING_CAPITAL = 50_000;   // original eval balance
    const PEAK_EQUITY = 53_000;         // all-time high (profitable trading)
    const CURRENT_EQUITY = 51_500;      // current — $1.5K below peak
    const now = nowMs();

    // Inject samples with a visible peak at $53K followed by a drop
    __injectEquitySamplesForTests(SESSION, [
      { capturedAt: now - 60 * 60_000, equity: PEAK_EQUITY },   // peak sample in window
      { capturedAt: now - 30 * 60_000, equity: 52_000 },
      { capturedAt: now, equity: CURRENT_EQUITY },
    ]);

    const result = await recordEquityAndCheck(
      SESSION,
      CURRENT_EQUITY,
      STARTING_CAPITAL,
      "topstep",
    );

    // With the fix: peak-based totalAccountDD = $53K - $51.5K = $1.5K
    // remainingBuffer = $2K - $1.5K = $500 < $2K × (1 - 0.7) = $600 → tighten fires
    expect(result.topstepTightenApplied).toBe(true);
    expect(result.effectiveThreshold).toBeLessThan(0.03);
  });

  it("profitable-account: far above startingCapital but within trailing buffer → uses window peak", async () => {
    // Account started at $50K, grew to $52K (peak), now at $51.9K
    // totalAccountDD (peak-based) = $52K - $51.9K = $100 → far from floor → no tighten
    const SESSION = "sess-slightly-profitable";
    const STARTING_CAPITAL = 50_000;
    const PEAK_EQUITY = 52_000;
    const CURRENT_EQUITY = 51_900;
    const now = nowMs();

    __injectEquitySamplesForTests(SESSION, [
      { capturedAt: now - 60 * 60_000, equity: PEAK_EQUITY },
      { capturedAt: now, equity: CURRENT_EQUITY },
    ]);

    const result = await recordEquityAndCheck(
      SESSION,
      CURRENT_EQUITY,
      STARTING_CAPITAL,
      "topstep",
    );

    // totalAccountDD = $100 → remaining buffer = $1900 → well above tighten threshold
    expect(result.topstepTightenApplied).toBe(false);
  });

  it("getSessionPeakEquity returns the all-time high across injected samples", () => {
    const SESSION = "sess-peak-getter";
    const now = nowMs();
    __injectEquitySamplesForTests(SESSION, [
      { capturedAt: now - 90 * 60_000, equity: 51_000 },
      { capturedAt: now - 60 * 60_000, equity: 53_000 },  // peak
      { capturedAt: now - 30 * 60_000, equity: 52_000 },
      { capturedAt: now, equity: 51_500 },
    ]);
    const peak = getSessionPeakEquity(SESSION);
    expect(peak).toBeCloseTo(53_000, 0);
  });

  it("getSessionPeakEquity returns null when session has no samples", () => {
    const peak = getSessionPeakEquity("sess-nonexistent");
    expect(peak).toBeNull();
  });
});

// ─── F-1: docstring contract (behavioral guard) ───────────────────────────────

describe("F-1: dd-velocity-gate docstring corrected — cron-only, not per-tick", () => {
  it("scheduler comment does NOT claim per-tick calling by paper-execution-service", () => {
    // Read the scheduler.ts source and verify the comment around dd-velocity-cron
    // registration no longer claims fine-grained per-tick calling from paper-execution-service.
    const schedulerPath = path.resolve(__dirname, "../scheduler.ts");
    const source = fs.readFileSync(schedulerPath, "utf8");

    // Find the dd-velocity-cron registration block
    const ddBlock = source.substring(
      source.lastIndexOf("dd-velocity-cron"),
      source.lastIndexOf("dd-velocity-cron") + 2000,
    );

    // The OLD stale claim "fine-grained check also happens per-tick from paper-execution-service.ts"
    // must be removed or corrected.
    expect(ddBlock).not.toContain("fine-grained check also happens per-tick from paper-execution-service");
  });

  it("dd-velocity-gate.ts docstring does NOT claim 'paper-execution-service.ts (on every tick)'", () => {
    const gatePath = path.resolve(__dirname, "../services/dd-velocity-gate.ts");
    const source = fs.readFileSync(gatePath, "utf8");
    // The old lie: "Callers: paper-execution-service.ts (on every tick / bar evaluation)"
    expect(source).not.toContain("paper-execution-service.ts (on every tick");
  });
});
