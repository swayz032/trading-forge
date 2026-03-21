import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { StatusBadge } from "@/components/forge/StatusBadge";
import {
  Settings as SettingsIcon,
  Database,
  Wifi,
  Globe,
  Server,
  Brain,
  HardDrive,
  Activity,
} from "lucide-react";

interface HealthResponse {
  status: string;
  service: string;
  uptime: number;
  version?: string;
  db?: {
    status: string;
    latencyMs?: number;
  };
  memory?: {
    heapUsedMB?: number;
    heapTotalMB?: number;
    rssMB?: number;
  };
  logLevel?: string;
}

export default function Settings() {
  const {
    data: health,
    isLoading,
    isError,
  } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: () => api.get<HealthResponse>("/health"),
    refetchInterval: 30_000,
  });

  const isOperational = health?.status === "ok" || health?.status === "healthy";

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Settings
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          System configuration & data sources
        </p>
      </div>

      {/* System Health */}
      <div className="forge-card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium text-foreground">System Health</h2>
        </div>

        {isLoading ? (
          <p className="text-sm text-text-muted">Checking system status...</p>
        ) : isError ? (
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-loss animate-pulse" />
            <span className="text-sm text-loss font-medium">
              Unreachable — API server is down
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isOperational ? "bg-profit" : "bg-loss"
                }`}
              />
              <span className="text-sm font-medium text-foreground">
                {isOperational ? "Operational" : "Degraded"}
              </span>
              <StatusBadge
                variant={isOperational ? "profit" : "loss"}
                dot
              >
                {health?.status ?? "unknown"}
              </StatusBadge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30">
                <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">
                  Uptime
                </span>
                <span className="text-sm font-mono text-foreground">
                  {health?.uptime ? formatUptime(health.uptime) : "—"}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30">
                <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">
                  DB Latency
                </span>
                <span className="text-sm font-mono text-foreground">
                  {health?.db?.latencyMs != null
                    ? `${health.db.latencyMs}ms`
                    : "—"}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30">
                <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">
                  Heap Memory
                </span>
                <span className="text-sm font-mono text-foreground">
                  {health?.memory?.heapUsedMB != null
                    ? `${health.memory.heapUsedMB.toFixed(0)} MB`
                    : "—"}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30">
                <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">
                  Version
                </span>
                <span className="text-sm font-mono text-foreground">
                  {health?.version ?? "—"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Data Sources */}
      <div>
        <h2 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          Data Sources
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Databento */}
          <div className="forge-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30 flex items-center justify-center">
                <Database className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-sm font-medium text-foreground block">
                  Databento
                </span>
                <span className="text-[11px] text-text-muted">
                  Historical tick data
                </span>
              </div>
            </div>
            <p className="text-xs text-text-muted mb-3">
              Institutional-grade futures data. Downloaded once to S3, never
              re-paid. $125 one-time credits.
            </p>
            <StatusBadge variant="profit" dot>
              Configured
            </StatusBadge>
          </div>

          {/* Massive */}
          <div className="forge-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30 flex items-center justify-center">
                <Wifi className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-sm font-medium text-foreground block">
                  Massive
                </span>
                <span className="text-[11px] text-text-muted">
                  Real-time WebSocket streaming
                </span>
              </div>
            </div>
            <p className="text-xs text-text-muted mb-3">
              Free real-time streaming for currencies, indices, options, and
              futures contracts. Used for paper/live trading.
            </p>
            <StatusBadge variant="info" dot>
              Free tier
            </StatusBadge>
          </div>

          {/* Alpha Vantage */}
          <div className="forge-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30 flex items-center justify-center">
                <Globe className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-sm font-medium text-foreground block">
                  Alpha Vantage
                </span>
                <span className="text-[11px] text-text-muted">
                  Indicators & sentiment
                </span>
              </div>
            </div>
            <p className="text-xs text-text-muted mb-3">
              60+ technical indicators and news/sentiment API. Server-side MCP
              integration for AI agents.
            </p>
            <StatusBadge variant="amber" dot>
              MCP enabled
            </StatusBadge>
          </div>
        </div>
      </div>

      {/* Integration Status */}
      <div>
        <h2 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" />
          Integration Status
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* PostgreSQL */}
          <div className="forge-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30 flex items-center justify-center">
                  <Database className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground block">
                    PostgreSQL
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Primary database (Drizzle ORM)
                  </span>
                </div>
              </div>
              <StatusBadge
                variant={
                  health?.db?.status === "ok" || health?.db?.status === "connected"
                    ? "profit"
                    : isError
                    ? "loss"
                    : "neutral"
                }
                dot
              >
                {health?.db?.latencyMs != null
                  ? `${health.db.latencyMs}ms`
                  : isError
                  ? "Offline"
                  : "—"}
              </StatusBadge>
            </div>
          </div>

          {/* n8n */}
          <div className="forge-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground block">
                    n8n
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Workflow orchestration
                  </span>
                </div>
              </div>
              <StatusBadge variant="info" dot>
                Local Docker
              </StatusBadge>
            </div>
          </div>

          {/* Ollama */}
          <div className="forge-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground block">
                    Ollama
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Local LLM — Qwen2.5-Coder:14b
                  </span>
                </div>
              </div>
              <StatusBadge variant="amber" dot>
                Local GPU
              </StatusBadge>
            </div>
          </div>

          {/* S3 Data Lake */}
          <div className="forge-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30 flex items-center justify-center">
                  <HardDrive className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground block">
                    S3 Data Lake
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Parquet storage (ratio-adjusted)
                  </span>
                </div>
              </div>
              <StatusBadge variant="profit" dot>
                Connected
              </StatusBadge>
            </div>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div>
        <h2 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
          <SettingsIcon className="w-4 h-4 text-primary" />
          Preferences
        </h2>
        <div className="forge-card p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30">
              <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">
                Log Level
              </span>
              <span className="text-sm font-mono text-foreground">
                {health?.logLevel ?? "info"}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30">
              <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">
                Default Backtest Mode
              </span>
              <span className="text-sm font-mono text-foreground">
                walkforward
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30">
              <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">
                Theme
              </span>
              <span className="text-sm font-mono text-foreground">
                Dark mode
              </span>
              <span className="text-[10px] text-text-muted block mt-0.5">
                Only dark mode supported
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
