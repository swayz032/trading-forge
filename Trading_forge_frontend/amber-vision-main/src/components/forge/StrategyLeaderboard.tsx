import { useEffect, useMemo } from "react";
import { ForgeTable } from "./ForgeTable";
import { StatusBadge } from "./StatusBadge";
import { num, dollarsToPoints, CONTRACT_SPECS } from "@/lib/utils";
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

      const startDate = bt ? new Date(bt.startDate) : null;
      const endDate = bt ? new Date(bt.endDate) : null;
      const calendarDays = startDate && endDate
        ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000))
        : 1;
      const tradingDays = Math.max(1, Math.round(calendarDays * 5 / 7));
      const tradesPerDay = totalTrades > 0 ? totalTrades / tradingDays : 0;

      const avgTradePnlDollars = num(bt?.avgTradePnl);
      const avgPtsPerTrade = avgTradePnlDollars !== 0
        ? dollarsToPoints(avgTradePnlDollars, symbol, 1)
        : 0;

      const maxDdDollars = Math.abs(num(bt?.maxDrawdown));
      const maxDdPts = maxDdDollars > 0 ? dollarsToPoints(maxDdDollars, symbol, 1) : 0;

      const isMicro = symbol.startsWith("M");
      const contractsForEval = isMicro ? 15 : 1;
      const daysToPass = computeDaysToPass(Math.abs(avgPtsPerTrade), tradesPerDay, symbol, contractsForEval);

      const crisisPassed = bt?.propCompliance
        ? (bt.propCompliance as any)?.crisisPassed ?? null
        : null;

      const decayScore = bt?.decayAnalysis?.compositeScore ?? null;

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
      if (a.daysToPass != null && b.daysToPass != null) return a.daysToPass - b.daysToPass;
      if (a.daysToPass != null) return -1;
      if (b.daysToPass != null) return 1;
      return b.forgeScore - a.forgeScore;
    });
  }, [strategies, backtests]);

  // Auto-select first row when data loads and nothing is selected
  useEffect(() => {
    if (!selectedId && rows.length > 0) {
      onSelect(rows[0]);
    }
  }, [rows, selectedId, onSelect]);

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
          {row.avgPtsPerTrade > 0 ? row.avgPtsPerTrade.toFixed(1) : "--"}
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
      selectedKey={selectedId ?? undefined}
      maxHeight="calc(100vh - 200px)"
      className="forge-card"
    />
  );
}
