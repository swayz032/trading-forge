import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

type SSEHandler = (data: any) => void;

export function useSSE(eventTypes: string[], onEvent?: SSEHandler) {
  const qc = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/sse/events");
    sourceRef.current = es;

    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        const data = JSON.parse(e.data);
        onEvent?.(data);

        // Auto-invalidate relevant queries
        if (type === "alert:new") qc.invalidateQueries({ queryKey: ["alerts"] });
        if (type === "strategy:updated") qc.invalidateQueries({ queryKey: ["strategies"] });
        if (type === "backtest:complete") qc.invalidateQueries({ queryKey: ["backtests"] });
        if (type === "paper:trade") qc.invalidateQueries({ queryKey: ["paper"] });
        if (type === "paper:pnl") qc.invalidateQueries({ queryKey: ["paper"] });
        if (type === "paper:signal") qc.invalidateQueries({ queryKey: ["paper", "signals"] });
        if (type === "strategy:promoted") qc.invalidateQueries({ queryKey: ["paper"] });
      });
    }

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [eventTypes.join(",")]);
}
