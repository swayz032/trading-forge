import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Factory, Trophy, Skull, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { useStrategiesByLifecycle } from "@/hooks/useStrategies";
import { useSSE } from "@/hooks/useSSE";
import type { Strategy } from "@/types/api";

// ──────────────────────────────────────────────────────────────────────────
// The strategy library as an assembly line: Factory Floor → Deploy → Graveyard.
// Read-only. NO lifecycle-mutation controls — promotions/demotions stay on the
// existing PATCH path. Each bin is one filtered API call (comma-separated
// lifecycleState → backend inArray filter).
// ──────────────────────────────────────────────────────────────────────────

type BinKey = "factory" | "deploy" | "graveyard";

const FACTORY_STATES = ["CANDIDATE", "TESTING", "SHADOW", "PAPER"] as const;
const DEPLOY_STATES = ["DEPLOY_READY", "PILOT", "DEPLOYED"] as const;
const GRAVEYARD_STATES = ["GRAVEYARD", "RETIRED", "DECLINING"] as const;

// Plain-English stage labels — operator is non-technical for stats.
const STAGE_LABEL: Record<string, string> = {
  CANDIDATE: "Backtesting",
  TESTING: "Stress-testing",
  SHADOW: "Shadow (signals only)",
  PAPER: "Paper trading",
  DEPLOY_READY: "Ready to deploy",
  PILOT: "Live canary",
  DEPLOYED: "Live",
  DECLINING: "Declining",
  GRAVEYARD: "Retired / failed",
  RETIRED: "Retired",
};

// Per-stage badge color so the pill reads at a glance.
function stageVariant(state: string): "info" | "amber" | "profit" | "regime" | "loss" | "neutral" {
  switch (state) {
    case "CANDIDATE":
    case "TESTING":
      return "info";
    case "SHADOW":
    case "PAPER":
      return "regime";
    case "DEPLOY_READY":
    case "PILOT":
      return "amber";
    case "DEPLOYED":
      return "profit";
    case "DECLINING":
      return "amber";
    case "GRAVEYARD":
    case "RETIRED":
      return "loss";
    default:
      return "neutral";
  }
}

function stageLabel(state: string): string {
  return STAGE_LABEL[state] ?? state;
}

/**
 * Best-effort "why it died" for a Graveyard strategy. There is no
 * `/api/strategies/graveyard` enrichment endpoint exposing the
 * `strategy_graveyard` table's failure reason / killing gate keyed by
 * strategy, so we fall back to whatever the strategy row carries:
 * config death/failure fields if present, else the plain-English stage.
 */
function deathReason(s: Strategy): string {
  const cfg = (s.config ?? {}) as Record<string, unknown>;
  const reason =
    (typeof cfg.death_reason === "string" && cfg.death_reason) ||
    (typeof cfg.deathReason === "string" && cfg.deathReason) ||
    (Array.isArray(cfg.failure_modes) && cfg.failure_modes.length > 0
      ? (cfg.failure_modes as string[]).join(", ")
      : "");
  if (reason) return reason;
  if (s.lifecycleState === "DECLINING") return "Performance decay detected";
  return stageLabel(s.lifecycleState);
}

const BINS: {
  key: BinKey;
  emoji: string;
  icon: typeof Factory;
  title: string;
  subtitle: string;
  states: readonly string[];
}[] = [
  {
    key: "factory",
    emoji: "🏭",
    icon: Factory,
    title: "Factory Floor",
    subtitle: "Work in progress — strategies moving through the validation pipeline.",
    states: FACTORY_STATES,
  },
  {
    key: "deploy",
    emoji: "🏆",
    icon: Trophy,
    title: "Deploy",
    subtitle: "The proven winners shelf — passed the gates and live (or ready).",
    states: DEPLOY_STATES,
  },
  {
    key: "graveyard",
    emoji: "🪦",
    icon: Skull,
    title: "Graveyard",
    subtitle: "Strategies that collapsed or were retired — and why.",
    states: GRAVEYARD_STATES,
  },
];

