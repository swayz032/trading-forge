import { motion } from "framer-motion";
import { Bot, Zap, Search, TrendingUp, Filter, ArrowRight, Activity, Loader2 } from "lucide-react";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAgentJobs, useFindStrategies } from "@/hooks/useAgent";
import { useScoutFunnel } from "@/hooks/useJournal";
import { num, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

const statusMap: Record<string, { variant: "profit" | "amber" | "neutral" | "info"; label: string }> = {
  success: { variant: "profit", label: "Success" },
  completed: { variant: "profit", label: "Completed" },
  active: { variant: "profit", label: "Active" },
  running: { variant: "info", label: "Running" },
  pending: { variant: "amber", label: "Pending" },
  failed: { variant: "neutral", label: "Failed" },
  error: { variant: "neutral", label: "Error" },
};

export default function Agents() {
  const { data: jobs, isLoading: jobsLoading } = useAgentJobs();
  const { data: funnel, isLoading: funnelLoading } = useScoutFunnel();
  const findStrategies = useFindStrategies();

  const funnelStages = funnel
    ? [
        { label: "Scouted", count: funnel.scouted, color: "hsl(var(--text-muted))" },
        { label: "Tested", count: funnel.tested, color: "hsl(var(--info))" },
        { label: "Passed", count: funnel.passed, color: "hsl(var(--amber-400))" },
        { label: "Deployed", count: funnel.deployed, color: "hsl(var(--profit))" },
      ]
    : [];

  const maxFunnel = funnelStages.length > 0 ? Math.max(funnelStages[0].count, 1) : 1;

  const agents = (jobs ?? []).map((job) => {
    const st = statusMap[job.status] ?? { variant: "neutral" as const, label: job.status };
    const result = job.result ?? {};
    const input = job.input ?? {};
    return {
      id: job.id,
      name: job.action,
      type: job.entityType ?? "agent",
      status: job.status,
      st,
      strategies: result.strategiesFound ?? result.count ?? 0,
      accepted: result.accepted ?? result.passed ?? 0,
      score: num(result.forgeScore ?? result.score, 0),
      durationMs: job.durationMs,
      lastRun: timeAgo(job.createdAt),
    };
  });

  const isLoading = jobsLoading || funnelLoading;

  const handleFindStrategies = () => {
    toast.info("Starting strategy scout...");
    findStrategies.mutate(undefined, {
      onSuccess: () => toast.success("Strategy scout started successfully"),
      onError: (err: any) => toast.error(`Scout failed: ${err.message}`),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">AI Agents</h1>
          <p className="text-sm text-text-secondary mt-1">Agent fleet management & strategy discovery pipeline</p>
        </div>
        <Button
          size="sm"
          className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleFindStrategies}
          disabled={findStrategies.isPending}
        >
          {findStrategies.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1" />}
          Find Strategies
        </Button>
      </div>

      {/* Discovery Funnel */}
      <div className="forge-card p-6">
        <h2 className="text-sm font-medium text-text-secondary mb-6 flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary" />
          Discovery Funnel
        </h2>
        {funnelLoading ? (
          <div className="flex items-center justify-center py-8 text-text-muted gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading funnel...</span>
          </div>
        ) : funnelStages.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-4">No funnel data available yet.</p>
        ) : (
          <div className="space-y-3">
            {funnelStages.map((stage, i) => {
              const width = Math.max((stage.count / maxFunnel) * 100, 8);
              return (
                <motion.div
                  key={stage.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.4 }}
                  className="flex items-center gap-4"
                >
                  <span className="text-xs text-text-muted w-20 text-right">{stage.label}</span>
                  <div className="flex-1 relative h-8 rounded-md overflow-hidden" style={{ background: "hsl(var(--surface-2))" }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${width}%` }}
                      transition={{ delay: i * 0.1 + 0.3, duration: 0.6, ease: "easeOut" }}
                      className="h-full rounded-md flex items-center px-3"
                      style={{ background: stage.color, opacity: 0.85 }}
                    >
                      <span className="text-xs font-mono font-semibold text-void">{stage.count.toLocaleString()}</span>
                    </motion.div>
                  </div>
                  {i < funnelStages.length - 1 && (
                    <span className="text-[10px] font-mono text-text-muted w-12">
                      {stage.count > 0 ? ((funnelStages[i + 1].count / stage.count) * 100).toFixed(0) : 0}%
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Agent Job Cards Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-text-muted gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading agent jobs...</span>
        </div>
      ) : agents.length === 0 ? (
        <div className="forge-card p-8 text-center">
          <p className="text-sm text-text-muted">No agent jobs yet. Click "Find Strategies" to start the discovery pipeline.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent, i) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.4 }}
              className="forge-card p-5 flex flex-col gap-4 cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "hsl(var(--surface-3))" }}>
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{agent.name}</h3>
                    <p className="text-[11px] text-text-muted">{agent.type}</p>
                  </div>
                </div>
                <StatusBadge variant={agent.st.variant} dot>{agent.st.label}</StatusBadge>
              </div>

              <div className="flex items-center gap-5">
                <ForgeScoreRing score={agent.score} maxScore={100} size={56} strokeWidth={5} />
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 flex-1 text-xs">
                  <div>
                    <span className="text-text-muted">Discovered</span>
                    <p className="font-mono text-foreground">{agent.strategies}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Accepted</span>
                    <p className="font-mono text-profit">{agent.accepted}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Duration</span>
                    <p className="font-mono text-foreground">{agent.durationMs != null ? `${(agent.durationMs / 1000).toFixed(1)}s` : "—"}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Last Run</span>
                    <p className="font-mono text-foreground">{agent.lastRun}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
