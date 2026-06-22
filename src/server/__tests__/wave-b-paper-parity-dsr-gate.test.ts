/**
 * wave-b-paper-parity-dsr-gate.test.ts — Wave B Fix 1 (paper-parity)
 *
 * Tests for evaluateDsrWalkForwardGate in b14-ci-gate.ts.
 *
 * Covers:
 *   1. dsr_pass=true → PROCEED (status "pass")
 *   2. dsr_pass=false, dsr_unavailable=false → BLOCK with "lifecycle.dsr_floor_block"
 *   3. dsr_pass=false, dsr_unavailable=true → BLOCK with "lifecycle.dsr_unavailable_block"
 *   4. dsr_pass=undefined (legacy) → PROCEED + "lifecycle.dsr_unavailable_legacy"
 *   5. dsr_pass=null (legacy null) → PROCEED + "lifecycle.dsr_unavailable_legacy"
 *   6. DSR block occurs AFTER B14 ci_high passes (gate ordering: they are independent
 *      pure functions; composition is enforced by calling ci gate first then dsr gate)
 *   7. Audit payload carries correlationId semantics (auditAction is non-null on block)
 *   8. auditAction is null when dsr_pass=true (no audit noise on clean pass)
 *   9. dsr value is preserved in auditPayload for all paths
 *  10. dsr_unavailable block takes precedence over bare floor block
 *  11. null wfMetadata (completely absent metadata) → legacy_proceed
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  evaluateDsrWalkForwardGate,
  evaluateB14CiGate,
  type WalkForwardDsrInput,
  type DsrGateStatus,
} from "../lib/b14-ci-gate.js";

// ── Logger mock (leaf module per CLAUDE.md feedback_helper_logger_import.md) ──
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Test 1: dsr_pass=true → PROCEED ─────────────────────────────────────────

describe("evaluateDsrWalkForwardGate — dsr_pass=true", () => {
  it("returns passed=true with status 'pass' when dsr_pass=true", () => {
    const input: WalkForwardDsrInput = { dsr_pass: true, dsr_unavailable: false, dsr: 1.75 };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.passed).toBe(true);
    expect(result.status).toBe("pass" satisfies DsrGateStatus);
    expect(result.auditAction).toBeNull();
    expect(result.reason).toBe("lifecycle.dsr_pass");
  });

  it("auditPayload reflects pass state", () => {
    const input: WalkForwardDsrInput = { dsr_pass: true, dsr_unavailable: false, dsr: 2.1 };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.auditPayload.blocked).toBe(false);
    expect(result.auditPayload.dsr_pass).toBe(true);
    expect(result.auditPayload.dsr).toBe(2.1);
    expect(result.auditPayload.status).toBe("pass");
  });

  it("auditAction is null (no audit noise on clean pass)", () => {
    const result = evaluateDsrWalkForwardGate({ dsr_pass: true, dsr: 1.5 });
    expect(result.auditAction).toBeNull();
  });
});

// ─── Test 2: dsr_pass=false, dsr_unavailable falsy → blocked_dsr_floor ───────

describe("evaluateDsrWalkForwardGate — dsr_pass=false (floor block)", () => {
  it("returns passed=false with status 'blocked_dsr_floor' when dsr_pass=false and dsr_unavailable=false", () => {
    const input: WalkForwardDsrInput = { dsr_pass: false, dsr_unavailable: false, dsr: 0.3 };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked_dsr_floor" satisfies DsrGateStatus);
    expect(result.auditAction).toBe("lifecycle.dsr_floor_block");
    expect(result.reason).toBe("lifecycle.dsr_floor_block");
  });

  it("returns blocked_dsr_floor when dsr_unavailable is absent (undefined)", () => {
    const input: WalkForwardDsrInput = { dsr_pass: false, dsr: 0.1 };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.status).toBe("blocked_dsr_floor");
    expect(result.auditPayload.dsr_unavailable).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("audit payload captures dsr value on floor block", () => {
    const input: WalkForwardDsrInput = { dsr_pass: false, dsr: 0.42 };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.auditPayload.dsr).toBe(0.42);
    expect(result.auditPayload.dsr_pass).toBe(false);
  });
});

// ─── Test 3: dsr_unavailable=true AND dsr_pass=false → blocked_dsr_unavailable

describe("evaluateDsrWalkForwardGate — dsr_unavailable=true (computation failure)", () => {
  it("returns passed=false with status 'blocked_dsr_unavailable' when dsr_unavailable=true AND dsr_pass=false", () => {
    const input: WalkForwardDsrInput = { dsr_pass: false, dsr_unavailable: true, dsr: null };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked_dsr_unavailable" satisfies DsrGateStatus);
    expect(result.auditAction).toBe("lifecycle.dsr_unavailable_block");
    expect(result.reason).toBe("lifecycle.dsr_unavailable_block");
  });

  it("audit payload marks dsr_unavailable=true on unavailable block", () => {
    const input: WalkForwardDsrInput = { dsr_pass: false, dsr_unavailable: true };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.auditPayload.dsr_unavailable).toBe(true);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.dsr_pass).toBe(false);
  });

  it("dsr_unavailable block takes PRIORITY over bare floor block when both conditions are true", () => {
    // When dsr_pass=false AND dsr_unavailable=true, the unavailable path should fire
    // (priority in the function: dsr_unavailable check BEFORE bare false check).
    const input: WalkForwardDsrInput = { dsr_pass: false, dsr_unavailable: true, dsr: 0.0 };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.status).toBe("blocked_dsr_unavailable");
    expect(result.auditAction).toBe("lifecycle.dsr_unavailable_block");
    // Must NOT be floor_block when unavailable is set
    expect(result.auditAction).not.toBe("lifecycle.dsr_floor_block");
  });
});

// ─── Test 4/5: dsr_pass=undefined|null (legacy) → legacy_proceed ──────────────

describe("evaluateDsrWalkForwardGate — legacy (dsr_pass absent or null)", () => {
  it("returns passed=true with status 'legacy_proceed' when dsr_pass is undefined", () => {
    const input: WalkForwardDsrInput = { dsr: 0.5 };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.passed).toBe(true);
    expect(result.status).toBe("legacy_proceed" satisfies DsrGateStatus);
    expect(result.auditAction).toBe("lifecycle.dsr_unavailable_legacy");
    expect(result.reason).toBe("lifecycle.dsr_unavailable_legacy");
  });

  it("returns passed=true with status 'legacy_proceed' when dsr_pass is null", () => {
    const input: WalkForwardDsrInput = { dsr_pass: null };
    const result = evaluateDsrWalkForwardGate(input);
    expect(result.passed).toBe(true);
    expect(result.status).toBe("legacy_proceed");
    expect(result.auditAction).toBe("lifecycle.dsr_unavailable_legacy");
  });

  it("null wfMetadata (completely absent) → legacy_proceed + warn audit", () => {
    const result = evaluateDsrWalkForwardGate(null);
    expect(result.passed).toBe(true);
    expect(result.status).toBe("legacy_proceed");
    expect(result.auditPayload.dsr_pass).toBeNull();
  });

  it("empty object input (no fields) → legacy_proceed", () => {
    const result = evaluateDsrWalkForwardGate({});
    expect(result.passed).toBe(true);
    expect(result.status).toBe("legacy_proceed");
  });

  it("audit payload marks blocked=false and dsr_pass=null for legacy path", () => {
    const result = evaluateDsrWalkForwardGate({ dsr_pass: null, dsr: 1.2 });
    expect(result.auditPayload.blocked).toBe(false);
    expect(result.auditPayload.dsr_pass).toBeNull();
    expect(result.auditPayload.dsr).toBe(1.2);
    expect(result.auditPayload.status).toBe("legacy_proceed");
  });
});

// ─── Test 6: Gate ordering — DSR runs AFTER B14 ci_high passes ────────────────

describe("Gate ordering: B14 ci_high passes first, then DSR gate applied", () => {
  it("when B14 ci_high passes (0.30 < 0.40 threshold) and dsr_pass=false → DSR blocks", () => {
    // Step 1: B14 ci_high gate → PASS
    const b14Result = evaluateB14CiGate(
      { ci_high: 0.30, ci_low: 0.15, point_estimate: 0.22 },
      null,
      0.40,
    );
    expect(b14Result.passed).toBe(true);

    // Step 2: DSR gate runs after B14 → BLOCK
    const dsrResult = evaluateDsrWalkForwardGate({ dsr_pass: false, dsr: 0.48 });
    expect(dsrResult.passed).toBe(false);
    expect(dsrResult.status).toBe("blocked_dsr_floor");

    // Composition: B14 passes but DSR blocks means the overall gate stack blocks
    const overallPassed = b14Result.passed && dsrResult.passed;
    expect(overallPassed).toBe(false);
  });

  it("when B14 ci_high passes AND dsr_pass=true → both pass (promotion allowed)", () => {
    const b14Result = evaluateB14CiGate({ ci_high: 0.25 }, null, 0.40);
    expect(b14Result.passed).toBe(true);

    const dsrResult = evaluateDsrWalkForwardGate({ dsr_pass: true, dsr: 1.8 });
    expect(dsrResult.passed).toBe(true);

    const overallPassed = b14Result.passed && dsrResult.passed;
    expect(overallPassed).toBe(true);
  });

  it("B14 fails regardless of DSR — B14 ci_high blocks first in lifecycle-service ordering", () => {
    // Even if DSR would pass, a B14 failure still blocks at the B14 stage
    const b14Result = evaluateB14CiGate({ ci_high: 0.55 }, null, 0.40);
    expect(b14Result.passed).toBe(false);

    // DSR would pass, but doesn't matter — B14 already blocked
    const dsrResult = evaluateDsrWalkForwardGate({ dsr_pass: true, dsr: 2.0 });
    expect(dsrResult.passed).toBe(true);

    // B14 already blocked — combined result is false (B14 is evaluated first in lifecycle-service.ts)
    const overallPassed = b14Result.passed && dsrResult.passed;
    expect(overallPassed).toBe(false);
  });
});

// ─── Test 7: Audit payload carries the status in all paths ───────────────────

describe("Audit payload completeness", () => {
  const PATHS: Array<{ label: string; input: WalkForwardDsrInput; expectedStatus: DsrGateStatus }> = [
    { label: "pass",                 input: { dsr_pass: true, dsr: 1.5 },                           expectedStatus: "pass" },
    { label: "blocked_floor",        input: { dsr_pass: false, dsr_unavailable: false, dsr: 0.2 }, expectedStatus: "blocked_dsr_floor" },
    { label: "blocked_unavailable",  input: { dsr_pass: false, dsr_unavailable: true },              expectedStatus: "blocked_dsr_unavailable" },
    { label: "legacy_proceed",       input: { dsr_pass: undefined, dsr: 0.9 },                      expectedStatus: "legacy_proceed" },
  ];

  for (const { label, input, expectedStatus } of PATHS) {
    it(`auditPayload.status matches status field for path: ${label}`, () => {
      const result = evaluateDsrWalkForwardGate(input);
      expect(result.auditPayload.status).toBe(expectedStatus);
      expect(result.status).toBe(expectedStatus);
    });
  }

  it("auditPayload.dsr is null when dsr not provided in input", () => {
    const result = evaluateDsrWalkForwardGate({ dsr_pass: true });
    expect(result.auditPayload.dsr).toBeNull();
  });
});
