/**
 * Unit tests for quantum-agreement.ts pure helper (Tier 1.1 — QAE shadow mode).
 *
 * Governance boundary: this file tests a PURE function only.
 * No DB calls, no imports from lifecycle-service, no execution path imports.
 * If a test here imports anything that touches the DB or execution paths,
 * that is a challenger isolation violation — fix immediately.
 *
 * Authority: computeAgreement is advisory only. It never makes lifecycle
 * decisions. These tests verify math correctness and fallback logic only.
 */
import { describe, it, expect } from "vitest";
import { computeAgreement } from "../quantum-agreement.js";

// ─── Property: score always in [0, 1] ────────────────────────────────────────

describe("computeAgreement — score bounds", () => {
  it("score is in [0, 1] when both values are identical", () => {
    const r = computeAgreement(0.3, 0.3);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it("score is in [0, 1] when delta is large (>10pp)", () => {
    const r = computeAgreement(0.0, 0.5);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it("score is in [0, 1] when classical is 0 and quantum is 1", () => {
    const r = computeAgreement(0.0, 1.0);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it("score is exactly 0 when delta >= 10pp", () => {
    const r = computeAgreement(0.0, 0.10);
    expect(r.score).toBe(0);
  });

  it("score is exactly 0 when delta > 10pp", () => {
    const r = computeAgreement(0.0, 0.25);
    expect(r.score).toBe(0);
  });
});

// ─── Edge: identical values ───────────────────────────────────────────────────

describe("computeAgreement — identical values", () => {
  it("score is 1.0 when values are identical", () => {
    const r = computeAgreement(0.3, 0.3);
    expect(r.score).toBe(1.0);
  });

  it("delta is 0 when values are identical", () => {
    const r = computeAgreement(0.3, 0.3);
    expect(r.delta).toBe(0);
  });

  it("withinTolerance is true when values are identical", () => {
    const r = computeAgreement(0.3, 0.3);
    expect(r.withinTolerance).toBe(true);
  });

  it("fallback is false when values are identical and quantum is valid", () => {
    const r = computeAgreement(0.3, 0.3);
    expect(r.fallback).toBe(false);
  });
});

// ─── Edge: null/undefined inputs ─────────────────────────────────────────────

describe("computeAgreement — null inputs", () => {
  it("fallback is true when classical is null", () => {
    const r = computeAgreement(null, 0.3);
    expect(r.fallback).toBe(true);
  });

  it("fallback is true when quantum is null", () => {
    const r = computeAgreement(0.3, null);
    expect(r.fallback).toBe(true);
  });

  it("score is 0 when quantum is null", () => {
    const r = computeAgreement(0.3, null);
    expect(r.score).toBe(0);
  });

  it("score is 0 when classical is null", () => {
    const r = computeAgreement(null, 0.3);
    expect(r.score).toBe(0);
  });

  it("fallback is true when both are null", () => {
    const r = computeAgreement(null, null);
    expect(r.fallback).toBe(true);
  });
});

// ─── Edge: tolerance boundary at exactly 5pp ─────────────────────────────────

describe("computeAgreement — tolerance boundary", () => {
  it("withinTolerance is true when delta is exactly 5pp", () => {
    // classical=0.30, quantum=0.25 → delta=0.05 (boundary)
    const r = computeAgreement(0.30, 0.25);
    expect(r.withinTolerance).toBe(true);
  });

  it("withinTolerance is true when delta is 4pp (inside tolerance)", () => {
    const r = computeAgreement(0.30, 0.26);
    expect(r.withinTolerance).toBe(true);
  });

  it("withinTolerance is false when delta is 6pp (outside tolerance)", () => {
    // classical=0.30, quantum=0.24 → delta=0.06
    const r = computeAgreement(0.30, 0.24);
    expect(r.withinTolerance).toBe(false);
  });

  it("score at 5pp delta is 0.5 (midpoint of linear scale)", () => {
    // formula: 1 - min(0.05 / 0.10, 1.0) = 1 - 0.5 = 0.5
    const r = computeAgreement(0.30, 0.25);
    expect(r.score).toBeCloseTo(0.5, 10);
  });
});

// ─── Edge: delta is signed (quantum - classical) ──────────────────────────────

describe("computeAgreement — signed delta", () => {
  it("delta is positive when quantum > classical", () => {
    const r = computeAgreement(0.20, 0.30);
    expect(r.delta).toBeCloseTo(0.10, 10);
  });

  it("delta is negative when quantum < classical", () => {
    const r = computeAgreement(0.30, 0.20);
    expect(r.delta).toBeCloseTo(-0.10, 10);
  });

  it("score is symmetric: same absolute delta yields same score regardless of sign", () => {
    const pos = computeAgreement(0.20, 0.28); // delta = +0.08
    const neg = computeAgreement(0.28, 0.20); // delta = -0.08
    expect(pos.score).toBeCloseTo(neg.score, 10);
  });
});

// ─── Edge: CI width triggers fallback ────────────────────────────────────────

describe("computeAgreement — confidence interval fallback", () => {
  it("fallback is true when ci_width > 0.20 even if values are close", () => {
    // ci = [0.10, 0.31] → width = 0.21 > 0.20 → fallback
    const r = computeAgreement(0.20, 0.21, [0.10, 0.31]);
    expect(r.fallback).toBe(true);
  });

  it("fallback is false when ci_width is exactly 0.20 (boundary — not over)", () => {
    // ci = [0.10, 0.30] → width = 0.20, NOT > 0.20 → no fallback from CI alone
    const r = computeAgreement(0.20, 0.21, [0.10, 0.30]);
    expect(r.fallback).toBe(false);
  });

  it("fallback is false when ci is undefined", () => {
    const r = computeAgreement(0.20, 0.21);
    expect(r.fallback).toBe(false);
  });

  it("score computation still runs even when ci triggers fallback", () => {
    // fallback=true does NOT mean score=0; it's a separate flag
    const r = computeAgreement(0.20, 0.20, [0.10, 0.31]);
    expect(r.score).toBe(1.0);    // perfect agreement
    expect(r.fallback).toBe(true); // but CI is too wide to trust
  });
});

// ─── disagreementPct derivation ───────────────────────────────────────────────

describe("computeAgreement — disagreementPct", () => {
  it("disagreementPct is 0 when values are identical", () => {
    const r = computeAgreement(0.30, 0.30);
    expect(r.disagreementPct).toBe(0);
  });

  it("disagreementPct equals |delta| * 100 in percentage points", () => {
    // delta = 0.06 → 6pp
    const r = computeAgreement(0.30, 0.24);
    expect(r.disagreementPct).toBeCloseTo(6.0, 8);
  });

  it("disagreementPct is 0 when fallback from null quantum", () => {
    const r = computeAgreement(0.30, null);
    expect(r.disagreementPct).toBe(0);
  });
});

// ─── Isolation guard: no DB or lifecycle-service imports ─────────────────────
// This test validates that the module under test is a pure function module.
// It cannot actually import DB at runtime since vitest runs in isolation,
// but we can verify the module's exported surface is exactly what we expect.

describe("computeAgreement — isolation / API surface", () => {
  it("module exports exactly one named export: computeAgreement", async () => {
    const mod = await import("../quantum-agreement.js");
    const exportedKeys = Object.keys(mod);
    expect(exportedKeys).toEqual(["computeAgreement"]);
  });

  it("computeAgreement is a function", () => {
    expect(typeof computeAgreement).toBe("function");
  });

  it("return value always has all 5 required fields", () => {
    const r = computeAgreement(0.3, 0.3);
    expect(r).toHaveProperty("score");
    expect(r).toHaveProperty("delta");
    expect(r).toHaveProperty("withinTolerance");
    expect(r).toHaveProperty("fallback");
    expect(r).toHaveProperty("disagreementPct");
  });
});
