import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { TiltCard, TiltLayer } from "@/components/ui/tilt-card";
import { useBacktests } from "@/hooks/useBacktests";
import { useStrategies } from "@/hooks/useStrategies";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { timeAgo } from "@/lib/utils";

const tierVariant = (tier: string | null | undefined) => {
  if (!tier) return "neutral" as const;
  if (tier === "TIER_1") return "profit" as const;
  if (tier === "TIER_2") return "amber" as const;
  if (tier === "TIER_3") return "info" as const;
  if (tier === "REJECTED") return "loss" as const;
  return "neutral" as const;
};

export function FreshStrategiesRow() {
  const navigate = useNavigate();
  const { data: backtests } = useBacktests({ status: "completed", limit: 12 });
  const { data: strategies } = useStrategies();

  const items = useMemo(() => {
    if (!backtests?.length || !strategies?.length) return [];
    const stratById = new Map(strategies.map((s) => [s.id, s]));
    return [...backtests]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 4)
      .map((bt) => {
        const s = stratById.get(bt.strategyId);
        return {
          id: bt.id,
          strategyId: bt.strategyId,
          name: s?.name ?? "Strategy",
          symbol: bt.symbol,
          timeframe: bt.timeframe,
          tier: bt.tier ?? null,
          createdAt: bt.createdAt,
        };
      });
  }, [backtests, strategies]);

  const Header = (
    <div className="flex items-center gap-2 mb-3 shrink-0">
      <Sparkles className="w-4 h-4 text-emerald" />
      <h2 className="text-xs uppercase tracking-widest text-text-secondary font-medium">
        Fresh strategies just tested
      </h2>
      <span className="text-[10px] text-text-muted ml-auto">
        {items.length === 0 ? "queue empty" : `last ${items.length}`}
      </span>
    </div>
  );

  // Empty: 4 ghost premium cards
  if (items.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {Header}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1 [&>*]:h-full">
          {Array.from({ length: 4 }).map((_, i) => (
            <PremiumGhost key={i} delay={i * 0.06} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {Header}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1 [&>*]:h-full">
        {items.map((it, i) => {
          const isTier1 = it.tier === "TIER_1";
          return (
            <motion.div
              key={it.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="min-h-[140px] h-full"
            >
              <TiltCard
                glow={isTier1}
                intensity={5}
                className="h-full p-0 overflow-hidden"
                onClick={() => navigate(`/strategies/${it.strategyId}`)}
              >
                {/* soft tone wash */}
                <div
                  aria-hidden
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(circle at 90% -10%, hsl(160 84% 39% / 0.12), transparent 55%)",
                  }}
                />
                <div className="relative z-10 p-4 h-full flex flex-col">
                  {/* Top: symbol + tier */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-bold text-emerald tracking-wider">
                        {it.symbol}
                      </span>
                      {it.timeframe && (
                        <>
                          <span className="text-[9px] text-text-muted">·</span>
                          <span className="text-[9px] uppercase tracking-widest text-text-muted">
                            {it.timeframe}
                          </span>
                        </>
                      )}
                    </div>
                    {it.tier && (
                      <StatusBadge variant={tierVariant(it.tier)}>
                        {it.tier.replace("_", " ")}
                      </StatusBadge>
                    )}
                  </div>

                  {/* Title — the star of the card */}
                  <TiltLayer depth={28}>
                    <h3 className="text-[14px] font-semibold text-foreground tracking-tight leading-snug line-clamp-2 flex-1">
                      {it.name}
                    </h3>
                  </TiltLayer>

                  {/* Footer: time + open arrow */}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/15 text-[10px]">
                    <span className="text-text-muted">{timeAgo(it.createdAt)}</span>
                    <span className="flex items-center gap-1 text-emerald opacity-70 hover:opacity-100 transition-opacity">
                      Open
                      <ArrowUpRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </TiltCard>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function PremiumGhost({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="min-h-[140px] h-full"
    >
      <TiltCard intensity={3} className="h-full p-0 overflow-hidden">
        {/* Pulsing emerald aura — feels alive, not dead */}
        <motion.div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          animate={{
            opacity: [0.3, 0.7, 0.3],
          }}
          transition={{
            duration: 3.5,
            repeat: Infinity,
            ease: "easeInOut",
            delay: delay * 1.5,
          }}
          style={{
            background:
              "radial-gradient(circle at 90% -10%, hsl(160 84% 39% / 0.10), transparent 55%)",
          }}
        />

        {/* Subtle scanline shimmer */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, hsl(160 84% 39% / 0.04) 50%, transparent 100%)",
          }}
        />

        <div className="relative z-10 p-4 h-full flex flex-col">
          {/* Top: animated dots in place of symbol */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1 h-1 rounded-full bg-emerald-500/50"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </div>
            <span className="text-[9px] uppercase tracking-widest text-emerald/60">
              scouting
            </span>
          </div>

          {/* Centered "awaiting" content with sparkle */}
          <div className="flex-1 flex flex-col items-start justify-center">
            <TiltLayer depth={20}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles className="w-3 h-3 text-emerald-500/60" />
                <h3 className="text-[13px] font-semibold text-text-secondary leading-snug">
                  Awaiting next strategy
                </h3>
              </div>
            </TiltLayer>
            <p className="text-[10px] text-text-muted/70 leading-relaxed">
              The scout will drop one here as soon as it lands
            </p>
          </div>

          {/* Footer: pipeline pulse */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-emerald-500/10 text-[10px]">
            <span className="flex items-center gap-1.5 text-text-muted">
              <span className="status-dot bg-emerald-500/40" />
              pipeline live
            </span>
            <span className="text-text-muted/50 font-mono">—</span>
          </div>
        </div>
      </TiltCard>
    </motion.div>
  );
}
