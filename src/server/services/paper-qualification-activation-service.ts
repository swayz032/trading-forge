/**
 * paper-qualification-activation-service.ts — AR-1155 (2026-08-18, repaired per AR-1335A)
 *
 * One shared PAPER qualification-activation authority, replacing the direct
 * `startStream()` calls previously scattered across POST /api/paper/start and
 * scheduler.ts's boot-resume / failed-to-stream-retry paths.
 *
 * Per AR-1147 §7 / AR-1335A, candidate identity is not row identity — it is a
 * canonical hash over the exact execution-relevant candidate projection:
 *   strategy_id + resolved execution symbol set + timeframe +
 *   POST-TRANSLATION effective paper config (the same object
 *   `paper-signal-service.ts::getSessionConfig()` hands the live paper engine,
 *   via `translateDSLToPaperConfig()` — never a second raw-DB approximation)
 *   + the full top-level `exit_plan_config`.
 * That hash is `candidate_version_hash`.
 *
 * A second canonical hash, `run_environment_hash`, covers the non-strategy
 * inputs that can also change qualification results: session mode, firm/risk
 * identity, feed identity, and the session's own risk/execution config
 * (`paper_sessions.config`, minus this module's own receipt key and the
 * unrelated evidence-labels receipt — never self-hash the receipt).
 *
 * `TF_RUNTIME_REVISION` (AR-1334A: read ONLY from `process.env`, never
 * inferred from working-tree HEAD/wall-clock/package version) is the third
 * leg. All three are stamped ONCE, atomically (compare-and-set — see
 * `verifyPaperActivation`), into `paper_sessions.config.qualification_identity`
 * (existing JSONB column, no migration). On every later call for the same
 * session, all three are recomputed fresh and compared for EXACT equality —
 * never overwritten, never partially checked. Any drift fails the session
 * closed.
 *
 * Callers MUST call the existing synchronous `startStream()` themselves, and
 * ONLY when this returns `{ ok: true }` — this module never calls it.
 */

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { paperSessions, strategies } from "../db/schema.js";
import { getSessionConfigFresh, type CachedSession } from "./paper-signal-service.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { logger } from "../lib/logger.js";
import { resolveFeedMode } from "../lib/paper-evidence-labels.js";
import type { PaperSessionConfigShape } from "../db/jsonb-shapes.js";

// ─── Canonical hashing (mirrors broker-router.ts::computeStrategyVersionHashForRouting) ──

