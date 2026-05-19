/**
 * Alpha Vantage Data Fetcher
 *
 * Role: Technical indicators + news/sentiment for AI agents
 * - 60+ server-side technical indicators (RSI, MACD, Bollinger, etc.)
 * - News + sentiment API for market analysis
 * - MCP support for direct Ollama agent access
 * - Free tier: 25 requests/day
 *
 * API Docs: https://www.alphavantage.co/documentation/
 * MCP: https://www.alphavantage.co/mcp
 */

import { CircuitBreakerRegistry } from "../../server/lib/circuit-breaker.js";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/** Fetch with a 30-second AbortController timeout. */
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch with 3-attempt exponential backoff (2s → 4s → 8s).
 * Retries on network errors and 5xx responses.
 * Does NOT retry on 4xx (bad request, rate limit 429 included) — those require
 * caller intervention, not blind retry.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url);
      // Retry on 5xx; surface 4xx immediately
      if (response.status >= 500) {
        lastErr = new Error(`Alpha Vantage server error: ${response.status}`);
        if (attempt < MAX_RETRIES) {
          const delayMs = Math.min(2000 * attempt, 8000);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw lastErr;
      }
      return response;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const delayMs = Math.min(2000 * attempt, 8000);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

interface AlphaVantageConfig {
  apiKey: string;
  baseUrl?: string;
}

interface IndicatorRequest {
  symbol: string;
  indicator: string; // e.g., "RSI", "MACD", "BBANDS", "SMA", "EMA", "ATR", "VWAP"
  interval: "1min" | "5min" | "15min" | "30min" | "60min" | "daily" | "weekly" | "monthly";
  timePeriod?: number;
  seriesType?: "close" | "open" | "high" | "low";
}

interface SentimentRequest {
  tickers?: string[]; // e.g., ["ES=F", "NQ=F"]
  topics?: string[]; // e.g., ["financial_markets", "economy_macro"]
  sort?: "LATEST" | "EARLIEST" | "RELEVANCE";
  limit?: number;
}

interface SentimentResult {
  title: string;
  url: string;
  timePublished: string;
  summary: string;
  overallSentimentScore: number;
  overallSentimentLabel: string;
  tickerSentiment: Array<{
    ticker: string;
    relevanceScore: number;
    sentimentScore: number;
    sentimentLabel: string;
  }>;
}

export function createAlphaVantageFetcher(config: AlphaVantageConfig) {
  const { apiKey, baseUrl = "https://www.alphavantage.co/query" } = config;

  // Circuit breaker shared across all Alpha Vantage calls from this fetcher.
  // 3 failures within 60s cooldown mirrors the scheduler withRetry pattern.
  const cb = CircuitBreakerRegistry.get("alphavantage", { failureThreshold: 3, cooldownMs: 60_000 });

  async function fetchIndicator(request: IndicatorRequest): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      function: request.indicator,
      symbol: request.symbol,
      interval: request.interval,
      apikey: apiKey,
    });

    if (request.timePeriod) params.set("time_period", String(request.timePeriod));
    if (request.seriesType) params.set("series_type", request.seriesType);

    const url = `${baseUrl}?${params}`;
    const response = await cb.call(() => fetchWithRetry(url));
    if (!response.ok) {
      throw new Error(`Alpha Vantage API error: ${response.status}`);
    }

    return response.json();
  }

  async function fetchSentiment(request: SentimentRequest): Promise<SentimentResult[]> {
    const params = new URLSearchParams({
      function: "NEWS_SENTIMENT",
      apikey: apiKey,
    });

    if (request.tickers) params.set("tickers", request.tickers.join(","));
    if (request.topics) params.set("topics", request.topics.join(","));
    if (request.sort) params.set("sort", request.sort);
    if (request.limit) params.set("limit", String(request.limit));

    const url = `${baseUrl}?${params}`;
    const response = await cb.call(() => fetchWithRetry(url));
    if (!response.ok) {
      throw new Error(`Alpha Vantage sentiment API error: ${response.status}`);
    }

    const data = await response.json();
    return data.feed as SentimentResult[];
  }

  // Convenience methods for common indicators
  const indicators = {
    rsi: (symbol: string, interval: IndicatorRequest["interval"], period = 14) =>
      fetchIndicator({ symbol, indicator: "RSI", interval, timePeriod: period, seriesType: "close" }),

    macd: (symbol: string, interval: IndicatorRequest["interval"]) =>
      fetchIndicator({ symbol, indicator: "MACD", interval, seriesType: "close" }),

    bbands: (symbol: string, interval: IndicatorRequest["interval"], period = 20) =>
      fetchIndicator({ symbol, indicator: "BBANDS", interval, timePeriod: period, seriesType: "close" }),

    sma: (symbol: string, interval: IndicatorRequest["interval"], period = 50) =>
      fetchIndicator({ symbol, indicator: "SMA", interval, timePeriod: period, seriesType: "close" }),

    ema: (symbol: string, interval: IndicatorRequest["interval"], period = 20) =>
      fetchIndicator({ symbol, indicator: "EMA", interval, timePeriod: period, seriesType: "close" }),

    atr: (symbol: string, interval: IndicatorRequest["interval"], period = 14) =>
      fetchIndicator({ symbol, indicator: "ATR", interval, timePeriod: period }),

    vwap: (symbol: string, interval: IndicatorRequest["interval"]) =>
      fetchIndicator({ symbol, indicator: "VWAP", interval }),
  };

  return { fetchIndicator, fetchSentiment, indicators };
}
