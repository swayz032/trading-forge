/**
 * ────────────────────────────────────────────────────────────────────────────
 * Shared DB types — derived from Drizzle schema via $inferSelect/$inferInsert
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Single source of truth for row shapes that cross the server boundary.
 * Whenever a column is added, renamed, or dropped in `src/server/db/schema.ts`,
 * these types update automatically — no manual mirroring required on the
 * server side.
 *
 * # Why this file exists
 * Until Pass 8 (2026-04), `Trading_forge_frontend/.../src/types/api.ts`
 * hand-mirrored Drizzle row shapes. This caused silent drift — for example
 * the `source` column added by migration 0045 never landed in the frontend
 * Strategy interface. By exporting inferred types from a shared module we
 * eliminate the manual sync step on the server and provide a generation
 * target the frontend can copy from in lockstep.
 *
 * # Frontend integration
 * The frontend lives in a separate workspace with its own tsconfig and
 * cannot import directly from `src/server/db/*` (no shared paths alias,
 * no monorepo setup). The frontend's `src/types/api.ts` re-declares the
 * key shapes with a header comment pointing here as the source of truth.
 *
 * If/when the workspace is unified, the frontend should import from
 * `@/shared/db-types` directly and delete the manual interfaces.
 *
 * # Drizzle inference notes
 * - `numeric` columns infer as `string | null` (Postgres returns numeric as
 *   string to preserve precision; client code parses as needed).
 * - `timestamp` columns infer as `Date` server-side. The frontend serializes
 *   them to ISO strings over JSON, so the frontend interfaces use `string`.
 * - `jsonb` columns infer as `unknown`. Use route-level Zod or hand
 *   narrowing for downstream consumers.
 */

import type {
  strategies,
  backtests,
  paperSessions,
  paperTrades,
  paperPositions,
  monteCarloRuns,
  criticOptimizationRuns,
  alerts,
  auditLog,
  strategyExports,
} from "../server/db/schema.js";

// ─── Select (read) shapes ────────────────────────────────────────────────────
export type Strategy = typeof strategies.$inferSelect;
export type Backtest = typeof backtests.$inferSelect;
export type PaperSession = typeof paperSessions.$inferSelect;
export type PaperTrade = typeof paperTrades.$inferSelect;
export type PaperPosition = typeof paperPositions.$inferSelect;
export type MonteCarloRun = typeof monteCarloRuns.$inferSelect;
export type CriticOptimizationRun = typeof criticOptimizationRuns.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type StrategyExport = typeof strategyExports.$inferSelect;

// ─── Insert shapes (for service layer typing) ────────────────────────────────
export type StrategyInsert = typeof strategies.$inferInsert;
export type BacktestInsert = typeof backtests.$inferInsert;
export type PaperSessionInsert = typeof paperSessions.$inferInsert;
export type PaperTradeInsert = typeof paperTrades.$inferInsert;
export type PaperPositionInsert = typeof paperPositions.$inferInsert;
export type MonteCarloRunInsert = typeof monteCarloRuns.$inferInsert;
export type CriticOptimizationRunInsert =
  typeof criticOptimizationRuns.$inferInsert;
export type AlertInsert = typeof alerts.$inferInsert;
export type AuditLogEntryInsert = typeof auditLog.$inferInsert;
export type StrategyExportInsert = typeof strategyExports.$inferInsert;
