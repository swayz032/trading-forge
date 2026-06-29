/**
 * carter-actions.test.ts — Unit tests for Carter voice-agent action handlers.
 *
 * Critical guardrail tests (must always pass):
 *   1. run_monte_carlo ALWAYS passes firms=['topstep_50k','mffu_50k'] — never skips, never lets caller override
 *   2. run_backtest STRIPS compliance_mode, actor, trial_n_total from caller params
 *   3. run_backtest 429 (cap saturated) → returns system_busy payload, no throw, no retry
 *   4. run_backtest pipeline paused → returns pipeline_paused payload, no throw
 *   5. fire_scout_cycle pipeline paused → returns paused, does NOT call runAutonomousScoutCycle
 *   6. deposit_pending_mention writes to pending path ONLY — never strict path
 *   7. evaluate_kill_signal catastrophic_risk fires when max_drawdown > 6000
 *   8. scan_youtube_for_setups returns video list, never auto-extracts
 */

// ── Mocks — hoisted before imports by vitest ──────────────────────────────────
// IMPORTANT: vi.mock factory functions must not reference module-level variables
// declared below the mock call — they may be in TDZ. Use inline literals only.

vi.mock("../../db/index.js", () => {
  // Bucket fixture — inlined to avoid TDZ (vi.mock is hoisted above variable declarations)
  const _bucket = { id: "bucket-1", sourceCount: 0, distinctProviders: 0 };
  const _counts = { source_count: 1, distinct_providers: 1, has_web: true, has_youtube: false, has_reddit: false };
  const _strat = {
    id: "strat-1", name: "TestStrat", symbol: "MES", timeframe: "5m",
    config: {
      strategy: {
        indicators: [], entry_long: "rsi < 30", entry_short: "rsi > 70",
        exit: "close", stop_loss: { type: "atr", multiplier: 2 },
        position_size: { type: "fixed", fixed_contracts: 1 },
      },
    },
  };

  // Helper: makes a thenable values result (drizzle builders are Promise-like;
  // the fire-and-forget auditLog insert calls .values({...}).catch(fn)).
  const _makeValues = (bucketFixture: typeof _bucket) => ({
    onConflictDoUpdate: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve([bucketFixture])),
    })),
    onConflictDoNothing: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve([{ id: "mention-1" }])),
    })),
    returning: vi.fn(() => Promise.resolve([bucketFixture])),
    // Thenable so .catch() works on bare .values() call (auditLog fire-and-forget)
    then: (fn: (v: unknown) => unknown) => Promise.resolve(undefined).then(fn),
    catch: (fn: (e: unknown) => unknown) => Promise.resolve(undefined).catch(fn),
  });

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([_strat])),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => _makeValues(_bucket)),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(undefined)),
        })),
      })),
      execute: vi.fn(() => Promise.resolve([_counts])),
    },
  };
});

vi.mock("../../db/schema.js", () => ({
  strategies: { id: "mock_col" },
  strategyPendingBuckets: { fingerprintHash: "mock_col", id: "mock_col" },
  strategyPendingMentions: {},
  auditLog: {},
}));

const mockRunBacktest = vi.fn();
vi.mock("../../services/backtest-service.js", () => ({
  runBacktest: (...args: unknown[]) => mockRunBacktest(...args),
}));

const mockRunMonteCarlo = vi.fn();
vi.mock("../../services/monte-carlo-service.js", () => ({
  runMonteCarlo: (...args: unknown[]) => mockRunMonteCarlo(...args),
}));

const mockRunMatrix = vi.fn();
vi.mock("../../services/matrix-backtest-service.js", () => ({
  runMatrix: (...args: unknown[]) => mockRunMatrix(...args),
  getMatrixStatus: vi.fn(),
}));

const mockRunScoutCycle = vi.fn();
const mockFetchYouTube = vi.fn();
vi.mock("../../services/autonomous-scout-runner.js", () => ({
  runAutonomousScoutCycle: (...args: unknown[]) => mockRunScoutCycle(...args),
  fetchYouTubeTopVideos: (...args: unknown[]) => mockFetchYouTube(...args),
}));

const mockStrategyHunt = vi.fn();
vi.mock("../../services/search-router.js", () => ({
  strategyHunt: (...args: unknown[]) => mockStrategyHunt(...args),
}));

// Wave 7 — transcript fetch (dynamic import inside extract_youtube_strategy).
const mockFetchTranscript = vi.fn();
vi.mock("../../services/transcript-fetch-queue.js", () => ({
  fetchTranscriptWithRetry: (...args: unknown[]) => mockFetchTranscript(...args),
}));

