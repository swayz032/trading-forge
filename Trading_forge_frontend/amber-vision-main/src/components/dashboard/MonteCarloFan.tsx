import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Dice5 } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import type { MonteCarloRun } from "@/types/api";
import {
  confidence,
  formatPnl,
  plainEnglish,
  summarySentence,
  verdict,
  verdictColorClass,
  verdictIcon,
  verdictLabel,
} from "@/lib/mcTranslate";

interface Props {
  mc: MonteCarloRun | null | undefined;
  loading?: boolean;
  accountSize?: number;
}

interface FanRow {
  step: number;
  p5: number;
  p50: number;
  p95: number;
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildFan(mc: MonteCarloRun | null | undefined): FanRow[] {
  if (!mc?.paths) return [];
  const paths = mc.paths;
  if (!Array.isArray(paths) || paths.length === 0) return [];
  // Normalize to numeric 2D array
  const matrix: number[][] = [];
  for (const p of paths) {
    if (Array.isArray(p)) matrix.push(p.map(num));
  }
  if (matrix.length === 0) return [];
  const minLen = Math.min(...matrix.map((m) => m.length));
  if (minLen === 0) return [];

  const stepCount = Math.min(minLen, 60);
  const stride = Math.max(1, Math.floor(minLen / stepCount));

  const rows: FanRow[] = [];
  for (let i = 0; i < minLen; i += stride) {
    const slice = matrix.map((m) => m[i]).filter((n) => Number.isFinite(n));
    slice.sort((a, b) => a - b);
    if (slice.length === 0) continue;
    rows.push({
      step: i,
      p5: slice[Math.floor(slice.length * 0.05)],
      p50: slice[Math.floor(slice.length * 0.5)],
      p95: slice[Math.floor(slice.length * 0.95)],
    });
  }
  return rows;
}

export function MonteCarloFan({ mc, loading, accountSize = 50000 }: Props) {
  const [showRaw, setShowRaw] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("mc_show_raw") === "true";
  });

  const v = useMemo(() => verdict(mc, accountSize), [mc, accountSize]);
  const conf = useMemo(() => confidence(mc, accountSize), [mc, accountSize]);
  const pe = useMemo(() => plainEnglish(mc), [mc]);
  const summary = useMemo(() => summarySentence(mc), [mc]);
  const fan = useMemo(() => buildFan(mc), [mc]);

  function toggleRaw() {
    setShowRaw((s) => {
      const next = !s;
      try { window.localStorage.setItem("mc_show_raw", String(next)); } catch {}
      return next;
    });
  }

  // Placeholder fan generated as plausible wandering equity paths so the
  // chart looks like a real Monte Carlo fan even before any real run lands.
  const placeholderFan = useMemo<FanRow[]>(() => {
    const NUM_STEPS = 60;
    const NUM_PATHS = 40;
    let seed = 0x1f5c >>> 0;
    const r = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const paths: number[][] = [];
    for (let p = 0; p < NUM_PATHS; p += 1) {
      const path: number[] = [0];
      let cur = 0;
      const drift = (p - NUM_PATHS / 2) * 0.55 + 0.3;
      for (let i = 1; i < NUM_STEPS; i += 1) {
        cur += drift / 4 + (r() - 0.5) * 6;
        path.push(cur);
      }
      paths.push(path);
    }
    const fan: FanRow[] = [];
    for (let i = 0; i < NUM_STEPS; i += 1) {
      const slice = paths.map((p) => p[i]).sort((a, b) => a - b);
      fan.push({
        step: i,
        p5: Math.round(slice[Math.floor(slice.length * 0.05)]),
        p50: Math.round(slice[Math.floor(slice.length * 0.5)]),
        p95: Math.round(slice[Math.floor(slice.length * 0.95)]),
      });
    }
    return fan;
  }, []);

  const hasData = !!mc;
  const fanToRender = hasData ? fan : placeholderFan;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="forge-card-glow p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Dice5 className="w-3.5 h-3.5 text-emerald" />
          <span className="text-[10px] uppercase tracking-widest text-text-secondary">
            Monte Carlo · {hasData ? `${(mc!.numSimulations || 1000).toLocaleString()} runs` : "no run yet"}
          </span>
        </div>
        {loading && <span className="text-[10px] text-emerald animate-pulse">simulating…</span>}
      </div>

      {/* Verdict pill */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${verdictColorClass(v)}`}>
        <span className="text-sm leading-none">{verdictIcon(v)}</span>
        <span>{verdictLabel(v)}</span>
      </div>

      {/* Confidence bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-widest text-text-muted">
            Confidence
          </span>
          <span className="text-xs font-mono font-semibold text-foreground">
            {conf}<span className="text-text-muted">/100</span>
          </span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${conf}%` }}
            transition={{ duration: 0.6 }}
            className={`h-full rounded-full ${
              v === "SAFE" ? "bg-profit"
              : v === "CAUTION" ? "bg-emerald-500"
              : v === "RISKY" ? "bg-loss"
              : "bg-text-muted/40"
            }`}
          />
        </div>
      </div>

      {/* Equity fan chart — always renders the frame as a proper band envelope */}
      <div className="mt-4 h-[140px] -mx-1 relative">
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <span className="text-[10px] uppercase tracking-widest text-text-muted/60">
              Awaiting simulation
            </span>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={fanToRender.map((r) => ({ ...r, band: [r.p5, r.p95] }))}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="mcFanBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(160 84% 55%)" stopOpacity={hasData ? 0.45 : 0.6} />
                <stop offset="100%" stopColor="hsl(160 84% 45%)" stopOpacity={0.18} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(160 30% 14% / 0.35)" vertical={false} />
            <XAxis dataKey="step" hide />
            <YAxis hide domain={["auto", "auto"]} />
            <ReferenceLine y={0} stroke="hsl(220 5% 30% / 0.5)" strokeDasharray="2 4" />
            <Tooltip
              contentStyle={{
                background: "hsl(220 9% 5% / 0.92)",
                border: "1px solid hsl(160 84% 39% / 0.3)",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelStyle={{ color: "hsl(220 5% 64%)" }}
              formatter={(value: any, key: any) => {
                if (key === "band") return null as any;
                const label = key === "p5" ? "Worst 5%" : key === "p95" ? "Best 5%" : "Typical";
                return [formatPnl(Number(value)), label];
              }}
            />
            {/* Envelope band p5 → p95 */}
            <Area
              type="monotone"
              dataKey="band"
              stroke="none"
              fill="url(#mcFanBand)"
              isAnimationActive={false}
            />
            {/* p95 boundary */}
            <Line
              type="monotone"
              dataKey="p95"
              stroke="hsl(160 84% 70%)"
              strokeOpacity={0.7}
              strokeWidth={1.2}
              dot={false}
              isAnimationActive={false}
            />
            {/* p5 boundary */}
            <Line
              type="monotone"
              dataKey="p5"
              stroke="hsl(0 84% 70%)"
              strokeOpacity={0.55}
              strokeWidth={1.2}
              dot={false}
              isAnimationActive={false}
            />
            {/* Median */}
            <Line
              type="monotone"
              dataKey="p50"
              stroke="hsl(160 84% 75%)"
              strokeWidth={2.4}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Plain-English numbers — always rendered */}
      <div className="mt-4 space-y-2 text-xs">
        <Row
          label="Typical month"
          value={hasData && pe ? formatPnl(pe.typicalPnl) : "—"}
          valueClass={hasData && pe ? (pe.typicalPnl >= 0 ? "text-profit" : "text-loss") : "text-text-muted"}
        />
        <Row
          label="Best case (1 in 20)"
          value={hasData && pe ? formatPnl(Math.abs(pe.bestCase)) : "—"}
          valueClass={hasData ? "text-profit" : "text-text-muted"}
        />
        <Row
          label="Worst case (1 in 20)"
          value={hasData && pe ? `-${formatPnl(Math.abs(pe.worstCase)).replace("+", "").replace("-", "")}` : "—"}
          valueClass={hasData ? "text-loss" : "text-text-muted"}
        />
        <Row
          label="Chance of blow-up"
          value={hasData && pe ? `${pe.blowUpPct}%` : "—"}
          valueClass={
            hasData && pe
              ? pe.blowUpPct < 5 ? "text-profit"
              : pe.blowUpPct < 15 ? "text-emerald"
              : "text-loss"
              : "text-text-muted"
          }
        />
        <Row
          label="Bad day max loss"
          value={hasData && pe && pe.badDayMaxLoss > 0 ? `-${formatPnl(pe.badDayMaxLoss).replace("+", "").replace("-", "")}` : "—"}
          valueClass={hasData ? "text-loss" : "text-text-muted"}
        />
      </div>

      {/* Plain-English summary sentence */}
      <p className="mt-4 text-[11px] leading-relaxed text-text-secondary italic border-l-2 border-emerald-500/30 pl-3">
        {hasData ? summary : "Pick a strategy with a completed Monte Carlo run to see survival odds."}
      </p>

      {/* Show technical view toggle */}
      <button
        onClick={toggleRaw}
        className="mt-3 text-[10px] text-text-muted hover:text-text-secondary tracking-wider uppercase transition-colors"
      >
        {showRaw ? "Hide technical view" : "Show technical view"}
      </button>

      {showRaw && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] font-mono text-text-secondary border-t border-border/20 pt-3">
          <RawRow label="p5 sharpe" value={mc ? num(mc.sharpeP5).toFixed(2) : "—"} />
          <RawRow label="p50 sharpe" value={mc ? num(mc.sharpeP50).toFixed(2) : "—"} />
          <RawRow label="p95 sharpe" value={mc ? num(mc.sharpeP95).toFixed(2) : "—"} />
          <RawRow label="P(ruin)" value={mc ? (num(mc.probabilityOfRuin) * 100).toFixed(1) + "%" : "—"} />
          <RawRow label="VaR95" value={mc ? `-$${Math.abs(num(mc.var95)).toFixed(0)}` : "—"} />
          <RawRow label="CVaR95" value={mc ? `-$${Math.abs(num(mc.cvar95)).toFixed(0)}` : "—"} />
          <RawRow label="DD p5" value={mc ? `-$${Math.abs(num(mc.maxDrawdownP5)).toFixed(0)}` : "—"} />
          <RawRow label="DD p95" value={mc ? `-$${Math.abs(num(mc.maxDrawdownP95)).toFixed(0)}` : "—"} />
        </div>
      )}
    </motion.div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/10 pb-1.5">
      <span className="text-text-secondary">{label}</span>
      <span className={`font-mono font-semibold ${valueClass ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

function RawRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  );
}
