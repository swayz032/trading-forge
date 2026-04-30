/**
 * Tier 6 — Quantum Pre-Flight Route
 *
 * CACHE-READ-ONLY lookup of quantum_mc_runs by strategy hash. n8n workflows
 * (Strategy_Generation_Loop, Nightly_Strategy_Research_Loop) call this between
 * "Parse Output" and "Submit Backtest" to gate strategies that have already
 * been quantum-tested and FAILED the prop-firm UCI threshold.
 *
 * CRITICAL CONSTRAINTS (architect-flagged):
 *   1. This route MUST NEVER spawn quantum compute. The backtest auto-fire path
 *      at backtest-service.ts:1022-1041 is the SOLE quantum-compute trigger.
 *   2. Cache MISS returns {cached: false, passed: true} — proceed without
 *      blocking, do NOT spawn a new QMC run. Spawning here would cause double
 *      quantum work per logical strategy event.
 *   3. n8n is shaky around long Python calls — keep this fast (target <200ms p95).
 *   4. Pipeline pause guard: when isActive() === false, return early with
 *      {cached: false, passed: true, reason: "pipeline_paused"} so paused
 *      pipelines never appear as "blocked by stale cache".
 *
 * Cache contract:
 *   Hit  + UCI <= threshold → {cached: true, passed: true,  score: <UCI>}
 *   Hit  + UCI >  threshold → {cached: true, passed: false, score: <UCI>}
 *   Miss                    → {cached: false, passed: true, score: null}
 *   Paused                  → {cached: false, passed: true, reason: "pipeline_paused"}
 *
 * UCI formula:
 *   UCI = estimated_value + confidence_interval.upper
 *   threshold = env.QUANTUM_PROP_FIRM_UCI_THRESHOLD ?? 0.01 (1% breach probability ceiling)
 *
 * Cache-key strategy hash:
 *   sha256(canonicalJson(dsl)) → 64-char hex. Canonical JSON sorts keys
 *   recursively so payload shape variations between n8n nodes don't fragment
 *   the cache.
 *
 * Lookup query:
 *   SELECT q.id, q.backtest_id, q.estimated_value, q.confidence_interval
 *   FROM quantum_mc_runs q
 *   JOIN backtests b ON b.id = q.backtest_id
 *   WHERE q.status = 'completed'
 *     AND b.config->>'strategy_hash' = $1
 *   ORDER BY q.created_at DESC
 *   LIMIT 1
 *
 * Backtests written before backtest-service starts embedding strategy_hash
 * into config will produce cache misses — that's correct behavior (proceed,
 * don't block).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";

export const quantumPreFlightRoutes = Router();

const DEFAULT_UCI_THRESHOLD = 0.01;

// ─── Validation ─────────────────────────────────────────────────────────────
const preFlightRequestSchema = z.object({
  dsl: z.record(z.unknown()),
  // Optional metadata so dashboards/audits can correlate to a parent flow
  // (no business logic depends on these — they only flow through to logs).
  workflowRunId: z.string().optional(),
  source: z.string().optional(),
});

// ─── Strategy hash (canonical JSON → sha256) ────────────────────────────────
/**
 * Canonical JSON serializer. Recursively sorts object keys so payloads with
 * different key orderings produce the same hash. Arrays preserve order.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

export function computeStrategyHash(dsl: unknown): string {
  const canonical = JSON.stringify(canonicalize(dsl));
  return createHash("sha256").update(canonical).digest("hex");
}

// ─── UCI extraction ─────────────────────────────────────────────────────────
type ConfidenceInterval = { lower?: number | string; upper?: number | string; confidence_level?: number | string };

function extractUci(estimatedValue: unknown, ci: unknown): number | null {
  const ev = Number(estimatedValue);
  if (!Number.isFinite(ev)) return null;
  if (!ci || typeof ci !== "object") return null;
  const upper = Number((ci as ConfidenceInterval).upper);
  if (!Number.isFinite(upper)) return null;
  return ev + upper;
}

function getThreshold(): number {
  const raw = process.env.QUANTUM_PROP_FIRM_UCI_THRESHOLD;
  if (!raw) return DEFAULT_UCI_THRESHOLD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UCI_THRESHOLD;
}

// ─── Route ──────────────────────────────────────────────────────────────────
/**
 * POST /api/quantum/pre-flight
 *
 * Body: { dsl: <StrategyDSL JSON> }
 * Response: { cached: bool, passed: bool, score: number|null, ...metadata }
 *
 * READ-ONLY. NEVER spawns quantum compute.
 */
quantumPreFlightRoutes.post("/", async (req: Request, res: Response) => {
  const parsed = preFlightRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // ─── Pipeline pause guard ──────────────────────────────────────────────────
  // When the pipeline is PAUSED/VACATION, return a non-blocking pass-through.
  // n8n keeps running (n8n is always-on per pipeline-control-service contract);
  // returning a deterministic shape lets workflows differentiate "no decision"
  // from a real cache hit.
  if (!(await isPipelineActive())) {
    res.json({
      cached: false,
      passed: true,
      score: null,
      reason: "pipeline_paused",
    });
    return;
  }

  // ─── Compute strategy hash from DSL ────────────────────────────────────────
  const strategyHash = computeStrategyHash(parsed.data.dsl);

  // ─── Cache lookup (READ-ONLY) ──────────────────────────────────────────────
  // Joins quantum_mc_runs to backtests on backtest_id and filters by the
  // strategy_hash embedded in backtests.config. Cache miss is the common case
  // until backtest-service starts persisting strategy_hash into config.
  let row: { id: string; backtest_id: string; estimated_value: unknown; confidence_interval: unknown } | undefined;
  try {
    const rows = (await db.execute(sql`
      SELECT q.id,
             q.backtest_id,
             q.estimated_value,
             q.confidence_interval
      FROM quantum_mc_runs q
      JOIN backtests b ON b.id = q.backtest_id
      WHERE q.status = 'completed'
        AND b.config->>'strategy_hash' = ${strategyHash}
      ORDER BY q.created_at DESC
      LIMIT 1
    `)) as unknown as Array<{
      id: string;
      backtest_id: string;
      estimated_value: unknown;
      confidence_interval: unknown;
    }>;
    row = rows[0];
  } catch (err) {
    // Cache lookup failure is NEVER fatal. Per architect: pre-flight must not
    // block the pipeline if the cache subsystem is unavailable.
    req.log.warn({ err, strategyHash }, "Quantum pre-flight: cache lookup failed (non-blocking)");
    res.json({
      cached: false,
      passed: true,
      score: null,
      reason: "cache_lookup_error",
    });
    return;
  }

  // ─── Cache miss → proceed without blocking ─────────────────────────────────
  if (!row) {
    res.json({
      cached: false,
      passed: true,
      score: null,
      reason: "no_prior_quantum_run",
    });
    return;
  }

  // ─── Cache hit → evaluate UCI vs threshold ─────────────────────────────────
  const uci = extractUci(row.estimated_value, row.confidence_interval);
  if (uci === null) {
    // Malformed cache row — treat as miss rather than guess.
    req.log.warn({ qmcRunId: row.id }, "Quantum pre-flight: cache row missing valid UCI components");
    res.json({
      cached: false,
      passed: true,
      score: null,
      reason: "cache_row_malformed",
    });
    return;
  }

  const threshold = getThreshold();
  const passed = uci <= threshold;
  res.json({
    cached: true,
    passed,
    score: uci,
    qmcRunId: row.id,
    backtestId: row.backtest_id,
    threshold,
    reason: passed ? "uci_within_threshold" : "uci_above_threshold",
  });
});
