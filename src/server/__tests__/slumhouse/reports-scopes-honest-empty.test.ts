import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// ops-experience 2026-07-21 — observability-room backend: the two NEW report
// scopes each own a DIFFERENT shape and each must be honest-empty.
//
//   soak      → rails_nightly_reports cert verdicts. An EMPTY table is a genuinely
//               empty history (soak:[], NOT degraded); a query FAILURE is degraded
//               so "the desk is broken" never reads as "no soak runs".
//   weekly-ab → read-only-consumes buildABComparisonData (the money-path builder,
//               NOT re-querying its tables). Pre-deploy both sub-accounts have 0
//               trades → hasData:false (never a fabricated edge); a builder throw
//               fail-softs to ab:null + degraded.
//
// Both are mocked at the module edge (db + the A/B builder) so the contract — not a
// live database — is what's locked.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../db/index.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../routes/ab-comparison.js", () => ({ buildABComparisonData: vi.fn() }));

import { db } from "../../db/index.js";
import { buildABComparisonData } from "../../routes/ab-comparison.js";
import { assembleSoakReports, assembleWeeklyAbReports } from "../../lib/slumhouse/reports-data.js";

const dbExecute = db.execute as unknown as ReturnType<typeof vi.fn>;
const abBuild = buildABComparisonData as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assembleSoakReports — cert-verdict shape, honest-empty", () => {
  it("empty rails table → soak:[] and NOT degraded (an empty history is not a failure)", async () => {
    dbExecute.mockResolvedValue([]);
    const out = await assembleSoakReports();
    expect(out.scope).toBe("soak");
    expect(out.soak).toEqual([]);
    expect(out.degraded).toBeUndefined();
  });

  it("★ query failure → soak:[] + degraded:true (a broken read never masquerades as 'no runs')", async () => {
    dbExecute.mockRejectedValue(new Error("db down"));
    const out = await assembleSoakReports();
    expect(out.soak).toEqual([]);
    expect(out.degraded).toBe(true);
  });

  it("rows map to cert verdicts; summary/checks/sha surface ONLY when the certificate has them", async () => {
    dbExecute.mockResolvedValue([
      {
        report_date: "2026-07-21",
        build_sha: "abcdef1234567890",
        verdict: "green",
        certificate: { summary: "held for 72h", checks: { passed: 40, total: 40 } },
      },
      { report_date: "2026-07-20", build_sha: null, verdict: "drift", certificate: {} },
    ]);
    const out = await assembleSoakReports();
    expect(out.soak).toHaveLength(2);
    expect(out.soak[0]).toMatchObject({ reportDate: "2026-07-21", verdict: "green", summary: "held for 72h" });
    expect(out.soak[0].checks).toEqual({ passed: 40, total: 40 });
    // Nothing is fabricated when the certificate is bare — honest nulls, not zeros.
    expect(out.soak[1].summary).toBeNull();
    expect(out.soak[1].checks).toBeNull();
    expect(out.soak[1].buildSha).toBeNull();
    expect(out.degraded).toBeUndefined();
  });
});

describe("assembleWeeklyAbReports — Sharpe/P&L delta shape, honest-empty", () => {
  const metrics = (over: Record<string, number> = {}) => ({
    rolling_20_session_sharpe: 0,
    cumulative_pnl: 0,
    max_drawdown: 0,
    trade_count: 0,
    ...over,
  });

  it("★ pre-deploy (0 trades both sides) → ab.hasData:false, NOT degraded (never a fabricated edge)", async () => {
    abBuild.mockResolvedValue({
      sub_account_1: metrics(),
      sub_account_2: metrics(),
      delta: { sharpe_delta: 0, pnl_delta: 0, drawdown_delta: 0 },
      kill_switch_status: { is_armed: false, currently_dormant: true, last_evaluated: null },
      last_updated: new Date("2026-07-21T00:00:00Z"),
    });
    const out = await assembleWeeklyAbReports();
    expect(out.scope).toBe("weekly-ab");
    expect(out.ab).not.toBeNull();
    expect(out.ab!.hasData).toBe(false);
    expect(out.degraded).toBeUndefined();
  });

  it("live sessions → hasData:true with deltas traced to the builder (not re-derived)", async () => {
    abBuild.mockResolvedValue({
      sub_account_1: metrics({ rolling_20_session_sharpe: 1.2, cumulative_pnl: 1000, trade_count: 18 }),
      sub_account_2: metrics({ rolling_20_session_sharpe: 1.4, cumulative_pnl: 1240, trade_count: 20 }),
      delta: { sharpe_delta: 0.2, pnl_delta: 240, drawdown_delta: -50 },
      kill_switch_status: { is_armed: true, currently_dormant: false, last_evaluated: new Date("2026-07-21T03:00:00Z") },
      last_updated: new Date("2026-07-21T03:00:00Z"),
    });
    const out = await assembleWeeklyAbReports();
    expect(out.ab!.hasData).toBe(true);
    expect(out.ab!.sharpeDelta).toBeCloseTo(0.2);
    expect(out.ab!.pnlDelta).toBe(240);
    expect(out.ab!.challenger.trades).toBe(20);
    expect(out.ab!.baseline.trades).toBe(18);
    expect(out.ab!.killSwitch.isArmed).toBe(true);
    expect(out.degraded).toBeUndefined();
  });

  it("★ builder throws → ab:null + degraded:true (read-only consume fail-softs honestly)", async () => {
    abBuild.mockRejectedValue(new Error("ab desk down"));
    const out = await assembleWeeklyAbReports();
    expect(out.ab).toBeNull();
    expect(out.degraded).toBe(true);
  });
});
