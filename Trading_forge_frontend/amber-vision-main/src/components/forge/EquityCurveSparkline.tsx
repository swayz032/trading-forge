import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { useBacktestEquity } from "@/hooks/useBacktests";
import { TrendingUp } from "lucide-react";

interface EquityCurveSparklineProps {
  backtestId: string | undefined;
  height?: number;
  emptyHint?: string;
}

type EquityPoint = { i: number; equity: number };

function normalizeEquityPayload(raw: unknown): EquityPoint[] {
  if (!raw) return [];
  const curve = (raw as { equityCurve?: unknown }).equityCurve ?? raw;
  if (!Array.isArray(curve)) return [];
  return curve
    .map((row, i) => {
      if (typeof row === "number") return { i, equity: row };
      if (Array.isArray(row)) return { i, equity: Number(row[1]) };
      const obj = row as { equity?: number; value?: number; pnl?: number };
      const v = obj.equity ?? obj.value ?? obj.pnl;
      return { i, equity: typeof v === "number" ? v : Number(v) };
    })
    .filter((p) => Number.isFinite(p.equity));
}

export function EquityCurveSparkline({
  backtestId,
  height = 56,
  emptyHint = "Run a backtest to see equity curve",
}: EquityCurveSparklineProps) {
  const { data, isLoading } = useBacktestEquity(backtestId);

  const points = useMemo(() => normalizeEquityPayload(data), [data]);
  const isProfitable = points.length > 1 && points[points.length - 1].equity >= points[0].equity;
  const stroke = isProfitable ? "hsl(var(--profit))" : "hsl(var(--loss))";
  const gradientId = `eq-grad-${backtestId ?? "empty"}`;

  if (!backtestId || (!isLoading && points.length < 2)) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border/30 bg-surface-2/30 text-[10px] text-text-muted gap-1.5"
        style={{ height }}
      >
        <TrendingUp className="w-3 h-3" />
        {emptyHint}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="rounded-md bg-surface-2/30 animate-pulse"
        style={{ height }}
      />
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="equity"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
