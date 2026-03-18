import { motion } from "framer-motion";
import { useState } from "react";
import { Key, Bell, Database, Sliders, Eye, EyeOff, Plus, Trash2, Save, Shield, RefreshCw, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAlerts, useDeleteAlert, useCreateAlert } from "@/hooks/useAlerts";
import { useSymbols, useHealth } from "@/hooks/useData";
import { toast } from "sonner";
import { timeAgo } from "@/lib/utils";

// --- API Keys (client-side only, kept as display data) ---
const initialKeys = [
  { id: 1, name: "CME Direct", key: "cme_live_••••••••k4x9", status: "active", lastUsed: "2 min ago" },
  { id: 2, name: "Polygon.io", key: "pk_••••••••••y7m2", status: "active", lastUsed: "5 sec ago" },
  { id: 3, name: "Databento", key: "db_••••••••••n3p1", status: "active", lastUsed: "2 min ago" },
  { id: 4, name: "Alpha Vantage", key: "av_••••••••••q8r5", status: "expired", lastUsed: "3 days ago" },
  { id: 5, name: "FRED API", key: "fred_••••••••••j2k7", status: "active", lastUsed: "1 hr ago" },
];

// --- System Preferences (localStorage) ---
const initialPrefs = {
  darkMode: true,
  compactTables: false,
  animationsEnabled: true,
  soundAlerts: false,
  autoRefreshInterval: "5s",
  defaultTimeframe: "1h",
  riskPerTrade: "2%",
  maxOpenPositions: "5",
  sessionFilter: "RTH Only",
  timezone: "America/Chicago",
};

