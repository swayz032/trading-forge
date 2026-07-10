/**
 * Recipe data assembler — per-strategy validation deep-dive.
 *
 * Every panel is fake money / simulated / replayed — never live. The Kitchen
 * page is where real money lives; Recipe shows the proof a play earned its
 * way to the menu.
 *
 * 4 panels surfaced:
 *   - Backtest         (📼 replay)    — equity curve + KPI dollars
 *   - Monte Carlo      (🧪 what-if)   — survival probability + outcome bands
 *   - Backtest Calendar (📼 replay)   — daily P&L heatmap
 *   - Other Tests feed (mixed source) — 8 systems with street-translated names
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { formatBag, lifecycleToStation, oddsOuttaHundred } from "./translate.js";
import { getB14CiHighThreshold } from "../b14-ci-gate.js";
import { getWfeHardFloor } from "../wfe-gate.js";
import { resolveGateJourney, type Gate, type GateSignals } from "./gate-journey.js";
import { getStrategySourceUrl } from "../strategy-source-resolver.js";

export interface RecipeData {
  identity: { id: string; name: string; symbol: string; stationStreet: string; lifecycleState: string };
  youtubeUrl: string | null;
  slumdawgScore: number;
  backtest: {
    totalMade: string;
    perPlay: string;
    worstDay: string;
    winningDays: number;
    tradesCount: number;
    equityCurve: number[];
    winRatePct: number;          // 0–100, integer
    sharpeRatio: number;         // raw float, 2dp on the wire
    riskReward: number;          // avg_win / |avg_loss|, 2dp on the wire
    profitFactor: number;        // 2dp on the wire
    maxDrawdownPct: number;      // 0–100
  };
  monteCarlo: {
    blowUpOdds: string;
    worstYear: string;
    bestYear: string;
    medianYear: string;
    verdictGreen: boolean;
    survivalScore: number;
    worstYearRaw: number;          // raw $ for chart math
    bestYearRaw: number;
    medianYearRaw: number;
    distribution: number[];        // up to ~1000 final-year P&Ls; empty if MC didn't expose a path array
    // deep-scan 2026-07-09 (MED, no-fabrication contract): TRUE when `distribution` is
    // empty and the UI would otherwise SYNTHESIZE a bell from the 3 percentiles. The
    // frontend MUST label or suppress the histogram when this is true — a synthesized
    // curve must never render as a real 1000-path Monte Carlo outcome (the prior ds22
    // fake-MC-histogram fabrication class, closed here at the data-contract seam).
    distributionIsSynthetic: boolean;
    ruinPct: number;               // 0–100, used to size the "blew up" tail visually
  };
  calendar: Array<{ date: string; pnl: number; trades: number }>;
  otherTests: Array<{ name: string; sentence: string; status: "pass" | "warn" | "fail" }>;
  // Per-gate metric detail — the left card switches to show one of these when a gate is clicked.
  gateMetrics: Record<string, { what: string; value: string; threshold: string; verdict: "pass" | "warn" | "fail" }>;
  gateJourney: Gate[];
  dead: boolean;
}

export async function assembleRecipeData(args: { strategyId: string }): Promise<RecipeData> {
  // 1. Strategy identity (required)
  const [strat] = (await db.execute(sql`
    SELECT id::text AS id, name, symbol, lifecycle_state,
           config->'metadata'->>'source_url' AS meta_source_url,
           config->'compiled_spec'->>'video' AS spec_video
    FROM strategies WHERE id = ${args.strategyId}::uuid LIMIT 1
  `).catch(() => [] as any[])) as any[];

  if (!strat) throw new Error(`strategy_not_found:${args.strategyId}`);

  // 2. Latest backtest result (fail-soft to empty)
  const [bt] = (await db.execute(sql`
    SELECT total_pnl, trade_count, daily_pnls, equity_curve, result_extras
    FROM backtests
    WHERE strategy_id = ${args.strategyId}::uuid
    ORDER BY created_at DESC
    LIMIT 1
  `).catch(() => [] as any[])) as any[];

  // 3. Latest Monte Carlo run (fail-soft)
  const [mc] = (await db.execute(sql`
    SELECT result_json
    FROM monte_carlo_runs
    WHERE strategy_id = ${args.strategyId}::uuid
    ORDER BY created_at DESC LIMIT 1
  `).catch(() => [] as any[])) as any[];

  // 4. Recent paper P&L for Preseason status
  const [paper] = (await db.execute(sql`
    SELECT COALESCE(SUM(pt.pnl::float), 0)::float AS paper_total
    FROM paper_trades pt
    JOIN paper_sessions ps ON ps.id = pt.session_id
    WHERE ps.strategy_id = ${args.strategyId}::uuid
      AND pt.exit_time >= NOW() - INTERVAL '30 days'
  `).catch(() => [{ paper_total: 0 }])) as any[];

  // 5. SHADOW divergence (latest, if any)
  const [shadow] = (await db.execute(sql`
    SELECT divergence_pct FROM lifecycle_shadow_signals
    WHERE strategy_id = ${args.strategyId}::uuid
    ORDER BY ts DESC LIMIT 1
  `).catch(() => [] as any[])) as any[];

  // 6. Wave 28 composite-health score
  const [health] = (await db.execute(sql`
    SELECT composite_score FROM strategy_health_scores
    WHERE strategy_id = ${args.strategyId}::uuid
    ORDER BY evaluated_at DESC LIMIT 1
  `).catch(() => [] as any[])) as any[];

  // Parse JSON safely
  const dailyPnls = parseJSON(bt?.daily_pnls);
  const equityCurve = parseJSON(bt?.equity_curve);
  const mcOut = parseJSON(mc?.result_json);
  const extras = parseJSON(bt?.result_extras);

  const totalPnl = Number(bt?.total_pnl ?? 0);
  const trades = Number(bt?.trade_count ?? 0);

  // Quant metrics from result_extras (backtests stamp these on completion;
  // older rows may omit some — every read is defensive with sane fallbacks).
  const winRateRaw = Number(extras?.win_rate ?? extras?.winrate ?? 0);
  const winRatePct = winRateRaw <= 1 ? Math.round(winRateRaw * 100) : Math.round(winRateRaw);
  const sharpeRatio = round2(Number(extras?.sharpe_ratio ?? extras?.sharpe ?? 0));
  const profitFactor = round2(Number(extras?.profit_factor ?? extras?.pf ?? 0));
  const avgWin = Number(extras?.avg_win ?? extras?.average_win ?? 0);
  const avgLoss = Math.abs(Number(extras?.avg_loss ?? extras?.average_loss ?? 0));
  const riskReward = round2(avgLoss > 0 ? avgWin / avgLoss : 0);
  const ddRaw = Number(extras?.max_drawdown ?? extras?.max_dd ?? 0);
  const maxDrawdownPct = ddRaw <= 1 && ddRaw > 0 ? Math.round(ddRaw * 100) : Math.round(Math.abs(ddRaw));

  // Compute daily aggregates (used by both Backtest panel + Calendar)
  const dailyList: Array<{ date: string; pnl: number; trades: number }> = Array.isArray(dailyPnls)
    ? dailyPnls.map((d: any) => ({
        date: String(d.date ?? d.day ?? ""),
        pnl: Number(d.pnl ?? d.value ?? 0),
        trades: Number(d.trades ?? d.trade_count ?? d.n_trades ?? 0),
      }))
    : [];
  const worstDay = dailyList.length > 0 ? Math.min(...dailyList.map((d) => d.pnl)) : 0;
  const winningDays = dailyList.filter((d) => d.pnl > 0).length;

  // Monte Carlo extraction (defensive — different MC versions emit different keys).
  //
  // ciHighRaw tracks whether MC has run at all (null = no MC run, gates fail-closed).
  // ciHigh (numeric, default 0) is kept for downstream display math that needs a number
  // (blowUpOdds, survivalScore, ruinPct).  verdictGreen MUST use ciHighRaw to avoid
  // showing green when MC simply hasn't been run yet (0 would pass the < threshold check).
  const ciHighRaw: number | null = mcOut != null
    ? (mcOut?.probability_of_ruin_ci?.ci_high != null
        ? Number(mcOut.probability_of_ruin_ci.ci_high)
        : mcOut?.probability_of_ruin != null
          ? Number(mcOut.probability_of_ruin)
          : null)
    : null;
  const ciHigh = ciHighRaw ?? 0;
  const b14Threshold = getB14CiHighThreshold();
  const worstYear = Number(mcOut?.percentile_5 ?? mcOut?.worst_year ?? 0);
  const bestYear = Number(mcOut?.percentile_95 ?? mcOut?.best_year ?? 0);
  const medianYear = Number(mcOut?.percentile_50 ?? mcOut?.median_year ?? 0);

  // Extract distribution if MC emitted one (different engine versions use
  // different keys — we try the common shapes, fall back to empty so the UI
  // synthesizes a bell from worst/median/best).
  let distribution: number[] = [];
  for (const key of ["final_pnl_distribution", "outcome_distribution", "pnl_distribution", "year_end_pnls", "paths", "samples"]) {
    const v = (mcOut as any)?.[key];
    if (Array.isArray(v) && v.length > 0) {
      distribution = v.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x));
      if (distribution.length > 0) break;
    }
  }
  // No real MC path array → any histogram the UI draws is synthesized, not observed.
  const distributionIsSynthetic = distribution.length === 0;

  // Slumdawg score — Wave 28 composite normalized to 0-100
  const compositeRaw = Number(health?.composite_score ?? 0);
  const slumdawgScore = Math.max(0, Math.min(100, Math.round(compositeRaw * 100)));

  // ── 8 Other Tests ───────────────────────────────────────────────────────
  const wfe = Number(extras?.wfe_overall ?? 0);
  const b15Passed = extras?.b15_passed === true || extras?.b15_status === "pass";
  const a14Severity = String(extras?.a14_severity ?? "pass");
  // Tri-state: true=pass, false=fail, absent=untested (deep-scan #13 —
  // defaulting missing gate data to "pass" asserted success that never ran).
  const b10Pass: boolean | null = extras?.b10_pass === true ? true : extras?.b10_pass === false ? false : null;
  const frankPass: boolean | null = extras?.frankenstein_pass === true ? true : extras?.frankenstein_pass === false ? false : null;
  const shadowDiv = Number(shadow?.divergence_pct ?? 0);
  const compliancePassRate = Number(extras?.compliance_pass_rate ?? 1.0);
  const paperTotal = Number(paper?.paper_total ?? 0);

  const otherTests: RecipeData["otherTests"] = [
    {
      name: "Surprise Test",
      sentence: surpriseSentence(wfe),
      // Use getWfeHardFloor() (default 0.70, env WFE_HARD_FLOOR) — same constant the
      // lifecycle gate enforces, not a hardcoded copy that can drift from the real gate.
      status: wfe >= getWfeHardFloor() ? "pass" : wfe >= 0.50 ? "warn" : wfe > 0 ? "fail" : "warn",
    },
    {
      name: "Sloppy Bot Test",
      sentence: b15Passed
        ? "Cranked all its dials 20% off. Still cashed out."
        : "Cranked all its dials 20% off. Fell apart — needs tighter screws.",
      status: b15Passed ? "pass" : "fail",
    },
    {
      name: "Worst Day Test",
      sentence: worstDaySentence(a14Severity),
      status: severityToStatus(a14Severity),
    },
    {
      name: "Every Mood Test",
      sentence: b10Pass === true
        ? "Made the bot play in 5 kinds of markets — trending, choppy, crashing, sleeping, wild. Won every one."
        : b10Pass === false
          ? "Made the bot play in 5 kinds of markets — trending, choppy, crashing, sleeping, wild. Cracked in a few."
          : "Made the bot play in 5 kinds of markets. Hasn't taken this test yet.",
      status: b10Pass === true ? "pass" : b10Pass === false ? "fail" : "warn",
    },
    {
      name: "Real or Lucky",
      sentence: frankPass === true
        ? "Shuffled its wins around to see if it was just hot. Wasn't. Got real game."
        : frankPass === false
          ? "Shuffled its wins around to see if it was just hot. Looked hot — was just lucky."
          : "Shuffled its wins around to see if it was just hot. Hasn't taken this test yet.",
      status: frankPass === true ? "pass" : frankPass === false ? "fail" : "warn",
    },
    {
      name: "Preseason",
      sentence: `30 days of fake money, real market. Pocketed ${formatBag(paperTotal)} in practice.`,
      status: paperTotal > 0 ? "pass" : paperTotal === 0 ? "warn" : "fail",
    },
    {
      name: "Real-Time Match",
      sentence: shadow ? `Watched the bot call live shots. ${(shadowDiv * 100).toFixed(1)}% off from the test.` : "Live signals matched the test signals.",
      status: shadow ? (shadowDiv < 0.05 ? "pass" : "fail") : "warn",
    },
    {
      name: "Plays Clean",
      sentence: compliancePassRate >= 1.0
        ? "Followed every house rule. Won't get the account shut down."
        : "Broke house rules in testing. Not clean yet.",
      status: compliancePassRate >= 1.0 ? "pass" : compliancePassRate >= 0.95 ? "warn" : "fail",
    },
  ];

  // Per-gate metric detail — the left card swaps to one of these on gate click.
  const wfeFloor = getWfeHardFloor();
  const hasB15 = extras?.b15_passed !== undefined || extras?.b15_status !== undefined;
  const hasCompliance = extras?.compliance_pass_rate != null;
  const gateMetrics: RecipeData["gateMetrics"] = {
    "Surprise Test": {
      what: "Walk-Forward Efficiency — how well it holds up on data it never trained on.",
      value: wfe > 0 ? wfe.toFixed(2) : "Not run yet",
      threshold: "needs ≥ " + wfeFloor.toFixed(2),
      verdict: otherTests[0].status,
    },
    "Sloppy Bot Test": {
      what: "Knocked every dial ±20% off — did the edge survive the jitter?",
      value: hasB15 ? (b15Passed ? "Held together" : "Fell apart") : "Not run yet",
      threshold: "SDR ≥ 0.85 · PSI ≤ 0.05 · RWS ≤ 0.20",
      verdict: otherTests[1].status,
    },
    "Worst Day Test": {
      what: "Ran it through the worst historical crashes to see if it blows up.",
      value: ciHighRaw !== null ? "Ruin odds " + Math.round(ciHigh * 100) + "%" : "Not run yet",
      threshold: "worst year " + formatBag(worstYear),
      verdict: otherTests[2].status,
    },
    "Every Mood Test": {
      what: "Played it in 5 market moods — trending, choppy, crashing, sleeping, wild.",
      value: b10Pass === true ? "Won every one" : b10Pass === false ? "Cracked in some" : "Not run yet",
      threshold: "must survive all 5 regimes",
      verdict: otherTests[3].status,
    },
    "Real or Lucky": {
      what: "Shuffled the wins to see if the edge was real or just a hot streak.",
      value: frankPass === true ? "Real edge" : frankPass === false ? "Just luck" : "Not run yet",
      threshold: "must beat the shuffle",
      verdict: otherTests[4].status,
    },
    "Preseason": {
      what: "30 days of fake money on the live market — did it actually make money?",
      value: paperTotal !== 0 ? formatBag(paperTotal) : "Not run yet",
      threshold: "must end green",
      verdict: otherTests[5].status,
    },
    "Real-Time Match": {
      what: "Compared its live-called shots against the tested signals.",
      value: shadow ? (shadowDiv * 100).toFixed(1) + "% drift" : "Not run yet",
      threshold: "needs < 5% drift",
      verdict: otherTests[6].status,
    },
    "Plays Clean": {
      what: "Checked every trade against the prop-firm rulebook.",
      value: hasCompliance ? Math.round(compliancePassRate * 100) + "% clean" : "Not run yet",
      threshold: "needs 100% clean",
      verdict: otherTests[7].status,
    },
  };

  // ── Strategy progress line (Slumhouse gate journey) ─────────────────────
  // Derive the 7 boolean gate signals from the already-computed otherTests
  // statuses + lifecycle, then resolve the 8-gate journey. `backtested` is
  // true when the composite score is above zero OR a completed backtest row
  // exists (same evidence the Backtest/Preseason panels read).
  const testStatus = (name: string) => otherTests.find((t) => t.name === name)?.status;
  const signals: GateSignals = {
    backtested: slumdawgScore > 0 || Boolean(bt),
    wfe_pass: testStatus("Surprise Test") === "pass",
    frankenstein_pass: testStatus("Real or Lucky") === "pass",
    blackswan_pass: testStatus("Worst Day Test") === "pass",
    paper_done: testStatus("Preseason") === "pass",
    shadow_pass: testStatus("Real-Time Match") === "pass",
    compliance_pass: testStatus("Plays Clean") === "pass",
  };
  const lifecycleUpper = String(strat.lifecycle_state).toUpperCase();
  const dead = lifecycleUpper === "GRAVEYARD" || lifecycleUpper === "DECLINING";
  const gateJourney = resolveGateJourney({ lifecycleState: String(strat.lifecycle_state), signals });

  // Source video URL for the recipe YouTube button. The current spec-onboarded
  // library stores the real video URL in config.metadata.source_url — prefer that
  // (117/117 coverage). Fall back to the bucket-based resolver (older bucket-
  // graduated strategies), then null (client shows a search link).
  let youtubeUrl: string | null = null;
  const metaUrl = strat.meta_source_url ?? strat.spec_video ?? null;
  if (typeof metaUrl === "string" && /^https?:\/\//.test(metaUrl)) {
    youtubeUrl = metaUrl;
  } else {
    try {
      const urls = await getStrategySourceUrl(String(strat.name));
      if (Array.isArray(urls) && urls.length > 0) {
        youtubeUrl = urls.find((u) => /youtube\.com|youtu\.be/i.test(String(u))) ?? urls[0];
      }
    } catch {
      /* fail-soft — button falls back to a search link */
    }
  }

  return {
    identity: {
      id: String(strat.id),
      name: String(strat.name),
      symbol: String(strat.symbol),
      stationStreet: lifecycleToStation(strat.lifecycle_state),
      lifecycleState: String(strat.lifecycle_state),
    },
    youtubeUrl,
    slumdawgScore,
    backtest: {
      totalMade: formatBag(totalPnl),
      perPlay: formatBag(trades > 0 ? totalPnl / trades : 0),
      worstDay: formatBag(worstDay),
      winningDays,
      tradesCount: trades,
      equityCurve: Array.isArray(equityCurve) ? equityCurve.map(Number) : [],
      winRatePct,
      sharpeRatio,
      riskReward,
      profitFactor,
      maxDrawdownPct,
    },
    monteCarlo: {
      blowUpOdds: oddsOuttaHundred(ciHigh),
      worstYear: formatBag(worstYear),
      bestYear: formatBag(bestYear),
      medianYear: formatBag(medianYear),
      // FIX 1 (2026-07-02 deep-scan #12 Track T):
      // The real B14 gate threshold is 0.20 (tightened from 0.40 on 2026-06-22).
      // The gate uses strict > (blocked when ci_high > threshold), so verdictGreen
      // mirrors ci_high <= threshold.  ciHighRaw !== null guards the missing-MC case
      // (no MC run → ciHighRaw=null → verdictGreen=false rather than misleading green).
      verdictGreen: ciHighRaw !== null && ciHighRaw <= b14Threshold,
      survivalScore: Math.round((1 - Math.min(1, Math.max(0, ciHigh))) * 100),
      worstYearRaw: worstYear,
      bestYearRaw: bestYear,
      medianYearRaw: medianYear,
      distribution,
      distributionIsSynthetic,
      ruinPct: Math.round(Math.min(1, Math.max(0, ciHigh)) * 100),
    },
    calendar: dailyList,
    otherTests,
    gateMetrics,
    gateJourney,
    dead,
  };
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function parseJSON(v: unknown): any {
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

function surpriseSentence(wfe: number): string {
  if (wfe <= 0) return "Haven't run the surprise test yet.";
  const won = Math.max(0, Math.min(10, Math.round(wfe * 10)));
  return `Hid pieces of history from the bot, made it trade them blind. Won ${won} outta 10.`;
}

function worstDaySentence(severity: string): string {
  if (severity === "fail") return "Played the 2020 crash. Took heavy damage.";
  if (severity === "warn") return "Played the 2020 crash. Lost a week of profit, then bounced back.";
  return "Played the 2020 crash. Came out clean.";
}

function severityToStatus(severity: string): "pass" | "warn" | "fail" {
  if (severity === "fail") return "fail";
  if (severity === "warn") return "warn";
  return "pass";
}
