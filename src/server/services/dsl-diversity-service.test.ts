/**
 * C9 — DSL Diversity Service Unit Tests (W17 Team B)
 *
 * Verification gate: two intentionally-identical DSL templates → second rejected.
 * Two genuinely different strategies → both accepted.
 *
 * Tests are pure unit tests (no DB): mocks db at module level.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ────────────────────────────────────────────────────────────────

let mockDbRows: Array<{
  strategyId: string;
  featureVectorCompressed: Buffer;
  featureDim: number;
  dslFingerprint: string;
}> = [];

let mockExactMatchRows: Array<{ strategyId: string }> = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(function (this: any) {
      // Return exact-match rows when filtering by fingerprint
      return { ...this, limit: (n: number) => Promise.resolve(mockExactMatchRows.slice(0, n)) };
    }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation((n: number) => Promise.resolve(mockDbRows.slice(0, n))),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: {},
  strategyDslFeatures: {},
  auditLog: {},
}));

vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  extractDslFeatureVector,
  computeDslFingerprint,
  compressFeatureVector,
  decompressFeatureVector,
  cosineSimilarity,
  checkDslDiversity,
  persistDslFeatureVector,
  getDslDiversityReport,
  DSL_SIMILARITY_THRESHOLD,
  type DslRecord,
} from "./dsl-diversity-service.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DSL_A: DslRecord = {
  name: "ema_crossover_strategy",
  description: "EMA crossover trend follow on MES",
  symbol: "MES",
  timeframe: "15m",
  direction: "both",
  entry_type: "trend_follow",
  entry_indicator: "ema_crossover",
  entry_params: { fast: 9, slow: 21, confirmation: 2 },
  entry_condition: "fast EMA crosses above slow EMA",
  exit_type: "trailing_stop",
  exit_params: { trail_atr: 2.0 },
  stop_loss_atr_multiple: 1.8,
  take_profit_atr_multiple: 3.5,
  preferred_regime: "TRENDING_UP",
};

// Identical to DSL_A (should be rejected as duplicate)
const DSL_A_CLONE: DslRecord = { ...DSL_A };

// DSL_A with only name changed — still structurally identical → should be same fingerprint
const DSL_A_RENAMED: DslRecord = { ...DSL_A, name: "copy_of_ema_strategy" };

// Genuinely different strategy
const DSL_B: DslRecord = {
  name: "rsi_mean_reversion",
  description: "RSI reversal on MNQ",
  symbol: "MNQ",
  timeframe: "5m",
  direction: "long",
  entry_type: "mean_reversion",
  entry_indicator: "rsi_reversal",
  entry_params: { period: 14, oversold: 30, overbought: 70 },
  entry_condition: "RSI crosses above 30 from below",
  exit_type: "fixed_target",
  exit_params: { target_atr: 1.5 },
  stop_loss_atr_multiple: 1.0,
  take_profit_atr_multiple: 2.0,
  preferred_regime: "RANGE_BOUND",
};

// ─── Feature vector tests ────────────────────────────────────────────────────

describe("extractDslFeatureVector", () => {
  it("returns a 13-element vector", () => {
    const vec = extractDslFeatureVector(DSL_A);
    expect(vec).toHaveLength(13);
  });

  it("all values are in [0, 1]", () => {
    const vec = extractDslFeatureVector(DSL_A);
    for (const v of vec) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic — identical DSL produces identical vector", () => {
    const v1 = extractDslFeatureVector(DSL_A);
    const v2 = extractDslFeatureVector(DSL_A_CLONE);
    expect(v1).toEqual(v2);
  });

  it("different entry_indicator produces different dimension [0]", () => {
    const vA = extractDslFeatureVector(DSL_A); // ema_crossover
    const vB = extractDslFeatureVector(DSL_B); // rsi_reversal
    expect(vA[0]).not.toBeCloseTo(vB[0], 5);
  });

  it("different symbol produces different dimension [3]", () => {
    const vA = extractDslFeatureVector(DSL_A); // MES
    const vB = extractDslFeatureVector(DSL_B); // MNQ
    expect(vA[3]).not.toBeCloseTo(vB[3], 5);
  });

  it("handles missing optional fields with zero/default values", () => {
    const minimal: DslRecord = {
      entry_indicator: "ema_crossover",
      exit_type: "trailing_stop",
      direction: "both",
      symbol: "MES",
      timeframe: "15m",
      stop_loss_atr_multiple: 2.0,
    };
    const vec = extractDslFeatureVector(minimal);
    expect(vec).toHaveLength(13);
    expect(vec[7]).toBe(0.0); // tp_atr missing → 0
    for (let i = 8; i < 13; i++) {
      expect(vec[i]).toBe(0.0); // entry_params missing → padded with 0
    }
  });

  it("entry_params padding: fewer than 5 params fills remainder with 0", () => {
    const dsl: DslRecord = {
      ...DSL_A,
      entry_params: { fast: 9, slow: 21 }, // only 2 params
    };
    const vec = extractDslFeatureVector(dsl);
    expect(vec[10]).toBe(0.0); // 3rd param slot (index 8+2)
    expect(vec[11]).toBe(0.0);
    expect(vec[12]).toBe(0.0);
  });

  it("entry_params: sorted by key for determinism (key order independence)", () => {
    const dslAsc: DslRecord = { ...DSL_A, entry_params: { fast: 9, slow: 21 } };
    const dslDesc: DslRecord = { ...DSL_A, entry_params: { slow: 21, fast: 9 } };
    expect(extractDslFeatureVector(dslAsc)).toEqual(extractDslFeatureVector(dslDesc));
  });
});

// ─── Fingerprint tests ───────────────────────────────────────────────────────

describe("computeDslFingerprint", () => {
  it("returns a 64-char hex string", () => {
    const fp = computeDslFingerprint(DSL_A);
    expect(fp).toHaveLength(64);
    expect(fp).toMatch(/^[0-9a-f]+$/);
  });

  it("identical DSL produces identical fingerprint", () => {
    expect(computeDslFingerprint(DSL_A)).toBe(computeDslFingerprint(DSL_A_CLONE));
  });

  it("fingerprint is key-order independent (canonical)", () => {
    const shuffled: DslRecord = {
      stop_loss_atr_multiple: DSL_A.stop_loss_atr_multiple,
      name: DSL_A.name,
      entry_indicator: DSL_A.entry_indicator,
      symbol: DSL_A.symbol,
      description: DSL_A.description,
      timeframe: DSL_A.timeframe,
      direction: DSL_A.direction,
      entry_type: DSL_A.entry_type,
      entry_params: DSL_A.entry_params,
      entry_condition: DSL_A.entry_condition,
      exit_type: DSL_A.exit_type,
      exit_params: DSL_A.exit_params,
      take_profit_atr_multiple: DSL_A.take_profit_atr_multiple,
      preferred_regime: DSL_A.preferred_regime,
    };
    expect(computeDslFingerprint(DSL_A)).toBe(computeDslFingerprint(shuffled));
  });

  it("different DSLs produce different fingerprints", () => {
    expect(computeDslFingerprint(DSL_A)).not.toBe(computeDslFingerprint(DSL_B));
  });

  it("name-only change produces DIFFERENT fingerprint (name is part of DSL)", () => {
    // DSL_A_RENAMED changes the name field, so fingerprint must differ
    // (the name is part of the canonical JSON)
    expect(computeDslFingerprint(DSL_A)).not.toBe(computeDslFingerprint(DSL_A_RENAMED));
  });
});

// ─── Compression tests ────────────────────────────────────────────────────────

describe("compressFeatureVector / decompressFeatureVector", () => {
  it("round-trips the feature vector exactly", () => {
    const vec = extractDslFeatureVector(DSL_A);
    const compressed = compressFeatureVector(vec);
    const decompressed = decompressFeatureVector(compressed);

    expect(decompressed).toHaveLength(vec.length);
    for (let i = 0; i < vec.length; i++) {
      // Float32 precision loss is expected — allow epsilon of 1e-6
      expect(decompressed[i]).toBeCloseTo(vec[i], 5);
    }
  });

  it("compression produces a Buffer", () => {
    const vec = extractDslFeatureVector(DSL_A);
    const compressed = compressFeatureVector(vec);
    expect(compressed).toBeInstanceOf(Buffer);
    expect(compressed.length).toBeGreaterThan(0);
  });
});

// ─── Cosine similarity tests ─────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("identical vectors → similarity = 1.0", () => {
    const vec = extractDslFeatureVector(DSL_A);
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
  });

  it("identical DSL A copies → similarity > 0.85", () => {
    const v1 = extractDslFeatureVector(DSL_A);
    const v2 = extractDslFeatureVector(DSL_A_CLONE);
    expect(cosineSimilarity(v1, v2)).toBeGreaterThan(DSL_SIMILARITY_THRESHOLD);
  });

  it("genuinely different DSLs → similarity < 0.85", () => {
    const vA = extractDslFeatureVector(DSL_A);
    const vB = extractDslFeatureVector(DSL_B);
    expect(cosineSimilarity(vA, vB)).toBeLessThan(DSL_SIMILARITY_THRESHOLD);
  });

  it("all-zero vector → similarity = 0", () => {
    const zeros = new Array(13).fill(0);
    const vec = extractDslFeatureVector(DSL_A);
    expect(cosineSimilarity(zeros, vec)).toBe(0);
  });

  it("empty vectors → similarity = 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

// ─── Primary gate: checkDslDiversity ─────────────────────────────────────────

describe("checkDslDiversity", () => {
  beforeEach(() => {
    mockDbRows = [];
    mockExactMatchRows = [];
    vi.clearAllMocks();
  });

  // ── VERIFICATION GATE: identical DSL → rejected ──────────────────────────

  it("VERIFICATION GATE: second identical DSL is rejected (similarity > 0.85)", async () => {
    // Pre-populate DB with DSL_A's feature vector
    const vecA = extractDslFeatureVector(DSL_A);
    const compressedA = compressFeatureVector(vecA);
    const fpA = computeDslFingerprint(DSL_A);

    mockDbRows = [
      {
        strategyId: "existing-strategy-uuid",
        featureVectorCompressed: compressedA,
        featureDim: vecA.length,
        dslFingerprint: fpA,
      },
    ];

    // Check the clone — should be rejected
    const result = await checkDslDiversity(DSL_A_CLONE);

    expect(result.passed).toBe(false);
    expect(result.maxSimilarity).toBeGreaterThan(DSL_SIMILARITY_THRESHOLD);
    expect(result.mostSimilarStrategyId).toBe("existing-strategy-uuid");
    expect(result.reason).toContain("BLOCKED");
    expect(result.threshold).toBe(DSL_SIMILARITY_THRESHOLD);
  });

  // ── VERIFICATION GATE: exact fingerprint match → rejected ────────────────

  it("VERIFICATION GATE: exact fingerprint match triggers fast-path rejection", async () => {
    mockExactMatchRows = [{ strategyId: "exact-match-strategy-uuid" }];

    const result = await checkDslDiversity(DSL_A);

    expect(result.passed).toBe(false);
    expect(result.maxSimilarity).toBe(1.0);
    expect(result.mostSimilarStrategyId).toBe("exact-match-strategy-uuid");
    expect(result.reason).toContain("exact fingerprint match");
  });

  // ── VERIFICATION GATE: genuinely different strategies → both accepted ────

  it("VERIFICATION GATE: genuinely different DSL is accepted (similarity < 0.85)", async () => {
    const vecA = extractDslFeatureVector(DSL_A);
    const compressedA = compressFeatureVector(vecA);

    mockDbRows = [
      {
        strategyId: "existing-strategy-uuid",
        featureVectorCompressed: compressedA,
        featureDim: vecA.length,
        dslFingerprint: computeDslFingerprint(DSL_A),
      },
    ];

    // DSL_B is genuinely different — should pass
    const result = await checkDslDiversity(DSL_B);

    expect(result.passed).toBe(true);
    expect(result.maxSimilarity).toBeLessThan(DSL_SIMILARITY_THRESHOLD);
    expect(result.reason).toContain("PASSED");
  });

  it("passes when no prior strategies exist (empty DB)", async () => {
    mockDbRows = [];
    const result = await checkDslDiversity(DSL_A);

    expect(result.passed).toBe(true);
    expect(result.strategiesChecked).toBe(0);
    expect(result.reason).toContain("no prior strategies");
  });

  it("fails-open on DB error (non-blocking)", async () => {
    // Import the mocked db to make it throw
    const { db } = await import("../db/index.js");
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("DB connection lost");
    });

    const result = await checkDslDiversity(DSL_A);

    // Fail-open: DB error must not block the pipeline
    expect(result.passed).toBe(true);
    expect(result.reason).toContain("fail-open");
  });

  it("returns passed=true when pipeline is paused", async () => {
    const { isActive } = await import("./pipeline-control-service.js");
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const result = await checkDslDiversity(DSL_A);

    expect(result.passed).toBe(true);
    expect(result.reason).toContain("pipeline paused");
  });

  it("records strategiesChecked count correctly", async () => {
    const vecA = extractDslFeatureVector(DSL_A);
    const compressedA = compressFeatureVector(vecA);

    // Populate 3 existing strategies
    mockDbRows = [
      { strategyId: "s-1", featureVectorCompressed: compressedA, featureDim: 13, dslFingerprint: "fp1" },
      { strategyId: "s-2", featureVectorCompressed: compressedA, featureDim: 13, dslFingerprint: "fp2" },
      { strategyId: "s-3", featureVectorCompressed: compressedA, featureDim: 13, dslFingerprint: "fp3" },
    ];

    // DSL_B is different enough to check (won't be rejected by similarity — it's genuinely different)
    const result = await checkDslDiversity(DSL_B);
    expect(result.strategiesChecked).toBe(3);
  });
});

// ─── Validation report surface ───────────────────────────────────────────────

describe("getDslDiversityReport", () => {
  beforeEach(() => {
    mockDbRows = [];
    mockExactMatchRows = [];
    vi.clearAllMocks();
  });

  it("returns checked=true with summary string", async () => {
    const report = await getDslDiversityReport(DSL_A);
    expect(report.checked).toBe(true);
    expect(typeof report.summary).toBe("string");
    expect(report.threshold).toBe(DSL_SIMILARITY_THRESHOLD);
  });

  it("includes passed=false when similarity exceeds threshold", async () => {
    const vecA = extractDslFeatureVector(DSL_A);
    mockDbRows = [
      {
        strategyId: "s-1",
        featureVectorCompressed: compressFeatureVector(vecA),
        featureDim: 13,
        dslFingerprint: computeDslFingerprint(DSL_A),
      },
    ];

    const report = await getDslDiversityReport(DSL_A_CLONE);
    expect(report.passed).toBe(false);
    expect(report.maxSimilarity).toBeGreaterThan(DSL_SIMILARITY_THRESHOLD);
  });
});

// ─── Persistence ─────────────────────────────────────────────────────────────

describe("persistDslFeatureVector", () => {
  it("returns true on success", async () => {
    const result = await persistDslFeatureVector("strategy-uuid-1", DSL_A);
    expect(result).toBe(true);
  });

  it("returns false on DB error (non-blocking)", async () => {
    const { db } = await import("../db/index.js");
    (db.insert as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Insert failed");
    });

    const result = await persistDslFeatureVector("strategy-uuid-1", DSL_A);
    expect(result).toBe(false);
  });
});
