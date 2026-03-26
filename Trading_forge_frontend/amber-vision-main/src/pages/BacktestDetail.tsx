import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, Target, TrendingUp, Shield, Grid3X3, CalendarDays } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { LightweightChart } from "@/components/forge/LightweightChart";
import { ForgeTable } from "@/components/forge/ForgeTable";
import { MatrixHeatmap } from "@/components/forge/MatrixHeatmap";
import { PnLCalendar } from "@/components/forge/PnLCalendar";
import { Pagination } from "@/components/forge/Pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaChart, Area, ScatterChart, Scatter, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useBacktest, useBacktestEquity, useBacktestTrades } from "@/hooks/useBacktests";
import { useStrategies } from "@/hooks/useStrategies";
import { api } from "@/lib/api-client";
import { num } from "@/lib/utils";

/** Adaptive P&L formatter for heatmap cells */
function adaptivePnlFormat(val: number): string {
  const abs = Math.abs(val);
  if (abs < 1) return `$${val.toFixed(2)}`;
  if (abs < 100) return `$${Math.round(val)}`;
  if (abs < 10000) return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${(val / 1000).toFixed(1)}k`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-lg border border-border/30 px-3 py-2">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className="text-sm font-mono font-semibold text-foreground">{payload[0].value?.toFixed?.(2) ?? payload[0].value}</p>
    </div>
  );
};

// Heatmap cell color — adaptive thresholds based on magnitude
function heatColor(val: number | null): string {
  if (val === null) return "hsl(240, 8%, 8.5%)";
  if (val === 0) return "hsl(240, 8%, 8.5%)";
  const abs = Math.abs(val);
  // Use relative intensity: strong > 2000, medium > 500, weak > 0
  if (val > 0) {
    if (abs > 2000) return "hsla(142, 71%, 45%, 0.8)";
    if (abs > 500) return "hsla(142, 71%, 45%, 0.5)";
    return "hsla(142, 71%, 45%, 0.25)";
  }
  // val < 0
  if (abs > 2000) return "hsla(0, 84%, 60%, 0.8)";
  if (abs > 500) return "hsla(0, 84%, 60%, 0.5)";
  return "hsla(0, 84%, 60%, 0.25)";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getSession(utcHour: number): string {
  // ES futures sessions (UTC): Asia 23-06, London 08-13:30, NY RTH 13:30-20, Overnight 20-23
  if (utcHour >= 13 && utcHour < 20) return "NY RTH";
  if (utcHour >= 8 && utcHour < 14) return "London";
  if (utcHour >= 23 || utcHour < 6) return "Asia";
  return "Overnight";
}

export default function BacktestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tradePage, setTradePage] = useState(1);
  const [directionFilter, setDirectionFilter] = useState<"all" | "long" | "short">("all");
  const TRADES_PER_PAGE = 50;

  const { data: backtest, isLoading: btLoading } = useBacktest(id);
  const { data: equityData, isLoading: eqLoading } = useBacktestEquity(id);
  const { data: trades, isLoading: trLoading } = useBacktestTrades(id);
  const { data: strategies } = useStrategies();

  // Matrix heatmap data — fetch by strategyId
  // API returns a single backtestMatrix row with results JSONB, not a raw array
  const { data: matrixRaw } = useQuery({
    queryKey: ["backtests", "matrix", backtest?.strategyId],
    queryFn: () =>
      api.get<{
        id: string;
        results?: Array<{
          symbol: string;
          timeframe: string;
          forgeScore: number;
          sharpe?: number;
          trades?: number;
          pnl?: number;
          status?: string;
        }>;
      }>(`/backtests/matrix?strategyId=${backtest!.strategyId}`),
    enabled: !!backtest?.strategyId,
  });
  const matrixData = matrixRaw?.results ?? [];

  // Look up strategy name
  const strategyName = useMemo(() => {
    if (!backtest || !strategies) return "Strategy";
    const s = strategies.find((s) => s.id === backtest.strategyId);
    return s?.name ?? "Unknown Strategy";
  }, [backtest, strategies]);

  // Equity curve from API — must produce { time: "YYYY-MM-DD", value } for LightweightChart
  const equityCurve = useMemo(() => {
    const raw = equityData?.equityCurve ?? backtest?.equityCurve;
    if (!raw || !Array.isArray(raw)) return [];

    // Timeframe → minutes for computing dates from flat arrays
    const tfMinutes: Record<string, number> = {
      "1min": 1, "5min": 5, "15min": 15, "30min": 30, "1h": 60, "4h": 240, "1D": 1440,
    };
    const barMins = tfMinutes[backtest?.timeframe ?? "15min"] ?? 15;
    const startMs = backtest?.startDate ? new Date(backtest.startDate).getTime() : Date.now();

    // Map raw data to { time, value } with proper dates
    const points: { time: string; value: number }[] = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      let timeStr: string;
      let value: number;

      if (typeof p === "number") {
        // Old flat array — compute date from bar index
        const barDate = new Date(startMs + i * barMins * 60_000);
        timeStr = barDate.toISOString().slice(0, 10);
        value = p;
      } else {
        timeStr = p.time ?? p.date ?? "";
        value = typeof p.value === "number" ? p.value
          : typeof p.equity === "number" ? p.equity
          : num(p.value ?? p.equity);
        // If time is "Day N" or not a valid date, compute from index
        if (!timeStr || timeStr.startsWith("Day") || !timeStr.includes("-")) {
          const barDate = new Date(startMs + i * barMins * 60_000);
          timeStr = barDate.toISOString().slice(0, 10);
        }
      }
      points.push({ time: timeStr, value });
    }

    // Aggregate to daily (last value per day) — intraday bars share dates
    const dailyMap = new Map<string, number>();
    for (const pt of points) {
      dailyMap.set(pt.time, pt.value);
    }
    return Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, value]) => ({ time, value }));
  }, [equityData, backtest]);

  // Derive drawdown from equity curve
  const drawdownData = useMemo(() => {
    if (!equityCurve.length) return [];
    let peak = equityCurve[0].value;
    return equityCurve.map((p) => {
      if (p.value > peak) peak = p.value;
      const dd = peak > 0 ? ((p.value - peak) / peak) * 100 : 0;
      return { date: p.time, drawdown: Math.round(dd * 100) / 100 };
    });
  }, [equityCurve]);

  // MAE/MFE scatter from trades — use explicit fields or estimate from P&L
  const maeMfeData = useMemo(() => {
    if (!trades || !Array.isArray(trades)) return [];
    // First try explicit mae/mfe fields
    const explicit = trades.filter((t) => t.mae != null && t.mfe != null);
    if (explicit.length > 0) {
      return explicit.map((t) => ({
        mae: num(t.mae),
        mfe: num(t.mfe),
        pnl: num(t.pnl),
        profitable: num(t.pnl) > 0,
      }));
    }
    // Fallback: estimate from P&L — for losers, MAE ≈ |pnl|, MFE ≈ small
    // For winners, MAE ≈ small fraction, MFE ≈ pnl. Not perfect but gives a visual sense.
    // MAE/MFE are both positive magnitudes ($ distance from entry).
    return trades
      .filter((t) => t.pnl != null && num(t.pnl) !== 0)
      .map((t) => {
        const pnl = num(t.pnl);
        const isWin = pnl > 0;
        return {
          mae: isWin ? Math.abs(pnl) * 0.2 : Math.abs(pnl),
          mfe: isWin ? Math.abs(pnl) : Math.abs(pnl) * 0.15,
          pnl,
          profitable: isWin,
        };
      });
  }, [trades]);

  // Monthly heatmap — prefer backtest.monthlyReturns JSONB, fallback to computing from trades
  const { monthlyPnl, years } = useMemo(() => {
    let raw = backtest?.monthlyReturns;

    // Fallback: compute monthly P&L from trade exit dates if monthlyReturns is empty
    if ((!raw || !Array.isArray(raw) || raw.length === 0) && trades && Array.isArray(trades) && trades.length > 0) {
      const monthMap = new Map<string, number>();
      for (const t of trades) {
        const exitDate = t.exitTime ? new Date(t.exitTime) : null;
        if (!exitDate || isNaN(exitDate.getTime()) || exitDate.getFullYear() < 1971) continue;
        const key = `${exitDate.getFullYear()}-${exitDate.getMonth()}`;
        monthMap.set(key, (monthMap.get(key) ?? 0) + num(t.pnl));
      }
      raw = Array.from(monthMap.entries()).map(([key, pnl]) => {
        const [year, month] = key.split("-").map(Number);
        return { year, month, pnl: Math.round(pnl * 100) / 100 };
      });
    }

    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return { monthlyPnl: [], years: [] as number[] };
    }
    // Expect array of { year, month, pnl } — month can be string name or 0-indexed number
    const mapped = raw.map((entry: any) => {
      const monthIdx = typeof entry.month === "number"
        ? entry.month
        : MONTHS.indexOf(entry.month);
      return {
        year: entry.year,
        month: MONTHS[monthIdx] ?? entry.month,
        monthIndex: monthIdx,
        pnl: entry.pnl != null ? num(entry.pnl) : null,
      };
    });
    const uniqueYears = [...new Set(mapped.map((e: any) => e.year as number))].sort();
    return { monthlyPnl: mapped, years: uniqueYears };
  }, [backtest, trades]);

  // Trade log for table display
  const tradeRows = useMemo(() => {
    if (!trades || !Array.isArray(trades)) return [];
    return trades.map((t: any) => {
      const entryDate = t.entryTime ? new Date(t.entryTime) : null;
      const exitDate = t.exitTime ? new Date(t.exitTime) : null;
      const fmtDate = (d: Date | null) => d && !isNaN(d.getTime()) && d.getFullYear() > 1971
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "—";
      const fmtTime = (d: Date | null) => d && !isNaN(d.getTime()) && d.getFullYear() > 1971
        ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        : "—";
      const session = entryDate ? getSession(entryDate.getUTCHours()) : "—";
      const holdMins = entryDate && exitDate ? Math.round((exitDate.getTime() - entryDate.getTime()) / 60_000) : null;
      return {
        direction: t.direction,
        entryDate: fmtDate(entryDate),
        entryTime: fmtTime(entryDate),
        exitDate: fmtDate(exitDate),
        exitTime: fmtTime(exitDate),
        entryPrice: num(t.entryPrice) > 0 ? num(t.entryPrice).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—",
        exitPrice: t.exitPrice && num(t.exitPrice) > 0 ? num(t.exitPrice).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—",
        pnl: num(t.pnl),
        contracts: t.contracts ?? 1,
        session,
        holdTime: holdMins ? (holdMins < 60 ? `${holdMins}m` : `${Math.floor(holdMins / 60)}h ${holdMins % 60}m`) : "—",
      };
    });
  }, [trades]);

  // Entry time distribution for chart
  const entryHourDist = useMemo(() => {
    if (!trades || !Array.isArray(trades)) return [];
    const hours: Record<number, { wins: number; losses: number }> = {};
    trades.forEach((t: any) => {
      const d = t.entryTime ? new Date(t.entryTime) : null;
      if (!d || isNaN(d.getTime()) || d.getFullYear() < 1971) return;
      const h = d.getUTCHours();
      if (!hours[h]) hours[h] = { wins: 0, losses: 0 };
      if (num(t.pnl) >= 0) hours[h].wins++;
      else hours[h].losses++;
    });
    return Object.entries(hours)
      .map(([h, v]) => ({ hour: `${h}:00`, wins: v.wins, losses: v.losses, total: v.wins + v.losses }))
      .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));
  }, [trades]);

  // Daily P&Ls for calendar view — aggregate trade P&L by exit date
  const dailyPnls = useMemo(() => {
    if (!trades || !Array.isArray(trades)) return [];
    const dayMap = new Map<string, { pnl: number; trades: number; balance: number }>();
    let runningBalance = 50_000; // starting capital (prop firm default)
    trades.forEach((t: any) => {
      const exitDate = t.exitTime ? new Date(t.exitTime) : null;
      if (!exitDate || isNaN(exitDate.getTime()) || exitDate.getFullYear() < 1971) return;
      const dateStr = exitDate.toISOString().slice(0, 10);
      const pnl = num(t.pnl);
      const existing = dayMap.get(dateStr);
      if (existing) {
        existing.pnl += pnl;
        existing.trades += 1;
      } else {
        dayMap.set(dateStr, { pnl, trades: 1, balance: 0 });
      }
    });
    // Compute running balance in date order
    const sorted = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted.map(([date, data]) => {
      runningBalance += data.pnl;
      return { date, pnl: data.pnl, trades: data.trades, balance: runningBalance };
    });
  }, [trades]);

  // Strategy config details for playbook
  const strategyConfig = useMemo(() => {
    const cfg = backtest?.config as any;
    if (!cfg?.strategy) return null;
    const s = cfg.strategy;
    return {
      entry: s.entry_long ?? "—",
      exit: s.exit ?? "—",
      stopLoss: s.stop_loss ? `${s.stop_loss.type} × ${s.stop_loss.multiplier}` : "—",
      posSize: s.position_size ? `${s.position_size.type}${s.position_size.target_risk_dollars ? ` ($${s.position_size.target_risk_dollars} risk)` : ""}` : "—",
      indicators: (s.indicators ?? []).map((i: any) => `${i.type.toUpperCase()}(${i.period})`).join(", ") || "—",
    };
  }, [backtest]);

  const isLoading = btLoading || eqLoading || trLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted text-sm">Loading backtest data...</div>
      </div>
    );
  }

  if (!backtest) {
    return (
      <div className="space-y-4 max-w-[1400px]">
        <button onClick={() => navigate("/backtests")} className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Backtests
        </button>
        <div className="forge-card p-8 text-center text-text-muted">Backtest not found.</div>
      </div>
    );
  }

  const totalReturnRatio = num(backtest.totalReturn);
  const totalReturnDollars = totalReturnRatio * 50_000; // vectorbt returns ratio, convert to $ (prop firm 50K)
  const sharpeRatio = num(backtest.sharpeRatio);
  const winRate = num(backtest.winRate);
  const profitFactor = num(backtest.profitFactor);
  const maxDrawdown = num(backtest.maxDrawdown);
  const totalTrades = backtest.totalTrades ?? 0;

  const statusVariant = backtest.status === "completed" ? "profit" : backtest.status === "failed" ? "loss" : "warning";

  const period = `${backtest.startDate?.split("T")[0] ?? "?"} — ${backtest.endDate?.split("T")[0] ?? "?"}`;

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <button onClick={() => navigate("/backtests")} className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Backtests
        </button>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">{strategyName}</h1>
          <StatusBadge variant={statusVariant as any} dot>{backtest.status}</StatusBadge>
        </div>
        <p className="text-sm text-text-secondary">{backtest.symbol} · {backtest.timeframe} · {period}</p>
      </motion.div>

      {/* Metric Strip */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }} className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: "P&L", value: `${totalReturnDollars >= 0 ? "+" : ""}$${Math.abs(totalReturnDollars).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, cls: totalReturnDollars >= 0 ? "text-profit" : "text-loss" },
          { label: "Sharpe", value: sharpeRatio.toFixed(2), cls: sharpeRatio >= 1.5 ? "text-profit" : "text-foreground" },
          { label: "Win Rate", value: `${winRate.toFixed(1)}%`, cls: "text-foreground" },
          { label: "Profit Factor", value: profitFactor.toFixed(2), cls: "text-foreground" },
          { label: "Max DD", value: `${maxDrawdown.toFixed(1)}%`, cls: "text-loss" },
          { label: "Trades", value: totalTrades.toString(), cls: "text-foreground" },
        ].map((m, i) => (
          <div key={i} className="forge-card px-4 py-3">
            <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-1">{m.label}</span>
            <span className={`text-sm font-mono font-bold ${m.cls}`}>{m.value}</span>
          </div>
        ))}
      </motion.div>

      {/* Tabs: Details / Matrix */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
        <Tabs defaultValue="details" className="space-y-4">
          <TabsList className="bg-surface-1 border border-border/20 p-1 rounded-lg">
            {[
              { label: "Details", value: "details" },
              { label: "Matrix", value: "matrix", icon: Grid3X3 },
              { label: "Calendar", value: "calendar", icon: CalendarDays },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md px-4 gap-1.5"
              >
                {tab.icon && <tab.icon className="w-3 h-3" />}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-6">

      {/* Account Balance (Lightweight Charts) */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="forge-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-foreground">Account Balance</h2>
          <span className="text-xs text-text-muted font-mono">{equityCurve.length} sessions</span>
        </div>
        {equityCurve.length > 0 ? (
          <LightweightChart type="area" data={equityCurve} height={320} />
        ) : (
          <div className="h-[320px] flex items-center justify-center text-text-muted text-sm">No account balance data</div>
        )}
      </motion.div>

      {/* Drawdown Chart */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }} className="forge-card p-5">
        <h2 className="text-sm font-medium text-foreground mb-4">Drawdown</h2>
        {drawdownData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={drawdownData}>
              <defs>
                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 5%, 14%)" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="drawdown" stroke="hsl(0, 84%, 60%)" strokeWidth={1.5} fill="url(#ddGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">No drawdown data</div>
        )}
      </motion.div>

      {/* Bottom Grid: MAE/MFE + Monthly Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* MAE/MFE Scatter */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }} className="forge-card p-5">
          <h2 className="text-sm font-medium text-foreground mb-1">MAE / MFE Analysis</h2>
          <p className="text-xs text-text-muted mb-4">Maximum Adverse / Favorable Excursion per trade</p>
          {maeMfeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 5%, 14%)" />
                <XAxis type="number" dataKey="mae" name="MAE" axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} tickFormatter={(v) => `$${v}`} label={{ value: "MAE ($)", position: "bottom", fill: "#71717A", fontSize: 10 }} />
                <YAxis type="number" dataKey="mfe" name="MFE" axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} tickFormatter={(v) => `$${v}`} label={{ value: "MFE ($)", angle: -90, position: "insideLeft", fill: "#71717A", fontSize: 10 }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="glass rounded-lg border border-border/30 px-3 py-2 space-y-1">
                      <p className="text-xs text-text-muted">MAE: <span className="font-mono text-loss">${d.mae.toFixed(0)}</span></p>
                      <p className="text-xs text-text-muted">MFE: <span className="font-mono text-profit">${d.mfe.toFixed(0)}</span></p>
                      <p className="text-xs text-text-muted">P&L: <span className={`font-mono ${d.pnl >= 0 ? "text-profit" : "text-loss"}`}>${d.pnl.toFixed(0)}</span></p>
                    </div>
                  );
                }} />
                <Scatter data={maeMfeData} fill="#FFBF00">
                  {maeMfeData.map((entry, i) => (
                    <Cell key={i} fill={entry.profitable ? "#22C55E" : "#EF4444"} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-text-muted text-sm">No MAE/MFE data available</div>
          )}
        </motion.div>

        {/* Monthly P&L Heatmap */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5 }} className="forge-card p-5">
          <h2 className="text-sm font-medium text-foreground mb-1">Monthly P&L Heatmap</h2>
          <p className="text-xs text-text-muted mb-4">Performance by month across years</p>

          {monthlyPnl.length > 0 ? (() => {
            // Check if all values are near-zero (< $1)
            const allNearZero = monthlyPnl.every((c: any) => c.pnl === null || Math.abs(c.pnl) < 1);
            if (allNearZero) {
              return (
                <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">
                  Strategy had minimal activity — monthly P&L values &lt; $1
                </div>
              );
            }
            return (
            <div className="space-y-1">
              {/* Month headers */}
              <div className="grid grid-cols-[60px_repeat(12,1fr)] gap-1">
                <div />
                {MONTHS.map((m) => (
                  <div key={m} className="text-center text-[9px] text-text-muted font-medium uppercase tracking-wider py-1">
                    {m}
                  </div>
                ))}
              </div>

              {/* Year rows */}
              {years.map((year) => (
                <div key={year} className="grid grid-cols-[60px_repeat(12,1fr)] gap-1">
                  <div className="text-xs font-mono text-text-secondary flex items-center">{year}</div>
                  {MONTHS.map((month, mi) => {
                    const cell = monthlyPnl.find((c: any) => c.year === year && c.monthIndex === mi);
                    const val = cell?.pnl ?? null;
                    return (
                      <div
                        key={`${year}-${month}`}
                        className="aspect-square rounded-md flex items-center justify-center text-[9px] font-mono font-medium transition-all duration-200 hover:scale-110 cursor-default group relative"
                        style={{ backgroundColor: heatColor(val) }}
                      >
                        {val !== null ? (
                          <span className={val >= 0 ? "text-profit/90" : "text-loss/90"}>
                            {val >= 0 ? "+" : ""}{adaptivePnlFormat(val)}
                          </span>
                        ) : (
                          <span className="text-text-muted/30">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            );
          })() : (
            <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">No monthly data</div>
          )}

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-border/10">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsla(0, 84%, 60%, 0.5)" }} />
              <span className="text-[10px] text-text-muted">Loss</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(240, 8%, 8.5%)" }} />
              <span className="text-[10px] text-text-muted">Flat</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsla(142, 71%, 45%, 0.5)" }} />
              <span className="text-[10px] text-text-muted">Profit</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Strategy Playbook */}
      {strategyConfig && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5 }} className="forge-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium text-foreground">Strategy Playbook</h2>
            {backtest.tier && (
              <StatusBadge variant={backtest.tier === "TIER_1" ? "profit" : backtest.tier === "TIER_2" ? "amber" : backtest.tier === "TIER_3" ? "neutral" : "loss"} dot>
                {backtest.tier}
              </StatusBadge>
            )}
            {backtest.forgeScore != null && (
              <span className="text-xs font-mono text-primary ml-auto">Forge Score: {num(backtest.forgeScore).toFixed(1)}</span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: TrendingUp, label: "Entry Rule", value: strategyConfig.entry },
              { icon: Shield, label: "Exit Rule", value: strategyConfig.exit },
              { icon: Shield, label: "Stop Loss", value: strategyConfig.stopLoss },
              { icon: Target, label: "Position Sizing", value: strategyConfig.posSize },
              { icon: Clock, label: "Indicators", value: strategyConfig.indicators },
              { icon: Clock, label: "Best Session", value: tradeRows.length > 0 ? tradeRows.filter(t => t.session !== "—").map(t => t.session).reduce((a, b, _, arr) => {
                const counts: Record<string, number> = {};
                arr.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
                return Object.entries(counts).sort(([,a],[,b]) => b - a)[0]?.[0] ?? "—";
              }) : "Insufficient data" },
            ].map((item, i) => (
              <div key={i} className="p-3 rounded-lg bg-surface-0/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <item.icon className="w-3 h-3 text-text-muted" />
                  <span className="text-[10px] uppercase tracking-wider text-text-muted">{item.label}</span>
                </div>
                <p className="text-xs font-mono text-foreground break-all">{item.value}</p>
              </div>
            ))}
          </div>
          {totalTrades > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <p className="text-xs text-text-secondary">
                <span className="text-primary font-medium">How to trade: </span>
                Wait for {strategyConfig.entry} signal on {backtest.symbol} {backtest.timeframe} chart.
                Enter with {strategyConfig.posSize} sizing.
                Stop at {strategyConfig.stopLoss}. Exit on {strategyConfig.exit}.
                {tradeRows.length > 0 && tradeRows[0].session !== "—" && ` Best results during ${tradeRows[0].session} session.`}
                {` Avg P&L per trade: $${num(backtest.avgTradePnl).toFixed(0)}.`}
              </p>
            </div>
          )}
        </motion.div>
      )}

      {/* Trade Log */}
      {tradeRows.length > 0 && (() => {
        const filteredTrades = directionFilter === "all"
          ? tradeRows
          : tradeRows.filter((t) => t.direction === directionFilter);
        const totalFiltered = filteredTrades.length;
        const start = (tradePage - 1) * TRADES_PER_PAGE;
        const paginatedTrades = filteredTrades.slice(start, start + TRADES_PER_PAGE);

        return (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.5 }} className="forge-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-foreground">Trade Log</h2>
            <div className="flex items-center gap-2">
              {(["all", "long", "short"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setDirectionFilter(f); setTradePage(1); }}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                    directionFilter === f
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-text-secondary hover:text-foreground border border-transparent"
                  }`}
                >
                  {f === "all" ? "All" : f === "long" ? "Long" : "Short"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border/20">
                  {["#", "Direction", "Entry Date", "Entry Time", "Entry Price", "Exit Date", "Exit Time", "Exit Price", "P&L", "Contracts", "Session", "Hold Time"].map((h) => (
                    <th key={h} className="text-left text-[10px] uppercase tracking-wider text-text-muted py-2 px-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedTrades.map((t, i) => (
                  <tr key={i} className="border-b border-border/10 hover:bg-surface-0/30 transition-colors">
                    <td className="py-2 px-2 font-mono text-text-muted">{start + i + 1}</td>
                    <td className="py-2 px-2">
                      <StatusBadge variant={t.direction === "long" ? "profit" : "loss"} dot>
                        {t.direction?.toUpperCase()}
                      </StatusBadge>
                    </td>
                    <td className="py-2 px-2 font-mono">{t.entryDate}</td>
                    <td className="py-2 px-2 font-mono text-primary">{t.entryTime}</td>
                    <td className="py-2 px-2 font-mono">{t.entryPrice}</td>
                    <td className="py-2 px-2 font-mono">{t.exitDate}</td>
                    <td className="py-2 px-2 font-mono text-primary">{t.exitTime}</td>
                    <td className="py-2 px-2 font-mono">{t.exitPrice}</td>
                    <td className={`py-2 px-2 font-mono font-semibold ${t.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                      {t.pnl >= 0 ? "+" : ""}${Math.abs(t.pnl).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-2 font-mono">{t.contracts}</td>
                    <td className="py-2 px-2">{t.session}</td>
                    <td className="py-2 px-2 font-mono">{t.holdTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalFiltered > TRADES_PER_PAGE && (
            <Pagination
              page={tradePage}
              pageSize={TRADES_PER_PAGE}
              total={totalFiltered}
              onPageChange={setTradePage}
            />
          )}
        </motion.div>
        );
      })()}

      {/* Entry Hour Distribution */}
      {entryHourDist.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.5 }} className="forge-card p-5">
          <h2 className="text-sm font-medium text-foreground mb-1">Entry Time Distribution</h2>
          <p className="text-xs text-text-muted mb-4">When trades were entered (UTC)</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={entryHourDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 5%, 14%)" />
              <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "hsl(240,10%,6%)", border: "1px solid hsl(240,5%,18%)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="wins" stackId="a" fill="#22C55E" name="Wins" radius={[2, 2, 0, 0]} />
              <Bar dataKey="losses" stackId="a" fill="#EF4444" name="Losses" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}

          </TabsContent>

          {/* Matrix Tab */}
          <TabsContent value="matrix" className="space-y-4">
            {matrixData && matrixData.length > 0 ? (
              <MatrixHeatmap matrixData={matrixData} />
            ) : (
              <div className="forge-card p-8 text-center">
                <Grid3X3 className="w-8 h-8 text-text-muted/40 mx-auto mb-3" />
                <p className="text-sm text-text-muted">No cross-matrix data available</p>
                <p className="text-xs text-text-muted/60 mt-1">Run a 42-combo matrix test to see Forge Scores across symbols × timeframes</p>
              </div>
            )}
          </TabsContent>

          {/* Calendar Tab */}
          <TabsContent value="calendar" className="space-y-4">
            {dailyPnls.length > 0 ? (
              <PnLCalendar dailyPnls={dailyPnls} />
            ) : (
              <div className="forge-card p-8 text-center">
                <CalendarDays className="w-8 h-8 text-text-muted/40 mx-auto mb-3" />
                <p className="text-sm text-text-muted">No daily P&L data available</p>
                <p className="text-xs text-text-muted/60 mt-1">Calendar view requires trade data with valid exit dates</p>
              </div>
            )}
          </TabsContent>

        </Tabs>
      </motion.div>
    </div>
  );
}
