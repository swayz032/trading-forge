/**
 * Correlation threshold constants — single source of truth for A7 gate.
 *
 * CLAUDE.md §12 hard gate: A7 Signal Correlation threshold = 0.70.
 *
 * Both correlation-service.ts and signal-correlation-service.ts import from here.
 * Any downstream consumer (lifecycle gate, dashboard, SSE) must also import from here —
 * never hardcode 0.50, 0.85, or any other value.
 */

/**
 * A7 signal correlation threshold.
 *
 * Two strategies whose signal cosine-similarity (or Pearson daily-PnL correlation)
 * exceeds this value are treated as duplicates for position-sizing and lifecycle gate purposes.
 *
 * CLAUDE.md §12 canonical value: 0.70.
 * Do NOT change this without a corresponding CLAUDE.md §12 update and audit_log entry.
 */
export const A7_CORRELATION_THRESHOLD = 0.70;
