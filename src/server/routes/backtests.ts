import { Router } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { backtests, backtestTrades, backtestMatrix, monteCarloRuns, stressTestRuns, strategies, auditLog } from "../db/schema.js";
import { runBacktest } from "../services/backtest-service.js";
import { runMatrix, getMatrixStatus } from "../services/matrix-backtest-service.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";

// ─── Phase 14: Concurrent backtest cap ───────────────────────────────────────
// Without this cap, operator batch-firing 6+ backtests + 4 parallel WF workers
// = 24+ simultaneous Python subprocesses → OOM → server crash.
//
// Policy: cap at MAX_CONCURRENT_BACKTESTS (default 3). When the cap is reached,
// return HTTP 429 with retry_after_seconds=30. The operator's calling pattern is
// fire-and-forget: fire N backtests, get 429s on the excess, retry after 30s.
// Do NOT queue or block the route — a queued response hides the actual load state.
//
// Math: 3 concurrent × 2 WF workers = 6 Python subprocesses. At ~400 MB each
// on the Skytech tower (16 GB RAM), that's ~2.4 GB for backtest workers alone.
// The remaining Node + Ollama + Postgres client can run in the remaining ~13 GB.
//
// Override: set MAX_CONCURRENT_BACKTESTS=5 in .env for dedicated validation runs
// where WF_MAX_WORKERS is also reduced to 1.
const MAX_CONCURRENT_BACKTESTS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_BACKTESTS ?? "3", 10) || 3,
);
let _concurrentBacktestCount = 0;

/** Acquire a backtest slot. Returns true if acquired, false if cap reached. */
function _acquireBacktestSlot(): boolean {
  if (_concurrentBacktestCount >= MAX_CONCURRENT_BACKTESTS) return false;
  _concurrentBacktestCount++;
  return true;
}

/** Release a backtest slot.
 *
 * C-2 FIX: Always called from the finally block of the fire-and-forget promise
 * chain so async exceptions can never leak a slot. Includes an overflow guard:
 * if count somehow exceeds cap+1 (impossible under correct acquire/release pairs
 * but defensive against a future code path that acquires without going through
 * _acquireBacktestSlot), we log CRITICAL and reset to 0.
 */
function _releaseBacktestSlot(): void {
  if (_concurrentBacktestCount > MAX_CONCURRENT_BACKTESTS + 1) {
    console.error(
      `[CRITICAL] _concurrentBacktestCount=${_concurrentBacktestCount} exceeds cap+1=${MAX_CONCURRENT_BACKTESTS + 1}. ` +
      "Resetting to 0. This indicates an acquire/release imbalance — audit callers.",
    );
    _concurrentBacktestCount = 0;
    return;
  }
  _concurrentBacktestCount = Math.max(0, _concurrentBacktestCount - 1);
}

/** Expose current concurrency state for /api/health. */
export function getBacktestConcurrencyStats(): { active: number; cap: number; saturated: boolean } {
  return {
    active: _concurrentBacktestCount,
    cap: MAX_CONCURRENT_BACKTESTS,
    saturated: _concurrentBacktestCount >= MAX_CONCURRENT_BACKTESTS,
  };
}

// C-2 FIX: Startup heartbeat — logs concurrency count every 5 minutes.
// Leaked slots become visible before they cause a 429 storm or OOM.
setInterval(() => {
  console.log(
    `[backtest-concurrency] active=${_concurrentBacktestCount}/${MAX_CONCURRENT_BACKTESTS} ` +
    `saturated=${_concurrentBacktestCount >= MAX_CONCURRENT_BACKTESTS}`,
  );
}, 5 * 60 * 1000).unref(); // .unref() so the interval doesn't prevent graceful shutdown

export const backtestRoutes = Router();

/**
 * G7.1 contract — POST /api/backtests response shape (202 Accepted, async).
 * The backtest is fire-and-forget; the consumer polls `GET /api/backtests/:id`
 * for completion status. Frontend imports this type from here, not from a
 * hand-rolled DB shape. See `src/server/lib/api-contracts.ts`.
 */
