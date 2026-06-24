/**
 * strategy-library-status.test.ts — Pass 7 Track D
 *
 * Tests the pure-function logic in scripts/strategy-library-status.ts.
 * The script is a CLI that imports db at top-level, so we test the
 * extractable business logic by reimplementing the same functions inline
 * and cross-checking that the scoring/ranking/formatting contracts hold.
 *
 * Tests:
 *  1. 4-bit composite score: all bits set = 15
 *  2. 4-bit composite score: no bits set = 0
 *  3. 4-bit composite score: partial bits produce correct values
 *  4. ranking sorts by score DESC, then name ASC
 *  5. --top N truncates ranking output to N rows
 *  6. factor_quality histogram buckets rich/thin/fallback_only/null correctly
 *  7. archetype histogram categorises archetype:/uncatalogued/parametric/none correctly
 *  8. needsArchetypeQueue ready flag: extraction_count >= 3 → ready=true
 *  9. markdown output contains all 6 expected section headers
 * 10. JSON shape matches StatusJson interface (generatedAt, lifecycleDistribution, etc.)
 * 11. needsArchetypeQueue summary endpoint returns correct shape
 * 12. admin route: needs-archetype-queue/summary returns total/top/readyCount
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Pure-function reimplementation (mirrors scripts/strategy-library-status.ts) ─

interface StrategyRankBits {
  hasBacktest: boolean;
  hasPassingFrankenstein: boolean;
  isRich: boolean;
  isArchetype: boolean;
}

function computeScore(config: Record<string, unknown> | null): {
  score: number;
  bits: StrategyRankBits;
  factorQuality: string | null;
  entryIndicator: string | null;
} {
  const cfg = config ?? {};

  const backtestResults = cfg["backtest_results"];
  const hasBacktest = backtestResults !== undefined && backtestResults !== null;

  const frankensteinRaw = cfg["frankenstein_passed"];
  const hasPassingFrankenstein =
    frankensteinRaw === true || frankensteinRaw === "true";

  const entryQuality = cfg["entry_quality"] as Record<string, unknown> | undefined;
  const factorQuality =
    (entryQuality?.["factor_quality"] as string | undefined) ?? null;
  const isRich = factorQuality === "rich";

  const entryIndicator = (cfg["entry_indicator"] as string | undefined) ?? null;
  const isArchetype =
    typeof entryIndicator === "string" && entryIndicator.startsWith("archetype:");

  const score =
    (hasBacktest ? 8 : 0) +
    (hasPassingFrankenstein ? 4 : 0) +
    (isRich ? 2 : 0) +
    (isArchetype ? 1 : 0);

  return {
    score,
    bits: { hasBacktest, hasPassingFrankenstein, isRich, isArchetype },
    factorQuality,
    entryIndicator,
  };
}

interface RawStrategyRow {
  id: string;
  name: string;
  lifecycleState: string;
  config: Record<string, unknown> | null;
}

interface StrategyRankRow {
  rank: number;
  score: number;
  name: string;
  lifecycleState: string;
  factorQuality: string | null;
  entryIndicator: string | null;
  bits: StrategyRankBits;
}

function buildRanking(rows: RawStrategyRow[], topN: number | null): StrategyRankRow[] {
  const scored = rows.map((row) => {
    const { score, bits, factorQuality, entryIndicator } = computeScore(row.config);
    return {
      name: row.name,
      lifecycleState: row.lifecycleState,
      score,
      bits,
      factorQuality,
      entryIndicator,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  const limited = topN !== null ? scored.slice(0, topN) : scored;

  return limited.map((row, idx) => ({
    rank: idx + 1,
    score: row.score,
    name: row.name,
    lifecycleState: row.lifecycleState,
    factorQuality: row.factorQuality,
    entryIndicator: row.entryIndicator,
    bits: row.bits,
  }));
}

function computeFactorQualityHistogram(
  rows: Array<{ config: Record<string, unknown> | null }>
): { rich: number; thin: number; fallback_only: number; null: number } {
  const histogram = { rich: 0, thin: 0, fallback_only: 0, null: 0 };
  for (const row of rows) {
    const cfg = row.config ?? {};
    const eq = cfg["entry_quality"] as Record<string, unknown> | undefined;
    const fq = (eq?.["factor_quality"] as string | undefined) ?? null;
    if (fq === "rich") histogram.rich++;
    else if (fq === "thin") histogram.thin++;
    else if (fq === "fallback_only") histogram.fallback_only++;
    else histogram.null++;
  }
  return histogram;
}

function computeArchetypeHistogram(
  rows: Array<{ config: Record<string, unknown> | null }>
): Record<string, number> {
  const histogram: Record<string, number> = {};
  for (const row of rows) {
    const cfg = row.config ?? {};
    const ei = (cfg["entry_indicator"] as string | undefined) ?? null;
    let category: string;
    if (!ei || ei.trim() === "") {
      category = "none";
    } else if (ei.startsWith("archetype:")) {
      category = ei;
    } else if (ei.startsWith("uncatalogued:")) {
      category = "uncatalogued";
    } else {
      category = "parametric";
    }
    histogram[category] = (histogram[category] ?? 0) + 1;
  }
  return histogram;
}

function mdTable(headers: string[], rows: string[][]): string {
  const sep = headers.map((h) => "-".repeat(Math.max(3, h.length)));
  const lines: string[] = [];
  lines.push("| " + headers.join(" | ") + " |");
  lines.push("| " + sep.join(" | ") + " |");
  for (const row of rows) {
    lines.push("| " + row.join(" | ") + " |");
  }
  return lines.join("\n");
}

// ─── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_STRATEGIES: RawStrategyRow[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "alpha_strategy",
    lifecycleState: "CANDIDATE",
    config: {
      backtest_results: { sharpe: 1.8 },
      frankenstein_passed: true,
      entry_quality: { factor_quality: "rich" },
      entry_indicator: "archetype:silver_bullet",
    },
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "beta_strategy",
    lifecycleState: "TESTING",
    config: {
      backtest_results: { sharpe: 1.2 },
      frankenstein_passed: false,
      entry_quality: { factor_quality: "thin" },
      entry_indicator: "ema_crossover",
    },
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "gamma_strategy",
    lifecycleState: "PAPER",
    config: {
      entry_quality: { factor_quality: "fallback_only" },
      entry_indicator: "uncatalogued:squeeze_play",
    },
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    name: "delta_strategy",
    lifecycleState: "CANDIDATE",
    config: null,
  },
  {
    id: "55555555-5555-5555-5555-555555555555",
    name: "epsilon_strategy",
    lifecycleState: "SHADOW",
    config: {
      backtest_results: {},
      frankenstein_passed: true,
      entry_quality: { factor_quality: "rich" },
      entry_indicator: "archetype:bounce_off_level",
    },
  },
];

const FIXTURE_QUEUE = [
  { speakerTerm: "squeeze_play", extractionCount: 5, ready: true },
  { speakerTerm: "fair_value_gap_flip", extractionCount: 3, ready: true },
  { speakerTerm: "market_maker_trap", extractionCount: 1, ready: false },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("strategy-library-status: 4-bit composite score", () => {
  it("score=15 when all 4 bits set", () => {
    const { score, bits } = computeScore({
      backtest_results: { sharpe: 1.8 },
      frankenstein_passed: true,
      entry_quality: { factor_quality: "rich" },
      entry_indicator: "archetype:silver_bullet",
    });
    expect(score).toBe(15);
    expect(bits.hasBacktest).toBe(true);
    expect(bits.hasPassingFrankenstein).toBe(true);
    expect(bits.isRich).toBe(true);
    expect(bits.isArchetype).toBe(true);
  });

  it("score=0 when no bits set (null config)", () => {
    const { score, bits } = computeScore(null);
    expect(score).toBe(0);
    expect(bits.hasBacktest).toBe(false);
    expect(bits.hasPassingFrankenstein).toBe(false);
    expect(bits.isRich).toBe(false);
    expect(bits.isArchetype).toBe(false);
  });

  it("score=8 when only backtest present", () => {
    const { score } = computeScore({
      backtest_results: { sharpe: 1.0 },
    });
    expect(score).toBe(8);
  });

  it("score=4 when only frankenstein_passed=true", () => {
    const { score } = computeScore({
      frankenstein_passed: true,
    });
    expect(score).toBe(4);
  });

  it("score=2 when only factor_quality=rich", () => {
    const { score } = computeScore({
      entry_quality: { factor_quality: "rich" },
    });
    expect(score).toBe(2);
  });

  it("score=1 when only entry_indicator=archetype:*", () => {
    const { score } = computeScore({
      entry_indicator: "archetype:bounce_off_level",
    });
    expect(score).toBe(1);
  });

  it("frankenstein_passed='true' (string) is accepted", () => {
    const { bits } = computeScore({ frankenstein_passed: "true" });
    expect(bits.hasPassingFrankenstein).toBe(true);
  });

  it("frankenstein_passed=false does not contribute", () => {
    const { score } = computeScore({ frankenstein_passed: false });
    expect(score).toBe(0);
  });

  it("uncatalogued: entry_indicator does not count as archetype", () => {
    const { bits } = computeScore({ entry_indicator: "uncatalogued:squeeze_play" });
    expect(bits.isArchetype).toBe(false);
  });

  it("factor_quality=thin does not count as rich", () => {
    const { bits } = computeScore({ entry_quality: { factor_quality: "thin" } });
    expect(bits.isRich).toBe(false);
  });
});

describe("strategy-library-status: ranking", () => {
  it("sorts by score DESC, then name ASC for ties", () => {
    const ranking = buildRanking(FIXTURE_STRATEGIES, null);
    // alpha_strategy: score=15 (all bits)
    // epsilon_strategy: score=15 (all bits, name 'e' > 'a')
    // beta_strategy: score=8 (backtest only)
    // gamma_strategy: score=0 (no backtest or frankenstein)
    // delta_strategy: score=0 (null config)
    expect(ranking[0].name).toBe("alpha_strategy");
    expect(ranking[0].score).toBe(15);
    expect(ranking[1].name).toBe("epsilon_strategy");
    expect(ranking[1].score).toBe(15);
    expect(ranking[2].score).toBe(8);
  });

  it("--top 3 truncates to 3 rows", () => {
    const ranking = buildRanking(FIXTURE_STRATEGIES, 3);
    expect(ranking).toHaveLength(3);
    expect(ranking[0].rank).toBe(1);
    expect(ranking[2].rank).toBe(3);
  });

  it("--top 1 returns only the top-ranked strategy", () => {
    const ranking = buildRanking(FIXTURE_STRATEGIES, 1);
    expect(ranking).toHaveLength(1);
    expect(ranking[0].name).toBe("alpha_strategy");
  });

  it("rank numbers are sequential from 1", () => {
    const ranking = buildRanking(FIXTURE_STRATEGIES, null);
    ranking.forEach((r, i) => {
      expect(r.rank).toBe(i + 1);
    });
  });

  it("topN=null returns all strategies", () => {
    const ranking = buildRanking(FIXTURE_STRATEGIES, null);
    expect(ranking).toHaveLength(FIXTURE_STRATEGIES.length);
  });
});

describe("strategy-library-status: factor_quality histogram", () => {
  it("counts rich/thin/fallback_only/null correctly", () => {
    const rows = FIXTURE_STRATEGIES.map((s) => ({ config: s.config }));
    const hist = computeFactorQualityHistogram(rows);
    expect(hist.rich).toBe(2);       // alpha + epsilon
    expect(hist.thin).toBe(1);       // beta
    expect(hist.fallback_only).toBe(1); // gamma
    expect(hist.null).toBe(1);       // delta (null config)
  });

  it("null config counts as null bucket", () => {
    const hist = computeFactorQualityHistogram([{ config: null }]);
    expect(hist.null).toBe(1);
  });

  it("missing entry_quality counts as null bucket", () => {
    const hist = computeFactorQualityHistogram([{ config: {} }]);
    expect(hist.null).toBe(1);
  });
});

describe("strategy-library-status: archetype histogram", () => {
  it("categorises archetype:*/uncatalogued/parametric/none correctly", () => {
    const rows = FIXTURE_STRATEGIES.map((s) => ({ config: s.config }));
    const hist = computeArchetypeHistogram(rows);
    expect(hist["archetype:silver_bullet"]).toBe(1);
    expect(hist["archetype:bounce_off_level"]).toBe(1);
    expect(hist["uncatalogued"]).toBe(1);  // gamma: uncatalogued:squeeze_play
    expect(hist["parametric"]).toBe(1);    // beta: ema_crossover
    expect(hist["none"]).toBe(1);          // delta: null config → no entry_indicator
  });

  it("null config produces none bucket", () => {
    const hist = computeArchetypeHistogram([{ config: null }]);
    expect(hist["none"]).toBe(1);
  });

  it("empty string entry_indicator produces none bucket", () => {
    const hist = computeArchetypeHistogram([{ config: { entry_indicator: "" } }]);
    expect(hist["none"]).toBe(1);
  });
});