// Wave 7 — research lane handlers delegate to carter-research (tested in depth
// in carter-research.test.ts). Here we only assert the handler delegates.
const mockInstitutionalResearch = vi.fn();
const mockResearchReddit = vi.fn();
vi.mock("../../lib/carter/carter-research.js", () => ({
  institutionalResearch: (...args: unknown[]) => mockInstitutionalResearch(...args),
  researchReddit: (...args: unknown[]) => mockResearchReddit(...args),
}));

vi.mock("../../services/strategy-fingerprint.js", () => ({
  computeConceptFingerprintHash: vi.fn(() => "fp-hash-abc"),
  extractEntryArchetype: vi.fn(() => "breakout"),
  normalizeExitType: vi.fn(() => "unknown"),
}));

const mockIsActive = vi.fn();
vi.mock("../../services/pipeline-control-service.js", () => ({
  isActive: (...args: unknown[]) => mockIsActive(...args),
  getMode: vi.fn(),
  setMode: vi.fn(),
}));

const mockGetStats = vi.fn();
vi.mock("../../routes/backtests.js", () => ({
  getBacktestConcurrencyStats: (...args: unknown[]) => mockGetStats(...args),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b, _op: "eq" })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._vals: unknown[]) => strings.raw.join("?"),
    { raw: (s: unknown) => s },
  ),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CARTER_ACTION_HANDLERS } from "../../lib/carter/carter-actions.js";

// ── Helper ────────────────────────────────────────────────────────────────────

const getHandler = (name: string) => {
  const h = CARTER_ACTION_HANDLERS[name];
  if (!h) throw new Error(`No action handler: ${name}`);
  return h;
};

// ─── Test suites ──────────────────────────────────────────────────────────────

describe("CARTER_ACTION_HANDLERS — map structure", () => {
  it("exports exactly 13 handlers", () => {
    expect(Object.keys(CARTER_ACTION_HANDLERS)).toHaveLength(13);
  });

  it("all expected keys are present", () => {
    const expected = [
      "run_backtest", "run_walk_forward", "run_monte_carlo", "run_matrix",
      "fire_scout_cycle", "competitive_intel",
      "scan_youtube_for_setups", "extract_youtube_strategy",
      "research_reddit", "institutional_research",
      "deposit_pending_mention", "evaluate_kill_signal",
    ];
    for (const key of expected) {
      expect(CARTER_ACTION_HANDLERS).toHaveProperty(key);
      expect(typeof CARTER_ACTION_HANDLERS[key]).toBe("function");
    }
  });
});

// ─── GUARDRAIL: run_monte_carlo always injects firms ─────────────────────────

describe("run_monte_carlo — firms guardrail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsActive.mockResolvedValue(true);
    mockRunMonteCarlo.mockResolvedValue({ id: "mc-1" });
  });

  it("ALWAYS passes firms=['topstep_50k','mffu_50k'] even when caller omits firms", async () => {
    const handler = getHandler("run_monte_carlo");
    await handler({ backtestId: "bt-1" });

    expect(mockRunMonteCarlo).toHaveBeenCalledOnce();
    const callArgs = mockRunMonteCarlo.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.firms).toEqual(["topstep_50k", "mffu_50k"]);
  });

  it("IGNORES caller-supplied firms and forces the required list", async () => {
    const handler = getHandler("run_monte_carlo");
    await handler({ backtestId: "bt-1", firms: ["some_other_firm"] });

    expect(mockRunMonteCarlo).toHaveBeenCalledOnce();
    const callArgs = mockRunMonteCarlo.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.firms).toEqual(["topstep_50k", "mffu_50k"]);
    expect((options.firms as string[]).includes("some_other_firm")).toBe(false);
  });

  it("returns pipeline_paused when pipeline is stopped — does NOT run MC", async () => {
    mockIsActive.mockResolvedValue(false);
    const handler = getHandler("run_monte_carlo");
    const result = await handler({ backtestId: "bt-1" }) as Record<string, unknown>;

    expect(result.status).toBe("pipeline_paused");
    expect(mockRunMonteCarlo).not.toHaveBeenCalled();
  });

  it("returns error when backtestId is missing", async () => {
    const handler = getHandler("run_monte_carlo");
    const result = await handler({}) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(mockRunMonteCarlo).not.toHaveBeenCalled();
  });
});

