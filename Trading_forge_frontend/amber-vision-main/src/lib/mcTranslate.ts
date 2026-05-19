import type { MonteCarloRun } from "@/types/api";

export type Verdict = "SAFE" | "CAUTION" | "RISKY" | "UNKNOWN";

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function formatPnl(value: number, opts?: { compact?: boolean }): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (opts?.compact && abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}k`;
  }
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function verdict(
  mc: MonteCarloRun | null | undefined,
  accountSize = 50000
): Verdict {
  if (!mc) return "UNKNOWN";
  const ruin = num(mc.probabilityOfRuin);
  const sharpe = num(mc.sharpeP50);
  const dd = Math.abs(num(mc.maxDrawdownP95));
  const ddPct = accountSize > 0 ? dd / accountSize : 0;

  if (ruin >= 0.10 || ddPct >= 0.25 || (sharpe > 0 && sharpe < 0.3)) return "RISKY";
  if (ruin >= 0.03 || ddPct >= 0.15 || (sharpe > 0 && sharpe < 0.8)) return "CAUTION";
  return "SAFE";
}

export function verdictLabel(v: Verdict): string {
  switch (v) {
    case "SAFE": return "Safe to deploy";
    case "CAUTION": return "Watch this one";
    case "RISKY": return "Don't deploy yet";
    default: return "Not yet simulated";
  }
}

export function verdictIcon(v: Verdict): string {
  switch (v) {
    case "SAFE": return "✅";
    case "CAUTION": return "⚠️";
    case "RISKY": return "🚫";
    default: return "•";
  }
}

export function verdictColorClass(v: Verdict): string {
  switch (v) {
    case "SAFE": return "text-profit bg-profit/10 border-profit/30";
    case "CAUTION": return "text-emerald bg-emerald-500/10 border-emerald-500/30";
    case "RISKY": return "text-loss bg-loss/10 border-loss/30";
    default: return "text-text-muted bg-surface-2 border-border/30";
  }
}

/**
 * Composite confidence score 0-100. Combines:
 *  - 1 - probabilityOfRuin (survival)
 *  - sharpeP50 normalized [0..2.5]
 *  - drawdown headroom [0..1] given account size
 */
export function confidence(
  mc: MonteCarloRun | null | undefined,
  accountSize = 50000
): number {
  if (!mc) return 0;
  const survival = Math.max(0, Math.min(1, 1 - num(mc.probabilityOfRuin)));
  const sharpeRaw = num(mc.sharpeP50);
  const sharpeFactor = sharpeRaw <= 0 ? 0 : Math.min(1, sharpeRaw / 2.5);
  const dd = Math.abs(num(mc.maxDrawdownP95));
  const ddPct = accountSize > 0 ? dd / accountSize : 1;
  const ddFactor = Math.max(0, Math.min(1, 1 - ddPct / 0.30));

  const composite = survival * 0.5 + sharpeFactor * 0.3 + ddFactor * 0.2;
  return Math.round(Math.max(0, Math.min(1, composite)) * 100);
}

export interface PlainEnglishMC {
  typicalPnl: number;
  bestCase: number;
  worstCase: number;
  blowUpPct: number;
  badDayMaxLoss: number;
  alive: number;
  total: number;
}

/** Translate raw MC to plain-English values using p50/p95/p5 path endpoints. */
export function plainEnglish(mc: MonteCarloRun | null | undefined): PlainEnglishMC | null {
  if (!mc) return null;

  // Try to derive endpoint stats from `paths` array if present, else fall back
  // to maxDrawdown percentiles converted to dollars (rough proxy).
  const total = mc.numSimulations || 1000;
  const ruin = num(mc.probabilityOfRuin);
  const alive = Math.round(total * (1 - ruin));
  const blowUpPct = Math.round(ruin * 100);
  const badDayMaxLoss = Math.abs(num(mc.var95));

  // Path-derived endpoints when available
  let typicalPnl = 0;
  let bestCase = 0;
  let worstCase = 0;

  const paths = mc.paths;
  if (Array.isArray(paths) && paths.length > 0) {
    const ends: number[] = [];
    for (const p of paths) {
      if (Array.isArray(p) && p.length > 0) {
        ends.push(num(p[p.length - 1]));
      }
    }
    if (ends.length > 0) {
      ends.sort((a, b) => a - b);
      worstCase = ends[Math.floor(ends.length * 0.05)];
      typicalPnl = ends[Math.floor(ends.length * 0.5)];
      bestCase = ends[Math.floor(ends.length * 0.95)];
    }
  }

  // If paths weren't available, fall back to drawdown percentiles as
  // negative-only outcomes (typical = 0, best = 0, worst = -p95 dd).
  if (typicalPnl === 0 && bestCase === 0 && worstCase === 0) {
    const ddP95 = Math.abs(num(mc.maxDrawdownP95));
    const ddP50 = Math.abs(num(mc.maxDrawdownP50));
    const ddP5 = Math.abs(num(mc.maxDrawdownP5));
    typicalPnl = -ddP50;
    bestCase = -ddP5;
    worstCase = -ddP95;
  }

  return {
    typicalPnl,
    bestCase,
    worstCase,
    blowUpPct,
    badDayMaxLoss,
    alive,
    total,
  };
}

export function summarySentence(mc: MonteCarloRun | null | undefined): string {
  const pe = plainEnglish(mc);
  if (!pe) return "Run a Monte Carlo simulation to see survival odds.";

  const typicalText =
    pe.typicalPnl >= 0
      ? `made ${formatPnl(pe.typicalPnl)}`
      : `lost ${formatPnl(Math.abs(pe.typicalPnl)).replace("+", "")}`;
  const lostText = formatPnl(Math.abs(pe.worstCase)).replace("+", "");

  return `Out of ${pe.total.toLocaleString()} imagined runs, ${pe.alive.toLocaleString()} stayed alive. The middle of the pack ${typicalText}. The unlucky 5% lost about ${lostText}.`;
}