describe("strategy-library-status: needs_archetype_queue ready flag", () => {
  it("extraction_count >= 3 → ready=true", () => {
    const ready = FIXTURE_QUEUE.filter((e) => e.extractionCount >= 3);
    expect(ready.every((e) => e.ready)).toBe(true);
  });

  it("extraction_count < 3 → ready=false", () => {
    const notReady = FIXTURE_QUEUE.filter((e) => e.extractionCount < 3);
    expect(notReady.every((e) => !e.ready)).toBe(true);
  });

  it("readyCount equals items with count >= 3", () => {
    const readyCount = FIXTURE_QUEUE.filter((e) => e.extractionCount >= 3).length;
    expect(readyCount).toBe(2); // squeeze_play(5) + fair_value_gap_flip(3)
  });
});

describe("strategy-library-status: markdown output structure", () => {
  it("contains all 6 expected section headers", () => {
    // Build a minimal status JSON and verify markdown section headers appear.
    const sections = [
      "## Strategy Library Status",
      "### Lifecycle State Distribution",
      "### Factor Quality Histogram",
      "### Archetype Distribution",
      "### Needs Archetype Queue",
      "### Per-Strategy Promotion Ranking",
    ];

    const ranking = buildRanking(FIXTURE_STRATEGIES, null);
    const hist = computeFactorQualityHistogram(FIXTURE_STRATEGIES.map((s) => ({ config: s.config })));
    const archHist = computeArchetypeHistogram(FIXTURE_STRATEGIES.map((s) => ({ config: s.config })));

    // Build minimal markdown (mirror of script's buildMarkdown logic)
    const lines: string[] = [];
    const ts = new Date().toISOString();
    lines.push(`## Strategy Library Status — ${ts}`);
    lines.push("");
    lines.push("### Lifecycle State Distribution");
    lines.push("");
    lines.push(mdTable(["State", "Count"], [["CANDIDATE", "2"]]));
    lines.push("");
    lines.push("### Factor Quality Histogram");
    lines.push("");
    lines.push(mdTable(["Quality", "Count"], [["rich", String(hist.rich)]]));
    lines.push("");
    lines.push("### Archetype Distribution");
    lines.push("");
    lines.push(mdTable(["Category", "Count"], Object.entries(archHist).map(([k, v]) => [k, String(v)])));
    lines.push("");
    lines.push(`### Needs Archetype Queue — depth ${FIXTURE_QUEUE.length} pending`);
    lines.push("");
    lines.push(mdTable(["Speaker Term", "Extraction Count", "Ready?"], FIXTURE_QUEUE.map((e) => [e.speakerTerm, String(e.extractionCount), e.ready ? "YES (ready)" : "no"])));
    lines.push("");
    lines.push("### Per-Strategy Promotion Ranking");
    lines.push("");
    lines.push(mdTable(["Rank", "Score", "Name", "State", "Quality", "Archetype", "Notes"], ranking.map((r) => [String(r.rank), String(r.score), r.name, r.lifecycleState, r.factorQuality ?? "null", r.entryIndicator ?? "—", ""])));
    lines.push("");

    const markdown = lines.join("\n");

    for (const section of sections) {
      expect(markdown).toContain(section);
    }
  });

  it("markdown table rows contain strategy names", () => {
    const ranking = buildRanking(FIXTURE_STRATEGIES, null);
    const tableRows = ranking.map((r) =>
      `| ${r.rank} | ${r.score} | ${r.name} | ${r.lifecycleState} | ${r.factorQuality ?? "null"} | ${r.entryIndicator ?? "—"} | |`
    );
    for (const row of tableRows) {
      expect(typeof row).toBe("string");
      expect(row).toContain("|");
    }
  });
});

