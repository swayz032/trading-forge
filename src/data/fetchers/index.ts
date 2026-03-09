/**
 * Data Fetchers — Unified entry point
 *
 * Three providers, three roles:
 *   Databento      → Historical bulk downloads (backtesting)
 *   Massive        → Real-time streaming (paper/live trading)
 *   Alpha Vantage  → Indicators + sentiment (AI agents)
 */

export { createDatabentoFetcher } from "./databento.js";
export { createMassiveFetcher } from "./massive.js";
export { createAlphaVantageFetcher } from "./alphavantage.js";
