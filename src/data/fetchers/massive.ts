/**
 * Massive Data Fetcher
 *
 * Role: Real-time streaming + supplemental historical data
 * - Free tier: Currencies Basic, Indices Basic, Options Basic, Stocks Basic
 * - WebSocket for live/paper trading (Phase 6)
 * - REST for on-demand historical bars
 *
 * API Docs: https://massive.io/docs (REST + WebSocket)
 * Dashboard: https://massive.io/dashboard/subscriptions
 */

interface MassiveConfig {
  apiKey: string;
  baseUrl?: string;
}

interface BarRequest {
  symbol: string;
  timeframe: "1min" | "5min" | "15min" | "1hour" | "daily";
  from: string;
  to: string;
}

interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function createMassiveFetcher(config: MassiveConfig) {
  const { apiKey, baseUrl = "https://api.massive.io/v1" } = config;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  async function fetchBars(request: BarRequest): Promise<Bar[]> {
    const params = new URLSearchParams({
      symbol: request.symbol,
      timeframe: request.timeframe,
      from: request.from,
      to: request.to,
    });

    const response = await fetch(`${baseUrl}/bars?${params}`, { headers });
    if (!response.ok) {
      throw new Error(`Massive API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.bars as Bar[];
  }

  function createWebSocket(symbols: string[], onBar: (bar: Bar & { symbol: string }) => void) {
    // WebSocket for real-time streaming (Phase 6 — paper/live trading)
    // Placeholder — will implement with ws package
    return {
      connect: () => {
        console.log(`[Massive WS] Connecting for symbols: ${symbols.join(", ")}`);
        // TODO: Implement WebSocket connection
      },
      disconnect: () => {
        console.log("[Massive WS] Disconnected");
      },
    };
  }

  return { fetchBars, createWebSocket };
}
