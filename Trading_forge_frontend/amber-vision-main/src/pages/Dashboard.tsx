import { useMemo } from "react";
import { motion } from "framer-motion";
import { MetricCard } from "@/components/forge/MetricCard";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeTable } from "@/components/forge/ForgeTable";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { AlertTriangle, CheckCircle, Info, TrendingUp } from "lucide-react";
import { TradingViewWidget } from "@/components/forge/TradingViewWidget";
import { useStrategies } from "@/hooks/useStrategies";
import { useBacktests } from "@/hooks/useBacktests";
import { useBacktestEquity } from "@/hooks/useBacktests";
import { useBacktestTrades } from "@/hooks/useBacktests";
import { useAlerts } from "@/hooks/useAlerts";
import { useJournalStats } from "@/hooks/useJournal";
import { num, timeAgo, fmtCurrency } from "@/lib/utils";

// === Lifecycle → UI status mapping ===
function mapStatus(lifecycleState: string): "active" | "paused" | "testing" | "retired" {
  switch (lifecycleState) {
    case "DEPLOYED":
    case "PAPER":
      return "active";
    case "DECLINING":
      return "paused";
    case "TESTING":
    case "CANDIDATE":
      return "testing";
    case "RETIRED":
      return "retired";
    default:
      return "testing";
  }
}

