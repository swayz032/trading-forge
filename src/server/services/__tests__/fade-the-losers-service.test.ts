/**
 * fade-the-losers-service.test.ts — Wave B "Fade-the-Losers" (2026-07-03)
 *
 * Covers:
 *   - Pure classifiers: extractCohortMetrics, classifyDirectionality.
 *   - Cohort selector (pglite): significance filter (min-trades + PF), skip each
 *     degenerate deathReason, skip already-faded / faded_from, dedupe same-origin.
 *   - Integration: a faded config passes Gate 1 and yields a CANDIDATE via the
 *     REAL gate ladder (overlay + auditor + playbook registration).
 *   - No-bypass: the faded strategy is lifecycle_state='CANDIDATE' (bottom of
 *     pipeline) and carries NO gate exemption — it must traverse the full battery.
 *
 * DB INJECTION PATTERN mirrors spec-onboarding-service.test.ts (the standard for
 * this layer): vi.mock the shared `db` import, import the module under test AFTER
 * mock registration, mock ../../index.js so the transitively-imported graduator
 * (Gate 1/2 via dynamic import) does not drag in the full Express bootstrap.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers/pglite-db.js";
import type { TestDb } from "../../__tests__/helpers/pglite-db.js";

let injectedDb: TestDb["db"] | null = null;

vi.mock("../../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

vi.mock("../../index.js", () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

import {
  runFadeTheLosers,
  selectFadeCohort,
  extractCohortMetrics,
  classifyDirectionality,
} from "../fade-the-losers-service.js";
import { strategies, strategyGraveyard, auditLog } from "../../db/schema.js";

// ─── strategy_graveyard DDL (not in the shared CORE_DDL helper) ─────────────
const GRAVEYARD_DDL = `
CREATE TABLE IF NOT EXISTS strategy_graveyard (
  id                 UUID PRIMARY KEY,
  strategy_id        UUID REFERENCES strategies(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  dsl_snapshot       JSONB NOT NULL,
  failure_modes      TEXT[] NOT NULL,
  failure_details    JSONB,
  backtest_summary   JSONB,
  embedding          JSONB,
  death_reason       TEXT,
  death_date         TIMESTAMP NOT NULL,
  source             TEXT DEFAULT 'auto',
  failure_category   TEXT,
  failure_severity   NUMERIC,
  searchable_metrics JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

type Dict = Record<string, unknown>;

function longOnlyConfig(): Dict {
  return {
    direction: "long",
    entry_type: "breakout",
    entry_indicator: "session_open_breakout",
    regime_gate: { enabled: true, preferred_regime: "TRENDING_UP" },
    take_profit: { type: "atr_multiple", multiplier: 3 },
    exit_type: "trailing_stop",
    exit_params: { style: "c" },
    session_filter: { enabled: true, session: "RTH_ONLY" },
    entry_quality: { confluence_factors: ["structural_setup", "vp_shape"], use_weighted_scoring: false },
    strategy: {
      name: "orb_long_loser_mes_5m",
      symbol: "MES",
      timeframe: "5m",
      entry_long: "close > orh_15m",
      entry_short: "high < low",
      stop_loss: { type: "atr", multiplier: 1.5 },
      position_size: { type: "risk_derived_pyramid", personal_dll_pct: 0.67 },
    },
  };
}

async function insertOriginal(
  db: TestDb["db"],
  opts: { id?: string; name?: string; symbol?: string; config?: Dict; source?: string } = {},
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await db.insert(strategies).values({
    id,
    name: opts.name ?? "orb_long_loser_mes_5m",
    symbol: opts.symbol ?? "MES",
    symbols: [opts.symbol ?? "MES"],
    timeframe: "5m",
    config: (opts.config ?? longOnlyConfig()) as Dict,
    lifecycleState: "GRAVEYARD",
    source: opts.source ?? "graduated_bucket",
  });
  return id;
}

async function insertGraveyard(
  db: TestDb["db"],
  opts: {
    strategyId: string | null;
    name?: string;
    dslSnapshot?: Dict;
    searchableMetrics?: Dict;
    deathReason?: string;
    failureCategory?: string | null;
    failureModes?: string[];
    source?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(strategyGraveyard).values({
    id,
    strategyId: opts.strategyId,
    name: opts.name ?? "orb_long_loser_mes_5m",
    dslSnapshot: (opts.dslSnapshot ?? longOnlyConfig()) as Dict,
    failureModes: opts.failureModes ?? ["negative_edge"],
    searchableMetrics: (opts.searchableMetrics ?? { n_trades: 120, expectancy: -0.35, profit_factor: 0.7 }) as Dict,
    deathReason: opts.deathReason ?? "negative expectancy underperformance",
    failureCategory: opts.failureCategory ?? "performance",
    deathDate: new Date(),
    source: opts.source ?? "auto",
  });
  return id;
}

// ─── Playbook fixture (idempotent registration target) ──────────────────────
let playbookRouterPath: string;
let tmpDir: string;

function freshPlaybookFile(): void {
  writeFileSync(
    playbookRouterPath,
    [
      'CONTINUATION_STRATS = ["ote", "ict_swing"]',
      'REVERSAL_STRATS = ["breaker"]',
      'MEAN_REV_STRATS = ["midnight_open"]',
      'ORB_STRATS = ["iofed"]',
      "ALL_STRATS = CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS",
      "",
    ].join("\n"),
    "utf-8",
  );
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "playbook-router-fade-test-"));
  playbookRouterPath = join(tmpDir, "playbook_router_fixture.py");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Pure unit tests (no DB) ────────────────────────────────────────────────

describe("fade-the-losers-service — extractCohortMetrics", () => {
  it("reads n_trades / expectancy / profit_factor across key-name variants", () => {
    const m = extractCohortMetrics({ total_trades: 84, avg_r: -0.2, pf: 0.9 }, null);
    expect(m.nTrades).toBe(84);
    expect(m.expectancy).toBe(-0.2);
    expect(m.profitFactor).toBe(0.9);
  });

  it("falls back to backtestSummary when searchableMetrics lacks a field", () => {
    const m = extractCohortMetrics({ n_trades: 40 }, { profit_factor: 0.8, expectancy: -0.1 });
    expect(m.nTrades).toBe(40);
    expect(m.profitFactor).toBe(0.8);
    expect(m.expectancy).toBe(-0.1);
  });

  it("returns null for absent metrics (never fabricates)", () => {
    const m = extractCohortMetrics(null, null);
    expect(m.nTrades).toBeNull();
    expect(m.expectancy).toBeNull();
    expect(m.profitFactor).toBeNull();
  });
});

describe("fade-the-losers-service — classifyDirectionality", () => {
  it("long-only (entry_short sentinel) -> long", () => {
    expect(classifyDirectionality(longOnlyConfig())).toBe("long");
  });

  it("short-only (entry_long sentinel) -> short", () => {
    const c = longOnlyConfig();
    c.direction = "short";
    (c.strategy as Dict).entry_long = "high < low";
    (c.strategy as Dict).entry_short = "close < orl_15m";
    expect(classifyDirectionality(c)).toBe("short");
  });

  it("direction: both -> null (not directional)", () => {
    const c = longOnlyConfig();
    c.direction = "both";
    (c.strategy as Dict).entry_short = "close < orl_15m";
    expect(classifyDirectionality(c)).toBeNull();
  });

  it("both sides active or both sentinel -> null", () => {
    const c = longOnlyConfig();
    (c.strategy as Dict).entry_short = "high < low";
    (c.strategy as Dict).entry_long = "high < low";
    expect(classifyDirectionality(c)).toBeNull();
  });

  it("contradictory (direction=long but only entry_short active) -> null", () => {
    const c = longOnlyConfig();
    c.direction = "long";
    (c.strategy as Dict).entry_long = "high < low"; // long side disabled
    (c.strategy as Dict).entry_short = "close < orl_15m"; // short side active
    expect(classifyDirectionality(c)).toBeNull();
  });
});

// ─── DB-backed tests ────────────────────────────────────────────────────────

describe("fade-the-losers-service — cohort selector + create (pglite)", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await createTestDb();
    await ctx.pg.exec(GRAVEYARD_DDL);
    injectedDb = ctx.db;
    freshPlaybookFile();
  });

  afterEach(async () => {
    await ctx.close();
    injectedDb = null;
  });

  it("SIGNIFICANCE FILTER: skips too-few-trades and non-losers as insufficient_trades", async () => {
    const winnerId = await insertOriginal(ctx.db, { name: "orb_winner_mes_5m" });
    await insertGraveyard(ctx.db, {
      strategyId: winnerId,
      name: "orb_winner_mes_5m",
      searchableMetrics: { n_trades: 200, expectancy: 0.4, profit_factor: 1.6 }, // profitable — not a loser
    });
    const fewId = await insertOriginal(ctx.db, { name: "orb_few_mes_5m" });
    await insertGraveyard(ctx.db, {
      strategyId: fewId,
      name: "orb_few_mes_5m",
      searchableMetrics: { n_trades: 10, expectancy: -0.5, profit_factor: 0.4 }, // loser but < 30 trades
    });

    const sel = await selectFadeCohort({});
    expect(sel.fadeable.length).toBe(0);
    expect(sel.skipped.every((s) => s.reason === "insufficient_trades")).toBe(true);
  });

  it("respects --min-trades override", async () => {
    const id = await insertOriginal(ctx.db, { name: "orb_mid_mes_5m" });
    await insertGraveyard(ctx.db, {
      strategyId: id,
      name: "orb_mid_mes_5m",
      searchableMetrics: { n_trades: 45, expectancy: -0.2, profit_factor: 0.8 },
    });
    // Default (30) → fadeable; min-trades 50 → insufficient.
    expect((await selectFadeCohort({})).fadeable.length).toBe(1);
    expect((await selectFadeCohort({ minTrades: 50 })).fadeable.length).toBe(0);
  });

  it("DEGENERATE DEATHS: skips 0-trade / data / compliance / look-ahead / curve-fit(PBO) / consistency", async () => {
    const degenerateReasons = [
      "zero_trade produced no fills",
      "data_gap NaN in ATR",
      "compliance_block 2% rule breach",
      "look_ahead future leak detected",
      "curve_fit high PBO overfit",
      "frankenstein shuffle failure",
      "consistency 50% concentration block",
    ];
    for (const reason of degenerateReasons) {
      const id = await insertOriginal(ctx.db, { name: `orb_${randomUUID().slice(0, 8)}_mes_5m` });
      await insertGraveyard(ctx.db, {
        strategyId: id,
        name: "deg",
        deathReason: reason,
        // significant loser so ONLY the death reason can cause the skip
        searchableMetrics: { n_trades: 100, expectancy: -0.4, profit_factor: 0.6 },
      });
    }
    const sel = await selectFadeCohort({});
    expect(sel.fadeable.length).toBe(0);
    expect(sel.skipped.length).toBe(degenerateReasons.length);
    expect(sel.skipped.every((s) => s.reason === "degenerate_death")).toBe(true);
  });

  it("REJECTED_BY_GATE: the production catch-all death vocabulary is excluded (non-performance failure)", async () => {
    const id = await insertOriginal(ctx.db, { name: "orb_gaterej_mes_5m" });
    await insertGraveyard(ctx.db, {
      strategyId: id,
      name: "orb_gaterej_mes_5m",
      // buryInGraveyard() collapses every hard-gate rejection into this string.
      deathReason: "rejected_by_gate",
      failureCategory: null,
      searchableMetrics: { n_trades: 100, expectancy: -0.4, profit_factor: 0.6 },
    });
    const sel = await selectFadeCohort({});
    expect(sel.fadeable.length).toBe(0);
    expect(sel.skipped[0].reason).toBe("degenerate_death");
  });

  it("SKIPS already-faded (self source=fade_the_losers) and faded_from-stamped configs", async () => {
    const cfg = longOnlyConfig();
    cfg.faded_from = "some-earlier-origin";
    const id = await insertOriginal(ctx.db, {
      name: "orb_already_fade_mes_5m",
      config: cfg,
      source: "fade_the_losers",
    });
    await insertGraveyard(ctx.db, {
      strategyId: id,
      name: "orb_already_fade_mes_5m",
      dslSnapshot: cfg,
      searchableMetrics: { n_trades: 100, expectancy: -0.4, profit_factor: 0.6 },
    });
    const sel = await selectFadeCohort({});
    expect(sel.fadeable.length).toBe(0);
    expect(sel.skipped.map((s) => s.reason)).toContain("already_faded");
  });

  it("DEDUPE: an origin that already has a fade in `strategies` is skipped as already_faded", async () => {
    const originId = await insertOriginal(ctx.db, { name: "orb_origin_mes_5m" });
    await insertGraveyard(ctx.db, {
      strategyId: originId,
      name: "orb_origin_mes_5m",
      searchableMetrics: { n_trades: 100, expectancy: -0.4, profit_factor: 0.6 },
    });
    // A fade of that origin already exists.
    await insertOriginal(ctx.db, {
      id: randomUUID(),
      name: "orb_origin_mes_5m_fade",
      config: { ...longOnlyConfig(), source: "fade_the_losers", faded_from: originId },
      source: "fade_the_losers",
    });

    const sel = await selectFadeCohort({});
    expect(sel.fadeable.length).toBe(0);
    expect(sel.skipped.map((s) => s.reason)).toContain("already_faded");
  });

  it("SKIPS non-directional (direction: both)", async () => {
    const cfg = longOnlyConfig();
    cfg.direction = "both";
    (cfg.strategy as Dict).entry_short = "close < orl_15m";
    const id = await insertOriginal(ctx.db, { name: "orb_both_mes_5m", config: cfg });
    await insertGraveyard(ctx.db, { strategyId: id, name: "orb_both_mes_5m", dslSnapshot: cfg });
    const sel = await selectFadeCohort({});
    expect(sel.fadeable.length).toBe(0);
    expect(sel.skipped[0].reason).toBe("not_directional");
  });

  it("INTEGRATION: a faded config passes Gate 1 and yields a CANDIDATE via the real gate ladder", async () => {
    const originId = await insertOriginal(ctx.db, { name: "orb_long_loser_mes_5m" });
    await insertGraveyard(ctx.db, { strategyId: originId, name: "orb_long_loser_mes_5m" });

    const result = await runFadeTheLosers({
      dryRun: false,
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.cohortSize).toBe(1);
    expect(result.created.length).toBe(1);
    const c = result.created[0];
    expect(c.status).toBe("created");
    expect(c.strategyId).toBeTruthy();
    expect(c.fadeName).toBe("orb_long_loser_mes_5m_fade");

    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, c.strategyId!));
    expect(row).toBeTruthy();
    expect(row.source).toBe("fade_the_losers");
    expect(row.symbol).toBe("MES");
    expect(row.symbols).toEqual(["MES"]);

    const config = row.config as Dict;
    expect(config.direction).toBe("short"); // inverted
    expect(config.faded_from).toBe(originId); // provenance chain closed
    expect((config.strategy as Dict).entry_short).toBe("close > orh_15m"); // losing long condition, now shorted
    expect((config.strategy as Dict).entry_long).toBe("high < low"); // now-untraded side
    // Framework overlay ran (authoritative): time_stop present, Style C exit_params.
    expect((config.time_stop as Dict).flat_at).toBe("15:55 ET");

    // Playbook registration wired into the same create path.
    const playbookSource = readFileSync(playbookRouterPath, "utf-8");
    expect(playbookSource).toContain("orb_long_loser_mes_5m_fade");

    // fade.candidate_created audit row written.
    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "fade.candidate_created"));
    expect(audits.length).toBe(1);
    expect((audits[0].input as Dict).faded_from).toBe(originId);
  });

  it("REGIME PRESERVED: a non-trending (RANGE_BOUND) original keeps RANGE_BOUND in config AND column AND array", async () => {
    const cfg = longOnlyConfig();
    // Non-trending original: mean-reversion in a range.
    cfg.entry_indicator = "rsi_reversal";
    (cfg as Dict).regime_gate = { enabled: true, preferred_regime: "RANGE_BOUND" };
    (cfg as Dict).preferred_regimes = ["RANGE_BOUND"];
    (cfg.strategy as Dict).entry_long = "rsi_14 < 30";
    const originId = await insertOriginal(ctx.db, { name: "rsi_range_loser_mes_5m", config: cfg });
    await insertGraveyard(ctx.db, { strategyId: originId, name: "rsi_range_loser_mes_5m", dslSnapshot: cfg });

    const result = await runFadeTheLosers({ dryRun: false, playbookRouterPath, skipDslCritic: true });
    expect(result.created.length).toBe(1);
    expect(result.created[0].status).toBe("created");

    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, result.created[0].strategyId!));
    // Column, config field, AND array all agree on the PRESERVED regime — no desync, no flip.
    expect(row.preferredRegime).toBe("RANGE_BOUND");
    expect(row.preferredRegimes).toEqual(["RANGE_BOUND"]);
    const config = row.config as Dict;
    expect((config.regime_gate as Dict).preferred_regime).toBe("RANGE_BOUND");
    // Direction still inverted even though regime is preserved.
    expect(config.direction).toBe("short");
  });

  it("NO-BYPASS: faded strategy is CANDIDATE (bottom of pipeline) and carries NO gate exemption", async () => {
    const originId = await insertOriginal(ctx.db, { name: "orb_nobypass_mes_5m" });
    await insertGraveyard(ctx.db, { strategyId: originId, name: "orb_nobypass_mes_5m" });

    const result = await runFadeTheLosers({ dryRun: false, playbookRouterPath, skipDslCritic: true });
    const c = result.created[0];
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, c.strategyId!));

    // Bottom of the pipeline — must traverse the full battery like anything else.
    expect(row.lifecycleState).toBe("CANDIDATE");

    // Tags: faded_from provenance + fade_the_losers — but NEVER a false
    // "cross-validated" canary (the fade cross-validated nothing) and NEVER a
    // gate-exemption source. No relaxed/exempt path.
    const tags = row.tags ?? [];
    expect(tags).not.toContain("cross-validated");
    expect(tags).toContain("fade_the_losers");
    expect(tags).toContain(`faded_from:${originId}`);
    expect(tags).not.toContain("clone");
    expect(tags).not.toContain("b4_regen");
    expect(tags).not.toContain("evolved");
    // Statistical-honesty tag for corpus-FDR multiple-testing correction.
    expect(row.source).toBe("fade_the_losers");

    // Config carries no exemption / grandfather flag.
    const config = row.config as Dict;
    expect(config.cpcv_exempt).toBeUndefined();
    expect(config.gate_exempt).toBeUndefined();
    expect(config.grandfather_pass).toBeUndefined();
  });

  it("DEDUPE end-to-end: re-running after a create skips the origin (no duplicate fade)", async () => {
    const originId = await insertOriginal(ctx.db, { name: "orb_rerun_mes_5m" });
    await insertGraveyard(ctx.db, { strategyId: originId, name: "orb_rerun_mes_5m" });

    const first = await runFadeTheLosers({ dryRun: false, playbookRouterPath, skipDslCritic: true });
    expect(first.created.length).toBe(1);

    const second = await runFadeTheLosers({ dryRun: false, playbookRouterPath, skipDslCritic: true });
    expect(second.cohortSize).toBe(0);
    expect(second.skipped.map((s) => s.reason)).toContain("already_faded");

    const fades = await ctx.db.select().from(strategies).where(eq(strategies.source, "fade_the_losers"));
    expect(fades.length).toBe(1); // not 2
  });

  it("DRY RUN: reports the plan but writes nothing", async () => {
    const originId = await insertOriginal(ctx.db, { name: "orb_dry_mes_5m" });
    await insertGraveyard(ctx.db, { strategyId: originId, name: "orb_dry_mes_5m" });

    const before = await ctx.db.select().from(strategies);
    const result = await runFadeTheLosers({ dryRun: true, playbookRouterPath, skipDslCritic: true });

    expect(result.created.length).toBe(1);
    expect(result.created[0].status).toBe("dry_run_planned");

    const after = await ctx.db.select().from(strategies);
    expect(after.length).toBe(before.length); // no new rows
    const audits = await ctx.db.select().from(auditLog);
    expect(audits.length).toBe(0); // no audit writes in dry-run
  });
});