export default function Settings() {
  const [keys] = useState(initialKeys);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [revealedKeys, setRevealedKeys] = useState<Set<number>>(new Set());

  // Real API hooks
  const { data: alerts, isLoading: alertsLoading } = useAlerts();
  const deleteAlert = useDeleteAlert();
  const createAlert = useCreateAlert();
  const { data: symbols, isLoading: symbolsLoading } = useSymbols();
  const { data: health, refetch: refetchHealth } = useHealth();

  const toggleReveal = (id: number) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleTestConnection = async () => {
    toast.info("Testing connection...");
    try {
      const result = await refetchHealth();
      if (result.data) {
        toast.success(`Connection OK: ${result.data.service} is ${result.data.status}`);
      } else {
        toast.error("Connection test failed — no response");
      }
    } catch (err: any) {
      toast.error(`Connection failed: ${err.message}`);
    }
  };

  const handleDeleteAlert = (id: string) => {
    deleteAlert.mutate(id, {
      onSuccess: () => toast.success("Alert deleted"),
      onError: (err: any) => toast.error(`Delete failed: ${err.message}`),
    });
  };

  const handleCreateAlert = () => {
    createAlert.mutate(
      { type: "custom", severity: "info", title: "New Alert Rule", message: "Configure this alert" },
      {
        onSuccess: () => toast.success("Alert created"),
        onError: (err: any) => toast.error(`Create failed: ${err.message}`),
      }
    );
  };

  // Map symbols to data source rows
  const dataSourceRows = (() => {
    if (!symbols) return [];
    // Group by symbol to show unique symbols with their status
    const seen = new Map<string, { symbol: string; timeframes: string[]; lastSync: string | null }>();
    for (const s of symbols) {
      const existing = seen.get(s.symbol);
      if (existing) {
        existing.timeframes.push(s.timeframe);
        if (s.lastSyncAt && (!existing.lastSync || s.lastSyncAt > existing.lastSync)) {
          existing.lastSync = s.lastSyncAt;
        }
      } else {
        seen.set(s.symbol, { symbol: s.symbol, timeframes: [s.timeframe], lastSync: s.lastSyncAt });
      }
    }
    const now = Date.now();
    return Array.from(seen.values()).map((s) => {
      const lastSyncMs = s.lastSync ? new Date(s.lastSync).getTime() : 0;
      const isRecent = lastSyncMs > 0 && (now - lastSyncMs) < 24 * 60 * 60 * 1000;
      return {
        id: s.symbol,
        name: s.symbol,
        type: s.timeframes.join(", "),
        status: isRecent ? "healthy" : s.lastSync ? "degraded" : "offline",
      };
    });
  })();

  return (
    <div className="space-y-6 max-w-[1000px]">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Settings</h1>
        <p className="text-sm text-text-secondary mt-1">API keys, alerts, data sources, and system preferences</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}>
        <Tabs defaultValue="api-keys" className="space-y-4">
          <TabsList className="bg-surface-1 border border-border/20 p-1 rounded-lg">
            {[
              { value: "api-keys", label: "API Keys", icon: Key },
              { value: "alerts", label: "Alerts", icon: Bell },
              { value: "data-sources", label: "Data Sources", icon: Database },
              { value: "preferences", label: "Preferences", icon: Sliders },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md px-4 gap-1.5"
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* === API Keys === */}
          <TabsContent value="api-keys" className="space-y-4">
            <div className="forge-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-medium text-foreground">API Key Management</h2>
                  <p className="text-xs text-text-muted mt-0.5">Manage exchange and data provider credentials</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="text-xs border-border/30 text-text-secondary hover:text-foreground" onClick={handleTestConnection}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Test Connection
                  </Button>
                  <Button size="sm" className="text-xs bg-primary/10 text-primary hover:bg-primary/20 border-0">
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Key
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {keys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-0/50 border border-border/10 hover:border-border/30 transition-colors">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4 text-text-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-foreground">{k.name}</span>
                          <StatusBadge variant={k.status === "active" ? "profit" : "loss"} dot>
                            {k.status}
                          </StatusBadge>
                        </div>
                        <span className="text-xs font-mono text-text-muted">
                          {revealedKeys.has(k.id) ? k.key.replace(/••••••••/g, "a1b2c3d4") : k.key}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <span className="text-[10px] text-text-muted whitespace-nowrap">Used {k.lastUsed}</span>
                      <button onClick={() => toggleReveal(k.id)} className="p-1.5 rounded-md hover:bg-surface-2/50 text-text-muted hover:text-foreground transition-colors">
                        {revealedKeys.has(k.id) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-loss/10 text-text-muted hover:text-loss transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* === Alerts === */}
          <TabsContent value="alerts" className="space-y-4">
            <div className="forge-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-medium text-foreground">Alert Configuration</h2>
                  <p className="text-xs text-text-muted mt-0.5">Configure notification rules and channels</p>
                </div>
                <Button
                  size="sm"
                  className="text-xs bg-primary/10 text-primary hover:bg-primary/20 border-0"
                  onClick={handleCreateAlert}
                  disabled={createAlert.isPending}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Rule
                </Button>
              </div>

              {alertsLoading ? (
                <div className="flex items-center justify-center py-8 text-text-muted gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading alerts...</span>
                </div>
              ) : !alerts || alerts.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-4">No alerts configured. Click "Add Rule" to create one.</p>
              ) : (
                <div className="space-y-2">
                  {alerts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-0/50 border border-border/10 hover:border-border/30 transition-colors">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                          <Bell className="w-4 h-4 text-text-muted" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-foreground block">{a.title}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-text-muted">{a.message}</span>
                            <span className="text-[10px] text-text-muted">·</span>
                            <StatusBadge variant={a.severity === "critical" ? "loss" : a.severity === "warning" ? "amber" : "info"} dot>
                              {a.severity}
                            </StatusBadge>
                            <span className="text-[10px] text-text-muted">·</span>
                            <span className="text-[11px] text-text-muted">{timeAgo(a.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-3">
                        <button
                          className="p-1.5 rounded-md hover:bg-loss/10 text-text-muted hover:text-loss transition-colors"
                          onClick={() => handleDeleteAlert(a.id)}
                          disabled={deleteAlert.isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* === Data Sources === */}
          <TabsContent value="data-sources" className="space-y-4">
            <div className="forge-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-medium text-foreground">Data Source Status</h2>
                  <p className="text-xs text-text-muted mt-0.5">Symbol data availability from your pipeline</p>
                </div>
                <Button size="sm" variant="outline" className="text-xs border-border/30 text-text-secondary hover:text-foreground" onClick={handleTestConnection}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh All
                </Button>
              </div>

              {symbolsLoading ? (
                <div className="flex items-center justify-center py-8 text-text-muted gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading data sources...</span>
                </div>
              ) : dataSourceRows.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-4">No data sources found. Sync symbols in the Data Pipeline page.</p>
              ) : (
                <div className="space-y-2">
                  {dataSourceRows.map((ds) => (
                    <div key={ds.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-0/50 border border-border/10 hover:border-border/30 transition-colors">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${ds.status === "healthy" ? "bg-profit" : ds.status === "degraded" ? "bg-primary" : "bg-loss"}`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-foreground block">{ds.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-text-muted">{ds.type}</span>
                            <span className="text-[10px] text-text-muted">·</span>
                            <StatusBadge variant={ds.status === "healthy" ? "profit" : ds.status === "degraded" ? "amber" : "loss"} dot>
                              {ds.status}
                            </StatusBadge>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* === Preferences === */}
          <TabsContent value="preferences" className="space-y-4">
            <div className="forge-card p-5">
              <h2 className="text-sm font-medium text-foreground mb-4">System Preferences</h2>

              {/* Toggle preferences */}
              <div className="space-y-3 mb-6">
                {[
                  { key: "darkMode", label: "Dark Mode", desc: "Use dark theme across the application" },
                  { key: "compactTables", label: "Compact Tables", desc: "Reduce row height in data tables" },
                  { key: "animationsEnabled", label: "Animations", desc: "Enable page transitions and micro-interactions" },
                  { key: "soundAlerts", label: "Sound Alerts", desc: "Play audio on trade fills and alerts" },
                ].map((p) => (
                  <div key={p.key} className="flex items-center justify-between p-3 rounded-lg bg-surface-0/50 border border-border/10">
                    <div>
                      <span className="text-sm font-medium text-foreground block">{p.label}</span>
                      <span className="text-[11px] text-text-muted">{p.desc}</span>
                    </div>
                    <Switch
                      checked={prefs[p.key as keyof typeof prefs] as boolean}
                      onCheckedChange={(checked) => setPrefs((prev) => ({ ...prev, [p.key]: checked }))}
                    />
                  </div>
                ))}
              </div>

              {/* Input preferences */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { key: "autoRefreshInterval", label: "Auto Refresh Interval" },
                  { key: "defaultTimeframe", label: "Default Timeframe" },
                  { key: "riskPerTrade", label: "Risk Per Trade" },
                  { key: "maxOpenPositions", label: "Max Open Positions" },
                  { key: "sessionFilter", label: "Session Filter" },
                  { key: "timezone", label: "Timezone" },
                ].map((p) => (
                  <div key={p.key} className="space-y-1.5">
                    <label className="text-xs text-text-secondary font-medium">{p.label}</label>
                    <Input
                      value={prefs[p.key as keyof typeof prefs] as string}
                      onChange={(e) => setPrefs((prev) => ({ ...prev, [p.key]: e.target.value }))}
                      className="h-9 bg-surface-0 border-border/20 text-sm font-mono text-foreground focus:border-primary/40"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end mt-6 pt-4 border-t border-border/10">
                <Button size="sm" className="text-xs bg-primary text-primary-foreground hover:bg-primary/90">
                  <Save className="w-3.5 h-3.5 mr-1" /> Save Preferences
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
