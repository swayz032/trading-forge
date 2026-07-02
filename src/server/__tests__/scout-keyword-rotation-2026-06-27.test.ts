/**
 * 2026-06-27 — Autonomous Scout keyword extension + daily-rotating-subset tests.
 *
 * Covers:
 *   (a) getRotatingQuerySubset — correct wrap-around windows across multiple cycleIndex values
 *   (b) getRotatingQuerySubset — full-pool fail-open when size >= len or size <= 0 or NaN
 *   (c) getRotatingQuerySubset — determinism (same inputs → same output, no Math.random())
 *   (d) New keywords present in the four query arrays
 *   (e) OPERATOR keywords propagate into every symbol group via getQueryTemplatesForGroup
 */
import { describe, it, expect } from "vitest";
import {
  getRotatingQuerySubset,
  MES_QUERY_TEMPLATES,
  MNQ_QUERY_TEMPLATES,
  MCL_QUERY_TEMPLATES,
  OPERATOR_QUERY_TEMPLATES,
  getQueryTemplatesForGroup,
} from "../services/autonomous-scout-runner";

// ─── (a) Correct wrap-around windows ─────────────────────────────────────────

describe("getRotatingQuerySubset — wrap-around windows", () => {
  const pool = ["a", "b", "c", "d", "e"];

  it("cycleIndex=0 returns items starting from offset 0", () => {
    expect(getRotatingQuerySubset(pool, 0, 3)).toEqual(["a", "b", "c"]);
  });

  it("cycleIndex=1 returns items starting from offset 1", () => {
    expect(getRotatingQuerySubset(pool, 1, 3)).toEqual(["b", "c", "d"]);
  });

  it("cycleIndex=3 wraps around the end correctly", () => {
    // offset 3 of 5 → items at index 3, 4, 0
    expect(getRotatingQuerySubset(pool, 3, 3)).toEqual(["d", "e", "a"]);
  });

  it("cycleIndex=4 wraps around with a two-item tail", () => {
    // offset 4 of 5 → items at index 4, 0, 1
    expect(getRotatingQuerySubset(pool, 4, 3)).toEqual(["e", "a", "b"]);
  });

  it("cycleIndex=5 aliases cycleIndex=0 (pool.length modulo)", () => {
    expect(getRotatingQuerySubset(pool, 5, 3)).toEqual(["a", "b", "c"]);
  });

  it("cycleIndex=13 correctly wraps (13 % 5 = 3)", () => {
    expect(getRotatingQuerySubset(pool, 13, 3)).toEqual(["d", "e", "a"]);
  });

  it("subsetSize=1 returns exactly one item at the correct offset", () => {
    expect(getRotatingQuerySubset(pool, 2, 1)).toEqual(["c"]);
  });

  it("subsetSize=pool.length-1 returns all items except the one before offset", () => {
    // offset=0, size=4 → [a, b, c, d]
    expect(getRotatingQuerySubset(pool, 0, 4)).toEqual(["a", "b", "c", "d"]);
  });

  it("negative cycleIndex is handled safely via double-modulo", () => {
    // ((-1 % 5) + 5) % 5 = 4 → items at index 4, 0
    expect(getRotatingQuerySubset(pool, -1, 2)).toEqual(["e", "a"]);
  });

  it("large cycleIndex (100) wraps correctly (100 % 5 = 0)", () => {
    expect(getRotatingQuerySubset(pool, 100, 3)).toEqual(["a", "b", "c"]);
  });
});

// ─── (b) Fail-open: full pool when size >= len or size <= 0 ──────────────────

