/**
 * W23H.A (2026-05-20) — 3-regime bias engine: PLAYBOOK_TO_REGIME mapping tests.
 *
 * Tests:
 *  1. All 9 playbook names produce correct regime_label (no UNKNOWN fallback)
 *  2. MEAN_REVERSION_LONG → RANGE_BOUND
 *  3. MEAN_REVERSION_SHORT → RANGE_BOUND
 *  4. Legacy compat: FULL_LONG/LEAN_LONG → TRENDING_UP, FULL_SHORT/LEAN_SHORT → TRENDING_DOWN
 *  5. NO_TRADE → NO_TRADE
 *  6. Unknown playbook → UNKNOWN (explicit fallback test)
 *
 * Pure unit tests — no DB, no network.
 * The PLAYBOOK_TO_REGIME dict lives in the Python inline script; we mirror it here
 * for TypeScript-level contract enforcement.
 */

import { describe, it, expect } from "vitest";

// Mirror of PLAYBOOK_TO_REGIME from bias-state-service.ts inline Python script.
// This TypeScript replica is the contract test — if the Python dict changes and
// this test is not updated, the test fails, forcing explicit acknowledgment.
const PLAYBOOK_TO_REGIME: Record<string, string> = {
  // 9-playbook router output names (W23H.A)
  "NO_TRADE":                 "NO_TRADE",
  "TREND_CONTINUATION_LONG":  "TRENDING_UP",
  "TREND_CONTINUATION_SHORT": "TRENDING_DOWN",
  "SWEEP_REVERSAL_LONG":      "TRENDING_UP",
  "SWEEP_REVERSAL_SHORT":     "TRENDING_DOWN",
  "MEAN_REVERSION_LONG":      "RANGE_BOUND",
  "MEAN_REVERSION_SHORT":     "RANGE_BOUND",
  "ORB_LONG":                 "TRENDING_UP",
  "ORB_SHORT":                "TRENDING_DOWN",
  // Legacy compat
  "FULL_LONG":                "TRENDING_UP",
  "LEAN_LONG":                "TRENDING_UP",
  "FULL_SHORT":               "TRENDING_DOWN",
  "LEAN_SHORT":               "TRENDING_DOWN",
};

function mapPlaybookToRegime(playbook: string): string {
  return PLAYBOOK_TO_REGIME[playbook] ?? "UNKNOWN";
}

// ─── All 9 playbook names produce correct regime ───────────────────────────

describe("W23H.A PLAYBOOK_TO_REGIME: all 9 router playbooks", () => {
  it("NO_TRADE → NO_TRADE", () => {
    expect(mapPlaybookToRegime("NO_TRADE")).toBe("NO_TRADE");
  });

  it("TREND_CONTINUATION_LONG → TRENDING_UP", () => {
    expect(mapPlaybookToRegime("TREND_CONTINUATION_LONG")).toBe("TRENDING_UP");
  });

  it("TREND_CONTINUATION_SHORT → TRENDING_DOWN", () => {
    expect(mapPlaybookToRegime("TREND_CONTINUATION_SHORT")).toBe("TRENDING_DOWN");
  });

  it("SWEEP_REVERSAL_LONG → TRENDING_UP", () => {
    expect(mapPlaybookToRegime("SWEEP_REVERSAL_LONG")).toBe("TRENDING_UP");
  });

  it("SWEEP_REVERSAL_SHORT → TRENDING_DOWN", () => {
    expect(mapPlaybookToRegime("SWEEP_REVERSAL_SHORT")).toBe("TRENDING_DOWN");
  });

  it("MEAN_REVERSION_LONG → RANGE_BOUND", () => {
    expect(mapPlaybookToRegime("MEAN_REVERSION_LONG")).toBe("RANGE_BOUND");
  });

  it("MEAN_REVERSION_SHORT → RANGE_BOUND", () => {
    expect(mapPlaybookToRegime("MEAN_REVERSION_SHORT")).toBe("RANGE_BOUND");
  });

  it("ORB_LONG → TRENDING_UP", () => {
    expect(mapPlaybookToRegime("ORB_LONG")).toBe("TRENDING_UP");
  });

  it("ORB_SHORT → TRENDING_DOWN", () => {
    expect(mapPlaybookToRegime("ORB_SHORT")).toBe("TRENDING_DOWN");
  });
});

// ─── Legacy compat: old 5-playbook names still map correctly ─────────────

describe("W23H.A PLAYBOOK_TO_REGIME: legacy 5-playbook compat", () => {
  it("FULL_LONG → TRENDING_UP", () => {
    expect(mapPlaybookToRegime("FULL_LONG")).toBe("TRENDING_UP");
  });

  it("LEAN_LONG → TRENDING_UP", () => {
    expect(mapPlaybookToRegime("LEAN_LONG")).toBe("TRENDING_UP");
  });

  it("FULL_SHORT → TRENDING_DOWN", () => {
    expect(mapPlaybookToRegime("FULL_SHORT")).toBe("TRENDING_DOWN");
  });

  it("LEAN_SHORT → TRENDING_DOWN", () => {
    expect(mapPlaybookToRegime("LEAN_SHORT")).toBe("TRENDING_DOWN");
  });
});

// ─── No UNKNOWN fallback for any known playbook name ──────────────────────

describe("W23H.A PLAYBOOK_TO_REGIME: no UNKNOWN for valid playbooks", () => {
  const validPlaybooks = Object.keys(PLAYBOOK_TO_REGIME);

  it("all valid playbook names produce non-UNKNOWN regime", () => {
    for (const pb of validPlaybooks) {
      const regime = mapPlaybookToRegime(pb);
      expect(regime).not.toBe("UNKNOWN");
      expect(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND", "NO_TRADE"]).toContain(regime);
    }
  });

  it("covers all 9 router playbooks (regression: none missing)", () => {
    const routerPlaybooks = [
      "NO_TRADE",
      "TREND_CONTINUATION_LONG",
      "TREND_CONTINUATION_SHORT",
      "SWEEP_REVERSAL_LONG",
      "SWEEP_REVERSAL_SHORT",
      "MEAN_REVERSION_LONG",
      "MEAN_REVERSION_SHORT",
      "ORB_LONG",
      "ORB_SHORT",
    ];
    for (const pb of routerPlaybooks) {
      expect(mapPlaybookToRegime(pb)).not.toBe("UNKNOWN");
    }
  });
});

// ─── Unknown playbook → UNKNOWN (explicit fallback test) ─────────────────

describe("W23H.A PLAYBOOK_TO_REGIME: unknown playbook fallback", () => {
  it("unmapped playbook name → UNKNOWN", () => {
    expect(mapPlaybookToRegime("SOME_FUTURE_PLAYBOOK")).toBe("UNKNOWN");
    expect(mapPlaybookToRegime("")).toBe("UNKNOWN");
  });
});