// ─── GUARDRAIL: run_backtest strips forbidden fields ─────────────────────────

describe("run_backtest — field-strip guardrail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockReturnValue({ active: 0, cap: 3, saturated: false });
    mockRunBacktest.mockResolvedValue({ id: "bt-out", status: "running" });
  });

  it("STRIPS compliance_mode from caller params — never reaches runBacktest config", async () => {
    const handler = getHandler("run_backtest");
    await handler({ strategyId: "strat-1", compliance_mode: "shadow" });

    expect(mockRunBacktest).toHaveBeenCalledOnce();
    const config = mockRunBacktest.mock.calls[0][1] as Record<string, unknown>;
    expect(config).not.toHaveProperty("compliance_mode");
  });

  it("STRIPS actor from caller params — actor is always pinned to 'automated'", async () => {
    const handler = getHandler("run_backtest");
    await handler({ strategyId: "strat-1", actor: "operator" });

    expect(mockRunBacktest).toHaveBeenCalledOnce();
    const config = mockRunBacktest.mock.calls[0][1] as Record<string, unknown>;
    expect(config).not.toHaveProperty("actor");
    // actor is the 6th arg to runBacktest — always "automated"
    const actorArg = mockRunBacktest.mock.calls[0][5];
    expect(actorArg).toBe("automated");
  });

  it("STRIPS trial_n_total from caller params", async () => {
    const handler = getHandler("run_backtest");
    await handler({ strategyId: "strat-1", trial_n_total: 999 });

    expect(mockRunBacktest).toHaveBeenCalledOnce();
    const config = mockRunBacktest.mock.calls[0][1] as Record<string, unknown>;
    expect(config).not.toHaveProperty("trial_n_total");
  });

  it("defaults mode to 'walkforward' when not provided", async () => {
    const handler = getHandler("run_backtest");
    await handler({ strategyId: "strat-1" });

    expect(mockRunBacktest).toHaveBeenCalledOnce();
    const config = mockRunBacktest.mock.calls[0][1] as Record<string, unknown>;
    expect(config.mode).toBe("walkforward");
  });

  it("respects mode='single' when explicitly provided", async () => {
    const handler = getHandler("run_backtest");
    await handler({ strategyId: "strat-1", mode: "single" });

    expect(mockRunBacktest).toHaveBeenCalledOnce();
    const config = mockRunBacktest.mock.calls[0][1] as Record<string, unknown>;
    expect(config.mode).toBe("single");
  });
});

// ─── GUARDRAIL: run_backtest 429 (cap saturated) ─────────────────────────────

describe("run_backtest — concurrent cap guardrail (429)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns system_busy when cap is saturated — no throw, no retry", async () => {
    mockGetStats.mockReturnValue({ active: 3, cap: 3, saturated: true });
    const handler = getHandler("run_backtest");

    const result = await handler({ strategyId: "strat-1" }) as Record<string, unknown>;

    expect(result.status).toBe("system_busy");
    expect(result.retry_after_seconds).toBe(30);
    expect(mockRunBacktest).not.toHaveBeenCalled();
  });

  it("does NOT throw when cap is saturated", async () => {
    mockGetStats.mockReturnValue({ active: 3, cap: 3, saturated: true });
    const handler = getHandler("run_backtest");
    await expect(handler({ strategyId: "strat-1" })).resolves.not.toThrow();
  });
});

// ─── GUARDRAIL: run_backtest pipeline paused ─────────────────────────────────

describe("run_backtest — pipeline pause guardrail (423)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockReturnValue({ active: 0, cap: 3, saturated: false });
  });

  it("returns pipeline_paused when service signals skipped/pipeline_paused", async () => {
    mockRunBacktest.mockResolvedValue({ id: null, status: "skipped", error: "pipeline_paused" });
    const handler = getHandler("run_backtest");

    const result = await handler({ strategyId: "strat-1" }) as Record<string, unknown>;

    expect(result.status).toBe("pipeline_paused");
  });
});

// ─── GUARDRAIL: fire_scout_cycle pipeline pause ───────────────────────────────

describe("fire_scout_cycle — pipeline pause guardrail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pipeline_paused and does NOT fire the cycle when pipeline is paused", async () => {
    mockIsActive.mockResolvedValue(false);
    const handler = getHandler("fire_scout_cycle");

    const result = await handler({}) as Record<string, unknown>;

    expect(result.status).toBe("pipeline_paused");
    expect(mockRunScoutCycle).not.toHaveBeenCalled();
  });

  it("fires fire-and-forget and returns cycle_started when pipeline is active", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunScoutCycle.mockResolvedValue({ done: true });
    const handler = getHandler("fire_scout_cycle");

    const result = await handler({}) as Record<string, unknown>;

    expect(result.status).toBe("cycle_started");
    expect(mockRunScoutCycle).toHaveBeenCalledOnce();
  });
});