const tradeColumns = [
  { key: "instrument", header: "Symbol", sortable: true },
  {
    key: "direction",
    header: "Side",
    render: (row: any) => (
      <StatusBadge variant={row.direction?.toLowerCase() === "long" ? "profit" : "loss"} dot>
        {row.direction?.toUpperCase()}
      </StatusBadge>
    ),
  },
  { key: "entry", header: "Entry", align: "right" as const, mono: true },
  { key: "exit", header: "Exit", align: "right" as const, mono: true },
  {
    key: "pnl",
    header: "P&L",
    align: "right" as const,
    sortable: true,
    mono: true,
    render: (row: any) => (
      <span className={row.pnl >= 0 ? "text-profit" : "text-loss"}>
        {row.pnl >= 0 ? "+" : ""}${Math.abs(row.pnl).toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  { key: "time", header: "Time", align: "right" as const, mono: true },
];

const alertIcons = {
  success: <CheckCircle className="w-3.5 h-3.5 text-profit" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-primary" />,
  info: <Info className="w-3.5 h-3.5 text-info" />,
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass rounded-lg border border-border/30 px-3 py-2">
        <p className="text-xs text-text-muted mb-1">{label}</p>
        <p className="text-sm font-mono font-semibold text-foreground">
          ${payload[0].value.toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  // === Data hooks ===
  const { data: rawStrategies, isLoading: strategiesLoading } = useStrategies();
  const { data: rawBacktests, isLoading: backtestsLoading } = useBacktests();
  const { data: rawAlerts, isLoading: alertsLoading } = useAlerts();
  const { data: journalStats, isLoading: journalLoading } = useJournalStats();

  // Find latest completed backtest for equity curve and trades
  const latestBacktest = useMemo(() => {
    if (!rawBacktests?.length) return null;
    return rawBacktests
      .filter((bt) => bt.status === "completed")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  }, [rawBacktests]);

  const latestBacktestId = latestBacktest?.id;

  const { data: equityResponse } = useBacktestEquity(latestBacktestId);
  const { data: rawTrades } = useBacktestTrades(latestBacktestId);

  // === Derived data ===
  const strategies = useMemo(() => {
    if (!rawStrategies?.length) return [];
    return rawStrategies.map((s) => ({
      name: s.name,
      status: mapStatus(s.lifecycleState),
      score: num(s.forgeScore),
      instrument: s.symbol,
    }));
  }, [rawStrategies]);

  const equityData = useMemo(() => {
    const curve = equityResponse?.equityCurve ?? latestBacktest?.equityCurve;
    if (!curve || !Array.isArray(curve)) return [];

    const tfMinutes: Record<string, number> = {
      "1min": 1, "5min": 5, "15min": 15, "30min": 30, "1h": 60, "4h": 240, "1D": 1440,
    };
    const barMins = tfMinutes[latestBacktest?.timeframe ?? "15min"] ?? 15;
    const startMs = latestBacktest?.startDate ? new Date(latestBacktest.startDate).getTime() : Date.now();

    // Map to { date, value } with computed dates for flat arrays
    const points: { date: string; value: number }[] = [];
    for (let i = 0; i < curve.length; i++) {
      const pt = curve[i];
      let dateStr: string;
      let value: number;

      if (typeof pt === "number") {
        const barDate = new Date(startMs + i * barMins * 60_000);
        dateStr = barDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        value = pt;
      } else {
        const rawDate = pt.date ?? pt.time ?? "";
        value = typeof pt.value === "number" ? pt.value : num(pt.value);
        if (!rawDate || rawDate.startsWith("Day") || !rawDate.includes("-")) {
          const barDate = new Date(startMs + i * barMins * 60_000);
          dateStr = barDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        } else {
          dateStr = new Date(rawDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        }
      }
      points.push({ date: dateStr, value });
    }

    // Aggregate to daily (last value per day) for clean chart
    const dailyMap = new Map<string, number>();
    for (const pt of points) {
      dailyMap.set(pt.date, pt.value);
    }
    return Array.from(dailyMap.entries()).map(([date, value]) => ({ date, value }));
  }, [equityResponse, latestBacktest]);

  const recentTrades = useMemo(() => {
    if (!rawTrades?.length) return [];
    const fmtDate = (d: string | null) => {
      if (!d) return "—";
      try {
        return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      } catch { return "—"; }
    };
    return rawTrades.slice(0, 10).map((t) => ({
      instrument: latestBacktest?.symbol ?? "—",
      direction: t.direction,
      entry: num(t.entryPrice) > 0
        ? num(t.entryPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })
        : "—",
      exit: t.exitPrice && num(t.exitPrice) > 0
        ? num(t.exitPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })
        : "—",
      pnl: num(t.pnl),
      time: fmtDate(t.exitTime ?? t.entryTime),
    }));
  }, [rawTrades, latestBacktest]);

  const alerts = useMemo(() => {
    if (!rawAlerts?.length) return [];
    return rawAlerts.slice(0, 8).map((a) => {
      let type: "warning" | "info" | "success";
      switch (a.severity) {
        case "critical":
        case "warning":
          type = "warning";
          break;
        case "info":
          type = "info";
          break;
        default:
          type = "success";
      }
      return {
        type,
        message: a.message || a.title,
        time: timeAgo(a.createdAt),
      };
    });
  }, [rawAlerts]);

  // === KPI computations ===
  const activeCount = strategies.filter((s) => s.status === "active").length;
  const testingCount = strategies.filter((s) => s.status === "testing").length;
  const totalCount = strategies.length;
  const bestScore = strategies.length
    ? Math.max(...strategies.map((s) => s.score))
    : 0;

  const totalPnl = useMemo(() => {
    if (!rawBacktests?.length) return 0;
    // totalReturn is a ratio from vectorbt (e.g. 0.043 = 4.3%), convert to dollars
    const INITIAL_CAPITAL = 100_000;
    return rawBacktests
      .filter((bt) => bt.status === "completed")
      .reduce((sum, bt) => sum + num(bt.totalReturn) * INITIAL_CAPITAL, 0);
  }, [rawBacktests]);

  const maxDrawdown = useMemo(() => {
    if (!rawBacktests?.length) return 0;
    const dds = rawBacktests
      .filter((bt) => bt.status === "completed" && bt.maxDrawdown != null)
      .map((bt) => num(bt.maxDrawdown));
    return dds.length ? Math.min(...dds) : 0;
  }, [rawBacktests]);

  const equityReturn = useMemo(() => {
    if (equityData.length < 2) return 0;
    const first = equityData[0].value;
    const last = equityData[equityData.length - 1].value;
    if (!first) return 0;
    return ((last - first) / first) * 100;
  }, [equityData]);

  const isLoading = strategiesLoading || backtestsLoading || alertsLoading || journalLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            Command Center
          </h1>
          <p className="text-sm text-text-secondary mt-1">Loading data...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Command Center
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Real-time overview of your trading operations
        </p>
      </motion.div>

      {/* Live Market Ticker */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="rounded-lg overflow-hidden"
      >
        <TradingViewWidget type="ticker-tape" />
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total P&L"
          value={fmtCurrency(totalPnl)}
          change={totalPnl !== 0 ? `${totalPnl >= 0 ? "+" : ""}${(totalPnl / 1000).toFixed(1)}%` : "—"}
          changeType={totalPnl >= 0 ? "profit" : "loss"}
          glow
          delay={0}
        />
        <MetricCard label="Forge Score" value="" delay={0.1}>
          <div className="flex justify-center -mt-2">
            <ForgeScoreRing score={bestScore} size={100} strokeWidth={6} />
          </div>
        </MetricCard>
        <MetricCard
          label="Active Strategies"
          value={`${activeCount} / ${totalCount}`}
          change={testingCount ? `${testingCount} testing` : "—"}
          changeType="neutral"
          delay={0.2}
        />
        <MetricCard
          label="Max Drawdown"
          value={maxDrawdown !== 0 ? `${maxDrawdown.toFixed(1)}%` : "—"}
          change={maxDrawdown !== 0 ? fmtCurrency(maxDrawdown * 1000) : "—"}
          changeType="loss"
          delay={0.3}
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Equity Curve — spans 2 cols */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="lg:col-span-2 forge-card p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-medium text-foreground">Equity Curve</h2>
              <p className="text-xs text-text-muted mt-0.5">Portfolio performance YTD</p>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-profit" />
              <span className="text-sm font-mono font-semibold text-profit">
                {equityReturn !== 0 ? `${equityReturn >= 0 ? "+" : ""}${equityReturn.toFixed(1)}%` : "—"}
              </span>
            </div>
          </div>
          {equityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="amberGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(45, 100%, 50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(45, 100%, 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 5%, 14%)" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(240, 4%, 46%)", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(240, 4%, 46%)", fontSize: 11 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(45, 100%, 50%)"
                  strokeWidth={2}
                  fill="url(#amberGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-sm text-text-muted">
              No equity data yet
            </div>
          )}
        </motion.div>

        {/* Strategy Status */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="forge-card p-5"
        >
          <h2 className="text-sm font-medium text-foreground mb-4">Strategy Status</h2>
          <div className="space-y-3">
            {strategies.length > 0 ? (
              strategies.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface-0/50 hover:bg-surface-2/30 transition-colors duration-200"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-primary">{s.instrument}</span>
                      <StatusBadge
                        variant={
                          s.status === "active" ? "profit" : s.status === "paused" ? "amber" : "info"
                        }
                        dot
                      >
                        {s.status}
                      </StatusBadge>
                    </div>
                    <p className="text-sm text-foreground truncate">{s.name}</p>
                  </div>
                  <div className="flex flex-col items-center ml-3">
                    <span className="text-lg font-mono font-bold text-foreground">{s.score}</span>
                    <span className="text-[9px] text-text-muted uppercase">Score</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted text-center py-4">No strategies yet</p>
            )}
          </div>
        </motion.div>
      </div>

      {/* Bottom grid: Trades + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Trades */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="lg:col-span-2 forge-card p-5"
        >
          <h2 className="text-sm font-medium text-foreground mb-4">Recent Trades</h2>
          {recentTrades.length > 0 ? (
            <ForgeTable columns={tradeColumns} data={recentTrades} />
          ) : (
            <p className="text-sm text-text-muted text-center py-4">No trades yet</p>
          )}
        </motion.div>

        {/* Alerts Feed */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="forge-card p-5"
        >
          <h2 className="text-sm font-medium text-foreground mb-4">Alerts</h2>
          <div className="space-y-2">
            {alerts.length > 0 ? (
              alerts.map((alert, i) => (
                <div
                  key={i}
                  className="flex gap-3 p-3 rounded-lg hover:bg-surface-0/50 transition-colors duration-200"
                >
                  <div className="mt-0.5 shrink-0">
                    {alertIcons[alert.type as keyof typeof alertIcons]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-relaxed">{alert.message}</p>
                    <p className="text-[10px] text-text-muted mt-1">{alert.time}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted text-center py-4">No alerts</p>
            )}
          </div>
        </motion.div>
      </div>

      {/* Live Market Overview */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="forge-card p-5"
      >
        <h2 className="text-sm font-medium text-foreground mb-4">Market Overview</h2>
        <TradingViewWidget type="market-overview" height={500} />
      </motion.div>
    </div>
  );
}
