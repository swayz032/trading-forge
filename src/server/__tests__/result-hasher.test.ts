/**
 * Result Hasher Tests — A2 Backtest Provenance Tracking
 *
 * Verifies:
 * 1. canonicalizeResult() key sort + float normalization + NaN/Inf sentinel handling
 * 2. computeResultHash() produces identical hex for identical inputs (determinism)
 * 3. computeResultHash() produces different hex for different inputs
 * 4. computeDataHash() is stable and deterministic
 * 5. computeStrategyHash() is stable and deterministic
 * 6. Float rounding matches Python's round(v, 6) behavior
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeResult,
  computeResultHash,
  computeDataHash,
  computeStrategyHash,
} from "../lib/result-hasher.js";

// ─── canonicalizeResult ────────────────────────────────────────────────────────

describe("canonicalizeResult", () => {
  it("sorts top-level keys alphabetically", () => {
    const result = canonicalizeResult({ z: 1, a: 2, m: 3 });
    // JSON with sorted keys — "a" before "m" before "z"
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("sorts nested dict keys recursively", () => {
    const result = canonicalizeResult({ outer: { z: 1, a: 2 } });
    expect(result).toBe('{"outer":{"a":2,"z":1}}');
  });

  it("rounds floats to 6 decimal places", () => {
    const result = canonicalizeResult({ v: 1.1234567890 });
    // 1.1234567890 rounded to 6 = 1.123457
    expect(result).toBe('{"v":1.123457}');
  });

  it("handles floats that are already <= 6 decimal places", () => {
    const result = canonicalizeResult({ v: 1.5 });
    expect(result).toBe('{"v":1.5}');
  });

  it("replaces NaN with sentinel string 'NaN'", () => {
    const result = canonicalizeResult({ v: NaN });
    expect(result).toBe('{"v":"NaN"}');
  });

  it("replaces Infinity with sentinel string 'Inf'", () => {
    const result = canonicalizeResult({ v: Infinity });
    expect(result).toBe('{"v":"Inf"}');
  });

  it("replaces -Infinity with sentinel string '-Inf'", () => {
    const result = canonicalizeResult({ v: -Infinity });
    expect(result).toBe('{"v":"-Inf"}');
  });

  it("normalizes array elements preserving order", () => {
    const result = canonicalizeResult({ arr: [3, 1, 2] });
    // Array order preserved — only dict keys are sorted
    expect(result).toBe('{"arr":[3,1,2]}');
  });

  it("normalizes nested arrays of dicts", () => {
    const result = canonicalizeResult({
      trades: [{ z: 1, a: 2 }, { b: 3, a: 4 }],
    });
    expect(result).toBe('{"trades":[{"a":2,"z":1},{"a":4,"b":3}]}');
  });

  it("handles null values", () => {
    const result = canonicalizeResult({ v: null });
    expect(result).toBe('{"v":null}');
  });

  it("handles undefined values (normalizes to null)", () => {
    const result = canonicalizeResult({ v: undefined });
    // Our normalizer converts undefined → null before JSON.stringify.
    // This makes the behavior explicit and consistent: both null and undefined
    // values in the result dict serialize to null, ensuring stable hashes
    // regardless of whether a field is absent or explicitly null.
    expect(result).toBe('{"v":null}');
  });

  it("handles boolean values", () => {
    const result = canonicalizeResult({ t: true, f: false });
    expect(result).toBe('{"f":false,"t":true}');
  });

  it("handles integer values without rounding", () => {
    const result = canonicalizeResult({ v: 42 });
    expect(result).toBe('{"v":42}');
  });

  it("produces no extra whitespace", () => {
    const result = canonicalizeResult({ a: 1, b: 2 });
    // Must match Python's json.dumps(separators=(',', ':')) — no spaces
    expect(result).not.toContain(" ");
    expect(result).not.toContain("\n");
  });
});

// ─── computeResultHash ────────────────────────────────────────────────────────

describe("computeResultHash", () => {
  it("returns 64-char hex string", () => {
    const hash = computeResultHash({ v: 1.0 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same hash", () => {
    const input = {
      sharpe_ratio: 2.5,
      total_return: 0.3,
      profit_factor: 1.8,
      trades: [{ pnl: 100.5 }, { pnl: -50.25 }],
    };
    const hash1 = computeResultHash(input);
    const hash2 = computeResultHash(input);
    expect(hash1).toBe(hash2);
  });

  it("is key-order independent — different key order same hash", () => {
    const input1 = { b: 2, a: 1 };
    const input2 = { a: 1, b: 2 };
    expect(computeResultHash(input1)).toBe(computeResultHash(input2));
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = computeResultHash({ sharpe: 2.5 });
    const hash2 = computeResultHash({ sharpe: 2.6 });
    expect(hash1).not.toBe(hash2);
  });

  it("two identical backtest results produce identical hashes (replay test)", () => {
    // Simulates A2 verification: run same backtest 3x, assert all 3 result_hash match
    const result = {
      total_return: 0.3456789,
      sharpe_ratio: 1.876543,
      max_drawdown: -0.123456,
      win_rate: 0.654321,
      profit_factor: 1.876543,
      total_trades: 150,
      tier: "TIER_2",
      forge_score: 73.5,
    };

    const hash1 = computeResultHash(result);
    const hash2 = computeResultHash({ ...result }); // copy, different object reference
    const hash3 = computeResultHash(JSON.parse(JSON.stringify(result))); // deep clone via JSON

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });
});

// ─── computeDataHash ──────────────────────────────────────────────────────────

describe("computeDataHash", () => {
  it("returns 64-char hex string", () => {
    const hash = computeDataHash("MES", "5m", "2024-01-01", "2024-12-31");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs produce same hash", () => {
    const h1 = computeDataHash("MES", "5m", "2024-01-01", "2024-12-31");
    const h2 = computeDataHash("MES", "5m", "2024-01-01", "2024-12-31");
    expect(h1).toBe(h2);
  });

  it("normalizes symbol to uppercase", () => {
    const h1 = computeDataHash("mes", "5m", "2024-01-01", "2024-12-31");
    const h2 = computeDataHash("MES", "5m", "2024-01-01", "2024-12-31");
    expect(h1).toBe(h2);
  });

  it("normalizes timeframe to lowercase", () => {
    const h1 = computeDataHash("MES", "5M", "2024-01-01", "2024-12-31");
    const h2 = computeDataHash("MES", "5m", "2024-01-01", "2024-12-31");
    expect(h1).toBe(h2);
  });

  it("produces different hash for different symbol", () => {
    const h1 = computeDataHash("MES", "5m", "2024-01-01", "2024-12-31");
    const h2 = computeDataHash("MNQ", "5m", "2024-01-01", "2024-12-31");
    expect(h1).not.toBe(h2);
  });

  it("produces different hash for different date range", () => {
    const h1 = computeDataHash("MES", "5m", "2024-01-01", "2024-12-31");
    const h2 = computeDataHash("MES", "5m", "2023-01-01", "2023-12-31");
    expect(h1).not.toBe(h2);
  });
});

// ─── computeStrategyHash ──────────────────────────────────────────────────────

describe("computeStrategyHash", () => {
  it("returns 64-char hex string", () => {
    const config = { name: "test", symbol: "MES", timeframe: "5m" };
    const hash = computeStrategyHash(config);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same config produces same hash", () => {
    const config = { name: "test", symbol: "MES", timeframe: "5m", stop_loss_atr: 1.5 };
    const h1 = computeStrategyHash(config);
    const h2 = computeStrategyHash({ ...config });
    expect(h1).toBe(h2);
  });

  it("is key-order independent (canonical sort)", () => {
    const h1 = computeStrategyHash({ a: 1, b: 2 });
    const h2 = computeStrategyHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it("produces different hash for different configs", () => {
    const h1 = computeStrategyHash({ stop_loss_atr: 1.5 });
    const h2 = computeStrategyHash({ stop_loss_atr: 2.0 });
    expect(h1).not.toBe(h2);
  });
});
