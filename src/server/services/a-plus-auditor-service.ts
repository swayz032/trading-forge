/**
 * A+ Market Auditor Service — Tier 3.3 (Gemini Quantum Blueprint, W3b)
 *
 * Orchestrates the daily pre-market scan:
 *   1. Check QUANTUM_AMARKET_AUDITOR_ENABLED feature flag — exit early if false.
 *   2. Insert pending row in a_plus_market_scans (pending-row contract).
 *   3. Wrap scan in quantum-cost-tracker (moduleName="a_plus_auditor").
 *   4. Spawn Python subprocess: src.engine.a_plus_market_auditor (CLI entry).
 *   5. Parse AuditResult JSON; update scan row to completed/failed.
 *   6. Broadcast SSE event "a-plus-auditor:scan-complete".
 *
 * Authority: advisory / challenger_only. This service writes evidence rows;
 * it does NOT signal execution or modify lifecycle state.
 *
 * Compliance handoff: if winnerMarket is null → observationMode=true.
 * Strategies that call shouldSkip() will see the OBSERVATION_MODE signal.
 * Correlated position enforcement lives in Tier 5.3.1 (W5b, not yet shipped).
 *
 * Feature flag: QUANTUM_AMARKET_AUDITOR_ENABLED=false (default)
 * When false: returns early with { skipped: true }.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { aPlusMarketScans } from "../db/schema.js";
import { runPythonModule } from "../lib/python-runner.js";
import { withCostTracking } from "../lib/quantum-cost-tracker.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";

// ─── Feature Flag ─────────────────────────────────────────────────────────────
function isAuditorEnabled(): boolean {
  return process.env.QUANTUM_AMARKET_AUDITOR_ENABLED === "true";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketInput {
  atr_5m: number;
  atr_8yr_avg: number;
  vix: number;
  gap_atr: number;
  spread: number;
  /** Pre-computed P(hit 1:2 reward) — if provided, Python skips MC circuit */
  p_target_hit?: number | null;
  /** Pre-computed noise score — if provided, Python skips entropy circuit */
  noise_score?: number | null;
}

export interface AuditorScanInput {
  marketInputs: Record<string, MarketInput>; // {"MES": {...}, "MNQ": {...}, "MCL": {...}}
  corrMatrix?: Record<string, Record<string, number>>; // 60-min rolling correlation matrix
  seed?: number;
}

export interface EdgeScoreDetail {
  vol: number;
  p_target: number;
  noise: number | null;
  entangle: number | null;
  composite: number;
  passes_p_target_gate: boolean;
  passes_noise_gate: boolean;
}

export interface AuditorScanResult {
  scanRowId: string;
  winnerMarket: string | null;
  observationMode: boolean;
  edgeScores: Record<string, EdgeScoreDetail>;
  leadMarket: string | null;
  lagWindowMinutes: number | null;
  entanglementStrength: number | null;
  governance: Record<string, unknown>;
  scanDurationMs: number;
  hardware: string;
  seed: number;
  /** True when QUANTUM_AMARKET_AUDITOR_ENABLED=false */
  skipped?: boolean;
}