export interface BacktestSubmitResponse {
  message: string;
  backtestId: string;
}

// ─── Validation Schemas ──────────────────────────────────────────

const indicatorSchema = z.object({
  type: z.enum(["sma", "ema", "rsi", "macd", "vwap", "bbands", "atr", "adx", "adr"]),
  period: z.number().int().positive(),
  fast: z.number().int().optional(),
  slow: z.number().int().optional(),
  signal: z.number().int().optional(),
  std_dev: z.number().optional(),
});

const strategyConfigSchema = z.object({
  name: z.string().min(1),
  symbol: z.enum(["MES", "MNQ", "MCL"]),
  timeframe: z.string().min(1),
  indicators: z.array(indicatorSchema).max(5).default([]),
  entry_long: z.string().min(1),
  entry_short: z.string().min(1),
  exit: z.string().min(1),
  stop_loss: z.object({
    type: z.enum(["atr", "fixed", "trailing_atr"]),
    multiplier: z.number().positive().default(2.0),
  }),
  position_size: z.object({
    type: z.enum(["dynamic_atr", "fixed"]),
    target_risk_dollars: z.number().positive().optional().default(500),
    fixed_contracts: z.number().int().positive().optional().default(1),
  }),
});

// ══════════════════════════════════════════════════════════════════════════
// MP1-CANDIDATE-INGRESS-1 — DB-authoritative execution-candidate identity
// Ruling AR-1031 (gpt-rulings f98dc291) §4 REPAIR A / B / D.
//
// `spec-onboarding-service.ts:929-935` persists three candidate-identity siblings
// into `strategies.config`, alongside `compiled_spec.spec_hash` (`:896-898`) which
// is the parent anchor. They are SIBLINGS of `compiled_spec` and must stay there:
// `spec_hash` is computed over the certified artifact, so moving a per-candidate
// field inside it would silently change what the certification covers.
//
// 🛑 Authority is the PERSISTED ROW, never the request body. Nothing here mints,
// infers or defaults a candidate: not from timeframe, duration, strategy name, nor
// array position. A row that cannot prove its candidate is REFUSED, because `[0]`
// is a choice the teacher declined to make (R-736).
// ══════════════════════════════════════════════════════════════════════════
const CANDIDATE_ID_KEY = "execution_candidate_id";
const CANDIDATE_CACHE_KEY = "execution_candidate_cache_identity";
const CANDIDATE_RECEIPT_KEY = "execution_candidate_receipt";
const CANDIDATE_PARENT_KEY = "execution_candidate_parent_spec_hash";

export type CandidateAuthoritySidecar = {
  [CANDIDATE_ID_KEY]: string;
  [CANDIDATE_CACHE_KEY]: string;
  [CANDIDATE_RECEIPT_KEY]: unknown;
  [CANDIDATE_PARENT_KEY]: string;
};

/** Non-empty string or null — the same shape as `readPersistedCandidateField`
 *  in spec-onboarding-service.ts:528, so both ends agree on what "present" means. */