// ─── GUARDRAIL: deposit_pending_mention targets pending ONLY ─────────────────

describe("deposit_pending_mention — pending-only guardrail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns accepted=true and path='pending'", async () => {
    const handler = getHandler("deposit_pending_mention");
    const result = await handler({
      conceptName: "opening_range_breakout",
      market: "MES",
      sourceUrl: "https://youtube.com/watch?v=abc123",
      layer: "youtube",
    }) as Record<string, unknown>;

    expect(result.accepted).toBe(true);
    expect(result.path).toBe("pending");
  });

  it("returns error when conceptName is missing", async () => {
    const handler = getHandler("deposit_pending_mention");
    const result = await handler({ market: "MES", sourceUrl: "https://example.com" }) as Record<string, unknown>;
    expect(result.error).toBeDefined();
  });

  it("returns error when market is invalid", async () => {
    const handler = getHandler("deposit_pending_mention");
    const result = await handler({ conceptName: "ORB", market: "SPY", sourceUrl: "https://example.com" }) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("market");
  });
});

// ─── evaluate_kill_signal — pure computation ─────────────────────────────────

describe("evaluate_kill_signal — pure computation", () => {
  const handler = () => getHandler("evaluate_kill_signal");

  it("returns catastrophic_risk when any attempt has max_drawdown > 6000", async () => {
    const result = await handler()({
      attempts: [
        { sharpe_ratio: 2.0, max_drawdown: 7000, win_rate: 0.65, profit_factor: 1.8, avg_daily_pnl: 350 },
      ],
    }) as Record<string, unknown>;
    expect(result.kill_signal).toBe("catastrophic_risk");
  });

  it("returns no_edge when best Sharpe < 0.8", async () => {
    const result = await handler()({
      attempts: [
        { sharpe_ratio: 0.5, max_drawdown: 1000, win_rate: 0.55, profit_factor: 1.2, avg_daily_pnl: 100 },
      ],
    }) as Record<string, unknown>;
    expect(result.kill_signal).toBe("no_edge");
  });

  it("returns wrong_direction when win_rate < 0.40 (and sharpe passes)", async () => {
    const result = await handler()({
      attempts: [
        { sharpe_ratio: 1.2, max_drawdown: 800, win_rate: 0.35, profit_factor: 1.5, avg_daily_pnl: 200 },
      ],
    }) as Record<string, unknown>;
    expect(result.kill_signal).toBe("wrong_direction");
  });

  it("returns null kill_signal when all thresholds pass", async () => {
    const result = await handler()({
      attempts: [
        { sharpe_ratio: 2.0, max_drawdown: 500, win_rate: 0.65, profit_factor: 2.0, avg_daily_pnl: 400 },
      ],
    }) as Record<string, unknown>;
    expect(result.kill_signal).toBeNull();
    expect(result.stage).toBeDefined();
  });

  it("returns error when attempts is missing or empty", async () => {
    const result = await handler()({}) as Record<string, unknown>;
    expect(result.error).toBeDefined();
  });

  it("assigns stage 1 for <= 3 attempts", async () => {
    const result = await handler()({
      attempts: [
        { sharpe_ratio: 2.0, max_drawdown: 500, win_rate: 0.65, profit_factor: 2.0, avg_daily_pnl: 400 },
      ],
    }) as Record<string, unknown>;
    expect(result.stage).toBe(1);
  });

  it("assigns stage 3 for > 6 attempts", async () => {
    const attempts = Array.from({ length: 7 }, () => ({
      sharpe_ratio: 2.0, max_drawdown: 500, win_rate: 0.65, profit_factor: 2.0, avg_daily_pnl: 400,
    }));
    const result = await handler()({ attempts }) as Record<string, unknown>;
    expect(result.stage).toBe(3);
  });
});

// ─── scan_youtube_for_setups — discovery only, no extraction ─────────────────