// ─── Default correlation matrix (fallback when caller doesn't provide one) ────
const DEFAULT_CORR_MATRIX: Record<string, Record<string, number>> = {
  MES: { MES: 1.0, MNQ: 0.82, MCL: 0.15, DXY: -0.30 },
  MNQ: { MES: 0.82, MNQ: 1.0,  MCL: 0.12, DXY: -0.28 },
  MCL: { MES: 0.15, MNQ: 0.12, MCL: 1.0,  DXY:  0.05 },
  DXY: { MES: -0.30, MNQ: -0.28, MCL: 0.05, DXY: 1.0  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Run a full A+ Market Auditor scan for today.
 *
 * Follows pending-row contract:
 *   - Row inserted with status="pending" before Python call.
 *   - Updated to "completed" or "failed" on resolve.
 *
 * Never throws to the cron caller — all errors are caught and persisted
 * as status="failed" with errorMessage.
 */
export async function runAuditScan(
  input: AuditorScanInput,
  correlationId?: string,
): Promise<AuditorScanResult> {
  const logCtx = { correlationId, moduleName: "a_plus_auditor" };

  // ── Feature flag early-exit ──────────────────────────────────────────────
  if (!isAuditorEnabled()) {
    logger.debug(
      logCtx,
      "a-plus-auditor: QUANTUM_AMARKET_AUDITOR_ENABLED=false — skipping scan",
    );
    return {
      scanRowId: "",
      winnerMarket: null,
      observationMode: false,
      edgeScores: {},
      leadMarket: null,
      lagWindowMinutes: null,
      entanglementStrength: null,
      governance: { authoritative: false, decision_role: "challenger_only" },
      scanDurationMs: 0,
      hardware: "skipped",
      seed: input.seed ?? 42,
      skipped: true,
    };
  }

  const scanDate = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // ── Insert pending row ───────────────────────────────────────────────────
  let scanRowId: string;
  try {
    const [pendingRow] = await db
      .insert(aPlusMarketScans)
      .values({
        scanDate,
        status: "pending",
        observationMode: false,
        edgeScores: {},
        seed: input.seed ?? 42,
      })
      .onConflictDoUpdate({
        target: [aPlusMarketScans.scanDate],
        set: {
          status: "pending",
          edgeScores: {},
          winnerMarket: null,
          observationMode: false,
          leadMarket: null,
          lagWindowMinutes: null,
          entanglementStrength: null,
          errorMessage: null,
          scanDurationMs: null,
          hardware: null,
          seed: input.seed ?? 42,
        },
      })
      .returning();
    scanRowId = pendingRow.id;
    logger.info(
      { ...logCtx, scanRowId, scanDate },
      "a-plus-auditor: pending row inserted",
    );
  } catch (err) {
    logger.error(
      { ...logCtx, err },
      "a-plus-auditor: failed to insert pending row — aborting scan",
    );
    throw err;
  }

  // ── Build Python payload ─────────────────────────────────────────────────
  const pythonPayload = {
    market_inputs: Object.fromEntries(
      Object.entries(input.marketInputs).map(([sym, mdata]) => [
        sym,
        {
          atr_5m: mdata.atr_5m,
          atr_8yr_avg: mdata.atr_8yr_avg,
          vix: mdata.vix,
          gap_atr: mdata.gap_atr,
          spread: mdata.spread,
          p_target_hit: mdata.p_target_hit ?? null,
          noise_score: mdata.noise_score ?? null,
        },
      ]),
    ),
    corr_matrix: input.corrMatrix ?? DEFAULT_CORR_MATRIX,
    seed: input.seed ?? 42,
  };

  // ── Run scan with cost tracking ──────────────────────────────────────────
  let pythonResult: Record<string, unknown>;
  try {
    pythonResult = await withCostTracking(
      { moduleName: "a_plus_auditor" },
      async () => {
        return await runPythonModule<Record<string, unknown>>({
          module: "src.engine.a_plus_market_auditor",
          config: pythonPayload,
          timeoutMs: 120_000,
          componentName: "a-plus-market-auditor",
          correlationId,
        });
      },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      { ...logCtx, scanRowId, err },
      "a-plus-auditor: Python scan failed",
    );
    await db
      .update(aPlusMarketScans)
      .set({ status: "failed", errorMessage })
      .where(eq(aPlusMarketScans.id, scanRowId));
    throw err;
  }

  // ── Parse result ─────────────────────────────────────────────────────────
  const winnerMarket = (pythonResult.winner_market as string | null) ?? null;
  const observationMode = Boolean(pythonResult.observation_mode ?? false);
  const edgeScores = (pythonResult.edge_scores as Record<string, EdgeScoreDetail>) ?? {};
  const leadMarket = (pythonResult.lead_market as string | null) ?? null;
  const lagWindowMinutes = (pythonResult.lag_window_minutes as number | null) ?? null;
  const entanglementStrength = (pythonResult.entanglement_strength as number | null) ?? null;
  const governance = (pythonResult.governance as Record<string, unknown>) ?? {};
  const scanDurationMs = (pythonResult.scan_duration_ms as number) ?? 0;
  const hardware = (pythonResult.hardware as string) ?? "fallback_unavailable";
  const seed = (pythonResult.seed as number) ?? (input.seed ?? 42);

  // ── Update row to completed ──────────────────────────────────────────────
  await db
    .update(aPlusMarketScans)
    .set({
      winnerMarket,
      observationMode,
      edgeScores: edgeScores as Record<string, unknown>,
      leadMarket,
      lagWindowMinutes,
      entanglementStrength: entanglementStrength !== null ? String(entanglementStrength) : null,
      status: "completed",
      scanDurationMs,
      hardware,
      seed,
      errorMessage: null,
    })
    .where(eq(aPlusMarketScans.id, scanRowId));

  logger.info(
    {
      ...logCtx,
      scanRowId,
      winnerMarket,
      observationMode,
      leadMarket,
      entanglementStrength,
      scanDurationMs,
      hardware,
    },
    "a-plus-auditor: scan completed",
  );

  // ── SSE broadcast ────────────────────────────────────────────────────────
  broadcastSSE("a-plus-auditor:scan-complete", {
    scanRowId,
    winnerMarket,
    observationMode,
    leadMarket,
    entanglementStrength,
    scanDate,
    completedAt: new Date().toISOString(),
  });

  return {
    scanRowId,
    winnerMarket,
    observationMode,
    edgeScores,
    leadMarket,
    lagWindowMinutes,
    entanglementStrength,
    governance,
    scanDurationMs,
    hardware,
    seed,
  };
}

/**
 * Get the most recent completed scan result for a given date.
 * Used by skip engine to check observation_mode before strategies fire.
 *
 * Returns null if no completed scan exists for that date.
 */
export async function getLatestScan(
  scanDate?: string,
): Promise<typeof aPlusMarketScans.$inferSelect | null> {
  const date = scanDate ?? new Date().toISOString().slice(0, 10);
  const [row] = await db
    .select()
    .from(aPlusMarketScans)
    .where(eq(aPlusMarketScans.scanDate, date))
    .limit(1);
  return row ?? null;
}
