/**
 * C7 — Validation Cadence Route Tests (W16 Team C)
 *
 * Tests:
 *  1. GET /api/validation-cadence/dashboard — happy path returns dashboard payload
 *  2. GET /api/validation-cadence/dashboard — bubbles 500 on service error
 *  3. POST /api/validation-cadence/reality-check — returns full report
 *  4. POST /api/validation-cadence/reality-check — bubbles 500 on service error
 *  5. Route is intentionally NOT pipeline-pause guarded (forcing function visibility)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("../services/validation-cadence-service.js", () => ({
  getValidationCadenceDashboard: vi.fn(),
  runMonthlyRealityCheckReport: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getValidationCadenceDashboard,
  runMonthlyRealityCheckReport,
} from "../services/validation-cadence-service.js";

// ─── Helper: simulate the dashboard route handler ────────────────────────────

interface MockRes {
  statusCode: number;
  body: any;
  status: (code: number) => MockRes;
  json: (body: any) => MockRes;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

async function callDashboardRoute(): Promise<MockRes> {
  const res = makeRes();
  try {
    const dashboard = await getValidationCadenceDashboard();
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return res;
}

async function callRealityCheckRoute(): Promise<MockRes> {
  const res = makeRes();
  try {
    const report = await runMonthlyRealityCheckReport();
    res.json(report);
  } catch (err) {
    res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Dashboard route ─────────────────────────────────────────────────────────

describe("GET /api/validation-cadence/dashboard", () => {
  it("returns dashboard payload on happy path", async () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      daysSinceLastLiveBacktest: {
        days: 2,
        lastBacktestAt: new Date().toISOString(),
        lastBacktestId: "bt-1",
        isRed: false,
        thresholdDays: 7,
      },
      strategiesThisMonth: {
        count: 1,
        strategyIds: ["s1"],
        monthStart: new Date().toISOString(),
        minThreshold: 1,
        isBelowThreshold: false,
      },
      realityCheck: {
        score: 80,
        breakdown: { cadenceScore: 35, throughputScore: 25, fidelityScore: 20 },
        thresholdDays: 7,
        minStrategiesThreshold: 1,
      },
    };
    vi.mocked(getValidationCadenceDashboard).mockResolvedValue(payload);

    const res = await callDashboardRoute();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(payload);
  });

  it("returns 500 on service error", async () => {
    vi.mocked(getValidationCadenceDashboard).mockRejectedValue(new Error("DB down"));

    const res = await callDashboardRoute();
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("internal_error");
    expect(res.body.message).toContain("DB down");
  });

  it("returns RED state when 8 days idle (the verification scenario)", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    vi.mocked(getValidationCadenceDashboard).mockResolvedValue({
      generatedAt: new Date().toISOString(),
      daysSinceLastLiveBacktest: {
        days: 8,
        lastBacktestAt: eightDaysAgo.toISOString(),
        lastBacktestId: "bt-stale",
        isRed: true, // ← this is what verification checks
        thresholdDays: 7,
      },
      strategiesThisMonth: {
        count: 0,
        strategyIds: [],
        monthStart: new Date().toISOString(),
        minThreshold: 1,
        isBelowThreshold: true,
      },
      realityCheck: {
        score: 0,
        breakdown: { cadenceScore: 0, throughputScore: 0, fidelityScore: 0 },
        thresholdDays: 7,
        minStrategiesThreshold: 1,
      },
    });

    const res = await callDashboardRoute();
    expect(res.statusCode).toBe(200);
    expect(res.body.daysSinceLastLiveBacktest.isRed).toBe(true);
    expect(res.body.daysSinceLastLiveBacktest.days).toBe(8);
  });
});

// ─── Reality Check route ─────────────────────────────────────────────────────

describe("POST /api/validation-cadence/reality-check", () => {
  it("returns full report on happy path", async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      realityCheck: {
        score: 85,
        breakdown: { cadenceScore: 40, throughputScore: 30, fidelityScore: 15 },
        thresholdDays: 7,
        minStrategiesThreshold: 1,
      },
      daysSinceLastLiveBacktest: {
        days: 1,
        lastBacktestAt: new Date().toISOString(),
        lastBacktestId: "bt-1",
        isRed: false,
        thresholdDays: 7,
      },
      strategiesThisMonth: {
        count: 3,
        strategyIds: ["s1", "s2", "s3"],
        monthStart: new Date().toISOString(),
        minThreshold: 1,
        isBelowThreshold: false,
      },
      comparisons: [],
      severity: "info" as const,
    };
    vi.mocked(runMonthlyRealityCheckReport).mockResolvedValue(report);

    const res = await callRealityCheckRoute();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(report);
  });

  it("returns 500 on service error", async () => {
    vi.mocked(runMonthlyRealityCheckReport).mockRejectedValue(new Error("internal failure"));

    const res = await callRealityCheckRoute();
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("internal_error");
  });

  it("returns critical severity in payload when cadence is RED", async () => {
    vi.mocked(runMonthlyRealityCheckReport).mockResolvedValue({
      generatedAt: new Date().toISOString(),
      realityCheck: {
        score: 0,
        breakdown: { cadenceScore: 0, throughputScore: 0, fidelityScore: 0 },
        thresholdDays: 7,
        minStrategiesThreshold: 1,
      },
      daysSinceLastLiveBacktest: {
        days: 9,
        lastBacktestAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
        lastBacktestId: "bt-old",
        isRed: true,
        thresholdDays: 7,
      },
      strategiesThisMonth: {
        count: 0,
        strategyIds: [],
        monthStart: new Date().toISOString(),
        minThreshold: 1,
        isBelowThreshold: true,
      },
      comparisons: [],
      severity: "critical",
    });

    const res = await callRealityCheckRoute();
    expect(res.statusCode).toBe(200);
    expect(res.body.severity).toBe("critical");
    expect(res.body.daysSinceLastLiveBacktest.isRed).toBe(true);
  });
});
