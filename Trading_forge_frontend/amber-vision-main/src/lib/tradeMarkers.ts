import type { ChartMarker } from "@/components/forge/LightweightChart";
import type { BacktestTrade } from "@/types/api";

function toUtcSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / 1000);
}

/**
 * Convert backtest trades → entry/exit markers for a candlestick chart.
 *
 * Marker convention:
 *   LONG entry  → up arrow below bar, profit-green
 *   SHORT entry → down arrow above bar, loss-red
 *   Exit        → small circle at exitPrice, color by trade pnl
 *
 * If two trades share the same bar timestamp lightweight-charts will keep
 * the last one — caller should pre-filter if that's a problem.
 */
export function tradesToMarkers(
  trades: BacktestTrade[] | null | undefined,
  opts?: { showExits?: boolean }
): ChartMarker[] {
  if (!trades?.length) return [];
  const showExits = opts?.showExits ?? true;
  const markers: ChartMarker[] = [];

  for (const t of trades) {
    const dir = (t.direction ?? "").toLowerCase();
    const isLong = dir === "long" || dir === "buy";

    // Entry marker
    const entryTime = toUtcSeconds(t.entryTime);
    if (entryTime != null) {
      markers.push({
        time: entryTime,
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? "#22C55E" : "#EF4444",
        shape: isLong ? "arrowUp" : "arrowDown",
        text: isLong ? "LONG" : "SHORT",
        size: 1,
      });
    }

    // Exit marker (color by pnl)
    if (showExits && t.exitTime) {
      const exitTime = toUtcSeconds(t.exitTime);
      if (exitTime != null) {
        const pnl = Number(t.pnl ?? 0);
        markers.push({
          time: exitTime,
          position: "inBar",
          color: pnl >= 0 ? "#10B981" : "#EF4444",
          shape: "circle",
          size: 0.8,
        });
      }
    }
  }

  // lightweight-charts requires markers sorted by time ascending
  markers.sort((a, b) => Number(a.time) - Number(b.time));
  return markers;
}
