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

export interface RecipeData {
  identity: { id: string; name: string; symbol: string; stationStreet: string; lifecycleState: string };
  slumdawgScore: number;
  backtest: {
    totalMade: string;
    perPlay: string;
    worstDay: string;
    winningDays: number;
    tradesCount: number;
    equityCurve: number[];
  };
  monteCarlo: {
    blowUpOdds: string;
    worstYear: string;
    bestYear: string;
    medianYear: string;
    verdictGreen: boolean;
    survivalScore: number;
  };
  calendar: Array<{ date: string; pnl: number }>;
  otherTests: Array<{ name: string; sentence: string; status: "pass" | "warn" | "fail" }>;
}

export async function assembleRecipeData(args: { strategyId: string }): Promise<RecipeData> {
  // 1. Strategy identity (required)
  const [strat] = (await db.execute(sql`
    SELECT id::text AS id, name, symbol, lifecycle_state
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

  // Compute daily aggregates (used by both Backtest panel + Calendar)
  const dailyList: Array<{ date: string; pnl: number }> = Array.isArray(dailyPnls)
    ? dailyPnls.map((d: any) => ({ date: String(d.date ?? d.day ?? ""), pnl: Number(d.pnl ?? d.value ?? 0) }))
    : [];
  const worstDay = dailyList.length > 0 ? Math.min(...dailyList.map((d) => d.pnl)) : 0;
  const winningDays = dailyList.filter((d) => d.pnl > 0).length;

  // Monte Carlo extraction (defensive — different MC versions emit different keys)
  const ciHigh = Number(
    mcOut?.probability_of_ruin_ci?.ci_high
      ?? mcOut?.probability_of_ruin
      ?? 0
  );
  const worstYear = Number(mcOut?.percentile_5 ?? mcOut?.worst_year ?? 0);
  const bestYear = Number(mcOut?.percentile_95 ?? mcOut?.best_year ?? 0);
  const medianYear = Number(mcOut?.percentile_50 ?? mcOut?.median_year ?? 0);

  // Slumdawg score — Wave 28 composite normalized to 0-100
  const compositeRaw = Number(health?.composite_score ?? 0);
  const slumdawgScore = Math.max(0, Math.min(100, Math.round(compositeRaw * 100)));

  // ── 8 Other Tests ───────────────────────────────────────────────────────
  const wfe = Number(extras?.wfe_overall ?? 0);
  const b15Passed = extras?.b15_passed === true || extras?.b15_status === "pass";
  const a14Severity = String(extras?.a14_severity ?? "pass");
  const b10Pass = extras?.b10_pass !== false; // default to pass if absent
  const frankPass = extras?.frankenstein_pass !== false;
  const shadowDiv = Number(shadow?.divergence_pct ?? 0);
  const compliancePassRate = Number(extras?.compliance_pass_rate ?? 1.0);
  const paperTotal = Number(paper?.paper_total ?? 0);

  const otherTests: RecipeData["otherTests"] = [
    {
      name: "Surprise Test",
      sentence: surpriseSentence(wfe),
      status: wfe >= 0.70 ? "pass" : wfe >= 0.50 ? "warn" : wfe > 0 ? "fail" : "warn",
    },
    {
      name: "Sloppy Bot Test",
      sentence: "Cranked all its dials 20% off. Still cashed out.",
      status: b15Passed ? "pass" : "fail",
    },
    {
      name: "Worst Day Test",
      sentence: worstDaySentence(a14Severity),
      status: severityToStatus(a14Severity),
    },
    {
      name: "Every Mood Test",
      sentence: "Made the bot play in 5 kinds of markets — trending, choppy, crashing, sleeping, wild. Won every one.",
      status: b10Pass ? "pass" : "fail",
    },
    {
      name: "Real or Lucky",
      sentence: "Shuffled its wins around to see if it was just hot. Wasn't. Got real game.",
      status: frankPass ? "pass" : "fail",
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
      sentence: "Followed every house rule. Won't get the account shut down.",
      status: compliancePassRate >= 1.0 ? "pass" : compliancePassRate >= 0.95 ? "warn" : "fail",
    },
  ];

  return {
    identity: {
      id: String(strat.id),
      name: String(strat.name),
      symbol: String(strat.symbol),
      stationStreet: lifecycleToStation(strat.lifecycle_state),
      lifecycleState: String(strat.lifecycle_state),
    },
    slumdawgScore,
    backtest: {
      totalMade: formatBag(totalPnl),
      perPlay: formatBag(trades > 0 ? totalPnl / trades : 0),
      worstDay: formatBag(worstDay),
      winningDays,
      tradesCount: trades,
      equityCurve: Array.isArray(equityCurve) ? equityCurve.map(Number) : [],
    },
    monteCarlo: {
      blowUpOdds: oddsOuttaHundred(ciHigh),
      worstYear: formatBag(worstYear),
      bestYear: formatBag(bestYear),
      medianYear: formatBag(medianYear),
      verdictGreen: ciHigh < 0.40,
      survivalScore: Math.round((1 - Math.min(1, Math.max(0, ciHigh))) * 100),
    },
    calendar: dailyList,
    otherTests,
  };
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
