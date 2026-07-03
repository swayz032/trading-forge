/**
 * Library Diversity Panel — Track 5 Phase D Readiness
 *
 * Shows:
 *   1. Pie chart — all strategies by school (ICT_HANDCODED vs others)
 *   2. Stacked bar — strategies by school × lifecycle stage
 *   3. ICT_HANDCODED share callout for DEPLOYED strategies
 *
 * Wired to GET /api/library-diversity. Polled every 120s.
 * Pure observability — no actions, no gates.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PieChart, BarChart2, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";

type School =
  | "ICT_HANDCODED"
  | "TREND"
  | "MEAN_REVERSION"
  | "VOLATILITY"
  | "VOLUME_ORDER_FLOW"
  | "SESSION_TIME"
  | "EVENT_DRIVEN"
  | "UNKNOWN";

interface LibraryDiversity {
  byStage: Partial<Record<string, Partial<Record<School, number>>>>;
  total: Partial<Record<School, number>>;
  ictPct: number;
}

const SCHOOL_COLORS: Record<School, string> = {
  ICT_HANDCODED:    "#f59e0b",   // amber — "old school"
  TREND:            "#10b981",   // emerald — primary brand
  MEAN_REVERSION:   "#3b82f6",   // blue
  VOLATILITY:       "#8b5cf6",   // violet
  VOLUME_ORDER_FLOW:"#06b6d4",   // cyan
  SESSION_TIME:     "#ec4899",   // pink
  EVENT_DRIVEN:     "#f97316",   // orange
  UNKNOWN:          "#6b7280",   // gray
};

const SCHOOL_LABELS: Record<School, string> = {
  ICT_HANDCODED:    "ICT / SMC",
  TREND:            "Trend",
  MEAN_REVERSION:   "Mean Rev",
  VOLATILITY:       "Volatility",
  VOLUME_ORDER_FLOW:"Vol / OF",
  SESSION_TIME:     "Session",
  EVENT_DRIVEN:     "Event",
  UNKNOWN:          "Unknown",
};

const LIFECYCLE_ORDER = [
  "CANDIDATE", "TESTING", "PAPER", "DEPLOY_READY",
  "PILOT", "DEPLOYED", "DECLINING", "RETIRED", "GRAVEYARD",
];

const ALL_SCHOOLS = Object.keys(SCHOOL_COLORS) as School[];

function PieSlice({
  school,
  count,
  total,
  startAngle,
}: {
  school: School;
  count: number;
  total: number;
  startAngle: number;
}) {
  if (total === 0 || count === 0) return null;
  const pct = count / total;
  const sweep = pct * 360;
  const r = 60;
  const cx = 80;
  const cy = 80;
  const start = startAngle - 90;
  const end = start + sweep;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(start));
  const y1 = cy + r * Math.sin(toRad(start));
  const x2 = cx + r * Math.cos(toRad(end));
  const y2 = cy + r * Math.sin(toRad(end));
  const largeArc = sweep > 180 ? 1 : 0;

  return (
    <path
      d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
      fill={SCHOOL_COLORS[school]}
      opacity={0.85}
      stroke="#0f172a"
      strokeWidth={1}
    />
  );
}

function PieChart2({ data }: { data: Partial<Record<School, number>> }) {
  const total = ALL_SCHOOLS.reduce((s, k) => s + (data[k] ?? 0), 0);
  let angle = 0;
  return (
    <svg width={160} height={160} className="mx-auto">
      {ALL_SCHOOLS.map((school) => {
        const count = data[school] ?? 0;
        const start = angle;
        angle += (count / Math.max(total, 1)) * 360;
        return (
          <PieSlice
            key={school}
            school={school}
            count={count}
            total={total}
            startAngle={start}
          />
        );
      })}
      {/* Center hole */}
      <circle cx={80} cy={80} r={32} fill="#0f172a" />
      <text x={80} y={76} textAnchor="middle" fill="#e2e8f0" fontSize={11} fontWeight="bold">
        {total}
      </text>
      <text x={80} y={89} textAnchor="middle" fill="#94a3b8" fontSize={9}>
        total
      </text>
    </svg>
  );
}

