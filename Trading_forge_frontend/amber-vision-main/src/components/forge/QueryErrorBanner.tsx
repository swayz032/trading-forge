import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

interface QueryErrorBannerProps {
  message?: string;
  queryKey?: string[];
}

export function QueryErrorBanner({ message = "Failed to load data", queryKey }: QueryErrorBannerProps) {
  const qc = useQueryClient();

  return (
    <div className="forge-card p-6 flex items-center justify-between border border-loss/20">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-loss/10">
          <AlertTriangle className="w-4 h-4 text-loss" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{message}</p>
          <p className="text-xs text-text-muted mt-0.5">Check that the backend is running on port 4000</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="text-xs border-border/30 text-text-secondary hover:text-foreground"
        onClick={() => {
          if (queryKey) {
            qc.invalidateQueries({ queryKey });
          } else {
            qc.invalidateQueries();
          }
        }}
      >
        <RefreshCw className="w-3.5 h-3.5 mr-1" />
        Retry
      </Button>
    </div>
  );
}

export function EmptyState({ message = "No data yet", icon: Icon = AlertTriangle }: { message?: string; icon?: any }) {
  return (
    <div className="forge-card p-12 text-center">
      <Icon className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-50" />
      <p className="text-sm text-text-secondary">{message}</p>
    </div>
  );
}
