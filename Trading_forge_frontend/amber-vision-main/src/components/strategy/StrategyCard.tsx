import { memo } from "react";
import { ArrowUpRight, Calendar } from "lucide-react";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { TiltCard, TiltLayer } from "@/components/ui/tilt-card";
import { getThumbnailUrlBySymbol } from "@/lib/strategyThumbnail";
import { deriveCardMetricsFromBacktest, formatPercent, formatSignedPnl } from "@/lib/strategyMetrics";
import { num, timeAgo } from "@/lib/utils";
import { humanizeStrategyName } from "@/lib/humanizeStrategyName";
import type { Backtest, Strategy } from "@/types/api";

interface Props {
  strategy: Strategy;
  backtest: Backtest | null | undefined;
  onClick?: () => void;
  highlight?: boolean;
}

const tierVariant = (tier: string | null | undefined) => {
  if (!tier) return "neutral" as const;
  if (tier === "TIER_1") return "profit" as const;
  if (tier === "TIER_2") return "amber" as const;
  if (tier === "TIER_3") return "info" as const;
  if (tier === "REJECTED") return "loss" as const;
  return "neutral" as const;
};

const lifecycleVariant = (lifecycleState: string) => {
  switch (lifecycleState) {
    case "DEPLOYED":
    case "PILOT":
      return "profit" as const;
    case "DEPLOY_READY":
      return "amber" as const;
    case "PAPER":
      return "info" as const;
    case "DECLINING":
      return "loss" as const;
    case "RETIRED":
    case "GRAVEYARD":
      return "neutral" as const;
    default:
      return "info" as const;
  }
};

function StrategyCardInner({ strategy, backtest, onClick, highlight }: Props) {
  const m = deriveCardMetricsFromBacktest(backtest);
  const score = num(strategy.forgeScore);
  const tier = backtest?.tier ?? null;
  const isTier1 = tier === "TIER_1";
  const thumbnail = getThumbnailUrlBySymbol(strategy.symbol, strategy.id);

  return (
    <TiltCard
      glow={isTier1 || highlight}
      intensity={6}
      className="p-0 overflow-hidden"
      onClick={onClick}
    >
      <div className="flex flex-col md:flex-row min-h-[260px]">
        {/* Left: header + metrics + footer */}
        <div className="flex-1 p-5 flex flex-col">
          {/* Header label + status */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-mono font-bold text-emerald tracking-wider">
              {strategy.symbol}
            </span>
            <span className="text-[10px] text-text-muted">·</span>
            <span className="text-[10px] uppercase tracking-widest text-text-muted">
              {strategy.timeframe}
            </span>
            <StatusBadge variant={lifecycleVariant(strategy.lifecycleState)} dot>
              {strategy.lifecycleState.replace("_", " ").toLowerCase()}
            </StatusBadge>
          </div>

          {/* Name */}
          <TiltLayer depth={30}>
            <h3 className="text-base font-semibold text-foreground tracking-tight mb-3 line-clamp-2">
              {humanizeStrategyName(strategy.name)}
            </h3>
          </TiltLayer>

          {/* Metrics block */}
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-xs flex-1">
            <Metric
              label="PnL"
              value={m.pnl !== 0 ? formatSignedPnl(m.pnl, { compact: true }) : "—"}
              valueClass={m.pnl > 0 ? "text-profit" : m.pnl < 0 ? "text-loss" : "text-text-muted"}
            />
            <Metric
              label="Sharpe"
              value={m.sharpe > 0 ? m.sharpe.toFixed(2) : "—"}
              valueClass={m.sharpe >= 1.5 ? "text-profit" : m.sharpe >= 1 ? "text-emerald" : undefined}
            />
            <Metric
              label="Avg win"
              value={m.avgWin > 0 ? formatSignedPnl(m.avgWin) : "—"}
              valueClass={m.avgWin > 0 ? "text-profit" : undefined}
            />
            <Metric
              label="Win rate"
              value={m.winRate > 0 ? formatPercent(m.winRate) : "—"}
              valueClass={m.winRate >= 0.6 ? "text-profit" : undefined}
            />
            <Metric
              label="Avg loss"
              value={m.avgLoss < 0 ? formatSignedPnl(m.avgLoss) : "—"}
              valueClass={m.avgLoss < 0 ? "text-loss" : undefined}
            />
            <Metric
              label="Drawdown"
              value={m.drawdown > 0 ? formatSignedPnl(-m.drawdown, { compact: true }) : "—"}
              valueClass={m.drawdown > 0 ? "text-loss" : undefined}
            />
          </div>

          {/* Footer */}
          <div className="flex items-end justify-between mt-4 pt-3 border-t border-border/15">
            <div className="flex items-center gap-3">
              <TiltLayer depth={45}>
                <ForgeScoreRing score={score} size={56} strokeWidth={4} label="" />
              </TiltLayer>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-widest text-text-muted">
                  Forge Score
                </span>
                <div className="flex items-center gap-2">
                  {tier && (
                    <StatusBadge variant={tierVariant(tier)}>
                      {tier.replace("_", " ")}
                    </StatusBadge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-emerald hover:text-emerald-deep transition-colors">
              View detail
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-text-muted mt-2">
            <Calendar className="w-3 h-3" />
            <span>Last backtest: {backtest ? timeAgo(backtest.createdAt) : "—"}</span>
          </div>
        </div>

        {/* Right: thumbnail */}
        <div className="md:w-[42%] relative overflow-hidden border-t md:border-t-0 md:border-l border-emerald-500/10">
          <TiltLayer depth={20} className="absolute inset-0">
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover scale-105 transition-transform duration-500 hover:scale-110"
              style={{ filter: "saturate(110%)" }}
            />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, hsl(220 10% 3% / 0.45) 0%, transparent 35%, hsl(160 84% 39% / 0.18) 100%)",
              }}
            />
          </TiltLayer>
        </div>
      </div>
    </TiltCard>
  );
}

function Metric({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
      <span className={`text-xs font-mono font-semibold ${valueClass ?? "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

export const StrategyCard = memo(StrategyCardInner);