function StackedBar({
  stage,
  data,
  maxCount,
}: {
  stage: string;
  data: Partial<Record<School, number>>;
  maxCount: number;
}) {
  const total = ALL_SCHOOLS.reduce((s, k) => s + (data[k] ?? 0), 0);
  if (total === 0) return null;
  const barWidth = Math.max(4, (total / Math.max(maxCount, 1)) * 160);

  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xs text-slate-400 w-24 text-right truncate">{stage}</span>
      <div className="flex h-4 rounded overflow-hidden" style={{ width: barWidth }}>
        {ALL_SCHOOLS.map((school) => {
          const count = data[school] ?? 0;
          if (count === 0) return null;
          return (
            <div
              key={school}
              style={{
                width: `${(count / total) * 100}%`,
                background: SCHOOL_COLORS[school],
                opacity: 0.85,
              }}
              title={`${SCHOOL_LABELS[school]}: ${count}`}
            />
          );
        })}
      </div>
      <span className="text-xs text-slate-500">{total}</span>
    </div>
  );
}

export function LibraryDiversityPanel() {
  const [data, setData] = useState<LibraryDiversity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await api.get<{ success: boolean; data: LibraryDiversity }>(
        // api-client prepends /api — path must be bare (deep-scan #13: double-/api 404)
        "/library-diversity"
      );
      if (res.success) setData(res.data);
    } catch (err) {
      setError("Failed to load library diversity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 120_000);
    return () => clearInterval(interval);
  }, []);

  const ictPctDisplay = data ? Math.round(data.ictPct * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-5 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <PieChart className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-slate-200">Library Diversity</span>
        </div>
        {loading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {data && (
        <div className="space-y-5">
          {/* ICT share callout */}
          <div
            className={`rounded-lg px-4 py-2 text-center ${
              ictPctDisplay > 60
                ? "bg-amber-900/30 border border-amber-700/40"
                : "bg-emerald-900/20 border border-emerald-700/30"
            }`}
          >
            <p className="text-xs text-slate-400">ICT share of DEPLOYED</p>
            <p
              className={`text-2xl font-bold ${
                ictPctDisplay > 60 ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {ictPctDisplay}%
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {ictPctDisplay > 60
                ? "Diversify via scout pipeline"
                : "On track"}
            </p>
          </div>

          {/* Pie chart — total by school */}
          <div>
            <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
              <PieChart className="w-3 h-3" /> All strategies by school
            </p>
            <PieChart2 data={data.total} />
            {/* Legend */}
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
              {ALL_SCHOOLS.filter((s) => (data.total[s] ?? 0) > 0).map((school) => (
                <div key={school} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: SCHOOL_COLORS[school] }}
                  />
                  <span className="text-xs text-slate-400 truncate">
                    {SCHOOL_LABELS[school]}
                  </span>
                  <span className="text-xs text-slate-500 ml-auto">
                    {data.total[school]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Stacked bar — by lifecycle stage */}
          <div>
            <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
              <BarChart2 className="w-3 h-3" /> By lifecycle stage
            </p>
            {(() => {
              const maxCount = LIFECYCLE_ORDER.reduce((m, stage) => {
                const stageBucket = data.byStage[stage] ?? {};
                const t = ALL_SCHOOLS.reduce((s, k) => s + (stageBucket[k] ?? 0), 0);
                return Math.max(m, t);
              }, 1);
              return LIFECYCLE_ORDER.map((stage) => (
                <StackedBar
                  key={stage}
                  stage={stage}
                  data={data.byStage[stage] ?? {}}
                  maxCount={maxCount}
                />
              ));
            })()}
          </div>
        </div>
      )}
    </motion.div>
  );
}
