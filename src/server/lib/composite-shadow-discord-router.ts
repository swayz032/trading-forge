/**
 * composite-shadow-discord-router.ts — Wave 28 Pass B.2
 *
 * Routes composite-vs-hard-gate DISAGREEMENT events to Discord (P2 priority).
 * Agreements stay silent — the operator does not need 50 "everything matches"
 * pings per day.  This router is called fire-and-forget from lifecycle-service.ts
 * immediately after B.1 emits the composite.shadow_evaluation audit row.
 *
 * Routing matrix:
 *   agree_allow           → no Discord (both said ALLOW)
 *   agree_block           → no Discord (both said BLOCK)
 *   shadow_no_opinion     → no Discord (missing/stale/below_threshold — Pass A health issue)
 *   disagree_shadow_blocks → P2 Discord (hard gates ALLOWED but composite says BLOCK)
 *   disagree_shadow_allows → P2 Discord (hard gates BLOCKED but composite says ALLOW)
 *
 * Rate limit:
 *   Per-(strategyId × agreement-type) 24h dedup via in-memory Map<string, number>
 *   keyed by `${strategyId}:${agreement}`.  This is intentionally in-memory (no DB
 *   roundtrip on the critical lifecycle path).  Caveat: map resets on server restart,
 *   so one extra Discord ping may fire immediately after a restart.  This is acceptable
 *   for Pass B observability-only mode — the same trade-off as W25P2 A-4 in-memory dedup
 *   in consistency-tracker-service.ts.
 *
 * Audit actions emitted:
 *   composite.shadow_disagreement_alerted          — Discord send succeeded
 *   composite.shadow_disagreement_rate_limited     — 24h cooldown still active; no send
 *   composite.shadow_disagreement_discord_failed   — Discord post threw; not re-thrown
 *
 * Import notes (CLAUDE.md feedback_helper_logger_import.md):
 *   logger imported from ./logger.js leaf — never from ../index.js.
 */

import { logger } from "./logger.js";
import { insertAuditRowSafe } from "./audit-log-helper.js";
import { appendFamilyGradePostscript } from "./notification-helpers.js";
import { notifyInfo } from "../services/notification-service.js";
import type { ShadowResult } from "./composite-shadow-gate.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type AgreementLabel =
  | "agree_allow"
  | "agree_block"
  | "disagree_shadow_blocks"
  | "disagree_shadow_allows"
  | "shadow_no_opinion";

export interface ShadowAuditPayload {
  strategyId: string;
  strategyName: string;
  hardGateOutcome: string;
  shadow_result: ShadowResult;
  agreement: AgreementLabel;
}

// ─── 24h In-Memory Rate Limiter ───────────────────────────────────────────────

/** Key: `${strategyId}:${agreement}` → timestamp (ms) of last Discord send. */
const _lastAlertMs: Map<string, number> = new Map();

const RATE_LIMIT_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours

function _isRateLimited(strategyId: string, agreement: AgreementLabel): boolean {
  const key = `${strategyId}:${agreement}`;
  const lastMs = _lastAlertMs.get(key);
  if (lastMs === undefined) return false;
  return Date.now() - lastMs < RATE_LIMIT_TTL_MS;
}

function _recordAlert(strategyId: string, agreement: AgreementLabel): void {
  const key = `${strategyId}:${agreement}`;
  _lastAlertMs.set(key, Date.now());
}

/** Exported for test isolation only — resets all rate limit state. */
export function _resetRateLimitForTest(): void {
  _lastAlertMs.clear();
}

// ─── Discord message builder ──────────────────────────────────────────────────

