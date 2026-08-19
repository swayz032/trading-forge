/**
 * paper-qualification-activation-service.ts — AR-1155 (2026-08-18)
 *
 * One shared PAPER qualification-activation authority, replacing the direct
 * `startStream()` calls previously scattered across POST /api/paper/start and
 * scheduler.ts's boot-resume / failed-to-stream-retry paths. Resolves:
 *   - the runtime-translated candidate (the linked strategy row + its
 *     resolved trading symbols — the same values every direct-`startStream()`
 *     call site was independently re-deriving before this packet);
 *   - the dedicated exit-config identity (strategies.exit_plan_config, or the
 *     static Style C default when absent);
 *   - the effective run identity (session id / mode / firm) and feed identity
 *     (paper-evidence-labels' existing feed_mode resolution);
 *   - TF_RUNTIME_REVISION, defined by AR-1334A: the deployed runtime code
 *     image's explicit immutable revision, read ONLY from
 *     `process.env.TF_RUNTIME_REVISION`. Never inferred from working-tree
 *     HEAD, wall-clock time, process start time, package version, or an old
 *     compiled_spec hash — the consumer contract AR-1334A defines.
 *
 * Stamps that identity ONCE into `paper_sessions.config.qualification_identity`
 * (existing JSONB column — no migration, per AR-1334A S2 rule 5). On every
 * later call for the same session (resume / retry / reconnect), the stamp is
 * VERIFIED, never overwritten: any drift in runtime revision, candidate,
 * exit-config, or run identity fails the session closed rather than silently
 * re-stamping under new conditions.
 *
 * Callers MUST call the existing synchronous `startStream()` themselves, and
 * ONLY when this returns `{ ok: true }` — this module never calls it.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { paperSessions, strategies } from "../db/schema.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { logger } from "../lib/logger.js";
import { resolveFeedMode } from "../lib/paper-evidence-labels.js";
import type { PaperSessionConfigShape } from "../db/jsonb-shapes.js";

// ─── Identity shape ─────────────────────────────────────────────────────────

export interface QualificationCandidateIdentity {
  strategy_id: string;
  lifecycle_state: string;
  symbols: string[];
}

export interface QualificationExitIdentity {
  has_exit_plan_config: boolean;
  exit_style: string | null;
}

export interface QualificationRunIdentity {
  session_id: string;
  mode: string;
  firm_id: string | null;
}

export interface QualificationFeedIdentity {
  feed_mode: "delayed" | "realtime" | "unknown";
}

export interface PaperQualificationIdentity {
  candidate: QualificationCandidateIdentity;
  exit_config: QualificationExitIdentity;
  run: QualificationRunIdentity;
  feed: QualificationFeedIdentity;
  runtime_revision: string;
  stamped_at: string;
}

/** The extra key this service adds to the existing PaperSessionConfigShape JSONB. */
export type PaperSessionConfigWithIdentity = PaperSessionConfigShape & {
  qualification_identity?: PaperQualificationIdentity;
};

export type ActivationVerifyResult =
  | { ok: true; identity: PaperQualificationIdentity; symbols: string[]; stamped: boolean }
  | { ok: false; reason: string };

// ─── Pure helpers (no I/O — directly unit-testable) ────────────────────────

