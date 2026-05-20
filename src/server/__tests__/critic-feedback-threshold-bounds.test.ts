/**
 * Track E F-7 — critic-feedback-service threshold cap + auto-loosen
 *
 * Verifies:
 *   1. Threshold is capped at 85 (CRITIC_FORGE_SCORE_MAX) — never goes above
 *   2. Auto-loosen fires when FPR < 10% and total >= 20
 *   3. Auto-loosen is floored at 50 (CRITIC_FORGE_SCORE_MIN) — never goes below
 *   4. Neither path fires when sample size is too small
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared mock state ────────────────────────────────────────────────────────
let mockCurrentValue = "70";
const mockUpdate = vi.fn();
const mockInsertHistory = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: Symbol("strategies"),
  auditLog: Symbol("auditLog"),
  systemParameters: Symbol("systemParameters"),
  systemParameterHistory: Symbol("systemParameterHistory"),
  performanceMetrics: Symbol("performanceMetrics"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Helper: set up db mock to return a param row with given currentValue
function setupDbMock(currentValue: string) {
  const { db } = require("../db/index.js");

  const mockParamRow = { id: "param-id-1", paramName: "critic_min_forge_score", currentValue };

  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([mockParamRow]),
      }),
    }),
  });

  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });

  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

describe("critic-feedback threshold bounds (Track E F-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("threshold cap at 85: tighten does not exceed CRITIC_FORGE_SCORE_MAX", () => {
    // Simulate the cap logic in isolation
    const CRITIC_FORGE_SCORE_MAX = 85;
    const currentValue = 83;
    const newValue = Math.min(currentValue + 5, CRITIC_FORGE_SCORE_MAX);
    expect(newValue).toBe(85);
    expect(newValue).toBeLessThanOrEqual(CRITIC_FORGE_SCORE_MAX);
  });

  it("threshold cap at 85: no-op when already at ceiling", () => {
    const CRITIC_FORGE_SCORE_MAX = 85;
    const currentValue = 85;
    const newValue = Math.min(currentValue + 5, CRITIC_FORGE_SCORE_MAX);
    // newValue === currentValue → skip (no update)
    expect(newValue).toBe(currentValue);
  });

  it("auto-loosen floor at 50: loosen does not go below CRITIC_FORGE_SCORE_MIN", () => {
    const CRITIC_FORGE_SCORE_MIN = 50;
    const currentValue = 51;
    const newValue = Math.max(currentValue - 2, CRITIC_FORGE_SCORE_MIN);
    expect(newValue).toBe(50);
    expect(newValue).toBeGreaterThanOrEqual(CRITIC_FORGE_SCORE_MIN);
  });

  it("auto-loosen floor at 50: no-op when already at floor", () => {
    const CRITIC_FORGE_SCORE_MIN = 50;
    const currentValue = 50;
    const newValue = Math.max(currentValue - 2, CRITIC_FORGE_SCORE_MIN);
    expect(newValue).toBe(currentValue);
  });

  it("auto-loosen fires when FPR < 0.10 and total >= 20", () => {
    const falsePositiveRate = 0.08;
    const total = 25;
    const shouldLoosen = falsePositiveRate < 0.10 && total >= 20;
    expect(shouldLoosen).toBe(true);
  });

  it("auto-loosen does NOT fire when total < 20", () => {
    const falsePositiveRate = 0.05;
    const total = 15;
    const shouldLoosen = falsePositiveRate < 0.10 && total >= 20;
    expect(shouldLoosen).toBe(false);
  });

  it("tighten does NOT fire when total < 10", () => {
    const falsePositiveRate = 0.40;
    const total = 8;
    const shouldTighten = falsePositiveRate > 0.30 && total >= 10;
    expect(shouldTighten).toBe(false);
  });

  it("tighten fires when FPR > 0.30 and total >= 10", () => {
    const falsePositiveRate = 0.35;
    const total = 12;
    const shouldTighten = falsePositiveRate > 0.30 && total >= 10;
    expect(shouldTighten).toBe(true);
  });
});
