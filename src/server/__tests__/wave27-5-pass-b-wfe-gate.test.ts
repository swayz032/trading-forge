/**
 * wave27-5-pass-b-wfe-gate.test.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Tests the pure-function evaluateWfeGate helper.
 * Covers:
 *   - WFE >= 0.70 → passes (happy path)
 *   - WFE < 0.50 → blocked (hard floor)
 *   - 0.50 <= WFE < 0.70 → warned (between floors, allow)
 *   - null WFE → legacy proceed + audit
 *   - env-var threshold override respected
 *   - audit action names correct for each outcome
 *   - SSE payload fields present on every evaluation
 *   - boundary conditions for hard and warn floors
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  evaluateWfeGate,
  getWfeHardFloor,
  getWfeWarnFloor,
  type WfeGateStatus,
} from "../lib/wfe-gate.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.WFE_HARD_FLOOR;
  delete process.env.WFE_WARN_FLOOR;
});

// ─── Env-var helpers ──────────────────────────────────────────────────────────

describe("getWfeHardFloor / getWfeWarnFloor defaults", () => {
  it("hard floor defaults to 0.70", () => {
    expect(getWfeHardFloor()).toBe(0.70);
  });

  it("warn floor defaults to 0.50", () => {
    expect(getWfeWarnFloor()).toBe(0.50);
  });

  it("hard floor respects env var WFE_HARD_FLOOR", () => {
    process.env.WFE_HARD_FLOOR = "0.80";
    expect(getWfeHardFloor()).toBe(0.80);
  });

  it("warn floor respects env var WFE_WARN_FLOOR", () => {
    process.env.WFE_WARN_FLOOR = "0.40";
    expect(getWfeWarnFloor()).toBe(0.40);
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("evaluateWfeGate — WFE >= hard floor → passed", () => {
  it("returns passed status when wfeOverall = 0.70 (exactly at floor)", () => {
    const result = evaluateWfeGate(0.70, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });

  it("returns passed status when wfeOverall = 0.90 (well above floor)", () => {
    const result = evaluateWfeGate(0.90, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.passed).toBe(true);
  });
});

// ─── Warn zone ────────────────────────────────────────────────────────────────

describe("evaluateWfeGate — WFE in warn zone → warned (allow)", () => {
  it("returns warned status when wfeOverall = 0.60 (between 0.50 and 0.70)", () => {
    const result = evaluateWfeGate(0.60, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("warned");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.wfe_warning_below_target");
  });

  it("returns warned status when wfeOverall = 0.50 (exactly at warn floor)", () => {
    const result = evaluateWfeGate(0.50, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("warned");
    expect(result.passed).toBe(true);
  });

  it("returns warned status when wfeOverall = 0.699 (just below hard floor)", () => {
    const result = evaluateWfeGate(0.699, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("warned");
    expect(result.passed).toBe(true);
  });
});

// ─── Hard block ───────────────────────────────────────────────────────────────

describe("evaluateWfeGate — WFE < warn floor → blocked", () => {
  it("returns blocked status when wfeOverall = 0.49 (just below warn floor)", () => {
    const result = evaluateWfeGate(0.49, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("returns blocked when wfeOverall = 0.10 (very low WFE — likely overfit)", () => {
    const result = evaluateWfeGate(0.10, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
  });

  it("returns blocked when wfeOverall = 0 (zero WFE)", () => {
    const result = evaluateWfeGate(0, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
  });
});

// ─── Legacy null path ─────────────────────────────────────────────────────────

describe("evaluateWfeGate — null WFE → legacy proceed", () => {
  it("returns legacy_null status when wfeOverall is null", () => {
    const result = evaluateWfeGate(null, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("legacy_null");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.wfe_unavailable_legacy");
    expect(result.wfeOverall).toBeNull();
  });

  it("returns legacy_null status when wfeOverall is undefined", () => {
    const result = evaluateWfeGate(undefined, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("legacy_null");
    expect(result.passed).toBe(true);
  });
});

// ─── Env-var override in gate ─────────────────────────────────────────────────

describe("evaluateWfeGate — env-var override respected via argument passthrough", () => {
  it("uses provided hardFloor argument (0.80) for threshold comparison", () => {
    // WFE 0.75 is above default 0.70 but below override 0.80 → should warn
    const result = evaluateWfeGate(0.75, 0.80, 0.50);
    expect(result.status).toBe<WfeGateStatus>("warned");
    expect(result.passed).toBe(true);
  });
});

// ─── Result payload completeness (SSE source) ─────────────────────────────────

describe("evaluateWfeGate — result payload (SSE surface)", () => {
  it("always returns wfeOverall, hardFloor, warnFloor in result", () => {
    const cases = [0.90, 0.60, 0.30, null];
    for (const wfe of cases) {
      const result = evaluateWfeGate(wfe, 0.70, 0.50);
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("wfeOverall");
      expect(result).toHaveProperty("hardFloor");
      expect(result).toHaveProperty("warnFloor");
      expect(result.hardFloor).toBe(0.70);
      expect(result.warnFloor).toBe(0.50);
    }
  });
});
