/**
 * W3B (2026-07-17) — payout-cap wiring tests.
 *
 * The /api/prop-firm/payout projection computed monthlyNet = monthlyGross ×
 * payoutSplit UNCAPPED, ignoring the per-request payout caps that
 * getPayoutCap() models (src/shared/firm-config.ts). Same class existed in
 * the /rank endpoint's funded-month ROI block. Both are now capped at
 * N_req × getPayoutCap(firm, stage, path, dll) with the cadence PINNED:
 * MFFU = 2 requests/month (bi-weekly per CLAUDE.md §6), Topstep = 1/month.
 *
 * Covers:
 *   - resolvePayoutCapContext / applyMonthlyPayoutCap helper units
 *   - /payout: capped vs uncapped months; MFFU 2×$2K monthly cap;
 *     Topstep XFA standard base vs withDll (route default dllOptedIn=TRUE,
 *     mirroring broker_accounts.dll_opted_in DEFAULT true — migration 0168);
 *     LFA uncapped (null cap); numAccounts scaling; response stamp
 *   - /rank: funded-month monthlyNet capped + per-row stamp
 *
 * Uses in-process express server + Node global fetch (web-discovery-route
 * pattern). No supertest dependency.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─── Module mocks (before importing the route under test) ────────────────────

vi.mock("../db/index.js", () => ({ db: {} }));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/prop-firm-survival-service.js", () => ({
  simulateSurvivalCurve: vi.fn(),
  deriveStrategyProfile: vi.fn(),
}));

// computeFirmSurvival catches per-firm errors → survival fields become nulls.
vi.mock("../services/firm-adversarial-event-service.js", () => ({
  getCurrentPriors: vi.fn().mockRejectedValue(new Error("not under test")),
}));

vi.mock("../services/firm-priors-fitter.js", () => ({
  refitPriorsForAllFirms: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../middleware/strict-rate-limit.js", () => ({
  strictRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { propFirmRoutes } from "../routes/prop-firm.js";
import {
  resolvePayoutCapContext,
  applyMonthlyPayoutCap,
  PAYOUT_REQUESTS_PER_MONTH,
} from "../lib/payout-cap-projection.js";

// ─── Helper units ─────────────────────────────────────────────────────────────

describe("payout-cap-projection helpers", () => {
  it("pins MFFU at 2 requests/month (bi-weekly per CLAUDE.md §6) and Topstep at 1", () => {
    expect(PAYOUT_REQUESTS_PER_MONTH["mffu"]).toBe(2);
    expect(PAYOUT_REQUESTS_PER_MONTH["topstep"]).toBe(1);
  });

  it("MFFU monthly cap = 2 × $2,000 = $4,000 regardless of path/DLL", () => {
    const ctx = resolvePayoutCapContext("mffu", "xfa", "standard", true);
    expect(ctx.cap_per_request).toBe(2000);
    expect(ctx.requests_per_month).toBe(2);
    expect(ctx.monthly_cap_per_account).toBe(4000);
    expect(ctx.source).toBe("getPayoutCap");
  });

  it("Topstep XFA standard: base $2,000 (dll=false) vs withDll $4,000 (dll=true)", () => {
    expect(resolvePayoutCapContext("topstep", "xfa", "standard", false).monthly_cap_per_account).toBe(2000);
    expect(resolvePayoutCapContext("topstep", "xfa", "standard", true).monthly_cap_per_account).toBe(4000);
  });

  it("Topstep XFA consistency path: $3,000 base / $6,000 withDll", () => {
    expect(resolvePayoutCapContext("topstep", "xfa", "consistency", false).monthly_cap_per_account).toBe(3000);
    expect(resolvePayoutCapContext("topstep", "xfa", "consistency", true).monthly_cap_per_account).toBe(6000);
  });

  it("Topstep LFA is uncapped: null cap, applyMonthlyPayoutCap passes through", () => {
    const ctx = resolvePayoutCapContext("topstep", "lfa", "standard", true);
    expect(ctx.cap_per_request).toBeNull();
    expect(ctx.monthly_cap_per_account).toBeNull();
    expect(applyMonthlyPayoutCap(123_456, ctx)).toBe(123_456);
  });

  it("applyMonthlyPayoutCap caps only when above the ceiling and scales by numAccounts", () => {
    const ctx = resolvePayoutCapContext("topstep", "xfa", "standard", true); // $4K/mo/acct
    expect(applyMonthlyPayoutCap(3000, ctx)).toBe(3000); // below cap → untouched
    expect(applyMonthlyPayoutCap(9000, ctx)).toBe(4000); // above cap → capped
    expect(applyMonthlyPayoutCap(9000, ctx, 2)).toBe(8000); // 2 accounts → 2×cap
  });

  it("labels the simplifications honestly (no stage/cycle modeling)", () => {
    const ctx = resolvePayoutCapContext("mffu");
    expect(ctx.simplifications.join(" ")).toContain("account-twin");
    expect(ctx.simplifications.join(" ")).toContain("2 requests/month");
  });
});

// ─── Route wiring ─────────────────────────────────────────────────────────────

describe("W3B payout-cap route wiring", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/prop-firm", propFirmRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  async function postJson(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  // avgDailyPnl=500 → monthlyGross $10,000/acct; Topstep net 0.9 → $9,000;
  // MFFU net 0.8 → $8,000. Eval 1 month, buffer 1 month → funded from month 3.
  it("/payout Topstep XFA standard (default dllOptedIn=TRUE) caps funded months at $4,000", async () => {
    const { status, body } = await postJson("/api/prop-firm/payout", {
      firm: "topstep",
      avgDailyPnl: 500,
      months: 6,
    });
    expect(status).toBe(200);
    expect(body.payout_cap_applied).toMatchObject({
      cap_per_request: 4000, // withDll — route default dllOptedIn=true (mig 0168)
      requests_per_month: 1,
      monthly_cap_per_account: 4000,
      account_stage: "xfa",
      payout_path: "standard",
      dll_opted_in: true,
      source: "getPayoutCap",
    });
    expect(Array.isArray(body.payout_cap_applied.simplifications)).toBe(true);
    const funded = body.monthlyProjection.filter((m: any) => m.phase === "funded");
    expect(funded.length).toBeGreaterThan(0);
    for (const m of funded) {
      expect(m.netPayoutUncapped).toBe(9000);
      expect(m.netPayout).toBe(4000); // capped
      expect(m.payoutCapped).toBe(true);
    }
  });

  it("/payout Topstep XFA standard with explicit dllOptedIn=false caps at the $2,000 base", async () => {
    const { body } = await postJson("/api/prop-firm/payout", {
      firm: "topstep",
      avgDailyPnl: 500,
      months: 6,
      dllOptedIn: false,
    });
    expect(body.payout_cap_applied.cap_per_request).toBe(2000);
    const funded = body.monthlyProjection.filter((m: any) => m.phase === "funded");
    for (const m of funded) expect(m.netPayout).toBe(2000);
  });

  it("/payout MFFU caps funded months at 2 × $2,000 = $4,000 (bi-weekly cadence)", async () => {
    const { body } = await postJson("/api/prop-firm/payout", {
      firm: "mffu",
      avgDailyPnl: 500,
      months: 6,
    });
    expect(body.payout_cap_applied).toMatchObject({
      cap_per_request: 2000,
      requests_per_month: 2,
      monthly_cap_per_account: 4000,
    });
    const funded = body.monthlyProjection.filter((m: any) => m.phase === "funded");
    expect(funded.length).toBeGreaterThan(0);
    for (const m of funded) {
      expect(m.netPayoutUncapped).toBe(8000); // 10,000 × 0.80
      expect(m.netPayout).toBe(4000); // capped at 2×$2K
      expect(m.payoutCapped).toBe(true);
    }
  });

  it("/payout Topstep LFA is uncapped (null cap) — months keep the full net", async () => {
    const { body } = await postJson("/api/prop-firm/payout", {
      firm: "topstep",
      avgDailyPnl: 500,
      months: 6,
      accountStage: "lfa",
    });
    expect(body.payout_cap_applied.cap_per_request).toBeNull();
    expect(body.payout_cap_applied.monthly_cap_per_account).toBeNull();
    const funded = body.monthlyProjection.filter((m: any) => m.phase === "funded");
    for (const m of funded) {
      expect(m.netPayout).toBe(9000); // uncapped
      expect(m.payoutCapped).toBe(false);
    }
  });

  it("/payout months below the cap are NOT capped (capped vs uncapped)", async () => {
    // avgDailyPnl=100 → monthlyGross $2,000 → Topstep net $1,800 < $4,000 cap
    const { body } = await postJson("/api/prop-firm/payout", {
      firm: "topstep",
      avgDailyPnl: 100,
      months: 12,
    });
    const funded = body.monthlyProjection.filter((m: any) => m.phase === "funded");
    expect(funded.length).toBeGreaterThan(0);
    for (const m of funded) {
      expect(m.netPayout).toBe(m.netPayoutUncapped);
      expect(m.payoutCapped).toBe(false);
    }
  });

  it("/payout monthly cap scales with numAccounts (caps are per account)", async () => {
    const { body } = await postJson("/api/prop-firm/payout", {
      firm: "topstep",
      avgDailyPnl: 500,
      months: 6,
      numAccounts: 2,
    });
    const funded = body.monthlyProjection.filter((m: any) => m.phase === "funded");
    for (const m of funded) {
      expect(m.netPayoutUncapped).toBe(18000); // 2 × $9,000
      expect(m.netPayout).toBe(8000); // 2 × $4,000 cap
    }
  });

  it("/rank funded-month projection is capped too (the sibling block) and stamps per row", async () => {
    const { status, body } = await postJson("/api/prop-firm/rank", {
      avgDailyPnl: 500,
      maxDrawdown: 1500,
      winRate: 0.5,
      profitFactor: 2.0,
    });
    expect(status).toBe(200);
    expect(body.rankings.length).toBe(2); // Topstep + MFFU only
    for (const row of body.rankings) {
      expect(row.payout_cap_applied.source).toBe("getPayoutCap");
      expect(row.payoutCapped).toBe(true);
      expect(row.monthlyNet).toBe(4000); // both firms: min(net, $4K/mo) − $0 fees
    }
    const topstep = body.rankings.find((r: any) => r.firm === "topstep");
    const mffu = body.rankings.find((r: any) => r.firm === "mffu");
    expect(topstep.monthlyNetUncapped).toBe(9000);
    expect(mffu.monthlyNetUncapped).toBe(8000);
    expect(topstep.payout_cap_applied.requests_per_month).toBe(1);
    expect(mffu.payout_cap_applied.requests_per_month).toBe(2);
  });
});
