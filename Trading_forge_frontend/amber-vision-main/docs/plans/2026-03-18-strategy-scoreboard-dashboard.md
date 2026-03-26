# Strategy Scoreboard Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-strategy Command Center with a hybrid Leaderboard + Spotlight dashboard that answers "which strategy passes eval fastest, survives all firms, and is market-proof."

**Architecture:** Left 2/3 is a sortable `ForgeTable` leaderboard (one row per strategy with its latest backtest metrics in points). Right 1/3 is a Spotlight panel that updates when a row is clicked — shows cumulative P&L (points), all-firm progression grid, crisis results, decay status, and last 10 trades. Top bar is 4 slim global KPIs. All data comes from existing hooks (`useStrategies`, `useBacktests`, `useBacktestTrades`, `usePaperTrades`, `useFirms`, `useDecayDashboard`). No new API endpoints needed.

**Tech Stack:** React 18, TypeScript, recharts (bar chart), ForgeTable, StatusBadge, MetricCard, framer-motion, TailwindCSS (existing forge design system)

**Key domain rules:**
- Futures P&L is in **points**, not dollars. Points = `(exit - entry)` for longs, `(entry - exit)` for shorts.
- Dollar P&L = `points × pointValue × contracts`. Point values: ES=$50, NQ=$20, CL=$1000, MES=$5, MNQ=$2.
- A real strategy passes ALL 8 prop firms. Tightest firm (Topstep $2K DD) is the benchmark.
- User does 1-2 trades/day, 10+ points/trade minimum. More trades = overtrading signal.
- Days to pass = `profitTarget / (avgPtsPerTrade × pointValue × contractsPerTrade × tradesPerDay)`.
- Micro contracts (MES/MNQ) use 15 contracts standard.

---

### Task 1: Add CONTRACT_SPECS to frontend utils

**Files:**
- Modify: `src/lib/utils.ts`

**Step 1: Add contract specs constant and points helpers**

Add to `src/lib/utils.ts`:

```typescript
/** Futures contract specifications — point values for P&L conversion */
export const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  ES:  { tickSize: 0.25, tickValue: 12.50, pointValue: 50.00 },
  NQ:  { tickSize: 0.25, tickValue: 5.00,  pointValue: 20.00 },
  CL:  { tickSize: 0.01, tickValue: 10.00, pointValue: 1000.00 },
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
};

/** Convert dollar P&L to points for a given symbol and contract count */
export function dollarsToPoints(dollarPnl: number, symbol: string, contracts: number = 1): number {
  const spec = CONTRACT_SPECS[symbol.toUpperCase()] ?? CONTRACT_SPECS["ES"];
  if (contracts === 0) return 0;
  return dollarPnl / (spec.pointValue * contracts);
}

/** Convert points to dollars */
export function pointsToDollars(points: number, symbol: string, contracts: number = 1): number {
  const spec = CONTRACT_SPECS[symbol.toUpperCase()] ?? CONTRACT_SPECS["ES"];
  return points * spec.pointValue * contracts;
}

/** Format points with sign */
export function fmtPoints(pts: number): string {
  return `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts`;
}
```

**Step 2: Verify build**

Run: `cd Trading_forge_frontend/amber-vision-main && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/utils.ts
git commit -m "feat: add CONTRACT_SPECS and points conversion helpers to frontend utils"
```

---

### Task 2: Create the StrategyLeaderboard component

**Files:**
- Create: `src/components/forge/StrategyLeaderboard.tsx`

This is the left 2/3 panel — a `ForgeTable` with one row per strategy, showing its latest backtest metrics converted to points.

**Step 1: Create the component**

