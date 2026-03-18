import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { num } from "@/lib/utils";

export interface MatrixHeatmapProps {
  matrixData: Array<{
    symbol: string;
    timeframe: string;
    forgeScore: number;
    sharpe?: number;
    trades?: number;
    pnl?: number;
    status?: string;
  }>;
}

const SYMBOLS = ["ES", "NQ", "CL", "YM", "RTY", "GC"];
const TIMEFRAMES = ["1min", "5min", "15min", "30min", "1hour", "4hour", "daily"];

function scoreColor(score: number): string {
  if (score >= 80) return "hsl(142, 71%, 45%)";
  if (score >= 60) return "hsl(45, 100%, 50%)";
  if (score >= 40) return "hsl(38, 92%, 50%)";
  if (score >= 20) return "hsl(0, 84%, 60%)";
  return "hsl(240, 5%, 18%)";
}

function scoreTextColor(score: number): string {
  if (score >= 60) return "hsl(0, 0%, 8%)";
  if (score >= 40) return "hsl(0, 0%, 8%)";
  return "hsl(0, 0%, 85%)";
}

export function MatrixHeatmap({ matrixData }: MatrixHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<{ symbol: string; timeframe: string } | null>(null);

  // Build lookup map: "symbol|timeframe" -> data
  const cellMap = useMemo(() => {
    const map = new Map<string, MatrixHeatmapProps["matrixData"][number]>();
    for (const d of matrixData) {
      map.set(`${d.symbol}|${d.timeframe}`, d);
    }
    return map;
  }, [matrixData]);

  // Find best combo
  const bestCombo = useMemo(() => {
    if (!matrixData.length) return null;
    return matrixData.reduce((best, curr) =>
      num(curr.forgeScore) > num(best.forgeScore) ? curr : best
    );
  }, [matrixData]);

  // Tooltip data for hovered cell
  const tooltipData = useMemo(() => {
    if (!hoveredCell) return null;
    return cellMap.get(`${hoveredCell.symbol}|${hoveredCell.timeframe}`) ?? null;
  }, [hoveredCell, cellMap]);

  return (
    <div className="forge-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-medium text-foreground">Cross-Matrix Heatmap</h2>
        {bestCombo && (
          <span className="text-xs font-mono text-primary">
            Best: {bestCombo.symbol} × {bestCombo.timeframe} — {num(bestCombo.forgeScore).toFixed(1)}
          </span>
        )}
      </div>
      <p className="text-xs text-text-muted mb-5">Forge Score across symbols × timeframes (42-combo matrix)</p>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `72px repeat(${TIMEFRAMES.length}, 1fr)` }}>
          {/* Header row */}
          <div /> {/* empty corner */}
          {TIMEFRAMES.map((tf) => (
            <div key={tf} className="text-center text-[10px] uppercase tracking-wider text-text-muted font-medium py-1.5 min-w-[72px]">
              {tf}
            </div>
          ))}

          {/* Data rows */}
          {SYMBOLS.map((symbol, si) => (
            <>
              {/* Row label */}
              <div key={`label-${symbol}`} className="text-xs font-mono text-text-secondary flex items-center pr-2">
                {symbol}
              </div>

              {/* Cells */}
              {TIMEFRAMES.map((tf, ti) => {
                const cell = cellMap.get(`${symbol}|${tf}`);
                const score = cell ? num(cell.forgeScore) : null;
                const isBest = bestCombo && bestCombo.symbol === symbol && bestCombo.timeframe === tf;
                const isHovered = hoveredCell?.symbol === symbol && hoveredCell?.timeframe === tf;
                const delay = si * TIMEFRAMES.length + ti;

                return (
                  <motion.div
                    key={`${symbol}-${tf}`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: delay * 0.02, duration: 0.3 }}
                    className="relative min-w-[72px] aspect-[4/3] rounded-md flex items-center justify-center cursor-default transition-transform duration-150 hover:scale-105"
                    style={{
                      backgroundColor: score !== null ? scoreColor(score) : "hsl(240, 5%, 10%)",
                      boxShadow: isBest
                        ? "0 0 12px 2px hsla(45, 100%, 50%, 0.5), inset 0 0 0 2px hsl(45, 100%, 50%)"
                        : "none",
                    }}
                    onMouseEnter={() => setHoveredCell({ symbol, timeframe: tf })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <span
                      className="text-xs font-mono font-bold"
                      style={{ color: score !== null ? scoreTextColor(score) : "hsl(240, 5%, 30%)" }}
                    >
                      {score !== null ? score.toFixed(0) : "—"}
                    </span>

                    {/* Tooltip */}
                    {isHovered && cell && (
                      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 glass rounded-lg border border-border/30 px-3 py-2 min-w-[160px] pointer-events-none">
                        <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
                          {symbol} × {tf}
                        </p>
                        <div className="space-y-0.5">
                          <p className="text-xs text-foreground font-mono">
                            Forge Score: <span className="font-bold text-primary">{num(cell.forgeScore).toFixed(1)}</span>
                          </p>
                          {cell.sharpe != null && (
                            <p className="text-xs text-text-secondary font-mono">
                              Sharpe: {num(cell.sharpe).toFixed(2)}
                            </p>
                          )}
                          {cell.trades != null && (
                            <p className="text-xs text-text-secondary font-mono">
                              Trades: {cell.trades}
                            </p>
                          )}
                          {cell.pnl != null && (
                            <p className={`text-xs font-mono font-semibold ${num(cell.pnl) >= 0 ? "text-profit" : "text-loss"}`}>
                              P&L: {num(cell.pnl) >= 0 ? "+" : ""}${Math.abs(num(cell.pnl)).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </p>
                          )}
                          {cell.status && (
                            <p className="text-[10px] text-text-muted mt-1">{cell.status}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-5 pt-3 border-t border-border/10">
        {[
          { label: "0–19", color: "hsl(240, 5%, 18%)" },
          { label: "20–39", color: "hsl(0, 84%, 60%)" },
          { label: "40–59", color: "hsl(38, 92%, 50%)" },
          { label: "60–79", color: "hsl(45, 100%, 50%)" },
          { label: "80–100", color: "hsl(142, 71%, 45%)" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="text-[10px] text-text-muted font-mono">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
