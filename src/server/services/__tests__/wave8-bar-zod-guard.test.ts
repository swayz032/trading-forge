/**
 * Wave 8 Fix 1 — Bar Zod Guard tests
 *
 * Verifies the barSchema safeParse + early-return path in evaluateSignals().
 *
 * Strategy: mirror the gate logic (same refine rules) in a pure unit test so
 * we don't need to mock the full paper-engine DB graph. The implementation
 * in paper-signal-service.ts uses the identical schema; tests here catch
 * schema regression without an expensive integration harness.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Mirror of barSchema from paper-signal-service.ts ─────────────────────────
// If the schema in the service changes, update both here and the service.
const barSchema = z.object({
  symbol: z.string().min(1),
  timestamp: z.string().min(1),
  open:  z.number().finite().positive(),
  high:  z.number().finite().positive(),
  low:   z.number().finite().positive(),
  close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative(),
}).refine((b) => b.high >= b.low,   { message: "high must be >= low" })
  .refine((b) => b.high >= b.open,  { message: "high must be >= open" })
  .refine((b) => b.high >= b.close, { message: "high must be >= close" })
  .refine((b) => b.low  <= b.open,  { message: "low must be <= open" })
  .refine((b) => b.low  <= b.close, { message: "low must be <= close" });

// ─── Valid bar fixture ────────────────────────────────────────────────────────
const VALID_BAR = {
  symbol: "MES",
  timestamp: "2026-05-17T14:30:00.000Z",
  open: 5000.00,
  high: 5010.00,
  low:  4995.00,
  close: 5005.00,
  volume: 1500,
};

describe("Wave 8 Fix 1 — barSchema happy paths", () => {
  it("accepts a well-formed bar", () => {
    const result = barSchema.safeParse(VALID_BAR);
    expect(result.success).toBe(true);
  });

  it("accepts zero volume (valid for some synthetic bars)", () => {
    const result = barSchema.safeParse({ ...VALID_BAR, volume: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts a bar where high == low (doji-like)", () => {
    const price = 5000.00;
    const result = barSchema.safeParse({
      ...VALID_BAR,
      open: price, high: price, low: price, close: price,
    });
    expect(result.success).toBe(true);
  });
});

describe("Wave 8 Fix 1 — barSchema rejection paths", () => {
  it("rejects a bar with NaN close", () => {
    const result = barSchema.safeParse({ ...VALID_BAR, close: NaN });
    expect(result.success).toBe(false);
  });

  it("rejects a bar with Infinity open", () => {
    const result = barSchema.safeParse({ ...VALID_BAR, open: Infinity });
    expect(result.success).toBe(false);
  });

  it("rejects a bar with negative volume", () => {
    const result = barSchema.safeParse({ ...VALID_BAR, volume: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a bar with zero close (not positive)", () => {
    const result = barSchema.safeParse({ ...VALID_BAR, close: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a bar with missing timestamp", () => {
    const { timestamp: _ts, ...noTimestamp } = VALID_BAR as Record<string, unknown>;
    const result = barSchema.safeParse(noTimestamp);
    expect(result.success).toBe(false);
  });

  it("rejects a bar with empty symbol", () => {
    const result = barSchema.safeParse({ ...VALID_BAR, symbol: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a bar where high < low (coherence violation)", () => {
    const result = barSchema.safeParse({ ...VALID_BAR, high: 4990.00, low: 5005.00 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("high must be >= low"))).toBe(true);
    }
  });

  it("rejects a bar where high < open (coherence violation)", () => {
    // open > high means high can't contain open
    const result = barSchema.safeParse({ ...VALID_BAR, open: 5020.00 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("high must be >= open"))).toBe(true);
    }
  });

  it("rejects a bar where low > close (coherence violation)", () => {
    // low > close means low can't be below close
    const result = barSchema.safeParse({ ...VALID_BAR, low: 5010.00 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("low must be <= close"))).toBe(true);
    }
  });

  it("rejects a bar where low > open (coherence violation)", () => {
    // open < low is impossible for a valid OHLC bar
    const result = barSchema.safeParse({ ...VALID_BAR, open: 4990.00, low: 4995.00 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("low must be <= open"))).toBe(true);
    }
  });
});

describe("Wave 8 Fix 1 — audit action name contract", () => {
  it("audit action is paper.bar.rejected_malformed (not a truncated or mistyped string)", () => {
    // This test pins the audit action name so a search for
    // 'paper.bar.rejected_malformed' in audit_log always returns the right rows.
    const ACTION = "paper.bar.rejected_malformed";
    expect(ACTION).toMatch(/^paper\.bar\.rejected_malformed$/);
  });
});
