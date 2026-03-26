import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { Pagination } from "@/components/forge/Pagination";
import { Activity, TrendingDown, Clock, AlertTriangle, Heart } from "lucide-react";
import { useDecayDashboard } from "@/hooks/useDecay";
import { num, timeAgo } from "@/lib/utils";

interface DecayStrategy {
  id: string;
  name: string;
  rollingSharpe30d: number | string | null;
  halfLifeDays: number | string | null;
  decayRate: number | string | null;
  status: string;
  lastUpdated: string;
}

function sharpeColor(sharpe: number): string {
  if (sharpe >= 1.5) return "hsl(142,71%,45%)";
  if (sharpe >= 1.0) return "hsl(45,100%,50%)";
  return "hsl(0,84%,60%)";
}

function sharpeTextClass(sharpe: number): string {
  if (sharpe >= 1.5) return "text-profit";
  if (sharpe >= 1.0) return "text-primary";
  return "text-loss";
}

function statusVariant(status: string): "profit" | "amber" | "loss" | "neutral" {
  const s = status?.toUpperCase();
  if (s === "HEALTHY") return "profit";
  if (s === "WARNING") return "amber";
  if (s === "CRITICAL") return "loss";
  return "neutral";
}

const PAGE_SIZE = 25;

export default function DecayDashboard() {
  const { data, isLoading } = useDecayDashboard();
  const [page, setPage] = useState(1);

  const strategies: DecayStrategy[] = useMemo(() => {
    if (!data?.strategies || !Array.isArray(data.strategies)) return [];
    return data.strategies;
  }, [data]);

  // Paginated strategies for the table
  const paginatedStrategies = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return strategies.slice(start, start + PAGE_SIZE);
  }, [strategies, page]);

  const kpis = useMemo(() => {
    const total = strategies.length;
    const healthy = strategies.filter((s) => num(s.rollingSharpe30d) >= 1.5).length;
    const warning = strategies.filter((s) => {
      const v = num(s.rollingSharpe30d);
      return v >= 1.0 && v < 1.5;
    }).length;
    const critical = strategies.filter((s) => num(s.rollingSharpe30d) < 1.0).length;

    return [
      { icon: Activity, label: "Total Monitored", value: total, variant: "foreground" as const },
      { icon: Heart, label: "Healthy", value: healthy, variant: "profit" as const },
      { icon: AlertTriangle, label: "Warning", value: warning, variant: "amber" as const },
      { icon: TrendingDown, label: "Critical", value: critical, variant: "loss" as const },
    ];
  }, [strategies]);

  const chartData = useMemo(() => {
    return strategies.map((s) => ({
      name: s.name,
      sharpe: num(s.rollingSharpe30d),
    }));
  }, [strategies]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Strategy Decay</h1>
        <p className="text-sm text-text-secondary mt-1">
          Alpha decay monitoring &amp; half-life tracking
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted text-sm">Loading decay data...</div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && strategies.length === 0 && (
        <div className="forge-card p-12 text-center">
          <TrendingDown className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            No strategy decay data available. Strategies will appear here once they have rolling performance metrics.
          </p>
        </div>
      )}

      {/* Content */}
      {!isLoading && strategies.length > 0 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((k, i) => (
              <motion.div
                key={k.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="forge-card p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <k.icon className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] uppercase tracking-widest text-text-muted">
                    {k.label}
                  </span>
                </div>
                <p
                  className={`text-xl font-mono font-semibold ${
                    k.variant === "loss"
                      ? "text-loss"
                      : k.variant === "profit"
                      ? "text-profit"
                      : k.variant === "amber"
                      ? "text-primary"
                      : "text-foreground"
                  }`}
                >
                  {k.value}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Decay Chart */}
          <div className="forge-card p-6">
            <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Rolling 30d Sharpe by Strategy
            </h2>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsla(240,5%,18%,0.5)" />
                  <XAxis
                    type="number"
                    tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, "auto"]}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: "hsl(240,4%,46%)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={140}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(240,10%,6%)",
                      border: "1px solid hsl(240,5%,18%)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "hsl(240,4%,63%)" }}
                    formatter={(v: number) => [v.toFixed(2), "Sharpe"]}
                  />
                  <ReferenceLine
                    x={1.5}
                    stroke="hsl(142,71%,45%)"
                    strokeDasharray="6 4"
                    strokeOpacity={0.5}
                    label={{
                      value: "1.5",
                      fill: "hsl(142,71%,45%)",
                      fontSize: 10,
                      position: "insideTopRight",
                    }}
                  />
                  <ReferenceLine
                    x={1.0}
                    stroke="hsl(45,100%,50%)"
                    strokeDasharray="6 4"
                    strokeOpacity={0.5}
                    label={{
                      value: "1.0",
                      fill: "hsl(45,100%,50%)",
                      fontSize: 10,
                      position: "insideTopRight",
                    }}
                  />
                  <Bar dataKey="sharpe" radius={[0, 4, 4, 0]} name="Sharpe">
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={sharpeColor(entry.sharpe)} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-3 text-[11px] text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded" style={{ background: "hsl(142,71%,45%)", opacity: 0.8 }} />
                Healthy (&ge; 1.5)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded" style={{ background: "hsl(45,100%,50%)", opacity: 0.8 }} />
                Warning (1.0 - 1.5)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded" style={{ background: "hsl(0,84%,60%)", opacity: 0.8 }} />
                Critical (&lt; 1.0)
              </span>
            </div>
          </div>

          {/* Strategy Table */}
          <div className="forge-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border/10">
              <h2 className="text-sm font-medium text-text-secondary flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Strategy Decay Details
              </h2>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border/10">
                    <th className="text-left px-6 py-3 text-[10px] uppercase tracking-widest text-text-muted font-medium">
                      Strategy
                    </th>
                    <th className="text-right px-6 py-3 text-[10px] uppercase tracking-widest text-text-muted font-medium">
                      Rolling 30d Sharpe
                    </th>
                    <th className="text-right px-6 py-3 text-[10px] uppercase tracking-widest text-text-muted font-medium">
                      Half-Life (days)
                    </th>
                    <th className="text-right px-6 py-3 text-[10px] uppercase tracking-widest text-text-muted font-medium">
                      Decay Rate
                    </th>
                    <th className="text-center px-6 py-3 text-[10px] uppercase tracking-widest text-text-muted font-medium">
                      Status
                    </th>
                    <th className="text-right px-6 py-3 text-[10px] uppercase tracking-widest text-text-muted font-medium">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedStrategies.map((s, i) => {
                    const sharpe = num(s.rollingSharpe30d);
                    const halfLife = num(s.halfLifeDays);
                    const decay = num(s.decayRate);
                    const status = s.status?.toUpperCase() ?? "--";

                    return (
                      <motion.tr
                        key={s.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-border/5 hover:bg-[hsl(var(--surface-2))]/50 transition-colors"
                      >
                        <td className="px-6 py-3.5">
                          <span className="text-sm font-medium text-foreground">{s.name}</span>
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <span className={`text-sm font-mono font-semibold ${sharpeTextClass(sharpe)}`}>
                            {sharpe.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <span className="text-sm font-mono text-foreground">
                            {halfLife > 0 ? `${halfLife.toFixed(0)}d` : "--"}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <span
                            className={`text-sm font-mono ${
                              decay > 5 ? "text-loss" : decay > 2 ? "text-primary" : "text-text-secondary"
                            }`}
                          >
                            {decay > 0 ? `-${decay.toFixed(1)}%/mo` : "--"}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          <StatusBadge variant={statusVariant(status)} dot>
                            {status}
                          </StatusBadge>
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <span className="text-xs text-text-muted">
                            {s.lastUpdated ? timeAgo(s.lastUpdated) : "--"}
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {strategies.length > PAGE_SIZE && (
              <div className="px-6 py-3">
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={strategies.length}
                  onPageChange={setPage}
                />
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
