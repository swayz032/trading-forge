import { useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Rocket, ShieldCheck, Sparkles } from "lucide-react";
import { StrategyCard } from "@/components/strategy/StrategyCard";
import { useStrategies } from "@/hooks/useStrategies";
import { useBacktests } from "@/hooks/useBacktests";
import { useSSE } from "@/hooks/useSSE";

const DEPLOY_READY_STATES = ["DEPLOY_READY", "PILOT"] as const;

export default function DeployReady() {
  useSSE([
    "strategy:promoted",
    "strategy:analyzed",
    "scheduler:sharpe-updated",
    // Wire lifecycle gate decisions so operator sees A7/Frankenstein/PILOT results
    // in real-time on the Promotion Queue page (Wave 4, 2026-05-16).
    "lifecycle:gate_evaluated",
    "lifecycle:promoted",
  ]);

  const navigate = useNavigate();
  const { data: strategies, isLoading: sLoad } = useStrategies();
  const { data: backtests, isLoading: bLoad } = useBacktests();

  const backtestByStrategy = useMemo(() => {
    const map = new Map<string, NonNullable<typeof backtests>[number]>();
    if (!backtests?.length) return map;
    const completed = [...backtests]
      .filter((bt) => bt.status === "completed")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (const bt of completed) {
      if (!map.has(bt.strategyId)) map.set(bt.strategyId, bt);
    }
    return map;
  }, [backtests]);

  const grouped = useMemo(() => {
    const groups: Record<typeof DEPLOY_READY_STATES[number], NonNullable<typeof strategies>> = {
      DEPLOY_READY: [],
      PILOT: [],
    };
    if (!strategies?.length) return groups;
    for (const s of strategies) {
      if (s.lifecycleState === "DEPLOY_READY") groups.DEPLOY_READY.push(s);
      else if (s.lifecycleState === "PILOT") groups.PILOT.push(s);
    }
    return groups;
  }, [strategies]);

  const totalCount = grouped.DEPLOY_READY.length + grouped.PILOT.length;
  const isLoading = sLoad || bLoad;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Promotion Queue</h1>
        <p className="text-sm text-text-secondary">Loading deploy-ready strategies…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between gap-4 flex-wrap"
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Rocket className="w-5 h-5 text-emerald" />
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              Promotion Queue
            </h1>
          </div>
          <p className="text-sm text-text-secondary">
            Strategies that passed validation and are ready for deployment.{" "}
            <span className="text-emerald font-medium">{totalCount}</span> strategies queued.
          </p>
        </div>
      </motion.div>

      {totalCount === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="forge-card-glow p-12 text-center"
        >
          <Sparkles className="w-10 h-10 text-emerald mx-auto mb-4 opacity-70" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Queue is empty</h2>
          <p className="text-sm text-text-secondary max-w-md mx-auto leading-relaxed">
            Strategies appear here after passing the PAPER → DEPLOY_READY gate
            (A7 signal-correlation, B5 multi-firm eligibility, B10 MRP soft gate).
            Run the scout pipeline to generate candidates.
          </p>
        </motion.div>
      ) : (
        <>
          {/* PILOT — canary track */}
          {grouped.PILOT.length > 0 && (
            <Section
              icon={<ShieldCheck className="w-4 h-4 text-emerald" />}
              title="Pilot — canary live"
              subtitle="5-session canary at 1 contract. Auto-promotes to DEPLOYED on rolling Sharpe ≥ 1.0."
              count={grouped.PILOT.length}
            >
              <Grid>
                {grouped.PILOT.map((s, i) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.05 }}
                  >
                    <StrategyCard
                      strategy={s}
                      backtest={backtestByStrategy.get(s.id) ?? null}
                      onClick={() => navigate(`/strategies/${s.id}`)}
                      highlight
                    />
                  </motion.div>
                ))}
              </Grid>
            </Section>
          )}

          {/* DEPLOY_READY */}
          {grouped.DEPLOY_READY.length > 0 && (
            <Section
              icon={<Rocket className="w-4 h-4 text-emerald" />}
              title="Deploy ready"
              subtitle="Passed all promotion gates. Promote to PILOT for the canary track or directly to DEPLOYED."
              count={grouped.DEPLOY_READY.length}
            >
              <Grid>
                {grouped.DEPLOY_READY.map((s, i) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.05 }}
                  >
                    <StrategyCard
                      strategy={s}
                      backtest={backtestByStrategy.get(s.id) ?? null}
                      onClick={() => navigate(`/strategies/${s.id}`)}
                    />
                  </motion.div>
                ))}
              </Grid>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  subtitle,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold text-foreground tracking-wide">
            {title}
          </h2>
          <span className="text-[11px] font-mono text-emerald">
            {count.toString().padStart(2, "0")}
          </span>
        </div>
      </div>
      <p className="text-xs text-text-muted mb-4 leading-relaxed max-w-2xl">
        {subtitle}
      </p>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">{children}</div>
  );
}
