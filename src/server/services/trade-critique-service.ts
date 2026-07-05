/**
 * Trade Critique Service — Wave 26 Pass 1.
 *
 * Autopsies every closed paper/live position within 60 seconds.
 * Triggered fire-and-forget from paper-execution-service.ts closePosition().
 *
 * Design:
 *   - Cloud-first GPT-5.4 (literal model string, operator-specified)
 *   - Ollama gemma4:e4b-it-qat fallback
 *   - MAX_CONCURRENT_CRITIQUES=3 (env: TRADE_CRITIQUE_CONCURRENCY) backpressure
 *   - 3-strike consecutive-failure Discord WARN via system_parameters
 *   - Dual-output: technical_diagnosis + plain_english_summary
 *   - Defensive Wave 25 field handling: null fields → missing_fields[] + data_completeness
 *   - Idempotency: re-run within 5 min on same position_id → returns existing row
 *
 * Audit actions emitted:
 *   trade_critique.completed
 *   trade_critique.partial_data
 *   trade_critique.deferred_saturation
 *   trade_critique.failed
 *   trade_critique.consecutive_failure_alert
 */

import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  paperPositions,
  paperSessions,
  strategies,
  tradeCritique,
  systemParameters,
  auditLog,
  brokerAccounts,
} from "../db/schema.js";
import { callOpenAI, getFallback, loadSystemPrompt } from "./model-router.js";
import { OllamaClient } from "./ollama-client.js";
import { notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { logger } from "../lib/logger.js";
// Wave 1 — institutional RAG grounding + faithfulness verification.
// Both are behind default-OFF feature flags (CRITIQUE_RAG_ENABLED /
// CRITIQUE_FAITHFULNESS_CHECK). When the flags are off, neither is invoked and
// behavior is byte-identical to the pre-Wave-1 single-message critique call.
import { retrieveCritiqueKnowledge } from "./critique-knowledge-retriever.js";
import { checkCritiqueFaithfulness } from "./critique-faithfulness-check.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TradeCritiqueStatus = "completed" | "partial_data" | "queued_deferred" | "failed";

export interface TechnicalDiagnosis {
  entry_quality_score: number;
  exit_execution_delta_r: number;
  confluence_factors_missed: string[];
  parameter_hint: null | {
    field: string;
    current: string | number | null;
    suggested_range: string;
    confidence: number;
  };
  regime_mismatch: boolean;
  attribution: {
    regime: number;
    structure: number;
    narrative: number;
    confluence: number;
    decay: number;
    liquidity: number;
    fill: number;
    exit_plan: number;
  };
  realized_r: number | null;
  expected_r_percentile: number | null;
  topstep_consistency_current_pct: number | null;
  topstep_consistency_distance_to_cap: number | null;
}

export interface PlainEnglishSummary {
  grade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  one_liner: string;
  what_went_right: string;
  what_to_watch: string;
  action_needed: string;
}

export interface TradeCritiqueResult {
  status: TradeCritiqueStatus;
  positionId: string;
  /** Populated when status = completed | partial_data */
  critiqueId?: string;
  grade?: PlainEnglishSummary["grade"];
  dataCompleteness?: "full" | "partial" | "minimal";
  provider?: "openai" | "ollama";
  model?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONSECUTIVE_FAILURES_KEY = "trade_critique_consecutive_failures";
const STRIKE_THRESHOLD = 3;
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ─── Backpressure (in-process concurrency gate) ──────────────────────────────

let _activeCritiques = 0;

function _maxConcurrent(): number {
  const fromEnv = parseInt(process.env.TRADE_CRITIQUE_CONCURRENCY ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 3;
}

// Exported for tests only — never call from production code
export function _resetActiveCount(): void {
  _activeCritiques = 0;
}

// ─── Consecutive-failure tracking ───────────────────────────────────────────

async function readConsecutiveFailures(): Promise<number> {
  try {
    const [row] = await db
      .select({ currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, CONSECUTIVE_FAILURES_KEY));
    return row ? parseInt(row.currentValue ?? "0", 10) : 0;
  } catch {
    return 0; // fail-open on read
  }
}

async function incrementConsecutiveFailures(): Promise<number> {
  try {
    const current = await readConsecutiveFailures();
    const next = current + 1;
    await upsertSystemParameter(CONSECUTIVE_FAILURES_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

async function resetConsecutiveFailures(): Promise<void> {
  try {
    await upsertSystemParameter(CONSECUTIVE_FAILURES_KEY, "0");
  } catch {
    // best-effort; failure to reset counter is non-fatal
  }
}

async function upsertSystemParameter(key: string, value: string): Promise<void> {
  const [existing] = await db
    .select({ paramName: systemParameters.paramName })
    .from(systemParameters)
    .where(eq(systemParameters.paramName, key));

  if (existing) {
    await db
      .update(systemParameters)
      .set({ currentValue: value, updatedAt: new Date() })
      .where(eq(systemParameters.paramName, key));
  } else {
    await db.insert(systemParameters).values({
      paramName: key,
      currentValue: value,
      description: "Trade critique consecutive failure counter (auto-resets on success)",
      domain: "paper",
    });
  }
}

// ─── Wave 25 field completeness check ───────────────────────────────────────

interface Wave25ContextFields {
  structureState: unknown;
  narrativePhase: unknown;
  confluenceScore: unknown;
  confluenceFactorsActive: unknown;
  nearestLiquidityLevel: unknown;
  backtestExpectedRByRegime: unknown;
}

function buildMissingFieldsList(ctx: Wave25ContextFields): string[] {
  const missing: string[] = [];
  if (ctx.structureState == null) missing.push("structure_state");
  if (ctx.narrativePhase == null) missing.push("narrative_phase");
  if (ctx.confluenceScore == null) missing.push("confluence_score");
  if (ctx.confluenceFactorsActive == null) missing.push("confluence_factors_active");
  if (ctx.nearestLiquidityLevel == null) missing.push("nearest_liquidity_level");
  if (ctx.backtestExpectedRByRegime == null) missing.push("backtest_expected_r_by_regime");
  return missing;
}

function deriveDataCompleteness(missingFields: string[]): "full" | "partial" | "minimal" {
  if (missingFields.length === 0) return "full";
  if (missingFields.length <= 4) return "partial";
  return "minimal";
}

// ─── Account resolution (data bridge, 2026-07-05) ────────────────────────────

/**
 * Resolve the broker_accounts.account_id that a trade_critique row should carry,
 * from the paper_positions -> paper_sessions -> firmId chain.
 *
 * paper_sessions has no direct account_id column today (see schema.ts), so this
 * mirrors the SAME "first enabled broker_accounts row for this firmId" convention
 * already established for live-order routing (paper-execution-service.ts's
 * `_resolveSmeContextForExit` + the Server-Mediated Execution entry-routing block
 * in paper-signal-service.ts) — a deliberate, documented approximation: today the
 * operator runs one enabled broker account per real firm (mffu/topstep), so the
 * lookup is unambiguous in practice. If/when true multi-account-per-firm paper
 * trading ships, this (and its two SME siblings) will need a session-level
 * account_id column to disambiguate — tracked as a known limitation, not silently
 * guessed around.
 *
 * Deliberately does NOT consult `strategies.paper_account_routing` /
 * `slumdawg-baseline` / `slumdawg-rl-challenger` (Wave 29 Pass C.3 A/B paper
 * routing) — those broker_accounts rows live under the sentinel `firm_id='paper'`
 * and exist purely for RL-challenger observability bookkeeping. Every strategy
 * defaults to `paper_account_routing='baseline'`, so resolving through that path
 * here would misattribute real MFFU/Topstep sessions' critiques to the internal
 * paper sandbox account — a worse error than leaving accountId null.
 *
 * Fail-soft: returns null (never throws) on missing firmId or any DB error, and
 * the caller logs a structured warn so the gap is visible rather than silently
 * swallowed.
 */
async function resolveAccountIdForCritique(firmId: string | null | undefined): Promise<string | null> {
  if (!firmId) return null;
  try {
    const [acct] = await db
      .select({ accountId: brokerAccounts.accountId })
      .from(brokerAccounts)
      .where(and(eq(brokerAccounts.firmId, firmId), eq(brokerAccounts.enabled, true)))
      .limit(1);
    return acct?.accountId ?? null;
  } catch (err) {
    logger.warn({ err, firmId }, "trade_critique: accountId resolution query failed — leaving null (fail-soft)");
    return null;
  }
}

// ─── R computation ───────────────────────────────────────────────────────────

function computeRealizedR(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pos: any,
): number | null {
  const entryPrice = Number(pos.entryPrice);
  const stopPrice = pos.stopPrice != null ? Number(pos.stopPrice) : null;
  const exitPrice = pos.exitPrice != null ? Number(pos.exitPrice) : Number(pos.currentPrice ?? pos.entryPrice);

  if (!stopPrice || stopPrice === entryPrice) return null;

  const stopDistance = Math.abs(entryPrice - stopPrice);
  const direction = pos.side === "long" ? 1 : -1;
  const priceMove = direction * (exitPrice - entryPrice);
  return priceMove / stopDistance;
}

// ─── Strict schema validation ─────────────────────────────────────────────────

interface RawCritiqueOutput {
  technical_diagnosis?: {
    entry_quality_score?: unknown;
    exit_execution_delta_r?: unknown;
    confluence_factors_missed?: unknown;
    parameter_hint?: unknown;
    regime_mismatch?: unknown;
    attribution?: unknown;
    realized_r?: unknown;
    expected_r_percentile?: unknown;
    topstep_consistency_current_pct?: unknown;
    topstep_consistency_distance_to_cap?: unknown;
  };
  plain_english_summary?: {
    grade?: unknown;
    one_liner?: unknown;
    what_went_right?: unknown;
    what_to_watch?: unknown;
    action_needed?: unknown;
  };
}

const VALID_GRADES = new Set(["A+","A","B+","B","C+","C","D","F"]);
const ATTRIBUTION_KEYS = ["regime","structure","narrative","confluence","decay","liquidity","fill","exit_plan"] as const;

function validateCritiqueOutput(raw: unknown): { valid: true; td: TechnicalDiagnosis; pes: PlainEnglishSummary } | { valid: false; reason: string } {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, reason: "output is not an object" };
  }

  const obj = raw as RawCritiqueOutput;

  // ─── technical_diagnosis ───
  const td = obj.technical_diagnosis;
  if (typeof td !== "object" || td === null) {
    return { valid: false, reason: "missing technical_diagnosis" };
  }

  if (typeof td.entry_quality_score !== "number") {
    return { valid: false, reason: "technical_diagnosis.entry_quality_score must be a number" };
  }
  if (typeof td.exit_execution_delta_r !== "number") {
    return { valid: false, reason: "technical_diagnosis.exit_execution_delta_r must be a number" };
  }
  if (!Array.isArray(td.confluence_factors_missed)) {
    return { valid: false, reason: "technical_diagnosis.confluence_factors_missed must be an array" };
  }
  if (typeof td.regime_mismatch !== "boolean") {
    return { valid: false, reason: "technical_diagnosis.regime_mismatch must be boolean" };
  }

  // attribution
  const attr = td.attribution;
  if (typeof attr !== "object" || attr === null) {
    return { valid: false, reason: "technical_diagnosis.attribution must be an object" };
  }
  const attrObj = attr as Record<string, unknown>;
  for (const key of ATTRIBUTION_KEYS) {
    if (typeof attrObj[key] !== "number") {
      return { valid: false, reason: `technical_diagnosis.attribution.${key} must be a number` };
    }
  }
  const attrSum = ATTRIBUTION_KEYS.reduce((s, k) => s + (attrObj[k] as number), 0);
  if (Math.abs(attrSum - 1.0) > 0.02) {
    return { valid: false, reason: `attribution weights sum to ${attrSum.toFixed(4)}, expected 1.00` };
  }

  // ─── plain_english_summary ───
  const pes = obj.plain_english_summary;
  if (typeof pes !== "object" || pes === null) {
    return { valid: false, reason: "missing plain_english_summary" };
  }
  if (!VALID_GRADES.has(pes.grade as string)) {
    return { valid: false, reason: `invalid grade: ${pes.grade}` };
  }
  for (const field of ["one_liner","what_went_right","what_to_watch","action_needed"] as const) {
    if (typeof pes[field] !== "string") {
      return { valid: false, reason: `plain_english_summary.${field} must be a string` };
    }
  }

  return {
    valid: true,
    td: {
      entry_quality_score:              td.entry_quality_score as number,
      exit_execution_delta_r:           td.exit_execution_delta_r as number,
      confluence_factors_missed:        td.confluence_factors_missed as string[],
      parameter_hint:                   (td.parameter_hint ?? null) as TechnicalDiagnosis["parameter_hint"],
      regime_mismatch:                  td.regime_mismatch as boolean,
      attribution: {
        regime:     attrObj.regime as number,
        structure:  attrObj.structure as number,
        narrative:  attrObj.narrative as number,
        confluence: attrObj.confluence as number,
        decay:      attrObj.decay as number,
        liquidity:  attrObj.liquidity as number,
        fill:       attrObj.fill as number,
        exit_plan:  attrObj.exit_plan as number,
      },
      realized_r:                            (td.realized_r ?? null) as number | null,
      expected_r_percentile:                 (td.expected_r_percentile ?? null) as number | null,
      topstep_consistency_current_pct:       (td.topstep_consistency_current_pct ?? null) as number | null,
      topstep_consistency_distance_to_cap:   (td.topstep_consistency_distance_to_cap ?? null) as number | null,
    },
    pes: {
      grade:           pes.grade as PlainEnglishSummary["grade"],
      one_liner:       pes.one_liner as string,
      what_went_right: pes.what_went_right as string,
      what_to_watch:   pes.what_to_watch as string,
      action_needed:   pes.action_needed as string,
    },
  };
}

// ─── Audit helper ────────────────────────────────────────────────────────────

async function writeAudit(
  action: string,
  positionId: string,
  status: "success" | "failed" | "info",
  result: Record<string, unknown>,
  correlationId?: string | null,
): Promise<void> {
  const insertPromise = db.insert(auditLog).values({
    action,
    entityType: "paper_position",
    entityId: positionId,
    decisionAuthority: "system",
    input: { positionId, correlationId } as Record<string, unknown>,
    result,
    status,
    correlationId: correlationId ?? null,
  });
  // Fire-and-forget with proper null guard for test environments where
  // the mock may not return a thenable.
  if (insertPromise && typeof (insertPromise as any).catch === "function") {
    (insertPromise as any).catch((err: unknown) =>
      logger.warn({ err, action }, "trade_critique audit write failed (non-blocking)"),
    );
  } else if (insertPromise && typeof (insertPromise as any).then === "function") {
    void Promise.resolve(insertPromise).catch((err: unknown) =>
      logger.warn({ err, action }, "trade_critique audit write failed (non-blocking)"),
    );
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run an institutional trade autopsy for a closed paper position.
 *
 * MUST be called fire-and-forget from closePosition():
 *   void runTradeCritique(positionId, correlationId).catch(err => logger.error({err},...))
 *
 * Returns early with status="queued_deferred" when MAX_CONCURRENT_CRITIQUES is saturated.
 * Idempotent: if a critique already exists for this positionId within 5 minutes, returns it.
 *
 * @param dryRun - When true, suppresses all DB writes (audit_log, system_parameters,
 *   trade_critique INSERT) and Discord notifications. LLM call still fires so callers
 *   can inspect/grade the result. Pass 2 replay-grading uses this path.
 */
export async function runTradeCritique(
  positionId: string,
  correlationId?: string,
  dryRun: boolean = false,
): Promise<TradeCritiqueResult> {
  // ─── Idempotency: skip if critique already written in last 5 min ───
  const idempotentCutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const [existing] = await db
    .select({
      id: tradeCritique.id,
      grade: tradeCritique.grade,
      dataCompleteness: tradeCritique.dataCompleteness,
      provider: tradeCritique.provider,
      model: tradeCritique.model,
    })
    .from(tradeCritique)
    .where(
      and(
        eq(tradeCritique.positionId, positionId),
        gte(tradeCritique.critiquedAt, idempotentCutoff),
      ),
    )
    .orderBy(desc(tradeCritique.critiquedAt))
    .limit(1);

  if (existing) {
    logger.debug({ positionId, critiqueId: existing.id }, "trade_critique: idempotent skip — critique exists within 5 min");
    return {
      status: "completed",
      positionId,
      critiqueId: existing.id,
      grade: existing.grade as PlainEnglishSummary["grade"],
      dataCompleteness: existing.dataCompleteness as "full" | "partial" | "minimal",
      provider: existing.provider as "openai" | "ollama",
      model: existing.model,
    };
  }

  // ─── Backpressure: check concurrency cap ────────────────────────
  if (_activeCritiques >= _maxConcurrent()) {
    logger.warn(
      { positionId, active: _activeCritiques, cap: _maxConcurrent() },
      "trade_critique: saturated — deferring",
    );
    if (!dryRun) {
      await writeAudit(
        "trade_critique.deferred_saturation",
        positionId,
        "info",
        { active: _activeCritiques, cap: _maxConcurrent(), reason: "concurrency_cap_reached" },
        correlationId,
      );
    }
    return { status: "queued_deferred", positionId };
  }

  _activeCritiques++;
  try {
    return await _runCritiqueInternal(positionId, correlationId, dryRun);
  } finally {
    _activeCritiques--;
  }
}

async function _runCritiqueInternal(
  positionId: string,
  correlationId?: string,
  dryRun: boolean = false,
): Promise<TradeCritiqueResult> {
  // ─── 1. Read position row ────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pos] = await db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.id, positionId)) as any[];

  if (!pos) {
    logger.warn({ positionId }, "trade_critique: position not found — skipping");
    return { status: "failed", positionId };
  }

  // ─── 2. Read session + strategy ──────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [session] = (pos.sessionId
    ? await db.select().from(paperSessions).where(eq(paperSessions.id, pos.sessionId))
    : []) as any[];

  const strategyId = session?.strategyId ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [strategy] = (strategyId
    ? await db.select().from(strategies).where(eq(strategies.id, strategyId))
    : []) as any[];

  // ─── 3. Detect missing Wave 25 fields ───────────────────────────
  // Wave 25 adds fields that may not yet be populated for older positions.
  // `pos` and `strategy` are typed as `any` (raw DB select), so direct access is fine.
  //
  // Data bridge (2026-07-05): paper_positions has no top-level columns for these
  // fields (confirmed against schema.ts) — `pos.structureState` etc. above were
  // always undefined in production. paper-signal-service.ts now captures whichever
  // of these fields the deciding signal actually knew at entry and merges them into
  // paper_positions.exit_plan.entryContext (see EntryDecisionContext in
  // jsonb-shapes.ts). Read that JSONB path as the primary source, keeping the
  // original top-level-column checks first for forward-compat if those columns are
  // ever added directly. `narrative_phase` and `backtest_expected_r_by_regime` are
  // NOT bridged — the Wave 25 Pass 6 narrative-state machine and per-regime
  // expected-R are genuinely disconnected from the live signal path today (see
  // jsonb-shapes.ts EntryDecisionContext doc comment) — left absent, not fabricated.
  const entryCtx = (pos.exitPlan as { entryContext?: Record<string, unknown> } | null | undefined)
    ?.entryContext ?? null;
  const wave25Context: Wave25ContextFields = {
    structureState:           pos.structureState ?? pos.structure_state ?? entryCtx?.structureState ?? null,
    narrativePhase:           pos.narrativePhase ?? pos.narrative_phase ?? null,
    confluenceScore:          pos.confluenceScore ?? pos.confluence_score ?? entryCtx?.confluenceScore ?? null,
    confluenceFactorsActive:  pos.confluenceFactorsActive ?? pos.confluence_factors_active ?? entryCtx?.confluenceFactorsActive ?? null,
    nearestLiquidityLevel:    pos.nearestLiquidityLevel ?? pos.nearest_liquidity_level ?? entryCtx?.nearestLiquidityLevel ?? null,
    backtestExpectedRByRegime: strategy ? strategy.backtestExpectedRByRegime ?? null : null,
  };

  const missingFields = buildMissingFieldsList(wave25Context);
  const dataCompleteness = deriveDataCompleteness(missingFields);

  // ─── 4. Build LLM input payload ─────────────────────────────────
  const realizedR = computeRealizedR(pos);

  const llmInput = {
    position: {
      id:               pos.id,
      symbol:           pos.symbol,
      side:             pos.side,
      contracts:        pos.contracts,
      entry_price:      pos.entryPrice,
      exit_price:       (pos as any).exitPrice ?? null,
      entry_time:       pos.entryTime,
      exit_time:        (pos as any).exitTime ?? null,
      stop_price:       pos.stopPrice,
      tp1_price:        (pos as any).tp1Price ?? null,
      tp2_price:        (pos as any).tp2Price ?? null,
      realized_pnl:     (pos as any).realizedPnl ?? null,
      gross_pnl:        (pos as any).grossPnl ?? null,
      slippage:         (pos as any).slippage ?? null,
      commission:       (pos as any).commission ?? null,
      roll_spread_cost: (pos as any).rollSpreadCost ?? null,
      exit_reason:      (pos as any).exitReason ?? null,
      mae:              (pos as any).mae ?? null,
      mfe:              (pos as any).mfe ?? null,
      style:            (pos as any).style ?? null,
      fill_probability: (pos as any).fillProbability ?? null,
    },
    session: {
      id:                       session?.id ?? null,
      strategy_id:              strategyId,
      firm_id:                  session?.firmId ?? null,
      account_balance:          (session as any)?.accountBalance ?? null,
      realized_peak_equity:     (session as any)?.realizedPeakEquity ?? null,
      daily_pnl_breakdown:      (session as any)?.dailyPnlBreakdown ?? null,
      metrics_snapshot:         session?.metricsSnapshot ?? null,
    },
    strategy: strategy ? {
      name:                  strategy.name,
      symbol:                strategy.symbol,
      preferred_regimes:     (strategy as any).preferredRegimes ?? null,
      entry_indicator:       (strategy as any).entryIndicator ?? null,
      confirming_indicators: (strategy as any).confirmingIndicators ?? null,
      entry_quality:         (strategy as any).entryQuality ?? null,
      position_size:         strategy.positionSize ?? null,
      stop_loss:             (strategy as any).stopLoss ?? null,
      take_profit:           (strategy as any).takeProfit ?? null,
    } : null,
    context: {
      // Data bridge (2026-07-05): regimeAtEntry/atrAtEntry are not top-level
      // paper_positions columns; fall back to the exit_plan JSONB bridge —
      // entryCtx.regimeAtEntry (new, EntryDecisionContext) then the pre-existing
      // F9 exitPlan.entryRegime (older positions written before this bridge).
      regime_at_entry:              (pos as any).regimeAtEntry
        ?? entryCtx?.regimeAtEntry
        ?? (pos.exitPlan as { entryRegime?: string } | null | undefined)?.entryRegime
        ?? null,
      structure_state:              wave25Context.structureState,
      narrative_phase:              wave25Context.narrativePhase,
      confluence_score:             wave25Context.confluenceScore,
      confluence_factors_active:    wave25Context.confluenceFactorsActive,
      nearest_liquidity_level:      wave25Context.nearestLiquidityLevel,
      backtest_expected_r_by_regime: wave25Context.backtestExpectedRByRegime,
      topstep_daily_pnl_breakdown:  (session as any)?.dailyPnlBreakdown ?? null,
      atr_at_entry:                 (pos as any).atrAtEntry ?? entryCtx?.atrAtEntry ?? null,
      session_type:                 (pos as any).sessionType ?? null,
    },
    realized_r:       realizedR,
    missing_fields:   missingFields,
    data_completeness: dataCompleteness,
  };

  const userPrompt = JSON.stringify(llmInput, null, 2);

  // ─── 5. Call LLM: cloud first, Ollama fallback ──────────────────
  let rawJson: string | null = null;
  let usedProvider: "openai" | "ollama" = "openai";
  let usedModel = "gpt-5.4";

  // Wave 1 — institutional RAG grounding (default OFF via CRITIQUE_RAG_ENABLED).
  // When ON, retrieve a structured INSTITUTIONAL REFERENCE block and pass it as a
  // SEPARATE grounding message BEFORE the raw trade JSON, so the trade data stays
  // primary and the reference is context. On ANY retrieval error, fall back to the
  // no-RAG path (never fail the critique). When OFF: referenceBlock stays null and
  // the call is byte-identical to the pre-Wave-1 single-message behavior.
  let referenceBlock: string | null = null;
  if (process.env.CRITIQUE_RAG_ENABLED === "true") {
    try {
      referenceBlock = await retrieveCritiqueKnowledge(llmInput);
    } catch (ragErr) {
      logger.warn({ positionId, err: ragErr }, "trade_critique: RAG retrieval failed — using no-RAG path");
      referenceBlock = null;
    }
  }

  const cloudMessages = referenceBlock
    ? [
        { role: "user" as const, content: referenceBlock },
        { role: "user" as const, content: userPrompt },
      ]
    : [{ role: "user" as const, content: userPrompt }];

  // Cloud attempt
  rawJson = await callOpenAI("trade_critique", cloudMessages);
  if (rawJson) {
    usedProvider = "openai";
    usedModel = "gpt-5.4";
  } else {
    // Ollama fallback
    logger.info({ positionId }, "trade_critique: cloud unavailable, falling back to Ollama");
    const fallback = getFallback("trade_critique");
    const fallbackModel = fallback?.model ?? "gemma4:e4b-it-qat";
    const systemPrompt = loadSystemPrompt("trade_critique");
    // Byte-identical to legacy when referenceBlock is null; injects grounding
    // before the user input only when RAG is enabled and retrieval succeeded.
    let fullPrompt = systemPrompt ? `${systemPrompt}\n\nUser input:\n${userPrompt}` : userPrompt;
    if (referenceBlock) {
      fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${referenceBlock}\n\nUser input:\n${userPrompt}`
        : `${referenceBlock}\n\nUser input:\n${userPrompt}`;
    }
    try {
      const ollama = new OllamaClient();
      const ollamaResp = await ollama.generate(fallbackModel, fullPrompt, undefined, true);
      rawJson = ollamaResp.response ?? null;
      usedProvider = "ollama";
      usedModel = fallbackModel;
    } catch (ollamaErr) {
      logger.error({ positionId, err: ollamaErr }, "trade_critique: Ollama fallback also failed");
    }
  }

  if (!rawJson) {
    // Both providers failed — track consecutive failures (skipped in dry-run)
    logger.error({ positionId, dryRun }, "trade_critique: all providers failed");
    if (!dryRun) {
      const strikes = await incrementConsecutiveFailures();

      await writeAudit(
        "trade_critique.failed",
        positionId,
        "failed",
        {
          reason: "all_providers_failed",
          strikes,
          sessionId: session?.id ?? null,
          strategyId,
          correlationId: correlationId ?? null,
        },
        correlationId,
      );

      if (strikes >= STRIKE_THRESHOLD) {
        notifyWarning(
          "Trade Critique — 3 Consecutive Failures",
          appendFamilyGradePostscript(
            `The trade critique service has failed ${strikes} times in a row. ` +
            `Last failed position: ${positionId}. ` +
            `Check OPENAI_API_KEY, Ollama connectivity, and model availability. ` +
            `Trading Forge continues to operate normally — critique is observability-only.`,
            "The bot had trouble analyzing a recent trade.",
            "No action needed — the bot will continue trading normally.",
          ),
          {
            positionId,
            strikes,
            strategyId: strategyId ?? "unknown",
            action: "investigate_llm_connectivity",
          },
        );
        await writeAudit(
          "trade_critique.consecutive_failure_alert",
          positionId,
          "failed",
          {
            strikes,
            alert_sent: true,
            threshold: STRIKE_THRESHOLD,
            correlationId: correlationId ?? null,
          },
          correlationId,
        );
      }
    }

    return { status: "failed", positionId };
  }

  // ─── 6. Parse and validate output ───────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (parseErr) {
    logger.error({ positionId, rawLength: rawJson.length, err: parseErr }, "trade_critique: JSON parse failed");
    if (!dryRun) {
      await incrementConsecutiveFailures();
      await writeAudit(
        "trade_critique.failed",
        positionId,
        "failed",
        { reason: "json_parse_error", provider: usedProvider, model: usedModel, correlationId: correlationId ?? null },
        correlationId,
      );
    }
    return { status: "failed", positionId };
  }

  const validation = validateCritiqueOutput(parsed);
  if (!validation.valid) {
    logger.error({ positionId, reason: validation.reason }, "trade_critique: schema validation failed");
    if (!dryRun) {
      await incrementConsecutiveFailures();
      await writeAudit(
        "trade_critique.failed",
        positionId,
        "failed",
        { reason: "schema_validation_failed", detail: validation.reason, provider: usedProvider, model: usedModel, correlationId: correlationId ?? null },
        correlationId,
      );
    }
    return { status: "failed", positionId };
  }

  // ─── 6b. Faithfulness check (Wave 1 — default OFF via CRITIQUE_FAITHFULNESS_CHECK) ──
  // Advisory-only: verifies each material attribution weight is supported by a
  // present data field, and every parameter_hint.field is whitelisted. Attaches
  // nothing to the DB (no schema change this wave — persistence is a follow-up);
  // logs the result structured. Never blocks the critique.
  if (process.env.CRITIQUE_FAITHFULNESS_CHECK === "true") {
    try {
      const faithfulness = checkCritiqueFaithfulness(parsed as Record<string, unknown>, llmInput);
      logger.info(
        {
          positionId,
          supported: faithfulness.supported,
          flags: faithfulness.flags,
          correlationId: correlationId ?? null,
        },
        "trade_critique: faithfulness check",
      );
    } catch (faithErr) {
      logger.warn({ positionId, err: faithErr }, "trade_critique: faithfulness check errored (non-blocking)");
    }
  }

  // ─── 7. Persist critique row (skipped in dry-run) ───────────────
  let persistedId: string | undefined;
  if (!dryRun) {
    // Account resolution (data bridge, 2026-07-05): resolve via session.firmId ->
    // first enabled broker_accounts row. See resolveAccountIdForCritique doc comment
    // for the multi-account-per-firm limitation and why A/B paper-routing accounts
    // are deliberately excluded from this resolution.
    const resolvedAccountId = await resolveAccountIdForCritique(session?.firmId ?? null);
    if (session?.firmId && !resolvedAccountId) {
      logger.warn(
        { positionId, sessionId: session?.id ?? null, firmId: session.firmId },
        "trade_critique: no enabled broker_accounts row found for session firmId — accountId left null (not fabricated)",
      );
    }

    const [row] = await db
      .insert(tradeCritique)
      .values({
        positionId,
        sessionId:           session?.id ?? null,
        accountId:           resolvedAccountId,
        strategyId:          strategyId ?? null,
        grade:               validation.pes.grade,
        technicalDiagnosis:  validation.td as unknown as Record<string, unknown>,
        plainEnglishSummary: validation.pes as unknown as Record<string, unknown>,
        dataCompleteness,
        missingFields,
        provider:            usedProvider,
        model:               usedModel,
        correlationId:       correlationId ?? null,
      })
      .returning({ id: tradeCritique.id });
    persistedId = row.id;

    // ─── 8. Reset consecutive failure counter on success ──────────
    await resetConsecutiveFailures();

    // ─── 9. Write audit row ────────────────────────────────────────
    const auditAction =
      dataCompleteness !== "full"
        ? "trade_critique.partial_data"
        : "trade_critique.completed";

    await writeAudit(
      auditAction,
      positionId,
      "success",
      {
        critiqueId:       persistedId,
        grade:            validation.pes.grade,
        dataCompleteness,
        missingFields,
        provider:         usedProvider,
        model:            usedModel,
        entry_quality:    validation.td.entry_quality_score,
        regime_mismatch:  validation.td.regime_mismatch,
        realized_r:       realizedR,
        correlationId:    correlationId ?? null,
      },
      correlationId,
    );
  }

  logger.info(
    {
      positionId,
      critiqueId: persistedId,
      grade: validation.pes.grade,
      dataCompleteness,
      provider: usedProvider,
      model: usedModel,
      dryRun,
    },
    "trade_critique: completed",
  );

  return {
    status: dataCompleteness !== "full" ? "partial_data" : "completed",
    positionId,
    critiqueId: persistedId,
    grade: validation.pes.grade,
    dataCompleteness,
    provider: usedProvider,
    model: usedModel,
  };
}
