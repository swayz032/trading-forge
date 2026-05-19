/**
 * Deterministic thumbnail mapping for strategy cards.
 * Hashes the strategy id to one of the four chart PNGs in /public/strategy-thumbnails.
 *
 * Thumbnails (Trading Forge brand assets, copied 2026-05-03):
 *   chart-1.png — LONG-only trend
 *   chart-2.png — Bearish → Reversal → Execution phases
 *   chart-3.png — TP / SL / Entry levels
 *   chart-4.png — Multi-LONG/SHORT signals
 */

const THUMBNAILS = [
  "/strategy-thumbnails/chart-1.png",
  "/strategy-thumbnails/chart-2.png",
  "/strategy-thumbnails/chart-3.png",
  "/strategy-thumbnails/chart-4.png",
];

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getThumbnailUrl(strategyId: string | undefined | null): string {
  if (!strategyId) return THUMBNAILS[0];
  const idx = hashString(strategyId) % THUMBNAILS.length;
  return THUMBNAILS[idx];
}

export function getThumbnailUrlBySymbol(symbol: string | undefined | null, strategyId?: string): string {
  // Optional symbol-aware hint: bias thumbnail by symbol family, then by id.
  if (!strategyId) return THUMBNAILS[0];
  const sym = (symbol ?? "").toUpperCase();
  const symBias =
    sym.includes("MES") || sym.includes("ES") ? 0
    : sym.includes("MNQ") || sym.includes("NQ") ? 1
    : sym.includes("MCL") || sym.includes("CL") ? 2
    : 3;
  const idHash = hashString(strategyId);
  return THUMBNAILS[(symBias + idHash) % THUMBNAILS.length];
}