function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/** Deterministic sha256 over sorted-key-canonicalized JSON. Same convention project-wide. */
export function canonicalHash(value: unknown): string {
  const canonical = JSON.stringify(value, sortedKeyReplacer) ?? "null";
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ─── Projections (pure — the exact bytes each hash covers) ────────────────

export interface CandidateProjection {
  strategy_id: string;
  symbols: string[];
  timeframe: string;
  effective_config: unknown;
  exit_plan_config: unknown;
}

export interface RunEnvironmentProjection {
  mode: string;
  firm_id: string | null;
  feed_mode: "delayed" | "realtime" | "unknown";
  session_risk_config: Record<string, unknown>;
}

export function buildCandidateProjection(input: {
  strategyId: string;
  symbols: string[];
  timeframe: string;
  effectiveConfig: unknown;
  exitPlanConfig: unknown;
}): CandidateProjection {
  return {
    strategy_id: input.strategyId,
    symbols: [...input.symbols].sort(),
    timeframe: input.timeframe,
    effective_config: input.effectiveConfig,
    exit_plan_config: input.exitPlanConfig,
  };
}

/** Strips this module's own receipt key + the unrelated evidence-labels receipt (non-semantic, self-hash risk). */
export function sessionRiskConfig(rawConfig: PaperSessionConfigShape | null | undefined): Record<string, unknown> {
  const { evidence_labels: _evidence_labels, qualification_identity: _qualification_identity, ...rest } =
    (rawConfig ?? {}) as Record<string, unknown> & { qualification_identity?: unknown };
  return rest;
}

export function buildRunEnvironmentProjection(input: {
  mode: string;
  firmId: string | null;
  feedMode: "delayed" | "realtime" | "unknown";
  rawSessionConfig: PaperSessionConfigShape | null | undefined;
}): RunEnvironmentProjection {
  return {
    mode: input.mode,
    firm_id: input.firmId,
    feed_mode: input.feedMode,
    session_risk_config: sessionRiskConfig(input.rawSessionConfig),
  };
}

// ─── Identity shape persisted to paper_sessions.config.qualification_identity ──

export interface PaperQualificationIdentity {
  /** LOAD-BEARING — the only fields ever compared for resume/retry equality. */
  candidate_version_hash: string;
  run_environment_hash: string;
  runtime_revision: string;
  /** Diagnostic only — human-readable receipt. Never compared; drift here without
   *  a hash change cannot occur (the hashes cover these same values), but these
   *  fields exist so an operator/GPT can read WHAT was stamped without recomputing. */
  diagnostic: {
    strategy_id: string;
    lifecycle_state: string;
    symbols: string[];
    timeframe: string;
    mode: string;
    firm_id: string | null;
    feed_mode: string;
  };
  stamped_at: string;
}

/** The extra key this service adds to the existing PaperSessionConfigShape JSONB. */
export type PaperSessionConfigWithIdentity = PaperSessionConfigShape & {
  qualification_identity?: PaperQualificationIdentity;
};

export type ActivationVerifyResult =
  | { ok: true; identity: PaperQualificationIdentity; symbols: string[]; stamped: boolean }
  | { ok: false; reason: string };

// ─── Pure helpers ───────────────────────────────────────────────────────────

/** AR-1334A Decision 2: explicit, immutable runtime-build revision. Never inferred. */
export function resolveRuntimeRevision(): string | null {
  const raw = process.env.TF_RUNTIME_REVISION;
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The market-data subscription surface — mirrors every direct-startStream() call site's own resolution. */
export function resolveCandidateSymbols(
  strategySymbol: string | null | undefined,
  strategyConfig: Record<string, unknown> | null | undefined,
): string[] {
  const symbols: string[] = [];
  if (strategySymbol) symbols.push(strategySymbol);
  const configSymbol = strategyConfig?.symbol;
  if (configSymbol && !symbols.includes(String(configSymbol))) {
    symbols.push(String(configSymbol));
  }
  return symbols;
}

/**
 * Pure decision core. Given precomputed hashes + resolved fields, decides
 * whether activation may proceed. No DB/env access — exported directly so the
 * decision logic (including every mutation/mismatch class) is unit tested
 * without a database.
 */
export function decideActivation(input: {
  strategyId: string | null;
  lifecycleState: string | null;
  symbols: string[];
  feedMode: "delayed" | "realtime" | "unknown";
  runtimeRevision: string | null;
  candidateVersionHash: string;
  runEnvironmentHash: string;
  diagnostic: PaperQualificationIdentity["diagnostic"];
  existingIdentity: PaperQualificationIdentity | null | undefined;
  nowIso: string;
}): ActivationVerifyResult {
  if (!input.strategyId || !input.lifecycleState) {
    return { ok: false, reason: "candidate_unresolved: paper session has no linked strategy" };
  }
  if (input.symbols.length === 0) {
    return { ok: false, reason: "candidate_unresolved: no symbol found for strategy" };
  }
  if (input.feedMode === "unknown") {
    return { ok: false, reason: "feed_identity_unresolved: PAPER_FEED_MODE resolved to 'unknown'" };
  }
  if (!input.runtimeRevision) {
    return {
      ok: false,
      reason: "runtime_revision_missing: TF_RUNTIME_REVISION is unset/blank in this runtime environment",
    };
  }

  const existing = input.existingIdentity;
  if (existing) {
    // RESUME — verify-only, exact equality on every stamped dimension. Never overwrite.
    if (existing.runtime_revision !== input.runtimeRevision) {
      return {
        ok: false,
        reason: `runtime_revision_mismatch: session stamped under '${existing.runtime_revision}', ` +
          `current runtime reports '${input.runtimeRevision}' — refusing countable resume under a changed executable identity`,
      };
    }
    if (existing.candidate_version_hash !== input.candidateVersionHash) {
      return {
        ok: false,
        reason: "candidate_mutation: candidate_version_hash no longer matches the original stamp " +
          "(strategy id, symbol set, timeframe, effective post-translation config, or exit_plan_config changed)",
      };
    }
    if (existing.run_environment_hash !== input.runEnvironmentHash) {
      return {
        ok: false,
        reason: "run_mutation: run_environment_hash no longer matches the original stamp " +
          "(mode, firm/risk identity, feed identity, or session risk config changed)",
      };
    }
    return { ok: true, identity: existing, symbols: existing.diagnostic.symbols, stamped: false };
  }

  // FIRST ACTIVATION — build and return a fresh stamp.
  const identity: PaperQualificationIdentity = {
    candidate_version_hash: input.candidateVersionHash,
    run_environment_hash: input.runEnvironmentHash,
    runtime_revision: input.runtimeRevision,
    diagnostic: input.diagnostic,
    stamped_at: input.nowIso,
  };
  return { ok: true, identity, symbols: input.symbols, stamped: true };
}

// ─── I/O wrapper ────────────────────────────────────────────────────────────

/**
 * Fetches session + the SAME post-translation candidate view the paper engine
 * consumes (`getSessionConfig`), runs `decideActivation`, and on a FIRST
 * activation persists the stamp with a compare-and-set UPDATE (only writes
 * when `config->'qualification_identity'` is still NULL — see F-3). If this
 * call loses that race, it re-reads the winning stamp and verifies against
 * it rather than overwriting. On a verified resume, no write happens. On a
 * blocked result, nothing is persisted to `config` and an audit row records
 * why.
 *
 * Callers call `startStream(sessionId, result.symbols)` themselves, only
 * when `result.ok === true`.
 */
export async function verifyPaperActivation(
  sessionId: string,
  opts: { correlationId?: string | null } = {},
): Promise<ActivationVerifyResult> {
  const [session] = await db.select().from(paperSessions).where(eq(paperSessions.id, sessionId));
  if (!session) {
    return { ok: false, reason: "session_not_found" };
  }

  // F-5 (GPT AR-1339A S1): NEVER the cached getSessionConfig() — identity verification must
  // see the current DB bytes on every call, not a value cached from an earlier activation in
  // this same process.
  const cached: CachedSession | null = await getSessionConfigFresh(sessionId);
  // Market-data subscription surface: resolved from the RAW strategy row, the exact
  // same fields (strategy.symbol + strategy.config.symbol) every prior direct-
  // startStream() call site read — decoupled from `cached.config`, which is the
  // TRANSLATED trading-logic object used below for the candidate hash. Conflating
  // the two would silently change which symbols get subscribed to.
  const [rawStrategy] = session.strategyId
    ? await db.select().from(strategies).where(eq(strategies.id, session.strategyId)).limit(1)
    : [];
  const symbols = resolveCandidateSymbols(
    rawStrategy?.symbol,
    rawStrategy?.config as Record<string, unknown> | undefined,
  );

  const feedMode = resolveFeedMode();
  const runtimeRevision = resolveRuntimeRevision();

  const candidateProjection = cached
    ? buildCandidateProjection({
        strategyId: cached.strategyId,
        symbols,
        timeframe: cached.timeframe,
        effectiveConfig: cached.config,
        exitPlanConfig: cached.exitPlanConfig,
      })
    : null;
  const runEnvironmentProjection = buildRunEnvironmentProjection({
    mode: session.mode,
    firmId: session.firmId ?? null,
    feedMode,
    rawSessionConfig: session.config as PaperSessionConfigShape | null,
  });

  const existingIdentity = (session.config as PaperSessionConfigWithIdentity | null)?.qualification_identity ?? null;

  const result = decideActivation({
    strategyId: cached?.strategyId ?? session.strategyId ?? null,
    lifecycleState: cached?.lifecycleState ?? null,
    symbols,
    feedMode,
    runtimeRevision,
    candidateVersionHash: candidateProjection ? canonicalHash(candidateProjection) : "",
    runEnvironmentHash: canonicalHash(runEnvironmentProjection),
    diagnostic: {
      strategy_id: cached?.strategyId ?? session.strategyId ?? "",
      lifecycle_state: cached?.lifecycleState ?? "",
      symbols,
      timeframe: cached?.timeframe ?? "",
      mode: session.mode,
      firm_id: session.firmId ?? null,
      feed_mode: feedMode,
    },
    existingIdentity,
    nowIso: new Date().toISOString(),
  });

  if (!result.ok) {
    await insertAuditRowSafe({
      action: "paper.activation_verify_blocked",
      entityType: "paper_session",
      entityId: sessionId,
      input: { sessionId },
      result: { reason: result.reason },
      status: "blocked",
      decisionAuthority: "system",
      correlationId: opts.correlationId ?? null,
    });
    logger.warn({ sessionId, reason: result.reason }, "paper-qualification-activation-service: activation BLOCKED");
    return result;
  }

  if (result.stamped) {
    // F-3 + F-7 (GPT AR-1339A S3): compare-and-set AND non-clobbering. `jsonb_set` merges
    // only the `qualification_identity` key against whatever `config` currently holds at
    // UPDATE time (not the stale pre-read `session.config` object), so a concurrent writer
    // touching an unrelated config key between our read and this write is preserved, not
    // silently overwritten by a full-object replacement built from stale bytes.
    const identityJson = JSON.stringify(result.identity);
    const [written] = await db
      .update(paperSessions)
      .set({
        config: sql`jsonb_set(coalesce(${paperSessions.config}, '{}'::jsonb), '{qualification_identity}', ${identityJson}::jsonb, true)`,
      })
      .where(and(eq(paperSessions.id, sessionId), sql`(${paperSessions.config}->'qualification_identity') IS NULL`))
      .returning({ id: paperSessions.id });

    if (!written) {
      // Lost the race — re-read the winning stamp and verify against it instead of
      // silently proceeding under a stamp this call never wrote or confirmed.
      const [rewon] = await db.select().from(paperSessions).where(eq(paperSessions.id, sessionId));
      const winningIdentity = (rewon?.config as PaperSessionConfigWithIdentity | null)?.qualification_identity ?? null;
      const reverified = decideActivation({
        strategyId: cached?.strategyId ?? session.strategyId ?? null,
        lifecycleState: cached?.lifecycleState ?? null,
        symbols,
        feedMode,
        runtimeRevision,
        candidateVersionHash: candidateProjection ? canonicalHash(candidateProjection) : "",
        runEnvironmentHash: canonicalHash(runEnvironmentProjection),
        diagnostic: result.identity.diagnostic,
        existingIdentity: winningIdentity,
        nowIso: new Date().toISOString(),
      });
      if (!reverified.ok) {
        await insertAuditRowSafe({
          action: "paper.activation_verify_blocked",
          entityType: "paper_session",
          entityId: sessionId,
          input: { sessionId, race: "lost_first_stamp_race" },
          result: { reason: reverified.reason },
          status: "blocked",
          decisionAuthority: "system",
          correlationId: opts.correlationId ?? null,
        });
        logger.warn(
          { sessionId, reason: reverified.reason },
          "paper-qualification-activation-service: lost first-stamp race, re-verify against winner BLOCKED",
        );
      }
      return reverified;
    }

    await insertAuditRowSafe({
      action: "paper.activation_identity_stamped",
      entityType: "paper_session",
      entityId: sessionId,
      input: { sessionId },
      result: result.identity as unknown as Record<string, unknown>,
      status: "success",
      decisionAuthority: "system",
      correlationId: opts.correlationId ?? null,
    });
  }

  return result;
}
