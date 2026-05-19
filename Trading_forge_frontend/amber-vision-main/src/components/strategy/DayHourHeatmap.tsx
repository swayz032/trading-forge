import { useMemo } from "react";
import { useBacktestTrades } from "@/hooks/useBacktests";

interface DayHourHeatmapProps {
  backtestId: string | undefined;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
// 9am–4pm ET trading hours (RTH for ES/NQ futures session core).
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16];

interface CellMetrics {
  trades: number;
  pnl: number;
  avg: number;
}

function emptyCell(): CellMetrics {
  return { trades: 0, pnl: 0, avg: 0 };
}

export function DayHourHeatmap({ backtestId }: DayHourHeatmapProps) {
  const { data: trades, isLoading } = useBacktestTrades(backtestId, { limit: 5000 });

  const grid = useMemo(() => {
    const matrix: CellMetrics[][] = DAYS.map(() => HOURS.map(() => emptyCell()));
    if (!trades?.length) return matrix;
    for (const t of trades as { entryTime?: string; pnl?: string | number; dayOfWeek?: number; hourOfDay?: number }[]) {
      let day: number;
      let hour: number;
      // Prefer pre-computed dayOfWeek/hourOfDay if available (backtester sets these).
      if (typeof t.dayOfWeek === "number" && typeof t.hourOfDay === "number") {
        day = t.dayOfWeek;
        hour = t.hourOfDay;
      } else if (t.entryTime) {
        const d = new Date(t.entryTime);
        day = (d.getUTCDay() + 6) % 7; // 0=Mon, 4=Fri (UTC, approximation)
        hour = d.getUTCHours();
      } else {
        continue;
      }
      if (day < 0 || day > 4) continue;
      const hourIdx = HOURS.indexOf(hour);
      if (hourIdx === -1) continue;
      const pnl = Number(t.pnl ?? 0);
      if (!Number.isFinite(pnl)) continue;
      const cell = matrix[day][hourIdx];
      cell.trades += 1;
      cell.pnl += pnl;
    }
    for (const row of matrix) {
      for (const cell of row) {
        cell.avg = cell.trades > 0 ? cell.pnl / cell.trades : 0;
      }
    }
    return matrix;
  }, [trades]);

  // Color scale based on max abs value across grid.
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const row of grid) for (const cell of row) m = Math.max(m, Math.abs(cell.avg));
    return m || 1;
  }, [grid]);

  const cellColor = (avg: number): string => {
    if (Math.abs(avg) < 0.1) return "hsl(var(--surface-2))";
    const intensity = Math.min(1, Math.abs(avg) / maxAbs);
    if (avg > 0) return `hsla(150, 60%, 45%, ${0.15 + intensity * 0.6})`;
    return `hsla(0, 65%, 55%, ${0.15 + intensity * 0.6})`;
  };

  const totalTrades = useMemo(() => {
    let n = 0;
    for (const row of grid) for (const cell of row) n += cell.trades;
    return n;
  }, [grid]);

  return (
    <div className="forge-card p-5 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">Performance Heatmap — Day × Hour</h2>
        <p className="text-[11px] text-text-muted mt-1">
          Average P&L per cell across trading hours. Per QuantVue V2 deck page 14 — reveals temporal edge that should drive session filters.
        </p>
      </div>

      {isLoading ? (
        <div className="h-48 rounded-md bg-surface-2/40 animate-pulse" />
      ) : totalTrades === 0 ? (
        <div className="flex items-center justify-center h-48 text-xs text-text-muted border border-dashed border-border/30 rounded-md">
          No trade timing data yet — run a backtest to populate.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="p-1.5 text-left text-text-muted font-normal" />
                {HOURS.map((h) => (
                  <th key={h} className="p-1.5 text-center text-text-muted font-normal">
                    {h}:00
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, rowIdx) => (
                <tr key={day}>
                  <td className="p-1.5 pr-3 text-text-muted font-medium">{day}</td>
                  {HOURS.map((_, colIdx) => {
                    const cell = grid[rowIdx][colIdx];
                    return (
                      <td
                        key={colIdx}
                        className="p-0 align-top"
                        title={`${day} ${HOURS[colIdx]}:00 — ${cell.trades} trades, avg $${cell.avg.toFixed(0)}, total $${cell.pnl.toFixed(0)}`}
                      >
                        <div
                          className="h-12 rounded flex flex-col items-center justify-center font-mono transition hover:ring-1 hover:ring-primary"
                          style={{ background: cellColor(cell.avg) }}
                        >
                          {cell.trades > 0 ? (
                            <>
                              <span className={`text-[11px] font-semibold ${cell.avg >= 0 ? "text-profit" : "text-loss"}`}>
                                {cell.avg >= 0 ? "+" : ""}${cell.avg.toFixed(0)}
                              </span>
                              <span className="text-[9px] text-text-muted">{cell.trades}t</span>
                            </>
                          ) : (
                            <span className="text-[10px] text-text-muted/50">—</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 pt-3 text-[10px] text-text-muted">
            <span>Color intensity = avg P&L magnitude relative to grid max.</span>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ background: "hsla(0, 65%, 55%, 0.6)" }} />
              <span>loss</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ background: "hsla(150, 60%, 45%, 0.6)" }} />
              <span>win</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