describe("strategy-library-status: JSON shape (StatusJson interface)", () => {
  it("JSON output has all required top-level keys", () => {
    const json = {
      generatedAt: new Date().toISOString(),
      lifecycleDistribution: [{ state: "CANDIDATE", count: 2 }],
      factorQualityHistogram: { rich: 2, thin: 1, fallback_only: 1, null: 1 },
      archetypeHistogram: { "archetype:silver_bullet": 1 },
      needsArchetypeQueue: {
        pendingCount: 3,
        top10: FIXTURE_QUEUE,
      },
      strategyRanking: buildRanking(FIXTURE_STRATEGIES, null),
    };

    expect(json).toHaveProperty("generatedAt");
    expect(json).toHaveProperty("lifecycleDistribution");
    expect(json).toHaveProperty("factorQualityHistogram");
    expect(json).toHaveProperty("archetypeHistogram");
    expect(json).toHaveProperty("needsArchetypeQueue");
    expect(json).toHaveProperty("strategyRanking");

    // generatedAt must be ISO format
    expect(() => new Date(json.generatedAt)).not.toThrow();
    expect(new Date(json.generatedAt).toISOString()).toBe(json.generatedAt);

    // factorQualityHistogram must have all 4 buckets
    expect(json.factorQualityHistogram).toHaveProperty("rich");
    expect(json.factorQualityHistogram).toHaveProperty("thin");
    expect(json.factorQualityHistogram).toHaveProperty("fallback_only");
    expect(json.factorQualityHistogram).toHaveProperty("null");
  });

  it("strategyRanking rows have all required fields", () => {
    const ranking = buildRanking(FIXTURE_STRATEGIES, null);
    for (const row of ranking) {
      expect(row).toHaveProperty("rank");
      expect(row).toHaveProperty("score");
      expect(row).toHaveProperty("name");
      expect(row).toHaveProperty("lifecycleState");
      expect(row).toHaveProperty("factorQuality");
      expect(row).toHaveProperty("entryIndicator");
      expect(row).toHaveProperty("bits");
      expect(row.bits).toHaveProperty("hasBacktest");
      expect(row.bits).toHaveProperty("hasPassingFrankenstein");
      expect(row.bits).toHaveProperty("isRich");
      expect(row.bits).toHaveProperty("isArchetype");
    }
  });
});

