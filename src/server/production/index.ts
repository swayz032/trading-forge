/**
 * src/server/production/index.ts
 *
 * ─── HARD ISOLATION BOUNDARY ───────────────────────────────────────────────
 * This module is the production trading path. It MUST NOT import from:
 *
 *   - agent-service.ts          (LLM research loop — nondeterministic)
 *   - critic-optimizer-service.ts (Optuna search — nondeterministic)
 *   - quantum_* modules         (challenger-only, high failure rate)
 *   - synthetic_market_simulator.py (research simulator)
 *   - scout-*-service.ts        (strategy generation pipeline)
 *   - Any module tagged challenger_only
 *
 * Violation detection: `npm run check:production-isolation` (CI gate).
 * See: src/server/production/README.md for the full allowed-import list.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Permitted imports (production-safe modules only):
 *   - paper-execution-service.ts       (paper/live order execution)
 *   - prop-firm-health-service.ts      (C2 suspension detection)
 *   - exchange-status-service.ts       (C1 CME outage detection)
 *   - macro-gate-service.ts            (C11 macro hard gates)
 *   - network-failover.ts              (C4 connectivity state)
 *   - credential-loader.ts             (C6 Bitwarden vault)
 *   - validation-cadence-service.ts    (C7 drift math input)
 *   - dashboard-snapshot-service.ts    (C2 evidence layer)
 *   - windows-health-check-service.ts  (C8 Windows reboot detection)
 *   - db/index.ts + db/schema.ts       (database)
 *   - routes/sse.ts                    (broadcastSSE)
 *   - services/alert-service.ts        (AlertFactory)
 *   - lib/logger.ts                    (structured logging)
 */

export { killSwitch } from "./kill-switch.js";
export type { ProductionMode, KillSwitchStatusReport, KillSwitchLayerStatus } from "./kill-switch.js";

export { runDailyReconciliation, getDailyReconciliationStatus, RECON_CONFIG } from "./reconciliation-service.js";
export type { ReconciliationResult, ReconciliationStatus, ReconSeverity, MismatchDetail } from "./reconciliation-service.js";

export { runWeeklyDriftDetection, DRIFT_CONFIG } from "./drift-detector.js";
export type { DriftReport, DriftSeverity } from "./drift-detector.js";