export default function StrategyLibrary() {
  // Refresh bins on lifecycle/promotion/drift events.
  useSSE([
    "strategy:promoted",
    "strategy:analyzed",
    "strategy:drift-alert",
    "lifecycle:promoted",
    "lifecycle:gate_evaluated",
    "scheduler:sharpe-updated",
  ]);

  const [active, setActive] = useState<BinKey>("factory");

  const factory = useStrategiesByLifecycle(FACTORY_STATES);
  const deploy = useStrategiesByLifecycle(DEPLOY_STATES);
  const graveyard = useStrategiesByLifecycle(GRAVEYARD_STATES);

  const dataByBin: Record<BinKey, Strategy[]> = {
    factory: factory.data ?? [],
    deploy: deploy.data ?? [],
    graveyard: graveyard.data ?? [],
  };
  const loadingByBin: Record<BinKey, boolean> = {
    factory: factory.isLoading,
    deploy: deploy.isLoading,
    graveyard: graveyard.isLoading,
  };

  const activeBin = BINS.find((b) => b.key === active)!;
  const rows = dataByBin[active];
  const isLoading = loadingByBin[active];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Strategy Library
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          The assembly line — every strategy from the Factory Floor to the Graveyard.
        </p>
      </motion.div>

      {/* Bin tabs */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
        className="flex items-center gap-2 flex-wrap"
      >
        {BINS.map((bin) => {
          const Icon = bin.icon;
          const count = dataByBin[bin.key].length;
          const isActive = bin.key === active;
          return (
            <button
              key={bin.key}
              onClick={() => setActive(bin.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium border transition-all duration-200 ${
                isActive
                  ? "bg-emerald-500/15 text-emerald border-emerald-500/30 shadow-[inset_0_0_0_1px_hsl(160_84%_39%/0.2)]"
                  : "text-text-secondary border-border/30 hover:text-foreground hover:bg-surface-2/50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>
                {bin.emoji} {bin.title}
              </span>
              <span
                className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  isActive ? "bg-emerald-500/20 text-emerald" : "bg-surface-2 text-text-muted"
                }`}
              >
                {loadingByBin[bin.key] ? "…" : count}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Active bin subtitle */}
      <p className="text-xs text-text-muted -mt-2 max-w-2xl leading-relaxed">
        {activeBin.subtitle}
      </p>

      {/* Bin contents */}
      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          {isLoading ? (
            <div className="forge-card p-12 text-center">
              <p className="text-sm text-text-muted">Loading {activeBin.title}…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="forge-card p-12 text-center">
              <activeBin.icon className="w-10 h-10 text-text-muted mx-auto mb-4 opacity-50" />
              <p className="text-sm text-text-muted">
                {active === "graveyard"
                  ? "Nothing buried here yet."
                  : active === "deploy"
                  ? "No proven winners on the shelf yet."
                  : "The factory floor is empty."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {rows.map((s, i) => (
                <LibraryCard
                  key={s.id}
                  strategy={s}
                  bin={active}
                  index={i}
                />
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function LibraryCard({
  strategy: s,
  bin,
  index,
}: {
  strategy: Strategy;
  bin: BinKey;
  index: number;
}) {
  const navigate = useNavigate();
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4) }}
      className="forge-card p-5 cursor-pointer group"
      onClick={() => navigate(`/strategies/${s.id}`)}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-mono font-semibold text-primary">{s.symbol}</span>
            <StatusBadge variant={stageVariant(s.lifecycleState)} dot>
              {stageLabel(s.lifecycleState)}
            </StatusBadge>
          </div>
          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
            {s.name}
          </h3>
          {s.description && (
            <p className="text-[11px] text-text-muted mt-1 line-clamp-2 leading-relaxed">
              {s.description}
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-text-muted shrink-0 group-hover:text-emerald transition-colors" />
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between pt-3 border-t border-border/20 text-[10px] text-text-muted">
        <span className="font-mono">{s.timeframe}</span>
        {s.preferredRegime && (
          <span className="uppercase tracking-wider">{s.preferredRegime}</span>
        )}
      </div>

      {/* Graveyard: show WHY it died */}
      {bin === "graveyard" && (
        <div className="mt-3 pt-3 border-t border-loss/15">
          <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-1">
            Cause of death
          </span>
          <p className="text-[11px] text-loss leading-relaxed line-clamp-3">
            {deathReason(s)}
          </p>
        </div>
      )}
    </motion.div>
  );
}