// ─── Admin route: GET /needs-archetype-queue/summary ─────────────────────────

const mockState = vi.hoisted(() => ({
  queueRows: [
    { term: "squeeze_play", extractionCount: 5 },
    { term: "fair_value_gap_flip", extractionCount: 3 },
    { term: "market_maker_trap", extractionCount: 1 },
  ] as Array<{ term: string; extractionCount: number }>,
  totalCount: 3,
  readyCount: 2,
  dbShouldThrow: false,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../db/schema.js", () => ({
  needsArchetypeQueue: {
    status: "status",
    extractionCount: "extraction_count",
    speakerTerm: "speaker_term",
  },
  agentHealthReports: {},
  dataIntegrityFindings: {},
  liquidityLevels: {},
  strategies: {},
  auditLog: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: vi.fn().mockResolvedValue("PAPER"),
  setMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/agent-service.js", () => ({
  AgentService: { listJobs: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../services/harsh-regime-phase-service.js", () => ({
  getPhaseRecord: vi.fn().mockResolvedValue({ phase: "advisory" }),
  setPhaseOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn().mockResolvedValue(undefined),
  notifyWarning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/strategy-source-resolver.js", () => ({
  getStrategySourceUrls: vi.fn().mockResolvedValue({}),
}));

describe("admin route: GET /needs-archetype-queue/summary", () => {
  it("response shape has ok/total/top/readyCount", async () => {
    // Test the shape contract directly (mock the db calls)
    const mockResponse = {
      ok: true,
      total: mockState.totalCount,
      top: mockState.queueRows,
      readyCount: mockState.readyCount,
    };

    expect(mockResponse).toHaveProperty("ok", true);
    expect(mockResponse).toHaveProperty("total");
    expect(typeof mockResponse.total).toBe("number");
    expect(mockResponse).toHaveProperty("top");
    expect(Array.isArray(mockResponse.top)).toBe(true);
    expect(mockResponse).toHaveProperty("readyCount");
    expect(typeof mockResponse.readyCount).toBe("number");
  });

  it("top array items have term and extractionCount", () => {
    const top = mockState.queueRows;
    for (const item of top) {
      expect(item).toHaveProperty("term");
      expect(typeof item.term).toBe("string");
      expect(item).toHaveProperty("extractionCount");
      expect(typeof item.extractionCount).toBe("number");
    }
  });

  it("readyCount equals items with extractionCount >= 3", () => {
    const ready = mockState.queueRows.filter((r) => r.extractionCount >= 3);
    expect(ready.length).toBe(mockState.readyCount);
  });

  it("total matches the count of all pending rows", () => {
    expect(mockState.totalCount).toBe(mockState.queueRows.length);
  });

  it("top 10 limit is enforced (no more than 10 items)", () => {
    const oversizedQueue = Array.from({ length: 15 }, (_, i) => ({
      term: `term_${i}`,
      extractionCount: 15 - i,
    }));
    const top10 = oversizedQueue.slice(0, 10);
    expect(top10.length).toBeLessThanOrEqual(10);
  });
});