describe("scan_youtube_for_setups — discovery only, no extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns video list without extracting transcripts", async () => {
    mockFetchYouTube.mockResolvedValue([
      { title: "Best ORB Strategy 2025", url: "https://youtube.com/watch?v=x1", titleScore: 5, source_pass: "captioned", combinedScore: 4, videoId: "x1" },
      { title: "VWAP Pullback Tutorial", url: "https://youtube.com/watch?v=x2", titleScore: 4, source_pass: "captioned", combinedScore: 3, videoId: "x2" },
    ]);
    const handler = getHandler("scan_youtube_for_setups");
    const result = await handler({ topic: "opening range breakout futures" }) as Record<string, unknown>;

    expect(result.videos).toHaveLength(2);
    expect((result.videos as unknown[])[0]).toMatchObject({ title: "Best ORB Strategy 2025", url: "https://youtube.com/watch?v=x1" });
    expect(result).not.toHaveProperty("transcripts");
    expect(result.note).toContain("no transcripts extracted");
  });

  it("returns error when topic is missing", async () => {
    const handler = getHandler("scan_youtube_for_setups");
    const result = await handler({}) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(mockFetchYouTube).not.toHaveBeenCalled();
  });
});

// ─── run_walk_forward — always walkforward mode ───────────────────────────────

describe("run_walk_forward", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockReturnValue({ active: 0, cap: 3, saturated: false });
    mockRunBacktest.mockResolvedValue({ id: "bt-out", status: "running" });
  });

  it("always passes mode=walkforward regardless of caller input", async () => {
    const handler = getHandler("run_walk_forward");
    await handler({ strategyId: "strat-1", mode: "single" }); // caller tries to force single

    expect(mockRunBacktest).toHaveBeenCalledOnce();
    const config = mockRunBacktest.mock.calls[0][1] as Record<string, unknown>;
    expect(config.mode).toBe("walkforward");
  });
});

// ─── Wave 7 — extract_youtube_strategy (STRATEGY lane) ───────────────────────
// THE governance boundary: strategies enter ONLY via YouTube extraction, and
// always deposit to the PENDING bucket — NEVER the strict path.