function _buildDisagreementBody(
  payload: ShadowAuditPayload,
): { operatorBody: string; plainWhat: string; plainAction: string } {
  const { strategyName, hardGateOutcome, shadow_result, agreement } = payload;

  const hardGateLabel = hardGateOutcome === "allowed" ? "ALLOW" : "BLOCK";
  const shadowVerdict = shadow_result.verdict ?? "unknown";
  const compositeScore =
    shadow_result.composite_score !== null
      ? shadow_result.composite_score.toFixed(3)
      : "n/a";

  const operatorBody = [
    `[W28 PASS B SHADOW] Shadow disagreement on \`${strategyName}\``,
    `Hard gates: ${hardGateLabel}   |   Composite: ${shadowVerdict} (score: ${compositeScore})`,
    `Reason: ${shadow_result.reason}`,
    `Agreement type: ${agreement}`,
    `This is Pass B shadow mode — no actual promotion impact.`,
    `Tracking 14-day agreement rate before Pass C activation.`,
    `Strategy ID: ${payload.strategyId}`,
  ].join("\n");

  const isShadowBlocks = agreement === "disagree_shadow_blocks";

  const plainWhat = isShadowBlocks
    ? `Tony's hard validation gates said the bot is OK to promote \`${strategyName}\`, but the composite health score disagrees (it says ${shadowVerdict}).`
    : `Tony's hard validation gates blocked \`${strategyName}\` from promotion, but the composite health score thinks it would be OK (it says ${shadowVerdict}).`;

  const plainAction = isShadowBlocks
    ? "No action needed yet — this is an early-warning signal that Tony is tracking. The strategy was NOT blocked."
    : "No action needed — this is data Tony is collecting to calibrate the composite health score over 14 days.";

  return { operatorBody, plainWhat, plainAction };
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * routeShadowDisagreementAlert
 *
 * Called fire-and-forget from lifecycle-service.ts after B.1 emits the
 * composite.shadow_evaluation audit row.  Never throws — all exceptions caught
 * and emitted as composite.shadow_disagreement_discord_failed audit rows.
 *
 * Agreement labels that generate no Discord:
 *   agree_allow, agree_block, shadow_no_opinion
 *
 * Agreement labels that generate P2 Discord:
 *   disagree_shadow_blocks, disagree_shadow_allows
 */
export async function routeShadowDisagreementAlert(
  payload: ShadowAuditPayload,
): Promise<void> {
  const { strategyId, agreement } = payload;

  // ── Silence all non-disagreements ─────────────────────────────────────────
  if (
    agreement === "agree_allow" ||
    agreement === "agree_block" ||
    agreement === "shadow_no_opinion"
  ) {
    // No Discord, no audit beyond B.1's composite.shadow_evaluation row.
    return;
  }

  // ── Rate limit check ──────────────────────────────────────────────────────
  if (_isRateLimited(strategyId, agreement)) {
    logger.debug(
      { strategyId, agreement },
      "composite-shadow-discord-router: rate limited — skipping Discord (24h cooldown active)",
    );
    await insertAuditRowSafe({
      action: "composite.shadow_disagreement_rate_limited",
      entityType: "strategy",
      entityId: strategyId,
      result: {
        strategy_id: strategyId,
        agreement,
        rate_limited: true,
      },
      status: "info",
      decisionAuthority: "system",
    });
    return;
  }

  // ── Build and post Discord message ────────────────────────────────────────
  const { operatorBody, plainWhat, plainAction } = _buildDisagreementBody(payload);
  const fullBody = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

  try {
    notifyInfo(
      `[W28 Shadow] Disagreement on \`${payload.strategyName}\``,
      fullBody,
      {
        job: "composite-shadow-discord-router",
        strategyId,
        agreement,
        composite_score: payload.shadow_result.composite_score,
        verdict: payload.shadow_result.verdict,
        hard_gate_outcome: payload.hardGateOutcome,
      },
    );
  } catch (discordErr) {
    // Discord failure must NEVER propagate to the lifecycle promotion flow.
    const errMsg = discordErr instanceof Error ? discordErr.message : String(discordErr);
    logger.error(
      { err: discordErr, strategyId, agreement },
      "composite-shadow-discord-router: Discord post failed — emitting discord_failed audit",
    );
    await insertAuditRowSafe({
      action: "composite.shadow_disagreement_discord_failed",
      entityType: "strategy",
      entityId: strategyId,
      result: {
        strategy_id: strategyId,
        agreement,
        error: errMsg,
      },
      status: "warning",
      decisionAuthority: "system",
    });
    return; // do NOT throw
  }

  // ── Record rate limit + emit success audit ────────────────────────────────
  _recordAlert(strategyId, agreement);

  await insertAuditRowSafe({
    action: "composite.shadow_disagreement_alerted",
    entityType: "strategy",
    entityId: strategyId,
    result: {
      strategy_id: strategyId,
      agreement,
      rate_limited: false,
    },
    status: "success",
    decisionAuthority: "system",
  });

  logger.info(
    { strategyId, agreement, strategyName: payload.strategyName },
    "composite-shadow-discord-router: disagreement alert sent to Discord",
  );
}