describe("getRotatingQuerySubset — fail-open for invalid or oversized subsetSize", () => {
  const pool = ["a", "b", "c", "d", "e"];

  it("subsetSize equal to pool.length returns full pool", () => {
    expect(getRotatingQuerySubset(pool, 0, 5)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("subsetSize greater than pool.length returns full pool", () => {
    expect(getRotatingQuerySubset(pool, 0, 100)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("subsetSize = 0 returns full pool", () => {
    expect(getRotatingQuerySubset(pool, 0, 0)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("subsetSize negative returns full pool", () => {
    expect(getRotatingQuerySubset(pool, 0, -1)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("subsetSize NaN returns full pool", () => {
    expect(getRotatingQuerySubset(pool, 0, NaN)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("subsetSize Infinity returns full pool", () => {
    expect(getRotatingQuerySubset(pool, 0, Infinity)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("empty pool returns empty array regardless of arguments", () => {
    expect(getRotatingQuerySubset([], 5, 3)).toEqual([]);
  });

  it("single-item pool always returns a copy of that item (size=1)", () => {
    expect(getRotatingQuerySubset(["only"], 7, 1)).toEqual(["only"]);
  });

  it("single-item pool with size=2 fails open (size >= pool.length)", () => {
    expect(getRotatingQuerySubset(["only"], 0, 2)).toEqual(["only"]);
  });
});

// ─── (c) Determinism ─────────────────────────────────────────────────────────

describe("getRotatingQuerySubset — determinism", () => {
  const pool = ["x", "y", "z", "w", "v", "u", "t"];

  it("same inputs produce identical output on repeated calls", () => {
    const r1 = getRotatingQuerySubset(pool, 7, 3);
    const r2 = getRotatingQuerySubset(pool, 7, 3);
    const r3 = getRotatingQuerySubset(pool, 7, 3);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it("different cycleIndex values produce different (non-overlapping) output", () => {
    const r0 = getRotatingQuerySubset(pool, 0, 3);
    const r1 = getRotatingQuerySubset(pool, 1, 3);
    expect(r0).not.toEqual(r1);
  });

  it("pool is not mutated by the function", () => {
    const original = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const copy = [...original];
    getRotatingQuerySubset(original, 2, 3);
    expect(original).toEqual(copy);
  });

  it("result is a new array (not a reference to the pool slice)", () => {
    const result = getRotatingQuerySubset(pool, 0, 3);
    expect(result).not.toBe(pool);
  });
});

// ─── (d) New keywords present in the four query arrays ───────────────────────

describe("2026-06-27 keyword additions — OPERATOR_QUERY_TEMPLATES", () => {
  it("contains 'futures intraday momentum setup'", () => {
    expect(OPERATOR_QUERY_TEMPLATES).toContain("futures intraday momentum setup");
  });
  it("contains 'Initial Balance breakout futures'", () => {
    expect(OPERATOR_QUERY_TEMPLATES).toContain("Initial Balance breakout futures");
  });
  it("contains 'VWAP deviation bands day trade'", () => {
    expect(OPERATOR_QUERY_TEMPLATES).toContain("VWAP deviation bands day trade");
  });
  it("contains 'naked POC futures target strategy'", () => {
    expect(OPERATOR_QUERY_TEMPLATES).toContain("naked POC futures target strategy");
  });
  it("contains 'first hour futures trading strategy'", () => {
    expect(OPERATOR_QUERY_TEMPLATES).toContain("first hour futures trading strategy");
  });
  it("still contains all original 8 operator queries", () => {
    const originals = [
      "futures trading strategies rules",
      "futures 4 hr strategy",
      "futures 15min strategy",
      "futures 5min strategy",
      "futures 1hr strategy",
      "futures indicators",
      "futures trading A+ setups",
      "futures trend trading strategy",
    ];
    for (const q of originals) {
      expect(OPERATOR_QUERY_TEMPLATES, `original query "${q}" must still exist`).toContain(q);
    }
  });
  it("does NOT contain the skipped near-duplicate 'Opening Range Breakout 15 min'", () => {
    // This was intentionally skipped — near-duplicate of
    // "opening range breakout 15 minute MES rules" in MES_QUERY_TEMPLATES.
    expect(OPERATOR_QUERY_TEMPLATES).not.toContain("Opening Range Breakout 15 min");
  });
});

describe("2026-06-27 keyword additions — MES_QUERY_TEMPLATES", () => {
  it("contains 'MES day trading strategy rules'", () => {
    expect(MES_QUERY_TEMPLATES).toContain("MES day trading strategy rules");
  });
  it("contains 'MES structural trade setup'", () => {
    expect(MES_QUERY_TEMPLATES).toContain("MES structural trade setup");
  });
  it("contains 'MES macro setup entry criteria'", () => {
    expect(MES_QUERY_TEMPLATES).toContain("MES macro setup entry criteria");
  });
  it("contains 'MES market structure shift'", () => {
    expect(MES_QUERY_TEMPLATES).toContain("MES market structure shift");
  });
});

describe("2026-06-27 keyword additions — MNQ_QUERY_TEMPLATES", () => {
  it("contains 'MNQ intraday trend following'", () => {
    expect(MNQ_QUERY_TEMPLATES).toContain("MNQ intraday trend following");
  });
});

describe("2026-06-27 keyword additions — MCL_QUERY_TEMPLATES", () => {
  it("contains 'MCL session trading setup'", () => {
    expect(MCL_QUERY_TEMPLATES).toContain("MCL session trading setup");
  });
  it("contains 'MCL intraday trend continuation'", () => {
    expect(MCL_QUERY_TEMPLATES).toContain("MCL intraday trend continuation");
  });
});

// ─── (e) OPERATOR keywords propagate through getQueryTemplatesForGroup ────────

describe("keyword propagation — OPERATOR keywords appear in all symbol groups", () => {
  const operatorExtension = [
    "futures intraday momentum setup",
    "Initial Balance breakout futures",
    "VWAP deviation bands day trade",
    "naked POC futures target strategy",
    "first hour futures trading strategy",
  ];

  for (const group of ["MES", "MNQ", "MCL"] as const) {
    it(`getQueryTemplatesForGroup("${group}") includes all 5 new OPERATOR queries`, () => {
      const pool = getQueryTemplatesForGroup(group);
      for (const q of operatorExtension) {
        expect(pool, `group "${group}" must include "${q}"`).toContain(q);
      }
    });
  }

  it("MES group contains MES-specific new keywords", () => {
    const pool = getQueryTemplatesForGroup("MES");
    expect(pool).toContain("MES day trading strategy rules");
    expect(pool).toContain("MES market structure shift");
  });

  it("MNQ group contains MNQ-specific new keyword", () => {
    const pool = getQueryTemplatesForGroup("MNQ");
    expect(pool).toContain("MNQ intraday trend following");
  });

  it("MCL group contains MCL-specific new keywords", () => {
    const pool = getQueryTemplatesForGroup("MCL");
    expect(pool).toContain("MCL session trading setup");
    expect(pool).toContain("MCL intraday trend continuation");
  });

  it("getQueryTemplatesForGroup returns at least 16 queries for every group (subset-default coverage)", () => {
    // Ensures the pool is always large enough that the default SCOUT_KEYWORD_SUBSET_SIZE=16
    // will not fall back to full-pool mode on any symbol group.
    for (const group of ["MES", "MNQ", "MCL"] as const) {
      expect(getQueryTemplatesForGroup(group).length).toBeGreaterThan(16);
    }
  });
});
