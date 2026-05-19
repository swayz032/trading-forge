/**
 * strict-rate-limit.ts
 *
 * Re-exports the pre-configured strictRateLimit middleware from rate-limit.ts.
 * Import this module in index.ts when mounting mutation/expensive endpoints
 * (run-strategy, batch, backtests, monte-carlo, quantum-mc).
 *
 * Limit: 30 req / 60 s per IP.
 * Responds 429 with Retry-After header when exceeded.
 */
export { strictRateLimit } from "./rate-limit.js";
