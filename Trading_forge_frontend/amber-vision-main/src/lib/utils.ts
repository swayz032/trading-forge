import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Parse Drizzle numeric string to number, defaulting to 0 */
export function num(v: string | number | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Format currency */
export function fmtCurrency(v: number): string {
  return v >= 0
    ? `+$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `-$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format percentage */
export function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

/** Futures contract specifications — point values for P&L conversion.
 *  CLAUDE.md §13 anti-pattern pin: micro/mini conversion is 10× — flipping the
 *  wrong spec causes silent risk inflation. Canonical Wave 23 symbols are
 *  MES / MNQ / MCL (micros). ES/NQ/CL minis kept for legacy reads only.
 */
export const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  ES:  { tickSize: 0.25, tickValue: 12.50, pointValue: 50.00 },
  NQ:  { tickSize: 0.25, tickValue: 5.00,  pointValue: 20.00 },
  CL:  { tickSize: 0.01, tickValue: 10.00, pointValue: 1000.00 },
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
  MCL: { tickSize: 0.01, tickValue: 0.50,  pointValue: 100.00 },
};

/** Convert dollar P&L to points for a given symbol and contract count.
 *  Returns null when the symbol has no spec — callers MUST render "—" on null
 *  rather than fall back to a different contract (fail-closed; never silently
 *  inflate / deflate using the wrong point value). See CLAUDE.md §13.
 */
export function dollarsToPoints(dollarPnl: number, symbol: string, contracts: number = 1): number | null {
  const spec = CONTRACT_SPECS[symbol.toUpperCase()] ?? null;
  if (spec === null) return null;
  if (contracts === 0) return 0;
  return dollarPnl / (spec.pointValue * contracts);
}

/** Convert points to dollars. Returns null when symbol is unknown. */
export function pointsToDollars(points: number, symbol: string, contracts: number = 1): number | null {
  const spec = CONTRACT_SPECS[symbol.toUpperCase()] ?? null;
  if (spec === null) return null;
  return points * spec.pointValue * contracts;
}

/** Format points with sign */
export function fmtPoints(pts: number): string {
  return `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts`;
}

/** Prop-firm default account size used for ratio→dollar conversions in the UI
 *  (matches the $50K eval baseline referenced across BacktestDetail). */
export const DEFAULT_STARTING_CAPITAL = 50_000;

/**
 * backtests.totalReturn is a vectorbt RATIO (backtest-service.ts:857).
 * Deep-scan #13: rendering it as dollars via magnitude-sniffing fabricated
 * P&L. Always render as a percentage; dollar views must label the assumed
 * capital explicitly.
 */
export function formatReturnPct(ratio: number): string {
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Format a backtest period as "Mon D, YYYY – Mon D, YYYY". Falls back to the
 *  raw string when a date can't be parsed. */
export function fmtDateRange(start: string, end: string): string {
  const fmt = (d: string) => {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Format a max-drawdown ratio (e.g. 0.123) as "-12.3% (-$6,150)" against the
 *  given starting capital. Sign-agnostic on input — drawdown is always shown
 *  as a loss. */
export function fmtMaxDrawdown(ratio: number, startingCapital: number = DEFAULT_STARTING_CAPITAL): string {
  const mag = Math.abs(ratio);
  const pct = mag * 100;
  const dollars = mag * startingCapital;
  return `-${pct.toFixed(1)}% (-$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })})`;
}

/** Time ago helper */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