function readPersistedString(config: unknown, key: string): string | null {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return null;
  const v = (config as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Which taught bot is THIS persisted row, or is it legacy, or is it unprovable?
 *
 * THREE outcomes, and deliberately no fourth that returns a guess:
 *   legacy     — none of the candidate keys present. Pre-existing behaviour, untouched.
 *   candidate  — the complete authority set: id + cache identity + receipt + parent.
 *   incomplete — ANY candidate key present without the rest. REFUSED, no defaults.
 *
 * The `incomplete` branch triggers on ANY of the three siblings rather than on
 * `candidate_id` alone: a row carrying a receipt but no outer identity is exactly
 * the state `resolve_row_for_execution` refuses, and it must not read as legacy here.
 */
export function resolveCandidateAuthority(
  stratConfig: Record<string, unknown> | undefined,
):
  | { kind: "legacy" }
  | { kind: "candidate"; sidecar: CandidateAuthoritySidecar }
  | { kind: "incomplete"; missing: string[] } {
  if (!stratConfig) return { kind: "legacy" };

  const candidateId = readPersistedString(stratConfig, CANDIDATE_ID_KEY);
  const cacheIdentity = readPersistedString(stratConfig, CANDIDATE_CACHE_KEY);
  const receipt = stratConfig[CANDIDATE_RECEIPT_KEY];
  const hasReceipt = receipt !== undefined && receipt !== null;

  // A row with NO candidate fields is a legacy row (obligation N). Nothing is minted.
  if (!candidateId && !cacheIdentity && !hasReceipt) return { kind: "legacy" };

  const compiledSpec = stratConfig["compiled_spec"];
  const parentSpecHash = readPersistedString(compiledSpec, "spec_hash");

  const missing: string[] = [];
  if (!candidateId) missing.push(CANDIDATE_ID_KEY);
  if (!cacheIdentity) missing.push(CANDIDATE_CACHE_KEY);
  if (!hasReceipt) missing.push(CANDIDATE_RECEIPT_KEY);
  // The parent anchor is required: without it the receipt cannot be joined back to
  // the spec that certified it, and inferring one would be the guess STOP[3] forbids.
  if (!parentSpecHash) missing.push("compiled_spec.spec_hash");

  if (missing.length > 0) return { kind: "incomplete", missing };

  return {
    kind: "candidate",
    sidecar: {
      [CANDIDATE_ID_KEY]: candidateId!,
      [CANDIDATE_CACHE_KEY]: cacheIdentity!,
      [CANDIDATE_RECEIPT_KEY]: receipt,
      [CANDIDATE_PARENT_KEY]: parentSpecHash!,
    },
  };
}

// Accept both snake_case (canonical) and camelCase aliases for dates so
// curl/JS callers don't silently fall through to the resolveDataRange()
// sentinel range when they happen to send startDate / endDate.
const backtestRequestSchema = z.object({
  strategyId: z.string().uuid(),
  strategy: strategyConfigSchema.optional(), // Optional — if omitted, loaded from DB
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slippage_ticks: z.number().positive().optional().default(1.0),
  commission_per_side: z.number().nonnegative().optional().default(0.62),
  mode: z.enum(["single", "walkforward"]).optional().default("walkforward"),
  walk_forward_splits: z.number().int().min(2).max(10).optional().default(5),
  optimizer: z.enum(["optuna", "sqa"]).optional().default("optuna"),
  refinement_stage: z.number().int().min(1).max(3).optional(),
  refinement_iteration: z.number().int().min(0).max(8).optional(),
});

// ══════════════════════════════════════════════════════════════════
// IMPORTANT: Named routes (/compare, /matrix, /matrix/:id) MUST be
// registered BEFORE the parameterized /:id catch-all, otherwise
// Express matches "matrix" and "compare" as :id values.
// ══════════════════════════════════════════════════════════════════

// ─── POST /api/backtests — Run a new backtest (async) ────────────
// G3.3: idempotencyMiddleware deduplicates identical POSTs by Idempotency-Key
// header for 24h, preventing double-spawn of expensive Python backtests.
backtestRoutes.post("/", idempotencyMiddleware, async (req, res) => {
  const parsed = backtestRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { strategyId, strategy: providedStrategy, startDate: _alias_start, endDate: _alias_end, ...rest } = parsed.data;
  // Promote camelCase aliases into the canonical snake_case keys the engine expects.
  const config: Record<string, unknown> = { ...rest };
  if (!config.start_date && _alias_start) config.start_date = _alias_start;
  if (!config.end_date && _alias_end) config.end_date = _alias_end;

  // If no strategy config provided, load it from the DB
  let resolvedStrategy = providedStrategy;
  let strategyClass: string | undefined;
  // Hoisted: MP1 candidate authority is resolved from the persisted row AFTER this
  // block, so the refusal happens before a concurrency slot is taken.
  let stratConfig: Record<string, unknown> | undefined;

  try {
    const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
    if (!strat && !providedStrategy) {
      res.status(404).json({ error: "Strategy not found and no config provided" });
      return;
    }
    stratConfig = strat?.config as Record<string, unknown> | undefined;
    if (stratConfig?.strategy_class) {
      strategyClass = String(stratConfig.strategy_class);
    }
    // If no strategy config was sent in the request, use the one from DB.
    // Canonical DB shape (W23F) nests the strategy DSL under config.strategy.*;
    // legacy/test strategies may have the same fields flat on config.*. Prefer
    // the nested form, fall back to flat. Without this, every field resolves to
    // the schema default ("" / [] / {fixed_contracts:1}) and the Python engine
    // receives an empty entry expression → "Cannot parse expression: ''".
    if (!resolvedStrategy && stratConfig) {
      const nested = (stratConfig.strategy as Record<string, unknown> | undefined) ?? {};
      const pick = <T,>(key: string, fallback: T): T => {
        const v = (nested as any)[key] ?? (stratConfig as any)[key];
        return (v === undefined || v === null) ? fallback : v;
      };
      resolvedStrategy = {
        name: strat!.name,
        symbol: strat!.symbol as any,
        timeframe: strat!.timeframe,
        indicators: pick<any[]>("indicators", []),
        entry_long: String(pick<string>("entry_long", "")),
        entry_short: String(pick<string>("entry_short", "")),
        exit: String(pick<string>("exit", "")),
        stop_loss: pick<any>("stop_loss", { type: "atr", multiplier: 2.0 }),
        position_size: pick<any>("position_size", { type: "fixed", fixed_contracts: 1 }),
      };
    }
  } catch {
    if (!providedStrategy) {
      res.status(500).json({ error: "Failed to load strategy from DB" });
      return;
    }
    // Non-fatal if we already have a provided strategy
  }

  if (!resolvedStrategy) {
    res.status(400).json({ error: "No strategy config provided and could not load from DB" });
    return;
  }

  // ── MP1-CANDIDATE-INGRESS-1 (AR-1031 §4 REPAIR A / B / D) ──────────────────
  // Resolved BEFORE _acquireBacktestSlot() so a refusal never leaks a slot, and
  // before any Python spawn so a refusal is a refusal, not a post-hoc annotation.
  const candidateAuthority = resolveCandidateAuthority(stratConfig);

  if (candidateAuthority.kind === "incomplete") {
    // REPAIR A, refusal half: a partial sidecar is unprovable. No defaults, no
    // "best effort" — an unprovable candidate must not reach the engine at all.
    res.status(409).json({
      error: "candidate_authority_incomplete",
      message:
        "This strategy row claims an execution candidate but cannot prove it: the " +
        "persisted candidate authority is incomplete. Refusing rather than defaulting " +
        "to a taught variant nobody selected.",
      strategyId,
      missing: candidateAuthority.missing,
    });
    return;
  }

  if (candidateAuthority.kind === "candidate" && providedStrategy) {
    // REPAIR B: a request may not run a different strategy payload while borrowing a
    // persisted candidate's identity. Neither side is silently preferred — the
    // conflict itself is the error.
    res.status(409).json({
      error: "candidate_authority_conflict",
      message:
        "This strategy row carries persisted execution-candidate authority, which a " +
        "request-body `strategy` override cannot replace. Persisted candidate/config " +
        "authority is authoritative; re-submit without `strategy`.",
      strategyId,
      execution_candidate_id: candidateAuthority.sidecar[CANDIDATE_ID_KEY],
    });
    return;
  }

  // Phase 14: concurrent backtest cap — return 429 when cap is reached.
  // This prevents the pool-saturation → OOM → server-crash chain under batch firing.
  if (!_acquireBacktestSlot()) {
    res.status(429).json({
      error: "backtest_concurrent_cap",
      message: `Server is running ${_concurrentBacktestCount}/${MAX_CONCURRENT_BACKTESTS} concurrent backtests. Retry after the current set completes.`,
      retry_after_seconds: 30,
      active: _concurrentBacktestCount,
      cap: MAX_CONCURRENT_BACKTESTS,
    });
    return;
  }

  // Reassemble config with the resolved strategy.
  // MP1 REPAIR A: the candidate sidecar is spread LAST and comes only from the
  // persisted row, so a same-named request-body key cannot colour it. REPAIR D:
  // a legacy row spreads nothing, so its config is byte-for-byte what it was.
  const fullConfig = {
    ...config,
    strategy: resolvedStrategy,
    ...(candidateAuthority.kind === "candidate" ? candidateAuthority.sidecar : {}),
  };

  // Generate the backtest ID upfront to avoid race condition
  const backtestId = randomUUID();

  // Fire and forget — return 202 immediately.
  // req.id and req.log are set by correlationMiddleware (typed in src/server/types/express.d.ts).
  //
  // actor="operator": POST /api/backtests is an explicit operator invocation — it must
  // bypass the pipeline-pause gate (pause stops automated scout drains, NOT operator
  // validation probes). Without actor="operator", a PAUSED pipeline silently drops the
  // backtest and the caller receives a ghost ID that never appears in GET /api/backtests/:id.
  const correlationId = req.id;

  // Audit-trail invariant: every operator-initiated backtest leaves a trace so
  // any 90-day-old run can be reconstructed from audit_log alone.
  db.insert(auditLog).values({
    action: "backtest.operator_initiated",
    entityType: "backtest",
    entityId: backtestId,
    input: { strategyId },
    result: {},
    status: "success",
    decisionAuthority: "human",
    correlationId: correlationId ?? null,
  }).catch((err: unknown) => {
    req.log.error({ err, backtestId, correlationId }, "Failed to write operator_initiated audit row");
  });

  runBacktest(strategyId, fullConfig, strategyClass, backtestId, correlationId, "operator").then((_result) => {
    // Logged internally by runBacktest
  }).catch((err) => {
    req.log.error({ err, strategyId, backtestId, correlationId }, "Fire-and-forget backtest failed");
  }).finally(() => {
    // Always release the slot — whether the backtest succeeded, failed, or timed out.
    _releaseBacktestSlot();
  });

  const response: BacktestSubmitResponse = {
    message: "Backtest started",
    backtestId,
  };
  res.status(202).json(response);
});

// ─── GET /api/backtests — List backtests ─────────────────────────
backtestRoutes.get("/", async (req, res) => {
  const { strategyId, status, tier, limit = "50", offset = "0" } = req.query;

  const conditions = [];
  if (strategyId) conditions.push(eq(backtests.strategyId, String(strategyId)));
  if (status) conditions.push(eq(backtests.status, String(status)));
  if (tier) conditions.push(eq(backtests.tier, String(tier)));

  const rows = await db
    .select({
      id: backtests.id,
      strategyId: backtests.strategyId,
      symbol: backtests.symbol,
      timeframe: backtests.timeframe,
      startDate: backtests.startDate,
      endDate: backtests.endDate,
      status: backtests.status,
      tier: backtests.tier,
      totalReturn: backtests.totalReturn,
      sharpeRatio: backtests.sharpeRatio,
      maxDrawdown: backtests.maxDrawdown,
      winRate: backtests.winRate,
      profitFactor: backtests.profitFactor,
      totalTrades: backtests.totalTrades,
      avgDailyPnl: backtests.avgDailyPnl,
      forgeScore: backtests.forgeScore,
      executionTimeMs: backtests.executionTimeMs,
      createdAt: backtests.createdAt,
    })
    .from(backtests)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(backtests.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json(rows);
});

// ─── POST /api/backtests/compare — Side-by-side metrics ──────────
backtestRoutes.post("/compare", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5) {
    res.status(400).json({ error: "Provide 1-5 backtest IDs" });
    return;
  }

  const rows = await db
    .select()
    .from(backtests)
    .where(inArray(backtests.id, ids));

  res.json(rows);
});

// ─── POST /api/backtests/kill-signal — Evaluate refinement kill signal ──
backtestRoutes.post("/kill-signal", async (req, res) => {
  const schema = z.object({
    attempts: z.array(z.object({
      sharpe_ratio: z.number(),
      max_drawdown: z.number(),
      win_rate: z.number(),
      profit_factor: z.number(),
      avg_daily_pnl: z.number(),
    })).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { attempts } = parsed.data;
  const TIER3_MINS = { sharpe_ratio: 1.5, profit_factor: 1.75, avg_daily_pnl: 250, win_rate: 0.60 };

  // Catastrophic risk: immediate kill
  for (const a of attempts) {
    if (a.max_drawdown > 6000) {
      res.json({ kill_signal: "catastrophic_risk", stage: getStage(attempts.length), stage_prompt: getStagePrompt(getStage(attempts.length)) });
      return;
    }
  }

  const bestSharpe = Math.max(...attempts.map((a) => a.sharpe_ratio));
  const bestPf = Math.max(...attempts.map((a) => a.profit_factor));
  const bestWr = Math.max(...attempts.map((a) => a.win_rate));
  const bestPnl = Math.max(...attempts.map((a) => a.avg_daily_pnl));

  if (bestSharpe < 0.8) { res.json({ kill_signal: "no_edge", stage: getStage(attempts.length) }); return; }
  if (bestWr < 0.40) { res.json({ kill_signal: "wrong_direction", stage: getStage(attempts.length) }); return; }
  if (bestPf < 1.0) { res.json({ kill_signal: "unprofitable", stage: getStage(attempts.length) }); return; }

  if (attempts.length >= 2) {
    const prevSharpe = attempts[attempts.length - 2].sharpe_ratio;
    const currSharpe = attempts[attempts.length - 1].sharpe_ratio;
    if (Math.abs(currSharpe - prevSharpe) < 0.1 && currSharpe < TIER3_MINS.sharpe_ratio) {
      res.json({ kill_signal: "flat_improvement", stage: getStage(attempts.length) });
      return;
    }
  }

  if (attempts.length >= 3) {
    const pctSharpe = bestSharpe / TIER3_MINS.sharpe_ratio;
    const pctPf = bestPf / TIER3_MINS.profit_factor;
    const pctPnl = bestPnl / TIER3_MINS.avg_daily_pnl;
    if ((pctSharpe + pctPf + pctPnl) / 3 < 0.70) {
      res.json({ kill_signal: "below_tier3", stage: getStage(attempts.length) });
      return;
    }
  }

  const stage = getStage(attempts.length);
  res.json({ kill_signal: null, stage, stage_prompt: getStagePrompt(stage) });
});

function getStage(iterationCount: number): number {
  if (iterationCount <= 3) return 1;
  if (iterationCount <= 6) return 2;
  return 3;
}

function getStagePrompt(stage: number): string {
  const prompts: Record<number, string> = {
    1: "STAGE 1 — PARAMETER REFINEMENT: Same strategy logic, adjust parameters. Try different lookback periods, ATR multiples, or threshold values. Do NOT change the core entry/exit logic.",
    2: "STAGE 2 — LOGIC VARIANT: Same edge thesis, different execution. Try a different entry method (e.g., mean reversion instead of breakout) or different exit logic.",
    3: "STAGE 3 — CONCEPT PIVOT: Different edge entirely for this symbol/session. Abandon the previous approach. Try a completely different strategy concept.",
  };
  return prompts[stage] ?? prompts[1];
}

// ─── POST /api/backtests/matrix — Cross-matrix testing ────────────
// Wave 2 Track 2A: idempotencyMiddleware deduplicates identical POSTs by
// X-Idempotency-Key (fail-open — no key ⇒ pass straight through). Closes the
// Strategy Deep Analysis Pipeline webhook double-fire → duplicate matrix run.
backtestRoutes.post("/matrix", idempotencyMiddleware, async (req, res) => {
  const schema = z.object({
    strategyId: z.string().uuid(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { strategyId } = parsed.data;

  // Fire and forget — tiered execution takes ~11 min
  runMatrix(strategyId).catch((err) => {
    req.log.error({ err, strategyId }, "Fire-and-forget matrix backtest failed");
  });

  // Get the matrix ID
  const [row] = await db
    .select({ id: backtestMatrix.id })
    .from(backtestMatrix)
    .where(eq(backtestMatrix.strategyId, strategyId))
    .orderBy(desc(backtestMatrix.createdAt))
    .limit(1);

  res.status(202).json({
    message: "Matrix backtest started — 3 symbols × 7 timeframes, tiered execution",
    matrixId: row?.id,
  });
});

// ─── GET /api/backtests/matrix/:id — Matrix status ────────────────
backtestRoutes.get("/matrix/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Invalid matrix ID format (expected UUID)" });
    return;
  }
  const row = await getMatrixStatus(id);
  if (!row) {
    res.status(404).json({ error: "Matrix not found" });
    return;
  }
  res.json(row);
});

// ─── GET /api/backtests/matrix — Latest matrix by strategyId ───────
backtestRoutes.get("/matrix", async (req, res) => {
  const { strategyId } = req.query;
  if (!strategyId || typeof strategyId !== "string") {
    res.status(400).json({ error: "strategyId query parameter required" });
    return;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strategyId)) {
    res.status(400).json({ error: "Invalid strategyId format (expected UUID)" });
    return;
  }

  const [row] = await db
    .select()
    .from(backtestMatrix)
    .where(eq(backtestMatrix.strategyId, strategyId))
    .orderBy(desc(backtestMatrix.createdAt))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "No matrix found for this strategy" });
    return;
  }

  res.json(row);
});

