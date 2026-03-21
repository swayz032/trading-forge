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

/** Futures contract specifications — point values for P&L conversion */
export const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  ES:  { tickSize: 0.25, tickValue: 12.50, pointValue: 50.00 },
  NQ:  { tickSize: 0.25, tickValue: 5.00,  pointValue: 20.00 },
  CL:  { tickSize: 0.01, tickValue: 10.00, pointValue: 1000.00 },
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
};

/** Convert dollar P&L to points for a given symbol and contract count */
export function dollarsToPoints(dollarPnl: number, symbol: string, contracts: number = 1): number {
  const spec = CONTRACT_SPECS[symbol.toUpperCase()] ?? CONTRACT_SPECS["ES"];
  if (contracts === 0) return 0;
  return dollarPnl / (spec.pointValue * contracts);
}

/** Convert points to dollars */
export function pointsToDollars(points: number, symbol: string, contracts: number = 1): number {
  const spec = CONTRACT_SPECS[symbol.toUpperCase()] ?? CONTRACT_SPECS["ES"];
  return points * spec.pointValue * contracts;
}

/** Format points with sign */
export function fmtPoints(pts: number): string {
  return `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts`;
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
