import { useState } from "react";
import { motion } from "framer-motion";
import { Database, Activity, CheckCircle, AlertTriangle, XCircle, Clock, HardDrive, RefreshCw, Loader2, Info } from "lucide-react";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeTable } from "@/components/forge/ForgeTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSymbols, useHealth, useSyncData } from "@/hooks/useData";
import { useSSE } from "@/hooks/useSSE";
import { num, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

const coverageColor = (v: number) => v >= 98 ? "text-profit" : v >= 94 ? "text-foreground" : v >= 90 ? "text-primary" : "text-loss";

export default function DataPipeline() {
  // SSE: keep pipeline status fresh on mode changes & scheduler events
  useSSE([
    "pipeline:mode-change",
    "pipeline:pause_snapshot",
    "pipeline:resume_stale_positions",
    "scheduler:pre-market-alert",
  ]);

  const { data: symbols, isLoading: symbolsLoading } = useSymbols();
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useHealth();
  const syncData = useSyncData();

  const [syncSymbol, setSyncSymbol] = useState("");

  const isLoading = symbolsLoading || healthLoading;

  // Compute summary from real data
  const totalSymbols = symbols?.length ?? 0;
  const totalBars = (symbols ?? []).reduce((sum, s) => sum + (s.totalBars ?? 0), 0);
  const healthStatus = health?.status ?? "unknown";

  const summaryCards = [
    { icon: Database, label: "Symbols", value: totalSymbols > 0 ? totalSymbols.toLocaleString() : "0" },
    { icon: HardDrive, label: "Total Bars", value: totalBars > 0 ? totalBars.toLocaleString() : "0" },
    { icon: Activity, label: "API Status", value: healthStatus === "ok" || healthStatus === "healthy" ? "Healthy" : healthStatus },
    { icon: Clock, label: "Last Check", value: health?.timestamp ? timeAgo(health.timestamp) : "\u2014" },
  ];

  // Determine data freshness: within 24h = complete, otherwise stale
  const now = Date.now();
  const symbolRows = (symbols ?? []).map((s) => {
    const lastSync = s.lastSyncAt ? new Date(s.lastSyncAt).getTime() : 0;
    const isRecent = lastSync > 0 && (now - lastSync) < 24 * 60 * 60 * 1000;
    return {
      symbol: s.symbol,
      timeframe: s.timeframe,
      totalBars: s.totalBars?.toLocaleString() ?? "\u2014",
      earliestDate: s.earliestDate ? new Date(s.earliestDate).toLocaleDateString() : "\u2014",
      latestDate: s.latestDate ? new Date(s.latestDate).toLocaleDateString() : "\u2014",
      coverage: s.totalBars ?? 0,
      status: isRecent ? "complete" : s.lastSyncAt ? "stale" : "no data",
    };
  });

  type SymbolRow = (typeof symbolRows)[number];

  const symbolColumns = [
    { key: "symbol", header: "Symbol", sortable: true, render: (r: SymbolRow) => <span className="font-mono font-semibold text-foreground">{r.symbol}</span> },
    { key: "timeframe", header: "Timeframe" },
    { key: "totalBars", header: "Total Bars", align: "right" as const, mono: true },
    { key: "earliestDate", header: "Earliest", mono: true },
    { key: "latestDate", header: "Latest", mono: true },
    {
      key: "status", header: "Status", align: "center" as const,
      render: (r: SymbolRow) => (
        <StatusBadge variant={r.status === "complete" ? "profit" : r.status === "stale" ? "amber" : "neutral"} dot>
          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        </StatusBadge>
      ),
    },
  ];

  const handleSync = () => {
    const sym = syncSymbol.trim().toUpperCase();
    if (!sym) {
      toast.error("Enter a symbol to sync");
      return;
    }
    toast.info(`Syncing ${sym}...`);
    syncData.mutate({ symbol: sym }, {
      onSuccess: () => toast.success(`${sym} sync started`),
      onError: (err: any) => toast.error(`Sync failed: ${err.message}`),
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
          <h1 className="text-2xl font-semibold text-foreground">Data Pipeline</h1>
          <p className="text-sm text-text-secondary mt-1">Symbol coverage, data source health & ingestion status</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Symbol (e.g. ES)"
            value={syncSymbol}
            onChange={(e) => setSyncSymbol(e.target.value)}
            className="h-9 w-32 bg-surface-0 border-border/20 text-sm font-mono text-foreground"
          />
          <Button size="sm" className="text-xs bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleSync} disabled={syncData.isPending}>
            {syncData.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Sync Data
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="forge-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <c.icon className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] uppercase tracking-widest text-text-muted">{c.label}</span>
            </div>
            <p className="text-xl font-mono font-semibold text-foreground">{c.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Data Source Health */}
      <div className="forge-card p-6">
        <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          System Health
        </h2>
        {healthLoading ? (
          <div className="flex items-center justify-center py-8 text-text-muted gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Checking health...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg p-4 flex items-center gap-4"
              style={{ background: "hsl(var(--surface-2))" }}
            >
              {healthStatus === "ok" || healthStatus === "healthy" ? (
                <CheckCircle className="w-3.5 h-3.5 text-profit" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-primary" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{health?.service ?? "Trading Forge API"}</p>
                <p className="text-[11px] text-text-muted">Status: {healthStatus}</p>
              </div>
              <div className="text-right text-[11px]">
                <p className="text-text-muted">Checked</p>
                <p className="font-mono text-foreground">{health?.timestamp ? timeAgo(health.timestamp) : "\u2014"}</p>
              </div>
            </motion.div>
          </div>
        )}
      </div>

      {/* Symbol Coverage Table */}
      <div className="forge-card p-6">
        <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          Symbol Coverage
        </h2>
        {symbolsLoading ? (
          <div className="flex items-center justify-center py-8 text-text-muted gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading symbols...</span>
          </div>
        ) : symbolRows.length === 0 ? (
          <div className="text-center py-10">
            <Info className="w-8 h-8 text-primary/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-text-secondary mb-2">No market data loaded yet</p>
            <p className="text-xs text-text-muted max-w-sm mx-auto">
              Market data is stored in S3 and synced on-demand during backtests. Use the "Sync Data" button above to
              manually fetch data for a specific symbol, or data will be automatically downloaded when you run your first backtest.
            </p>
          </div>
        ) : (
          <ForgeTable columns={symbolColumns} data={symbolRows} />
        )}
      </div>
    </motion.div>
  );
}