// ─── GET /api/backtests/:id — Full backtest detail ───────────────
// NOTE: This catch-all MUST be after all named routes (/compare, /matrix)
backtestRoutes.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Invalid backtest ID format (expected UUID)" });
    return;
  }
  const [row] = await db
    .select()
    .from(backtests)
    .where(eq(backtests.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }

  // Attach crisis/stress test results if they exist
  const [stressRow] = await db
    .select()
    .from(stressTestRuns)
    .where(eq(stressTestRuns.backtestId, req.params.id))
    .limit(1);

  const result: Record<string, unknown> = { ...row };
  if (stressRow) {
    result.crisisResults = stressRow.scenarios;
  }

  res.json(result);
});

// ─── GET /api/backtests/:id/equity — Equity curve ────────────────
backtestRoutes.get("/:id/equity", async (req, res) => {
  const [row] = await db
    .select({ equityCurve: backtests.equityCurve })
    .from(backtests)
    .where(eq(backtests.id, req.params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }

  res.json({ equityCurve: row.equityCurve });
});

// ─── GET /api/backtests/:id/trades — Paginated trades ────────────
backtestRoutes.get("/:id/trades", async (req, res) => {
  const { limit = "100", offset = "0" } = req.query;

  const trades = await db
    .select()
    .from(backtestTrades)
    .where(eq(backtestTrades.backtestId, req.params.id))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json(trades);
});

// ─── DELETE /api/backtests/:id — Cascade delete ──────────────────
backtestRoutes.delete("/:id", async (req, res) => {
  const backtestId = req.params.id;

  // Delete related records first (FK constraints)
  await db.delete(monteCarloRuns).where(eq(monteCarloRuns.backtestId, backtestId));
  await db.delete(stressTestRuns).where(eq(stressTestRuns.backtestId, backtestId));
  await db.delete(backtestTrades).where(eq(backtestTrades.backtestId, backtestId));

  const [deleted] = await db
    .delete(backtests)
    .where(eq(backtests.id, backtestId))
    .returning({ id: backtests.id });

  if (!deleted) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }

  // Audit log — include correlationId to link this human action to the originating HTTP request
  await db.insert(auditLog).values({
    action: "backtest.delete",
    entityType: "backtest",
    entityId: backtestId,
    input: {},
    result: {},
    status: "success",
    decisionAuthority: "human",
    correlationId: req.id ?? null,
  });

  res.json({ deleted: true, id: backtestId });
});