```tsx
import { useMemo } from "react";
import { ForgeTable } from "./ForgeTable";
import { StatusBadge } from "./StatusBadge";
import { num, dollarsToPoints, fmtPoints, CONTRACT_SPECS } from "@/lib/utils";
import type { Strategy, Backtest } from "@/types/api";

export interface LeaderboardRow {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  forgeScore: number;
  avgPtsPerTrade: number;
  tradesPerDay: number;
  winRate: number;
  maxDdPts: number;
  daysToPass: number | null;
  evalStatus: string;
  crisisPassed: boolean | null;
  decayScore: number | null;
  // Raw data for spotlight
  strategyId: string;
  backtestId: string | null;
  tier: string | null;
}

interface Props {
  strategies: Strategy[];
  backtests: Backtest[];
  selectedId: string | null;
  onSelect: (row: LeaderboardRow) => void;
}

/** Tightest firm profit target — Topstep 50K = $3,000 */
const TIGHTEST_PROFIT_TARGET = 3000;

function computeDaysToPass(avgPtsPerTrade: number, tradesPerDay: number, symbol: string, contracts: number): number | null {
  if (avgPtsPerTrade <= 0 || tradesPerDay <= 0) return null;
  const spec = CONTRACT_SPECS[symbol.toUpperCase()] ?? CONTRACT_SPECS["ES"];
  const dailyDollars = avgPtsPerTrade * spec.pointValue * contracts * tradesPerDay;
  if (dailyDollars <= 0) return null;
  return Math.ceil(TIGHTEST_PROFIT_TARGET / dailyDollars);
}

export function StrategyLeaderboard({ strategies, backtests, selectedId, onSelect }: Props) {
  const rows = useMemo(() => {
    // Map latest completed backtest per strategy
    const latestBt = new Map<string, Backtest>();
    const completed = backtests.filter((bt) => bt.status === "completed");
    for (const bt of completed) {
      const key = bt.strategyId;
      const existing = latestBt.get(key);
      if (!existing || new Date(bt.createdAt) > new Date(existing.createdAt)) {
        latestBt.set(key, bt);
      }
    }

    return strategies.map((s): LeaderboardRow => {
      const bt = latestBt.get(s.id);
      const symbol = s.symbol || "ES";
      const totalTrades = bt?.totalTrades ?? 0;

      // Compute trading days from backtest date range
      const startDate = bt ? new Date(bt.startDate) : null;
      const endDate = bt ? new Date(bt.endDate) : null;
      const calendarDays = startDate && endDate
        ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000))
        : 1;
      // Rough trading days = calendar days * 5/7
      const tradingDays = Math.max(1, Math.round(calendarDays * 5 / 7));

      const tradesPerDay = totalTrades > 0 ? totalTrades / tradingDays : 0;

      // Avg P&L per trade in dollars → convert to points
      const avgTradePnlDollars = num(bt?.avgTradePnl);
      // Assume 1 contract for backtest results (backtester already accounts for position sizing)
      const avgPtsPerTrade = avgTradePnlDollars !== 0
        ? dollarsToPoints(avgTradePnlDollars, symbol, 1)
        : 0;

      // Max DD in points
      const maxDdDollars = Math.abs(num(bt?.maxDrawdown));
      const maxDdPts = maxDdDollars > 0
        ? dollarsToPoints(maxDdDollars, symbol, 1)
        : 0;

      // Days to pass — use 15 micros standard for MES/MNQ, 1 contract for full-size
      const isMicro = symbol.startsWith("M");
      const contractsForEval = isMicro ? 15 : 1;
      const daysToPass = computeDaysToPass(Math.abs(avgPtsPerTrade), tradesPerDay, symbol, contractsForEval);

      // Crisis and decay from walkForwardResults
      const crisisPassed = bt?.propCompliance
        ? (bt.propCompliance as any)?.crisisPassed ?? null
        : null;

      const decayScore = (bt as any)?.decayAnalysis?.compositeScore ?? null;

      // Eval status from lifecycle
      const evalStatus = s.lifecycleState === "DEPLOYED" ? "FUNDED"
        : s.lifecycleState === "PAPER" ? "PAPER"
        : s.lifecycleState === "TESTING" ? "EVAL"
        : s.lifecycleState === "CANDIDATE" ? "SCOUTED"
        : s.lifecycleState;

      return {
        id: s.id,
        name: s.name,
        symbol,
        timeframe: s.timeframe,
        forgeScore: num(s.forgeScore),
        avgPtsPerTrade: Math.round(avgPtsPerTrade * 10) / 10,
        tradesPerDay: Math.round(tradesPerDay * 10) / 10,
        winRate: num(bt?.winRate) * 100,
        maxDdPts: Math.round(maxDdPts * 10) / 10,
        daysToPass,
        evalStatus,
        crisisPassed,
        decayScore,
        strategyId: s.id,
        backtestId: bt?.id ?? null,
        tier: bt?.tier ?? null,
      };
    }).sort((a, b) => {
      // Sort: strategies with daysToPass first (ascending), then by forgeScore desc
      if (a.daysToPass != null && b.daysToPass != null) return a.daysToPass - b.daysToPass;
      if (a.daysToPass != null) return -1;
      if (b.daysToPass != null) return 1;
      return b.forgeScore - a.forgeScore;
    });
  }, [strategies, backtests]);

  const columns = [
    {
      key: "name",
      header: "Strategy",
      render: (row: LeaderboardRow) => (
        <div>
          <span className="text-foreground font-medium">{row.name}</span>
          <span className="text-text-muted text-[10px] ml-1.5">{row.symbol} · {row.timeframe}</span>
        </div>
      ),
    },
    {
      key: "forgeScore",
      header: "Score",
      sortable: true,
      align: "right" as const,
      mono: true,
      render: (row: LeaderboardRow) => (
        <span className={row.forgeScore >= 70 ? "text-profit" : row.forgeScore >= 50 ? "text-primary" : "text-text-muted"}>
          {row.forgeScore > 0 ? row.forgeScore.toFixed(0) : "--"}
        </span>
      ),
    },
    {
      key: "avgPtsPerTrade",
      header: "Pts/Trade",
      sortable: true,
      align: "right" as const,
      mono: true,
      render: (row: LeaderboardRow) => (
        <span className={row.avgPtsPerTrade >= 10 ? "text-profit" : row.avgPtsPerTrade > 0 ? "text-primary" : "text-text-muted"}>
          {row.avgPtsPerTrade > 0 ? `${row.avgPtsPerTrade.toFixed(1)}` : "--"}
        </span>
      ),
    },
    {
      key: "tradesPerDay",
      header: "Trades/Day",
      sortable: true,
      align: "right" as const,
      mono: true,
      render: (row: LeaderboardRow) => (
        <span className={row.tradesPerDay > 3 ? "text-loss" : row.tradesPerDay > 0 ? "text-foreground" : "text-text-muted"}>
          {row.tradesPerDay > 0 ? row.tradesPerDay.toFixed(1) : "--"}
        </span>
      ),
    },
    {
      key: "winRate",
      header: "Win %",
      sortable: true,
      align: "right" as const,
      mono: true,
      render: (row: LeaderboardRow) => (
        <span className={row.winRate >= 60 ? "text-profit" : row.winRate > 0 ? "text-foreground" : "text-text-muted"}>
          {row.winRate > 0 ? `${row.winRate.toFixed(0)}%` : "--"}
        </span>
      ),
    },
    {
      key: "maxDdPts",
      header: "Max DD",
      sortable: true,
      align: "right" as const,
      mono: true,
      render: (row: LeaderboardRow) => (
        <span className="text-loss">
          {row.maxDdPts > 0 ? `-${row.maxDdPts.toFixed(1)} pts` : "--"}
        </span>
      ),
    },
    {
      key: "daysToPass",
      header: "Days to Pass",
      sortable: true,
      align: "right" as const,
      mono: true,
      render: (row: LeaderboardRow) => (
        <span className={
          row.daysToPass != null && row.daysToPass <= 7 ? "text-profit font-semibold" :
          row.daysToPass != null && row.daysToPass <= 14 ? "text-primary" :
          row.daysToPass != null ? "text-foreground" : "text-text-muted"
        }>
          {row.daysToPass != null ? `${row.daysToPass}d` : "--"}
        </span>
      ),
    },
    {
      key: "evalStatus",
      header: "Status",
      render: (row: LeaderboardRow) => {
        const variant = row.evalStatus === "FUNDED" ? "profit"
          : row.evalStatus === "PAPER" ? "info"
          : row.evalStatus === "EVAL" ? "amber"
          : "neutral";
        return <StatusBadge variant={variant} dot>{row.evalStatus}</StatusBadge>;
      },
    },
    {
      key: "robust",
      header: "Robust",
      align: "center" as const,
      render: (row: LeaderboardRow) => {
        const crisisColor = row.crisisPassed === true ? "bg-profit" : row.crisisPassed === false ? "bg-loss" : "bg-text-muted/30";
        const decayColor = row.decayScore != null
          ? (row.decayScore > 60 ? "bg-loss" : row.decayScore > 30 ? "bg-primary" : "bg-profit")
          : "bg-text-muted/30";
        return (
          <div className="flex items-center justify-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${crisisColor}`} title={`Crisis: ${row.crisisPassed ?? "N/A"}`} />
            <span className={`w-2 h-2 rounded-full ${decayColor}`} title={`Decay: ${row.decayScore ?? "N/A"}`} />
          </div>
        );
      },
    },
  ];

  return (
    <ForgeTable
      columns={columns}
      data={rows}
      onRowClick={onSelect}
      maxHeight="calc(100vh - 200px)"
      className="forge-card"
    />
  );
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/forge/StrategyLeaderboard.tsx
git commit -m "feat: add StrategyLeaderboard component with points-based metrics"
```

---

### Task 3: Create the StrategySpotlight component

**Files:**
- Create: `src/components/forge/StrategySpotlight.tsx`

Right 1/3 panel — shows selected strategy details: cumulative P&L (points), all-firm grid, crisis results, decay status, last 10 trades.

**Step 1: Create the component**

```tsx
import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { Shield, AlertTriangle, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { num, dollarsToPoints, fmtPoints, CONTRACT_SPECS } from "@/lib/utils";
import { useFirms } from "@/hooks/usePropFirm";
import type { Backtest, BacktestTrade } from "@/types/api";
import type { LeaderboardRow } from "./StrategyLeaderboard";

interface Props {
  row: LeaderboardRow | null;
  backtest: Backtest | null;
  trades: BacktestTrade[];
}

/** All 8 firm configs for the firm grid — profit target and DD limit for 50K accounts */
const FIRM_CONFIGS: { name: string; display: string; profitTarget: number; ddLimit: number }[] = [
  { name: "topstep",  display: "Topstep",       profitTarget: 3000, ddLimit: 2000 },
  { name: "mffu",     display: "MFFU",          profitTarget: 3000, ddLimit: 2500 },
  { name: "tpt",      display: "TPT",           profitTarget: 3000, ddLimit: 2500 },
  { name: "apex",     display: "Apex",          profitTarget: 3000, ddLimit: 2500 },
  { name: "ffn",      display: "FFN",           profitTarget: 3000, ddLimit: 2500 },
  { name: "alpha",    display: "Alpha Futures",  profitTarget: 3000, ddLimit: 2500 },
  { name: "tradeify", display: "Tradeify",      profitTarget: 3000, ddLimit: 2500 },
  { name: "e2t",      display: "Earn2Trade",    profitTarget: 3000, ddLimit: 2500 },
];

export function StrategySpotlight({ row, backtest, trades }: Props) {
  if (!row) {
    return (
      <div className="forge-card p-6 flex items-center justify-center h-full min-h-[400px]">
        <p className="text-sm text-text-muted">Select a strategy to view details</p>
      </div>
    );
  }

  const symbol = row.symbol || "ES";
  const spec = CONTRACT_SPECS[symbol.toUpperCase()] ?? CONTRACT_SPECS["ES"];

  // Daily P&L bars in points
  const dailyPnlBars = useMemo(() => {
    if (!trades.length) {
      // Fall back to backtest dailyPnls if available
      if (backtest?.dailyPnls && Array.isArray(backtest.dailyPnls)) {
        return backtest.dailyPnls.slice(-30).map((pnl: number, i: number) => ({
          day: `D${i + 1}`,
          pts: dollarsToPoints(pnl, symbol, 1),
        }));
      }
      return [];
    }

    // Group trades by day, sum P&L, convert to points
    const dayMap = new Map<string, number>();
    for (const t of trades) {
      const d = (t.exitTime ?? t.entryTime)?.slice(0, 10);
      if (d) {
        dayMap.set(d, (dayMap.get(d) ?? 0) + num(t.pnl));
      }
    }

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, dollarPnl]) => ({
        day: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        pts: dollarsToPoints(dollarPnl, symbol, 1),
      }));
  }, [trades, backtest, symbol]);

  // Firm grid — can this strategy pass each firm?
  const firmGrid = useMemo(() => {
    const maxDdDollars = Math.abs(num(backtest?.maxDrawdown));
    // Convert maxDD: if < 1 it's ratio, if < 100 it's percentage, else dollars
    const ddDollars = maxDdDollars < 1 ? maxDdDollars * 50000
      : maxDdDollars <= 100 ? (maxDdDollars / 100) * 50000
      : maxDdDollars;

    const isMicro = symbol.startsWith("M");
    const contracts = isMicro ? 15 : 1;

    return FIRM_CONFIGS.map((firm) => {
      const passes = ddDollars < firm.ddLimit;
      const daysToPass = row.daysToPass != null
        ? Math.ceil(firm.profitTarget / (FIRM_CONFIGS[0].profitTarget / row.daysToPass))
        : null;

      return {
        ...firm,
        passes,
        ddDollars: Math.round(ddDollars),
        daysToPass,
      };
    });
  }, [backtest, row, symbol]);

  // Crisis results from backtest
  const crisisResults = useMemo(() => {
    const cr = (backtest as any)?.crisisResults ?? (backtest?.walkForwardResults as any)?.crisis_results;
    if (!cr || !Array.isArray(cr)) return null;
    return cr as Array<{ name: string; passed: boolean; max_drawdown?: number; pnl?: number }>;
  }, [backtest]);

  // Decay analysis
  const decayAnalysis = useMemo(() => {
    return (backtest as any)?.decayAnalysis ?? null;
  }, [backtest]);

  // Last 10 trades with points
  const recentTrades = useMemo(() => {
    return trades
      .filter((t) => t.exitTime)
      .sort((a, b) => new Date(b.exitTime!).getTime() - new Date(a.exitTime!).getTime())
      .slice(0, 10)
      .map((t) => {
        const entryP = num(t.entryPrice);
        const exitP = num(t.exitPrice);
        const isShort = t.direction?.toLowerCase().includes("short");
        const pts = isShort ? (entryP - exitP) : (exitP - entryP);
        return {
          direction: isShort ? "SHORT" : "LONG",
          entry: entryP,
          exit: exitP,
          pts: Math.round(pts * 100) / 100,
          contracts: t.contracts,
          time: t.exitTime ? new Date(t.exitTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "--",
        };
      });
  }, [trades]);

  const DailyPnlTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const pts = payload[0].value;
      return (
        <div className="glass rounded-lg border border-border/30 px-3 py-2">
          <p className="text-xs text-text-muted">{payload[0].payload.day}</p>
          <p className={`text-sm font-mono font-semibold ${pts >= 0 ? "text-profit" : "text-loss"}`}>
            {fmtPoints(pts)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={row.id}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.25 }}
        className="forge-card p-5 space-y-5 overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 160px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">{row.name}</h2>
            <span className="text-xs text-text-muted">{row.symbol} · {row.timeframe}</span>
          </div>
          <div className="flex items-center gap-2">
            {row.tier && (
              <StatusBadge variant={row.tier === "TIER_1" ? "profit" : row.tier === "TIER_2" ? "amber" : "info"}>
                {row.tier.replace("_", " ")}
              </StatusBadge>
            )}
            <span className="text-lg font-mono font-bold text-primary">{row.forgeScore > 0 ? row.forgeScore.toFixed(0) : "--"}</span>
          </div>
        </div>

        {/* Daily P&L Bars (points) */}
        <div>
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Daily P&L (points)</h3>
          {dailyPnlBars.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={dailyPnlBars}>
                <XAxis dataKey="day" tick={false} axisLine={false} />
                <YAxis hide />
                <Tooltip content={<DailyPnlTooltip />} />
                <ReferenceLine y={0} stroke="hsl(240, 5%, 20%)" />
                <Bar dataKey="pts" radius={[2, 2, 0, 0]}>
                  {dailyPnlBars.map((d, i) => (
                    <Cell key={i} fill={d.pts >= 0 ? "hsl(142, 70%, 45%)" : "hsl(0, 70%, 50%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-text-muted text-center py-4">No daily data</p>
          )}
        </div>

        {/* All-Firm Progression Grid */}
        <div>
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            <Shield className="w-3 h-3 inline mr-1" />
            Firm Progression (all 8)
          </h3>
          <div className="space-y-1">
            {firmGrid.map((f) => (
              <div
                key={f.name}
                className={`flex items-center justify-between px-3 py-1.5 rounded text-[11px] ${
                  f.passes ? "bg-surface-0/50" : "bg-loss/5 border border-loss/20"
                }`}
              >
                <span className={f.passes ? "text-foreground" : "text-loss"}>{f.display}</span>
                <div className="flex items-center gap-3 font-mono">
                  <span className="text-text-muted">${f.profitTarget.toLocaleString()}</span>
                  <span className={f.ddDollars > f.ddLimit ? "text-loss" : "text-text-muted"}>
                    DD ${f.ddDollars.toLocaleString()} / ${f.ddLimit.toLocaleString()}
                  </span>
                  <span className={
                    f.daysToPass != null && f.daysToPass <= 7 ? "text-profit font-semibold" :
                    f.daysToPass != null ? "text-foreground" : "text-text-muted"
                  }>
                    {f.daysToPass != null ? `${f.daysToPass}d` : "--"}
                  </span>
                  <span className={`w-2 h-2 rounded-full ${f.passes ? "bg-profit" : "bg-loss"}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Crisis Results */}
        {crisisResults && (
          <div>
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              Crisis Stress Test
            </h3>
            <div className="grid grid-cols-2 gap-1">
              {crisisResults.map((cr, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-surface-0/30 text-[10px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${cr.passed ? "bg-profit" : "bg-loss"}`} />
                  <span className="text-foreground truncate">{cr.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Decay Status */}
        {decayAnalysis && (
          <div>
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              <Clock className="w-3 h-3 inline mr-1" />
              Alpha Decay
            </h3>
            <div className="flex items-center gap-4 text-xs">
              <div>
                <span className="text-text-muted">Composite: </span>
                <span className={`font-mono font-semibold ${
                  decayAnalysis.compositeScore > 60 ? "text-loss" :
                  decayAnalysis.compositeScore > 30 ? "text-primary" : "text-profit"
                }`}>
                  {decayAnalysis.compositeScore?.toFixed(0) ?? "--"}
                </span>
              </div>
              {decayAnalysis.halfLifeDays != null && (
                <div>
                  <span className="text-text-muted">Half-life: </span>
                  <span className="font-mono text-foreground">{decayAnalysis.halfLifeDays}d</span>
                </div>
              )}
              <div>
                <span className="text-text-muted">Trend: </span>
                {decayAnalysis.trend === "improving" ? (
                  <TrendingUp className="w-3 h-3 inline text-profit" />
                ) : decayAnalysis.trend === "declining" ? (
                  <TrendingDown className="w-3 h-3 inline text-loss" />
                ) : (
                  <span className="text-foreground">Stable</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Last 10 Trades */}
        <div>
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Last 10 Trades</h3>
          {recentTrades.length > 0 ? (
            <div className="space-y-1">
              {recentTrades.map((t, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded bg-surface-0/30 text-[11px]">
                  <div className="flex items-center gap-2">
                    <StatusBadge variant={t.direction === "LONG" ? "profit" : "loss"} className="text-[9px] px-1.5 py-0.5">
                      {t.direction}
                    </StatusBadge>
                    <span className="font-mono text-text-muted">{t.entry.toFixed(2)} → {t.exit.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-mono font-semibold ${t.pts >= 0 ? "text-profit" : "text-loss"}`}>
                      {t.pts >= 0 ? "+" : ""}{t.pts.toFixed(1)} pts
                    </span>
                    <span className="text-text-muted">{t.time}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted text-center py-4">No trades</p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/forge/StrategySpotlight.tsx
git commit -m "feat: add StrategySpotlight component with firm grid, crisis, decay, trades"
```

---

### Task 4: Rewrite Dashboard.tsx with the new layout

**Files:**
- Modify: `src/pages/Dashboard.tsx` (full rewrite)

**Step 1: Replace Dashboard.tsx**

Replace the entire file content with:

```tsx
import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, Shield, Zap, Clock } from "lucide-react";
import { TradingViewWidget } from "@/components/forge/TradingViewWidget";
import { StrategyLeaderboard } from "@/components/forge/StrategyLeaderboard";
import { StrategySpotlight } from "@/components/forge/StrategySpotlight";
import { useStrategies } from "@/hooks/useStrategies";
import { useBacktests, useBacktestTrades } from "@/hooks/useBacktests";
import type { LeaderboardRow } from "@/components/forge/StrategyLeaderboard";
import { num } from "@/lib/utils";

// === Session helpers ===
function getETTime(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function getSessionIndicator(): { label: string; color: string } {
  const et = getETTime();
  const h = et.getHours();
  const m = et.getMinutes();
  const dayOfWeek = et.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return { label: "MARKET CLOSED", color: "text-text-muted" };
  const timeMinutes = h * 60 + m;
  if (timeMinutes >= 570 && timeMinutes < 960) return { label: "RTH OPEN", color: "text-profit" };
  if (timeMinutes >= 480 && timeMinutes < 570) return { label: "PRE-MARKET", color: "text-primary" };
  if (timeMinutes >= 1080 || timeMinutes < 480) return { label: "OVERNIGHT", color: "text-info" };
  return { label: "MARKET CLOSED", color: "text-text-muted" };
}

function formatETTime(): string {
  const et = getETTime();
  return et.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Dashboard() {
  // Session clock
  const [etTime, setEtTime] = useState(formatETTime());
  const [session, setSession] = useState(getSessionIndicator());

  useEffect(() => {
    const interval = setInterval(() => {
      setEtTime(formatETTime());
      setSession(getSessionIndicator());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Data hooks
  const { data: strategies, isLoading: strategiesLoading } = useStrategies();
  const { data: backtests, isLoading: backtestsLoading } = useBacktests();

  // Selected strategy for spotlight
  const [selectedRow, setSelectedRow] = useState<LeaderboardRow | null>(null);

  // Fetch trades for selected strategy's backtest
  const { data: selectedTrades } = useBacktestTrades(selectedRow?.backtestId ?? undefined);

  // Find the full backtest object for spotlight
  const selectedBacktest = useMemo(() => {
    if (!selectedRow?.backtestId || !backtests) return null;
    return backtests.find((bt) => bt.id === selectedRow.backtestId) ?? null;
  }, [selectedRow, backtests]);

  // Global KPIs
  const globalKpis = useMemo(() => {
    const strats = strategies ?? [];
    const bts = backtests ?? [];

    const activeCount = strats.filter((s) => ["PAPER", "DEPLOYED"].includes(s.lifecycleState)).length;
    const testingCount = strats.filter((s) => ["TESTING", "CANDIDATE"].includes(s.lifecycleState)).length;

    // Worst DD across all latest backtests
    const completed = bts.filter((bt) => bt.status === "completed");
    const latestBt = new Map<string, typeof completed[0]>();
    for (const bt of completed) {
      const key = bt.strategyId;
      const existing = latestBt.get(key);
      if (!existing || new Date(bt.createdAt) > new Date(existing.createdAt)) {
        latestBt.set(key, bt);
      }
    }
    const dds = Array.from(latestBt.values()).map((bt) => Math.abs(num(bt.maxDrawdown)));
    const worstDd = dds.length > 0 ? Math.max(...dds) : 0;
    // Normalize: if < 1 it's ratio, if < 100 percentage, else dollars
    const worstDdDollars = worstDd < 1 ? worstDd * 50000 : worstDd <= 100 ? (worstDd / 100) * 50000 : worstDd;
    const worstDdPct = (worstDdDollars / 2000) * 100; // vs tightest firm (Topstep $2K)

    // Best forge score
    const scores = strats.map((s) => num(s.forgeScore)).filter((s) => s > 0);
    const bestScore = scores.length > 0 ? Math.max(...scores) : 0;

    return { activeCount, testingCount, total: strats.length, worstDdPct, worstDdDollars, bestScore };
  }, [strategies, backtests]);

  const isLoading = strategiesLoading || backtestsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1600px]">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Command Center</h1>
          <p className="text-sm text-text-secondary mt-1">Loading data...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1600px]">
      {/* Top Bar */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">Command Center</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wider ${session.color}`}>
                {session.label}
              </span>
              <span className="text-xs font-mono text-text-muted">{etTime} ET</span>
            </div>
          </div>

          {/* Global KPIs — compact */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs">
              <Activity className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Strategies:</span>
              <span className="font-mono text-foreground">{globalKpis.activeCount}</span>
              <span className="text-text-muted">/</span>
              <span className="font-mono text-text-muted">{globalKpis.testingCount}</span>
              <span className="text-[10px] text-text-muted">active/testing</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Shield className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Worst DD:</span>
              <span className={`font-mono ${globalKpis.worstDdPct > 75 ? "text-loss" : globalKpis.worstDdPct > 50 ? "text-primary" : "text-profit"}`}>
                {globalKpis.worstDdPct.toFixed(0)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Zap className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Best Score:</span>
              <span className="font-mono text-primary">{globalKpis.bestScore > 0 ? globalKpis.bestScore.toFixed(0) : "--"}</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Market Ticker */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.1 }} className="rounded-lg overflow-hidden">
        <TradingViewWidget type="ticker-tape" />
      </motion.div>

      {/* Main Content: Leaderboard + Spotlight */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Leaderboard — 2/3 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="lg:col-span-2"
        >
          <StrategyLeaderboard
            strategies={strategies ?? []}
            backtests={backtests ?? []}
            selectedId={selectedRow?.id ?? null}
            onSelect={setSelectedRow}
          />
        </motion.div>

        {/* Spotlight — 1/3 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <StrategySpotlight
            row={selectedRow}
            backtest={selectedBacktest}
            trades={selectedTrades ?? []}
          />
        </motion.div>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Build production bundle**

Run: `npx vite build`
Expected: Build succeeds

**Step 4: Verify in browser**

Open http://localhost:4000 — should show:
- Slim top bar with session, strategy counts, worst DD, best score
- Market ticker
- Leaderboard table with strategy rows (sortable)
- Clicking a row shows Spotlight panel

**Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat: rewrite Dashboard as strategy scoreboard with leaderboard + spotlight"
```

---

### Task 5: Highlight selected row in leaderboard

**Files:**
- Modify: `src/components/forge/StrategyLeaderboard.tsx`
- Modify: `src/components/forge/ForgeTable.tsx`

The ForgeTable already supports `onRowClick` but doesn't visually highlight the selected row. Add a `selectedKey` prop.

**Step 1: Add selectedKey to ForgeTable**

In `ForgeTable.tsx`, add `selectedKey` to props interface:

```tsx
interface ForgeTableProps<T> {
  // ... existing props
  selectedKey?: string;
}
```

And in the `<tr>` className, add highlight when selected:

```tsx
className={cn(
  "border-b border-border/10 hover:bg-surface-1/50 transition-colors duration-150",
  onRowClick && "cursor-pointer",
  selectedKey && (row.id ?? row.key) === selectedKey && "bg-primary/10 border-l-2 border-l-primary"
)}
```

**Step 2: Pass selectedKey from StrategyLeaderboard**

In `StrategyLeaderboard.tsx`, pass `selectedKey={selectedId ?? undefined}` to `ForgeTable`.

**Step 3: Verify build and visual**

Run: `npx vite build`
Expected: Build succeeds. Clicking a row in the leaderboard highlights it with a primary-colored left border.

**Step 4: Commit**

```bash
git add src/components/forge/ForgeTable.tsx src/components/forge/StrategyLeaderboard.tsx
git commit -m "feat: highlight selected row in ForgeTable"
```

---

### Task 6: Load real firm data from API in spotlight

**Files:**
- Modify: `src/components/forge/StrategySpotlight.tsx`

Replace the hardcoded `FIRM_CONFIGS` with data from `useFirms()` + `useFirmAccount()`. The current hardcoded values are placeholders — real profit targets and DD limits vary per firm.

**Step 1: Wire up useFirms hook**

The `useFirms()` hook is already imported. Modify the component to:

1. Call `const { data: firmsData } = useFirms();`
2. Replace `FIRM_CONFIGS` mapping with `firmsData` when available
3. For each firm, call the `/prop-firm/firms/{name}/50k` endpoint data to get real `profitTarget`, `maxDrawdown`

Since we can't call hooks in a loop, fetch all firm details via a single query. Add a new hook `useAllFirmAccounts()` to `usePropFirm.ts`:

```typescript
export function useAllFirmAccounts() {
  const { data: firms } = useFirms();
  return useQuery({
    queryKey: ["prop-firm", "all-accounts"],
    queryFn: async () => {
      if (!firms?.length) return [];
      const results = await Promise.all(
        firms.map((f) => api.get<FirmAccountDetail>(`/prop-firm/firms/${f.name}/50k`))
      );
      return results;
    },
    enabled: !!firms?.length,
  });
}
```

Use this in Spotlight instead of hardcoded configs.

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/hooks/usePropFirm.ts src/components/forge/StrategySpotlight.tsx
git commit -m "feat: load real firm configs in spotlight from API"
```

---

## Verification Checklist

After all tasks complete:

1. `npx tsc --noEmit` — zero TS errors
2. `npx vite build` — builds successfully
3. Browser at http://localhost:4000:
   - Top bar: session status, ET clock, strategy counts, worst DD %, best score
   - Leaderboard: all strategies listed with Pts/Trade, Trades/Day, Win%, Max DD, Days to Pass, Status, Robust dots
   - Default sort: Days to Pass ascending (fastest fund first)
   - Clicking row highlights it and loads Spotlight
   - Spotlight: Daily P&L bars (points), all-firm grid with pass/fail, crisis results, decay status, last 10 trades in points
4. Sorting works on all sortable columns
5. No console errors
