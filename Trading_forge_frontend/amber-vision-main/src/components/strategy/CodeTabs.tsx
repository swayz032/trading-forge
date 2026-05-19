import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, Loader2, Code2, FileText, Hash } from "lucide-react";

// Mirrors src/lib/api-client.ts BASE — these endpoints return text/plain or
// application/yaml so we can't use the JSON-only api wrapper.
const API_BASE = "/api";

interface CodeTabsProps {
  strategyId: string;
}

type Format = "dsl" | "pine" | "python";

const FORMAT_META: Record<Format, { label: string; icon: typeof Code2; mime: string; ext: string }> = {
  dsl: { label: "DSL", icon: FileText, mime: "application/yaml", ext: "yaml" },
  pine: { label: "Pine v5", icon: Code2, mime: "text/plain", ext: "pine" },
  python: { label: "Python", icon: Hash, mime: "text/plain", ext: "py" },
};

function useStrategyCode(strategyId: string, format: Format) {
  return useQuery({
    queryKey: ["strategy-code", strategyId, format],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/strategies/${strategyId}/${format}`, {
        credentials: "include",
      });
      if (r.status === 202) {
        const j = await r.json();
        return { kind: "pending" as const, message: j.message ?? "Compilation pending" };
      }
      if (!r.ok) {
        const text = await r.text();
        return { kind: "error" as const, message: text || `HTTP ${r.status}` };
      }
      const text = await r.text();
      return { kind: "ok" as const, text };
    },
    enabled: Boolean(strategyId),
  });
}

export function CodeTabs({ strategyId }: CodeTabsProps) {
  const [format, setFormat] = useState<Format>("dsl");
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError, error } = useStrategyCode(strategyId, format);

  useEffect(() => {
    setCopied(false);
  }, [format, data]);

  const handleCopy = async () => {
    if (data?.kind !== "ok") return;
    try {
      await navigator.clipboard.writeText(data.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore — clipboard may not be permitted
    }
  };

  const handleDownload = () => {
    if (data?.kind !== "ok") return;
    const meta = FORMAT_META[format];
    const blob = new Blob([data.text], { type: meta.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strategy-${strategyId.slice(0, 8)}.${meta.ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="forge-card p-5 space-y-3">
      <Tabs value={format} onValueChange={(v) => setFormat(v as Format)}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList className="bg-surface-2 p-1 rounded-md border border-border/20">
            {(Object.keys(FORMAT_META) as Format[]).map((f) => {
              const Icon = FORMAT_META[f].icon;
              return (
                <TabsTrigger
                  key={f}
                  value={f}
                  className="text-[11px] data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 gap-1.5"
                >
                  <Icon className="w-3 h-3" />
                  {FORMAT_META[f].label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              disabled={data?.kind !== "ok"}
              className="px-2.5 py-1 rounded-md border border-border/30 hover:bg-surface-2 transition text-[11px] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-3 h-3 text-profit" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={data?.kind !== "ok"}
              className="px-2.5 py-1 rounded-md border border-border/30 hover:bg-surface-2 transition text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download as file"
            >
              Download
            </button>
          </div>
        </div>

        {(Object.keys(FORMAT_META) as Format[]).map((f) => (
          <TabsContent key={f} value={f} className="mt-3">
            <div className="rounded-md border border-border/20 bg-[#0d1117] overflow-hidden">
              {isLoading ? (
                <div className="flex items-center justify-center py-12 text-text-muted text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading {FORMAT_META[f].label}…
                </div>
              ) : isError ? (
                <div className="p-4 text-loss text-xs font-mono">
                  Error loading {FORMAT_META[f].label}: {(error as Error)?.message ?? "unknown"}
                </div>
              ) : data?.kind === "pending" ? (
                <div className="p-6 text-text-muted text-xs">
                  <p className="font-medium text-foreground mb-1">Not yet compiled</p>
                  <p>{data.message}</p>
                </div>
              ) : data?.kind === "error" ? (
                <div className="p-4 text-loss text-xs font-mono">{data.message}</div>
              ) : data?.kind === "ok" ? (
                <pre className="p-4 text-[12px] leading-relaxed font-mono text-text-secondary overflow-x-auto whitespace-pre">
                  {data.text}
                </pre>
              ) : null}
            </div>
            {f === "dsl" && (
              <p className="text-[10px] text-text-muted mt-2">
                Schema: <code>src/engine/compiler/strategy_schema.py</code> ·
                Round-trip safe (DSL → backtest → Pine export).
              </p>
            )}
            {f === "pine" && (
              <p className="text-[10px] text-text-muted mt-2">
                Pine Script v5 · Includes <code>use_bar_magnifier=true</code> +{" "}
                <code>fill_orders_on_standard_ohlc=true</code> for fill hygiene on Heikin/Renko charts.
              </p>
            )}
            {f === "python" && (
              <p className="text-[10px] text-text-muted mt-2">
                Vectorbt skeleton — for the executable backtest, run{" "}
                <code>python -m src.engine.backtester</code> with this strategy ID.
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