describe("extract_youtube_strategy — YouTube-only strategy lane", () => {
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/scout-extract")) {
        return {
          ok: true,
          json: async () => ({
            extracted: true,
            extraction_mode: "single_pass",
            ideas: [{
              market: "MES", timeframe: "5m", thesis: "ORB long on opening range break with volume",
              entry_rules: "Enter long when price breaks the 15m opening range high with volume confirmation",
              exit_rules: "Style C 33/33/34 scale-out", risk_rules: "1.5x ATR structural stop",
              concept_name: "opening_range_breakout", name: "ORB MES",
              entry_indicator: "opening_range_breakout", direction: "long",
            }],
          }),
        } as unknown as Response;
      }
      if (String(url).includes("/scout-ideas/pending")) {
        return { ok: true, json: async () => ({ accepted: true, bucket_id: "bk-1", path: "pending" }) } as unknown as Response;
      }
      throw new Error(`unexpected fetch URL: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  it("fetches transcript, calls scout-extract, and deposits to PENDING (never strict)", async () => {
    mockFetchTranscript.mockResolvedValue({ transcript: "x".repeat(800), attempts: [], finalOutcome: "captioned_succeeded" });
    const handler = getHandler("extract_youtube_strategy");
    const result = await handler({ url: "https://www.youtube.com/watch?v=abc123XYZ" }) as Record<string, unknown>;

    expect(mockFetchTranscript).toHaveBeenCalledWith("abc123XYZ");
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/api/agent/scout-extract"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/agent/scout-ideas/pending"))).toBe(true);
    // GUARDRAIL: never the strict path
    expect(calledUrls.some((u) => u.includes("/scout-ideas/strict"))).toBe(false);

    expect(result.extracted).toBe(true);
    expect(result.deposited).toBe(true);
    expect(result.deposit_path).toBe("pending");
  });

  it("deposits with source_provider youtube_transcript_npm and layer youtube", async () => {
    mockFetchTranscript.mockResolvedValue({ transcript: "x".repeat(800), attempts: [], finalOutcome: "captioned_succeeded" });
    const handler = getHandler("extract_youtube_strategy");
    await handler({ url: "https://youtu.be/abc123XYZ" });

    const pendingCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/scout-ideas/pending"));
    expect(pendingCall).toBeDefined();
    const body = JSON.parse((pendingCall![1] as { body: string }).body);
    expect(body.layer).toBe("youtube");
    expect(body.source_provider).toBe("youtube_transcript_npm");
    expect(body.is_cross_validation_result).toBe(false);
  });

  it("returns error when url is missing", async () => {
    const handler = getHandler("extract_youtube_strategy");
    const result = await handler({}) as Record<string, unknown>;
    expect(result.error).toBe("url is required");
    expect(mockFetchTranscript).not.toHaveBeenCalled();
  });

  it("returns invalid_youtube_url for a non-YouTube URL", async () => {
    const handler = getHandler("extract_youtube_strategy");
    const result = await handler({ url: "https://example.com/article" }) as Record<string, unknown>;
    expect(result.error).toBe("invalid_youtube_url");
  });

  it("does NOT call scout-extract when transcript is too short", async () => {
    mockFetchTranscript.mockResolvedValue({ transcript: "short", attempts: [], finalOutcome: "captioned_failed" });
    const handler = getHandler("extract_youtube_strategy");
    const result = await handler({ url: "https://www.youtube.com/watch?v=abc123XYZ" }) as Record<string, unknown>;
    expect(result.extracted).toBe(false);
    expect(result.reason).toBe("transcript_too_short");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Wave 7 — research lane handlers delegate to carter-research ──────────────

describe("research_reddit — delegates to carter-research (NON-strategy)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("delegates to researchReddit with the topic", async () => {
    mockResearchReddit.mockResolvedValue({ topic: "FOMC", summary: "…", posts: [], count: 0, note: "" });
    const handler = getHandler("research_reddit");
    const result = await handler({ topic: "FOMC reaction" }) as Record<string, unknown>;
    expect(mockResearchReddit).toHaveBeenCalledWith({ topic: "FOMC reaction" });
    expect(result.topic).toBe("FOMC");
  });

  it("returns error when topic is missing", async () => {
    const handler = getHandler("research_reddit");
    const result = await handler({}) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(mockResearchReddit).not.toHaveBeenCalled();
  });
});

describe("institutional_research — delegates to carter-research (NON-strategy)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("delegates to institutionalResearch with question + includeParallel", async () => {
    mockInstitutionalResearch.mockResolvedValue({ question: "q", brief: "b", sources: [], providers_ok: [], providers_failed: [], synthesized_by: "ollama", elapsed_ms: 1 });
    const handler = getHandler("institutional_research");
    await handler({ question: "How do desks size kill switches?", includeParallel: true });
    expect(mockInstitutionalResearch).toHaveBeenCalledWith({ question: "How do desks size kill switches?", includeParallel: true });
  });

  it("defaults includeParallel to false", async () => {
    mockInstitutionalResearch.mockResolvedValue({ question: "q", brief: "b", sources: [], providers_ok: [], providers_failed: [], synthesized_by: "ollama", elapsed_ms: 1 });
    const handler = getHandler("institutional_research");
    await handler({ question: "q" });
    expect(mockInstitutionalResearch).toHaveBeenCalledWith({ question: "q", includeParallel: false });
  });

  it("returns error when question is missing", async () => {
    const handler = getHandler("institutional_research");
    const result = await handler({}) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(mockInstitutionalResearch).not.toHaveBeenCalled();
  });
});

describe("competitive_intel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns topResults from strategyHunt with competitive framing", async () => {
    mockStrategyHunt.mockResolvedValue({
      query: "ICT concepts institutional", depth: "advanced",
      totalRaw: 3, totalFused: 3, totalAfterGraveyard: 3,
      perProvider: {},
      results: [{ title: "ICT Order Flow", url: "https://example.com", provider: "exa" }],
    });
    const handler = getHandler("competitive_intel");
    const result = await handler({ topic: "ICT concepts institutional" }) as Record<string, unknown>;
    expect(result.topResults).toBeDefined();
  });

  it("returns error when topic is missing", async () => {
    const handler = getHandler("competitive_intel");
    const result = await handler({}) as Record<string, unknown>;
    expect(result.error).toBeDefined();
  });
});

// ─── run_matrix ───────────────────────────────────────────────────────────────

describe("run_matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runMatrix with strategyId and returns dispatched status", async () => {
    mockRunMatrix.mockResolvedValue({ id: "matrix-1" });
    const handler = getHandler("run_matrix");
    const result = await handler({ strategyId: "strat-1" }) as Record<string, unknown>;

    expect(mockRunMatrix).toHaveBeenCalledWith("strat-1");
    expect(result.status).toBe("dispatched");
  });

  it("returns error when strategyId is missing", async () => {
    const handler = getHandler("run_matrix");
    const result = await handler({}) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(mockRunMatrix).not.toHaveBeenCalled();
  });
});
