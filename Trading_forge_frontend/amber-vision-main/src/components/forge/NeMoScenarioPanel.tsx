/**
 * NeMo Scenario Panel — Track 1 (Challenger-Only, Phase 0)
 *
 * Displays the latest 10 NeMo macro-narrative scenarios from the bank.
 * Each row shows: scenario label, severity badge, duration, vol/trend,
 * and the narrative summary. No OHLCV chart (A14 chart deferred per plan §12).
 *
 * Data source: GET /api/nemo-scenarios/recent?limit=10
 * Refreshes every 60s (same cadence as ValidationCadencePanel).
 *
 * Visual style: emerald (#10B981) on near-black, glassy 3D floating card.
 * Phase 0 advisory microcopy on every row — never presents evidence as authoritative.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Brain, Loader2, AlertTriangle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { api } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NeMoScenarioRow {
  id: number;
  scenarioLabel: string;
  severity: "mild" | "moderate" | "severe" | "extreme";
  durationDays: number;
  targetVol: string | null;
  targetTrend: string | null;
  scenarioJson: {
    narrative?: string;
    macro_links?: Record<string, string>;
    target_gap_profile?: Record<string, unknown>;
    generator_version?: string;
  };
  generatorVersion: string;
  createdAt: string;
}

interface ApiResponse {
  scenarios: NeMoScenarioRow[];
  count: number;
  governance: { authoritative: boolean; decision_role: string };
}

// ─── Severity badge ───────────────────────────────────────────────────────────

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case "extreme": return "bg-red-900/60 text-red-300 border border-red-700/50";
    case "severe":  return "bg-orange-900/50 text-orange-300 border border-orange-700/40";
    case "moderate": return "bg-amber-900/40 text-amber-300 border border-amber-700/40";
    case "mild":
    default:        return "bg-zinc-800/60 text-zinc-400 border border-zinc-700/40";
  }
}

function TrendIcon({ trend }: { trend: number }) {
  if (trend > 0.1) return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (trend < -0.1) return <TrendingDown className="h-3 w-3 text-red-400" />;
  return <Minus className="h-3 w-3 text-zinc-500" />;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function NeMoScenarioPanel() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const result = await api.get<ApiResponse>("/api/nemo-scenarios/recent?limit=10");
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load NeMo scenarios");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-zinc-800/60 bg-zinc-900/70 backdrop-blur-md shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-zinc-100">NeMo Scenario Bank</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700/40 ml-1">
            advisory · Phase 0
          </span>
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
      </div>

      {/* Body */}
      <div className="p-4 space-y-2.5">
        {error && (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-800/30 rounded-lg px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && (!data || data.scenarios.length === 0) && (
          <p className="text-xs text-zinc-500 text-center py-6">
            No scenarios yet. Run weekly cron or trigger via POST /api/nemo-scenarios/generate.
          </p>
        )}

        {data?.scenarios.map((s) => {
          const vol = s.targetVol ? parseFloat(s.targetVol) : null;
          const trend = s.targetTrend ? parseFloat(s.targetTrend) : null;
          const narrative = s.scenarioJson?.narrative ?? "";

          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl bg-zinc-800/40 border border-zinc-700/30 px-4 py-3 space-y-1.5"
            >
              {/* Row 1: label + severity + duration */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-zinc-300 truncate max-w-[200px]">
                  {s.scenarioLabel}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${severityBadgeClass(s.severity)}`}>
                  {s.severity}
                </span>
                <span className="text-[10px] text-zinc-500">
                  {s.durationDays}d
                </span>
                {vol !== null && (
                  <span className="text-[10px] text-zinc-500">
                    vol {(vol * 100).toFixed(0)}%
                  </span>
                )}
                {trend !== null && (
                  <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                    <TrendIcon trend={trend} />
                    {trend > 0 ? "+" : ""}{(trend * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              {/* Row 2: narrative snippet */}
              {narrative && (
                <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                  {narrative}
                </p>
              )}

              {/* Row 3: timestamp */}
              <div className="text-[10px] text-zinc-600">
                {new Date(s.createdAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Footer governance note */}
      <div className="px-5 py-2.5 border-t border-zinc-800/40 bg-zinc-900/40">
        <p className="text-[10px] text-zinc-600">
          Challenger-only evidence. NeMo scenarios condition A14 VAE; outputs are advisory.
          No authority over entry, exit, sizing, or lifecycle promotion.
        </p>
      </div>
    </motion.div>
  );
}
