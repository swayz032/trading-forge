/**
 * Volume Profile Panel — Track 2 (Volume Profile EXPANDED)
 *
 * Operator morning glance card: daily POC/VAH/VAL + profile shape (D/b/P/Thin)
 * + IB high/low/extension status + open-relative-to-value classification.
 *
 * Data source: GET /api/volume-profile/latest?symbol=<SYM>
 * Refreshes every 60s (same cadence as ValidationCadencePanel).
 *
 * Visual style: emerald (#10B981) on near-black, glassy 3D floating card.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Loader2, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api } from "@/lib/api-client";

interface VPLevels {
  symbol: string;
  sessionDate: string;
  poc: number;
  vah: number;
  val: number;
  nakedPocs: Array<{ price: number; source_date: string }>;
  profileShape: string;       // 'D' | 'b' | 'P' | 'Thin'
  shapeConfidence: number;
  ibHigh: number | null;
  ibLow: number | null;
  ibExtensionStatus: string | null;
  openClassification: string | null;
  computedAt: string;
}

const SYMBOLS = ["MES", "MNQ", "MCL"] as const;

// ─── Shape icon + label ────────────────────────────────────────────────────

function ShapeIcon({ shape }: { shape: string }) {
  switch (shape) {
    case "b": return <TrendingUp className="h-4 w-4 text-emerald-400" />;
    case "P": return <TrendingDown className="h-4 w-4 text-red-400" />;
    case "Thin": return <TrendingUp className="h-4 w-4 text-amber-400" />;
    case "D":
    default:  return <Minus className="h-4 w-4 text-zinc-400" />;
  }
}

function shapeBadgeClass(shape: string): string {
  switch (shape) {
    case "b":    return "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40";
    case "P":    return "bg-red-900/40 text-red-300 border border-red-700/40";
    case "Thin": return "bg-amber-900/40 text-amber-300 border border-amber-700/40";
    case "D":
    default:     return "bg-zinc-800/60 text-zinc-400 border border-zinc-700/40";
  }
}

function ibBadgeClass(status: string | null): string {
  if (!status) return "bg-zinc-800/60 text-zinc-500";
  if (status === "IB_HOLD") return "bg-zinc-800/60 text-zinc-400";
  if (status.includes("UP")) return "bg-emerald-900/40 text-emerald-300";
  if (status.includes("DOWN")) return "bg-red-900/40 text-red-300";
  return "bg-amber-900/40 text-amber-300"; // BOTH
}

function ibLabel(status: string | null): string {
  if (!status) return "—";
  const map: Record<string, string> = {
    IB_HOLD: "IB Hold",
    IB_EXTENSION_UP: "Ext ↑",
    IB_EXTENSION_DOWN: "Ext ↓",
    IB_EXTENSION_BOTH: "Ext ↕",
  };
  return map[status] ?? status;
}

function openClassLabel(cls: string | null): string {
  if (!cls) return "—";
  const map: Record<string, string> = {
    "Open-In-Value": "In Value",
    "Open-Outside-Value-Up": "Above Value",
    "Open-Outside-Value-Down": "Below Value",
    "Open-Outside-Range": "Outside Range",
  };
  return map[cls] ?? cls;
}

// ─── Single-symbol card ────────────────────────────────────────────────────

function SymbolVPCard({ symbol }: { symbol: string }) {
  const [levels, setLevels] = useState<VPLevels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchLevels() {
      try {
        const data = await api.get<VPLevels>(`/api/volume-profile/latest?symbol=${symbol}`);
        if (!cancelled) {
          setLevels(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg.includes("404") ? "No data yet" : "Fetch error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLevels();
    const interval = setInterval(fetchLevels, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-md p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex flex-col gap-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">{symbol}</span>
        </div>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 text-zinc-500 animate-spin" />
        ) : error ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        ) : null}
      </div>

      {/* No data */}
      {!loading && error && (
        <p className="text-xs text-zinc-500 italic">{error}</p>
      )}

      {/* Data */}
      {levels && (
        <>
          {/* Profile shape + session date */}
          <div className="flex items-center gap-2">
            <ShapeIcon shape={levels.profileShape} />
            <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${shapeBadgeClass(levels.profileShape)}`}>
              {levels.profileShape}
            </span>
            <span className="text-xs text-zinc-500 ml-auto">{levels.sessionDate}</span>
          </div>

          {/* POC / VAH / VAL */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "VAH", value: levels.vah, cls: "text-emerald-400" },
              { label: "POC", value: levels.poc, cls: "text-white font-semibold" },
              { label: "VAL", value: levels.val, cls: "text-red-400" },
            ].map(({ label, value, cls }) => (
              <div key={label} className="flex flex-col items-center rounded-lg bg-white/5 py-2">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</span>
                <span className={`text-xs font-mono mt-0.5 ${cls}`}>{value.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* IB levels */}
          {(levels.ibHigh != null || levels.ibLow != null) && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">IB</span>
              {levels.ibHigh != null && (
                <span className="font-mono text-emerald-300">{levels.ibHigh.toFixed(2)}</span>
              )}
              <span className="text-zinc-600">—</span>
              {levels.ibLow != null && (
                <span className="font-mono text-red-300">{levels.ibLow.toFixed(2)}</span>
              )}
              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${ibBadgeClass(levels.ibExtensionStatus)}`}>
                {ibLabel(levels.ibExtensionStatus)}
              </span>
            </div>
          )}

          {/* Open classification */}
          {levels.openClassification && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Open</span>
              <span className="text-zinc-300">{openClassLabel(levels.openClassification)}</span>
            </div>
          )}

          {/* Naked POCs count */}
          {levels.nakedPocs.length > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Naked POCs</span>
              <span className="text-amber-400 font-mono">{levels.nakedPocs.length}</span>
            </div>
          )}

          {/* Shape confidence */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Confidence</span>
            <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${Math.round(levels.shapeConfidence * 100)}%` }}
              />
            </div>
            <span className="text-zinc-400 font-mono">{Math.round(levels.shapeConfidence * 100)}%</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ─── Panel ─────────────────────────────────────────────────────────────────

export function VolumeProfilePanel() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 px-1">
        <BarChart3 className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white tracking-wide">Volume Profile</h2>
        <span className="text-[10px] text-zinc-500 ml-2">Daily POC · IB · Open</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SYMBOLS.map((sym) => (
          <SymbolVPCard key={sym} symbol={sym} />
        ))}
      </div>
    </div>
  );
}
