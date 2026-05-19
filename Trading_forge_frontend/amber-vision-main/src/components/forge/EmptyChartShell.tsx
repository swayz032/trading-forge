import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

type ShellType = "equity" | "drawdown" | "mc-fan" | "bar" | "line" | "candles";

interface Props {
  type?: ShellType;
  height?: number;
  label?: string;
  hint?: string;
}

/**
 * Always-on chart shell. Renders proper-looking placeholder geometry so the
 * chart container looks like a real chart even when there's no live data —
 * not a flat zero baseline.
 *
 * type:
 *  - equity     → smooth, gently rising equity curve
 *  - drawdown   → underwater drawdown wave (negative)
 *  - mc-fan     → multi-path fan with p5/p50/p95 bands
 *  - line       → wandering line
 *  - bar        → varied monthly P&L bars (mix of green and red)
 */
export function EmptyChartShell({
  type = "equity",
  height = 260,
  label = "Awaiting data",
  hint,
}: Props) {
  const grid = "hsl(160 30% 14% / 0.4)";
  const axis = "hsl(220 5% 47% / 0.5)";

  // Generate placeholder geometry once per render
  const data = useMemo(() => buildSeries(type), [type]);

  return (
    <div className="relative" style={{ height }}>
      {/* Subtle "preview" badge — top-right */}
      <div className="absolute top-2 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full glass border border-emerald-500/15 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
        <span className="text-[9px] uppercase tracking-widest text-text-muted">
          {label}
        </span>
      </div>
      {hint && (
        <div className="absolute bottom-2 left-3 z-20 pointer-events-none">
          <span className="text-[10px] text-text-muted/60">{hint}</span>
        </div>
      )}

      <ResponsiveContainer width="100%" height="100%">
        {renderChart(type, data, grid, axis)}
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Geometry generators
// ─────────────────────────────────────────────────────────────────────────

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildSeries(type: ShellType): any[] {
  if (type === "equity") return buildEquity();
  if (type === "drawdown") return buildDrawdown();
  if (type === "mc-fan") return buildMcFan();
  if (type === "bar") return buildBars();
  if (type === "candles") return buildCandles();
  return buildLine();
}

function buildEquity(): { x: number; v: number }[] {
  const r = rand(13);
  const out: { x: number; v: number }[] = [];
  let cur = 100;
  for (let i = 0; i < 80; i += 1) {
    const drift = 0.45;
    const noise = (r() - 0.5) * 4;
    cur += drift + noise;
    out.push({ x: i, v: Math.round(cur * 10) / 10 });
  }
  return out;
}

function buildDrawdown(): { x: number; v: number }[] {
  const r = rand(29);
  const out: { x: number; v: number }[] = [];
  let cur = 0;
  let underwater = false;
  for (let i = 0; i < 80; i += 1) {
    if (!underwater && r() < 0.05) underwater = true;
    if (underwater) {
      cur -= r() * 1.2;
      if (cur < -18) underwater = false;
    } else if (cur < 0) {
      cur += 0.6;
      if (cur > 0) cur = 0;
    }
    out.push({ x: i, v: Math.round(cur * 10) / 10 });
  }
  return out;
}

function buildMcFan(): { x: number; p5: number; p50: number; p95: number }[] {
  const r = rand(17);
  const NUM_STEPS = 60;
  const NUM_PATHS = 40;

  // Generate NUM_PATHS wandering equity paths
  const paths: number[][] = [];
  for (let p = 0; p < NUM_PATHS; p += 1) {
    const path: number[] = [0];
    let cur = 0;
    const drift = (p - NUM_PATHS / 2) * 0.6 + 0.5;
    for (let i = 1; i < NUM_STEPS; i += 1) {
      cur += drift / 4 + (r() - 0.5) * 8;
      path.push(cur);
    }
    paths.push(path);
  }

  // Compute p5/p50/p95 at each step
  const fan: { x: number; p5: number; p50: number; p95: number }[] = [];
  for (let i = 0; i < NUM_STEPS; i += 1) {
    const slice = paths.map((p) => p[i]).sort((a, b) => a - b);
    fan.push({
      x: i,
      p5: Math.round(slice[Math.floor(slice.length * 0.05)]),
      p50: Math.round(slice[Math.floor(slice.length * 0.5)]),
      p95: Math.round(slice[Math.floor(slice.length * 0.95)]),
    });
  }
  return fan;
}

function buildBars(): { x: number; v: number }[] {
  const r = rand(41);
  const out: { x: number; v: number }[] = [];
  for (let i = 0; i < 12; i += 1) {
    out.push({ x: i, v: Math.round((r() - 0.35) * 200) });
  }
  return out;
}

function buildLine(): { x: number; v: number }[] {
  const r = rand(7);
  const out: { x: number; v: number }[] = [];
  let cur = 0;
  for (let i = 0; i < 80; i += 1) {
    cur += (r() - 0.5) * 6;
    out.push({ x: i, v: Math.round(cur * 10) / 10 });
  }
  return out;
}

/**
 * Plausible-looking candle data so the Price + trades empty state actually
 * looks like a candlestick chart (real wicks/bodies/colors), not an equity curve.
 *
 * Each row carries:
 *   - lowHigh:    [low, high]   → wick (high–low spread)
 *   - openClose:  [open, close] → body (open–close range, color via cell)
 *   - up: boolean → green vs red coloring per candle
 */
function buildCandles(): {
  x: number;
  lowHigh: [number, number];
  openClose: [number, number];
  up: boolean;
}[] {
  const r = rand(53);
  const N = 64;
  const out: {
    x: number;
    lowHigh: [number, number];
    openClose: [number, number];
    up: boolean;
  }[] = [];
  let cur = 100;
  // mild upward drift with chunky candles
  for (let i = 0; i < N; i += 1) {
    const drift = 0.35 + (r() - 0.4) * 1.5;
    const open = cur;
    const close = open + drift + (r() - 0.5) * 4;
    const wickHigh = Math.max(open, close) + r() * 2.2;
    const wickLow = Math.min(open, close) - r() * 2.2;
    const up = close >= open;
    out.push({
      x: i,
      lowHigh: [wickLow, wickHigh],
      openClose: up ? [open, close] : [close, open],
      up,
    });
    cur = close;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Renderers
// ─────────────────────────────────────────────────────────────────────────

function renderChart(type: ShellType, data: any[], grid: string, axis: string) {
  if (type === "candles") {
    // Render two stacked Bars per candle: thin wick (low→high) + thick body (open→close).
    // Recharts Bars accept [low, high] tuples for floating bars.
    return (
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        barCategoryGap={3}
      >
        <CartesianGrid strokeDasharray="2 4" stroke={grid} vertical={false} />
        <XAxis dataKey="x" stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis
          stroke={axis}
          tick={{ fontSize: 9 }}
          tickLine={false}
          axisLine={false}
          domain={["dataMin - 2", "dataMax + 2"]}
          orientation="right"
        />
        {/* Wick — thin floating bar from low to high */}
        <Bar dataKey="lowHigh" barSize={1.5} isAnimationActive={false}>
          {data.map((d: any, i: number) => (
            <Cell key={`wick-${i}`} fill={d.up ? "hsl(142 71% 50%)" : "hsl(0 84% 65%)"} fillOpacity={0.8} />
          ))}
        </Bar>
        {/* Body — thick floating bar from open to close */}
        <Bar dataKey="openClose" barSize={6} isAnimationActive={false}>
          {data.map((d: any, i: number) => (
            <Cell
              key={`body-${i}`}
              fill={d.up ? "hsl(142 71% 50%)" : "hsl(0 84% 65%)"}
              fillOpacity={d.up ? 0.85 : 0.85}
              stroke={d.up ? "hsl(142 71% 60%)" : "hsl(0 84% 70%)"}
              strokeWidth={1}
            />
          ))}
        </Bar>
      </ComposedChart>
    );
  }

  if (type === "mc-fan") {
    // Build band data so the area renders as a proper envelope between p5 and p95
    const bandData = data.map((d: any) => ({ ...d, band: [d.p5, d.p95] }));
    return (
      <ComposedChart data={bandData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="emcFanBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(160 84% 55%)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="hsl(160 84% 45%)" stopOpacity={0.18} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke={grid} vertical={false} />
        <XAxis dataKey="x" stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <ReferenceLine y={0} stroke="hsl(220 5% 30% / 0.5)" strokeDasharray="2 4" />
        {/* Envelope band p5 → p95 */}
        <Area
          type="monotone"
          dataKey="band"
          stroke="none"
          fill="url(#emcFanBand)"
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
        {/* Median line — most prominent */}
        <Line
          type="monotone"
          dataKey="p50"
          stroke="hsl(160 84% 75%)"
          strokeWidth={2.4}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    );
  }

  if (type === "drawdown") {
    return (
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="emShellDD" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.05} />
            <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0.18} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke={grid} vertical={false} />
        <XAxis dataKey="x" stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <ReferenceLine y={0} stroke="hsl(220 5% 30% / 0.4)" />
        <Area type="monotone" dataKey="v" stroke="hsl(0 84% 60% / 0.5)" fill="url(#emShellDD)" strokeWidth={1.5} />
      </AreaChart>
    );
  }

  if (type === "bar") {
    return (
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={grid} vertical={false} />
        <XAxis dataKey="x" stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <ReferenceLine y={0} stroke="hsl(220 5% 30% / 0.4)" />
        <Bar dataKey="v" radius={[2, 2, 0, 0]} fill="hsl(160 84% 39% / 0.18)" />
      </BarChart>
    );
  }

  if (type === "line") {
    return (
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={grid} vertical={false} />
        <XAxis dataKey="x" stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <ReferenceLine y={0} stroke="hsl(220 5% 30% / 0.4)" />
        <Line type="monotone" dataKey="v" stroke="hsl(160 84% 50% / 0.7)" dot={false} strokeWidth={1.5} />
      </LineChart>
    );
  }

  // equity (default)
  return (
    <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
      <defs>
        <linearGradient id="emShellEq" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(160 84% 50%)" stopOpacity={0.45} />
          <stop offset="100%" stopColor="hsl(160 84% 50%)" stopOpacity={0.04} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="2 4" stroke={grid} vertical={false} />
      <XAxis dataKey="x" stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
      <YAxis stroke={axis} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
      <Area type="monotone" dataKey="v" stroke="hsl(160 84% 65%)" fill="url(#emShellEq)" strokeWidth={2.2} />
    </AreaChart>
  );
}