/** AR-1334A Decision 2: explicit, immutable runtime-build revision. Never inferred. */
export function resolveRuntimeRevision(): string | null {
  const raw = process.env.TF_RUNTIME_REVISION;
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Mirrors the symbol-resolution already duplicated at every direct-startStream() call site. */
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

function sameSymbols(a: string[], b: string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

/**
 * Pure decision core. Given already-fetched session/strategy fields and the
 * current runtime revision, decides whether activation may proceed:
 *   - no existing stamp  -> build + return a fresh identity (`stamped: true`);
 *   - existing stamp     -> verify every dimension unchanged (`stamped: false`)
 *                           or fail closed on the first mismatch found.
 * No DB/env access here — exported directly so the decision logic is unit
 * tested without a database.
 */
export function decideActivation(input: {
  sessionId: string;
  mode: string;
  firmId: string | null;
  existingConfig: PaperSessionConfigWithIdentity | null | undefined;
  strategyId: string | null;
  lifecycleState: string | null;
  strategySymbol: string | null | undefined;
  strategyConfig: Record<string, unknown> | null | undefined;
  exitPlanConfig: { exit_style?: string } | null | undefined;
  feedMode: "delayed" | "realtime" | "unknown";
  runtimeRevision: string | null;
  nowIso: string;
}): ActivationVerifyResult {
  if (!input.strategyId || !input.lifecycleState) {
    return { ok: false, reason: "candidate_unresolved: paper session has no linked strategy" };
  }
  const symbols = resolveCandidateSymbols(input.strategySymbol, input.strategyConfig);
  if (symbols.length === 0) {
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

  const existing = input.existingConfig?.qualification_identity;

  if (existing) {
    // RESUME — verify-only. Never overwrite an existing stamp.
    if (existing.runtime_revision !== input.runtimeRevision) {
      return {
        ok: false,
        reason: `runtime_revision_mismatch: session stamped under '${existing.runtime_revision}', ` +
          `current runtime reports '${input.runtimeRevision}' — refusing countable resume under a changed executable identity`,
      };
    }
    if (existing.candidate.strategy_id !== input.strategyId) {
      return { ok: false, reason: "candidate_mutation: stamped strategy_id no longer matches the linked strategy" };
    }
    if (!sameSymbols(existing.candidate.symbols, symbols)) {
      return { ok: false, reason: "candidate_mutation: resolved symbols no longer match the original stamp" };
    }
    const currentExitStyle = input.exitPlanConfig?.exit_style ?? null;
    if (
      existing.exit_config.has_exit_plan_config !== (input.exitPlanConfig != null) ||
      existing.exit_config.exit_style !== currentExitStyle
    ) {
      return { ok: false, reason: "exit_config_mutation: strategy exit_plan_config changed since the original stamp" };
    }
    if (existing.run.mode !== input.mode || existing.run.firm_id !== input.firmId) {
      return { ok: false, reason: "run_mutation: session mode/firm_id no longer matches the original stamp" };
    }
    return { ok: true, identity: existing, symbols: existing.candidate.symbols, stamped: false };
  }

  // FIRST ACTIVATION — build and return a fresh stamp.
  const identity: PaperQualificationIdentity = {
    candidate: { strategy_id: input.strategyId, lifecycle_state: input.lifecycleState, symbols },
    exit_config: {
      has_exit_plan_config: input.exitPlanConfig != null,
      exit_style: input.exitPlanConfig?.exit_style ?? null,
    },
    run: { session_id: input.sessionId, mode: input.mode, firm_id: input.firmId },
    feed: { feed_mode: input.feedMode },
    runtime_revision: input.runtimeRevision,
    stamped_at: input.nowIso,
  };
  return { ok: true, identity, symbols, stamped: true };
}

// ─── I/O wrapper ────────────────────────────────────────────────────────────

/**
 * Fetches session + linked strategy, runs `decideActivation`, and on a FIRST
 * activation persists the stamp into `paper_sessions.config`. On a verified
 * resume, the existing stamp is left untouched (no write). On a blocked
 * result, nothing is persisted to `config` and an audit row records why.
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
  const strat = session.strategyId
    ? (await db.select().from(strategies).where(eq(strategies.id, session.strategyId)).limit(1))[0]
    : undefined;

  const result = decideActivation({
    sessionId: session.id,
    mode: session.mode,
    firmId: session.firmId ?? null,
    existingConfig: session.config as PaperSessionConfigWithIdentity | null,
    strategyId: session.strategyId ?? null,
    lifecycleState: strat?.lifecycleState ?? null,
    strategySymbol: strat?.symbol,
    strategyConfig: strat?.config as Record<string, unknown> | undefined,
    exitPlanConfig: strat?.exitPlanConfig ?? null,
    feedMode: resolveFeedMode(),
    runtimeRevision: resolveRuntimeRevision(),
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
    const newConfig: PaperSessionConfigWithIdentity = {
      ...((session.config as PaperSessionConfigShape | null) ?? {}),
      qualification_identity: result.identity,
    };
    await db.update(paperSessions).set({ config: newConfig }).where(eq(paperSessions.id, sessionId));
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
