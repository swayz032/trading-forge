/**
 * confluence-quality-audit.ts — Wave 26 Pass G B3 (2026-05-26)
 *
 * Observability hooks for the two new graduation gates added by B2:
 *   Gate 1: bidirectional_completeness — rejects direction=both when one side empty
 *   Gate 3: thin_confluence_warning — warns on fallback_only factor quality
 *
 * INTEGRATION CONTRACT FOR B2 GATE CALLERS:
 *   Three functions are exported. B2 calls them at the indicated gate sites.
 *   All writes are FIRE-AND-FORGET (.catch) — none can block graduation flow.
 *
 *   1. emitBidirectionalIncompleteRejected(payload)
 *      — Call from B2 Gate 1 BEFORE returning the rejection.
 *      — Writes audit row (REJECT status), broadcasts SSE, increments Prometheus.
 *
 *   2. emitFactorQualityClassified(payload)
 *      — Call from B2 Gate 2 AFTER factor_quality is computed on every graduation.
 *      — Writes audit row (INFO status), increments Prometheus counter + histogram.
 *
 *   3. emitThinConfluenceWarning(payload)
 *      — Call from B2 Gate 3 WHEN graduation completes with factor_quality="fallback_only".
 *      — Writes audit row (WARN status), broadcasts SSE, sends Discord WARNING
 *        (idempotent per strategy_id per session; env-gated via THIN_CONFLUENCE_DISCORD_ENABLED).
 *
 * CORRELATION ID:
 *   Pass the graduation correlation_id (§10b) in every payload. Pass null only
 *   when the calling context has no request context (e.g. cron/backfill paths).
 *
 * AUTO-FALLBACK LIST:
 *   A factor is considered "auto_floor" when it was NOT extracted by the LLM and
 *   was added by the graduator's confluence floor logic. The canonical list is
 *   `AUTO_FLOOR_FACTORS` exported from this module for use by the backfill script
 *   and by B2 Gate 2's classification logic.
 *
 *   Current auto-floor factors (these are always available without real extraction):
 *     - "regime_match"    (added by graduator floor when LLM extracted < 2 factors)
 *     - "structural_setup" (added as second fallback when even regime_match was missing)
 *
 * FACTOR QUALITY CLASSIFICATION:
 *   classifyFactorQuality(factors) is exported so B2 and the backfill script share
 *   identical logic. Classification rules:
 *     "fallback_only" — ALL factors are in AUTO_FLOOR_FACTORS (nothing extracted)
 *     "thin"          — at least one non-fallback factor, but total count < 3
 *     "rich"          — ≥3 non-fallback factors extracted
 */

import { insertAuditRowSafe } from "./audit-log-helper.js";
import {
  graduationFactorQualityTotal,
  graduationBidirectionalRejectionTotal,
  extractionConfluenceDepthHistogram,
} from "./metrics-registry.js";
import { broadcastSSE, FACTORY_EVENTS } from "../routes/sse.js";
import { notifyWarning } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "./notification-helpers.js";
import { logger } from "./logger.js";

// ─── Auto-floor factor set ────────────────────────────────────────────────────

/**
 * Factors that the graduator adds as a quality floor — NOT extracted by the LLM.
 * Any strategy whose entire confluence_factors list is a subset of these is
 * classified as "fallback_only" (no genuine extraction signal).
 *
 * SYNC CONTRACT: Keep this list in sync with the floor logic in
 * direct-bucket-graduator.ts (the block that appends regime_match / structural_setup
 * when rawConfluenceFactors.length < 2). If a new auto-floor factor is added
 * there, add it here too.
 */
export const AUTO_FLOOR_FACTORS: ReadonlySet<string> = new Set([
  "regime_match",
  "structural_setup",
]);

// ─── Factor quality classification ───────────────────────────────────────────

export type FactorQuality = "rich" | "thin" | "fallback_only";

/**
 * Classify the factor_quality of a graduation based on its confluence_factors.
 *
 * Rules (in priority order):
 *   "fallback_only" — every factor is in AUTO_FLOOR_FACTORS (nothing extracted by LLM)
 *   "thin"          — at least one non-fallback factor, but total < 3
 *   "rich"          — ≥3 non-fallback (extracted) factors present
 *
 * @param factors  The confluence_factors array from entry_quality.
 * @returns        "rich" | "thin" | "fallback_only"
 */
export function classifyFactorQuality(factors: string[]): FactorQuality {
  if (factors.length === 0) return "fallback_only";

  const extractedFactors = factors.filter((f) => !AUTO_FLOOR_FACTORS.has(f));

  if (extractedFactors.length === 0) return "fallback_only";
  if (extractedFactors.length < 3) return "thin";
  return "rich";
}

// ─── Factor source tagging ────────────────────────────────────────────────────

export type FactorSource = "extracted" | "auto_floor" | "kb_inferred";

/**
 * Tag each factor with its source.
 * "auto_floor"   — in AUTO_FLOOR_FACTORS (added by graduator floor logic)
 * "extracted"    — LLM extracted this from the transcript
 * "kb_inferred"  — future path: derived from KB overlap (not yet implemented;
 *                  reserved for B2's Gate 2 extension)
 */
export function tagFactorSources(factors: string[]): Record<string, FactorSource> {
  const result: Record<string, FactorSource> = {};
  for (const f of factors) {
    result[f] = AUTO_FLOOR_FACTORS.has(f) ? "auto_floor" : "extracted";
  }
  return result;
}

// ─── Per-session idempotency guard for thin-confluence Discord ────────────────
// Prevents duplicate Discord warnings when a cron runs the same row twice
// within a session. Key = strategy_id, value = timestamp of last warning sent.
const _thinConfluenceDiscordSent: Map<string, number> = new Map();

/** Exported for test injection — do not call in production code directly. */
export function _clearThinConfluenceDiscordState(): void {
  _thinConfluenceDiscordSent.clear();
}

// ─── Payload types ────────────────────────────────────────────────────────────

export interface BidirectionalIncompleteRejectedPayload {
  /** Human-readable strategy name (concept name at graduation time). */
  strategy_name: string;
  /** Graduation correlation ID from §10b chain. Null if absent. */
  correlation_id: string | null;
  /** The direction field from the DSL that caused rejection. */
  direction: string;
  /** Structured rejection reason code. */
  rejection_reason: "incomplete_bidirectional_extraction" | string;
  /** Which side was empty: "long_side_empty" | "short_side_empty" | "both_sides_empty". */
  empty_side: string;
  /**
   * Wave 26 Pass G B4 reconciliation (2026-05-26): when called from
   * direct-bucket-graduator.ts the graduator already wrote its own audit row
   * (different action name `graduation.rejected_incomplete_bidirectional`).
   * This flag is currently a no-op for Gate 1 (no duplicate action name) but
   * exists for API symmetry with FactorQuality / ThinConfluence payloads.
   */
  skipAuditRow?: boolean;
}

export interface FactorQualityClassifiedPayload {
  /** Strategy row ID (UUID). */
  strategy_id: string;
  /** Human-readable strategy name. */
  strategy_name: string;
  /** Graduation correlation ID from §10b chain. Null if absent. */
  correlation_id: string | null;
  /** Computed factor quality. */
  factor_quality: FactorQuality;
  /** Per-factor source tags. */
  factor_sources: Record<string, FactorSource>;
  /** The full confluence_factors array. */
  confluence_factors: string[];
  /** true when this row was written by the backfill script (not a live graduation). */
  backfill?: boolean;
  /**
   * Wave 26 Pass G B4 reconciliation (2026-05-26): graduator does NOT write
   * its own `graduation.factor_quality_classified` audit row (B2 left this
   * gap intentionally — only Prom/SSE telemetry desired per gate). Pass true
   * from non-graduator callers (parity test, backfill) to suppress the audit
   * row IF a caller wants Prom/Histogram only. Currently always false in
   * runtime since the helper IS the audit-row owner for this action.
   */
  skipAuditRow?: boolean;
}

export interface ThinConfluenceWarningPayload {
  /** Strategy row ID (UUID). */
  strategy_id: string;
  /** Human-readable strategy name. */
  strategy_name: string;
  /** Graduation correlation ID from §10b chain. Null if absent. */
  correlation_id: string | null;
  /** Always "fallback_only" when Gate 3 fires. */
  factor_quality: FactorQuality;
  /** The full confluence_factors array. */
  confluence_factors: string[];
  /** Best-available source URL for the strategy (from strategy-source-resolver). */
  source_url: string | null;
  /**
   * Wave 26 Pass G B4 reconciliation (2026-05-26): graduator writes its own
   * `graduation.thin_confluence_warning` audit row (same action name as this
   * helper). When called from direct-bucket-graduator.ts, pass true to
   * suppress the helper-side audit write and prevent duplicate audit rows.
   * Helper still emits SSE + Prom + Discord — Discord remains idempotent via
   * `_thinConfluenceDiscordSent` even if the graduator also did a notify().
   * Non-graduator callers (backfill replay, future cron sweeps) leave this
   * unset so the helper owns the audit write end-to-end.
   */
  skipAuditRow?: boolean;
}

// ─── Emission helpers — the three public hook functions B2 calls ──────────────

/**
 * emitBidirectionalIncompleteRejected
 *
 * Call from B2 Gate 1 when direction=both but one side has no entry condition.
 * Writes audit row with REJECT status, broadcasts SSE, increments Prometheus.
 * Fire-and-forget — never throws, never blocks.
 *
 * Audit action: "graduation.bidirectional_incomplete_rejected"
 * SSE event:    "factory:bidirectional_rejected"
 * Counter:      tf_graduation_bidirectional_rejection_total{reason}
 */
export function emitBidirectionalIncompleteRejected(
  payload: BidirectionalIncompleteRejectedPayload,
): void {
  // 1. Prometheus counter — synchronous, never throws
  try {
    graduationBidirectionalRejectionTotal
      .labels({ reason: payload.rejection_reason })
      .inc();
  } catch { /* counter unavailable — ignore */ }

  // 2. SSE broadcast
  try {
    broadcastSSE(FACTORY_EVENTS.BIDIRECTIONAL_REJECTED, {
      strategy_name:    payload.strategy_name,
      correlation_id:   payload.correlation_id,
      rejection_reason: payload.rejection_reason,
      empty_side:       payload.empty_side,
      direction:        payload.direction,
    });
  } catch (err: unknown) {
    logger.warn(
      { err: String(err), strategy_name: payload.strategy_name },
      "confluence-quality-audit: bidirectional_rejected SSE broadcast failed (non-blocking)",
    );
  }

  // 3. Audit log — async fire-and-forget (skipped when called from graduator,
  // which writes its own `graduation.rejected_incomplete_bidirectional` row).
  if (payload.skipAuditRow) return;
  insertAuditRowSafe({
    action: "graduation.bidirectional_incomplete_rejected",
    entityType: "strategy",
    entityId: null,
    input: {
      strategy_name: payload.strategy_name,
      direction:     payload.direction,
    } as Record<string, unknown>,
    result: {
      rejection_reason: payload.rejection_reason,
      empty_side:       payload.empty_side,
    } as Record<string, unknown>,
    status: "rejected",
    decisionAuthority: "system",
    correlationId: payload.correlation_id ?? null,
  }).catch((err: unknown) =>
    logger.warn(
      { err: String(err), strategy_name: payload.strategy_name },
      "confluence-quality-audit: bidirectional_incomplete_rejected audit write failed (non-blocking)",
    )
  );
}

/**
 * emitFactorQualityClassified
 *
 * Call from B2 Gate 2 on EVERY graduation (including rich ones).
 * Writes audit row with INFO status, increments quality counter + depth histogram.
 * Fire-and-forget — never throws, never blocks.
 *
 * Audit action: "graduation.factor_quality_classified"
 * Counter:      tf_graduation_factor_quality_total{quality}
 * Histogram:    tf_extraction_confluence_depth_histogram (observed = factor count)
 */
export function emitFactorQualityClassified(
  payload: FactorQualityClassifiedPayload,
): void {
  // 1. Prometheus counter — synchronous, never throws
  try {
    graduationFactorQualityTotal
      .labels({ quality: payload.factor_quality })
      .inc();
  } catch { /* counter unavailable — ignore */ }

  // 2. Confluence depth histogram — observe factor count
  try {
    // Cap at 5 (bucket ceiling); each factor beyond 5 increments the +Inf bucket.
    extractionConfluenceDepthHistogram.observe(
      Math.min(payload.confluence_factors.length, 5),
    );
  } catch { /* histogram unavailable — ignore */ }

  // 3. Audit log — async fire-and-forget (Pass G B4: helper owns this action
  // name end-to-end; graduator does NOT write a competing row for Gate 2).
  if (payload.skipAuditRow) return;
  insertAuditRowSafe({
    action: "graduation.factor_quality_classified",
    entityType: "strategy",
    entityId: payload.strategy_id,
    input: {
      strategy_name:     payload.strategy_name,
      confluence_factors: payload.confluence_factors,
    } as Record<string, unknown>,
    result: {
      factor_quality:  payload.factor_quality,
      factor_sources:  payload.factor_sources,
      ...(payload.backfill ? { backfill: true } : {}),
    } as Record<string, unknown>,
    status: "info",
    decisionAuthority: "system",
    correlationId: payload.correlation_id ?? null,
  }).catch((err: unknown) =>
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id },
      "confluence-quality-audit: factor_quality_classified audit write failed (non-blocking)",
    )
  );
}

/**
 * emitThinConfluenceWarning
 *
 * Call from B2 Gate 3 when a graduation completes with factor_quality="fallback_only".
 * Writes audit row (WARN status), broadcasts SSE, sends Discord WARNING (idempotent
 * per strategy_id per session; controlled by THIN_CONFLUENCE_DISCORD_ENABLED env).
 * Fire-and-forget — never throws, never blocks.
 *
 * Audit action: "graduation.thin_confluence_warning"
 * SSE event:    "factory:thin_confluence_graduated"
 * Discord:      WARNING to DISCORD_CH_STRATEGY_FINDS (env-gated + idempotent)
 */
export function emitThinConfluenceWarning(
  payload: ThinConfluenceWarningPayload,
): void {
  // 1. SSE broadcast
  try {
    broadcastSSE(FACTORY_EVENTS.THIN_CONFLUENCE_GRADUATED, {
      strategy_id:       payload.strategy_id,
      strategy_name:     payload.strategy_name,
      correlation_id:    payload.correlation_id,
      factor_quality:    payload.factor_quality,
      confluence_factors: payload.confluence_factors,
      source_url:        payload.source_url,
    });
  } catch (err: unknown) {
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id },
      "confluence-quality-audit: thin_confluence_graduated SSE broadcast failed (non-blocking)",
    );
  }

  // 2. Audit log — async fire-and-forget (skipped when called from graduator,
  // which already wrote its own `graduation.thin_confluence_warning` row at
  // the Gate 3 call-site; helper still emits SSE + Prom + Discord additively).
  if (payload.skipAuditRow) {
    // fall through to Discord block — SSE already fired above
  } else {
  insertAuditRowSafe({
    action: "graduation.thin_confluence_warning",
    entityType: "strategy",
    entityId: payload.strategy_id,
    input: {
      strategy_name:     payload.strategy_name,
      confluence_factors: payload.confluence_factors,
      source_url:        payload.source_url,
    } as Record<string, unknown>,
    result: {
      factor_quality: payload.factor_quality,
    } as Record<string, unknown>,
    status: "warning",
    decisionAuthority: "system",
    correlationId: payload.correlation_id ?? null,
  }).catch((err: unknown) =>
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id },
      "confluence-quality-audit: thin_confluence_warning audit write failed (non-blocking)",
    )
  );
  } // end audit-row else

  // 3. Discord WARNING — idempotent per strategy_id per session.
  // Graduator already does its own notify() at Gate 3 — when skipAuditRow=true
  // the caller is the graduator and Discord has already been sent; skip to
  // avoid a duplicate message (the helper's idempotency map alone is per-
  // session, so we need an explicit suppression for the in-flow duplicate).
  if (payload.skipAuditRow) return;
  const discordEnabled =
    (process.env["THIN_CONFLUENCE_DISCORD_ENABLED"] ?? "true") !== "false";

  if (!discordEnabled) return;

  const alreadySent = _thinConfluenceDiscordSent.has(payload.strategy_id);
  if (alreadySent) {
    logger.debug(
      { strategy_id: payload.strategy_id },
      "confluence-quality-audit: thin_confluence Discord already sent this session — skipping dedup",
    );
    return;
  }

  _thinConfluenceDiscordSent.set(payload.strategy_id, Date.now());

  // Resolve target channel webhook URL.
  // DISCORD_CH_STRATEGY_FINDS overrides the default DISCORD_WEBHOOK_URL so the
  // message can be routed to #strategy-finds specifically.
  const channelWebhook =
    process.env["DISCORD_CH_STRATEGY_FINDS"] ??
    process.env["DISCORD_WEBHOOK_URL"];

  if (!channelWebhook) {
    logger.debug(
      { strategy_id: payload.strategy_id },
      "confluence-quality-audit: no Discord channel configured for thin-confluence warning — skipped",
    );
    return;
  }

  const sourceRef = payload.source_url ?? "(source URL unavailable)";
  const operatorBody =
    `New strategy \`${payload.strategy_name}\` graduated with thin confluence ` +
    `(only auto-fallback factors). Operator may want to re-extract from source URL ` +
    `for richer signal stack. Strategy ID: \`${payload.strategy_id}\`. ` +
    `Source: ${sourceRef}.`;

  const fullBody = appendFamilyGradePostscript(
    operatorBody,
    "A new trading strategy was approved for testing but it only has basic signal filters. " +
    "The bot analysed the source video/article but couldn't find enough specific trading cues to classify it as high-confidence.",
    "No action needed. The strategy will paper-trade normally. " +
    "If you see underperformance, the operator can re-extract the source for richer signal data.",
  );

  // notifyWarning is fire-and-forget by design (see notification-service.ts)
  // We pass the channel override via env so the service picks it up normally.
  // Since notifyWarning reads DISCORD_WEBHOOK_URL from env, we temporarily shadow
  // the env var only when a dedicated channel override is configured. To avoid
  // mutating process.env at runtime (unsafe in concurrent code), we POST directly
  // via fetch when a channel override is configured, otherwise fall through to
  // the standard notifyWarning routing.
  if (process.env["DISCORD_CH_STRATEGY_FINDS"]) {
    // Direct POST to the dedicated channel — bypass notification-service routing.
    _postThinConfluenceDirectly(channelWebhook, payload.strategy_name, fullBody).catch(
      (err: unknown) =>
        logger.warn(
          { err: String(err), strategy_id: payload.strategy_id },
          "confluence-quality-audit: direct Discord thin-confluence post failed (non-blocking)",
        ),
    );
  } else {
    // Fall through to standard notification-service routing (DISCORD_WEBHOOK_URL).
    notifyWarning(
      `Thin confluence: ${payload.strategy_name}`,
      fullBody,
      {
        strategy_id:   payload.strategy_id,
        factor_quality: payload.factor_quality,
        source_url:    payload.source_url,
      },
    );
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _postThinConfluenceDirectly(
  webhookUrl: string,
  strategyName: string,
  body: string,
): Promise<void> {
  const payload =
    webhookUrl.startsWith("https://discord.com/api/webhooks/")
      ? {
          embeds: [
            {
              title: `Thin confluence: ${strategyName}`,
              description: body.slice(0, 4000),
              color: 0xffa500, // amber — WARNING severity
              timestamp: new Date().toISOString(),
              footer: { text: "Trading Forge | confluence-quality-audit" },
            },
          ],
        }
      : { title: `Thin confluence: ${strategyName}`, message: body, severity: "WARNING" };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "(unreadable)");
    throw new Error(`Discord thin-confluence POST HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ─── parity-test helper (B1) ──────────────────────────────────────────────────

export interface ExtractionParityTestPayload {
  /** The test fixture label (e.g. "youtube_ict_bias_fixture"). */
  fixture_label: string;
  /** Number of confluence factors the new prompt extracted. */
  factors_extracted: number;
  /** Factor quality of the extraction result. */
  factor_quality: FactorQuality;
  /** true when direction=both was correctly emitted. */
  bidirectional_correct: boolean;
  /** Correlation ID for the test run. Pass null for unit-test runs. */
  correlation_id: string | null;
}

/**
 * emitExtractionParityTestRun
 *
 * Called by B1's parity test suite once per fixture run.
 * Writes an INFO audit row so Pass G B3 tests can verify the event fires.
 * Fire-and-forget — never throws, never blocks production code.
 *
 * Audit action: "extraction.parity_test_run"
 */
export function emitExtractionParityTestRun(
  payload: ExtractionParityTestPayload,
): void {
  // Depth histogram — track what the new prompt achieves on the fixtures
  try {
    extractionConfluenceDepthHistogram.observe(
      Math.min(payload.factors_extracted, 5),
    );
  } catch { /* histogram unavailable — ignore */ }

  insertAuditRowSafe({
    action: "extraction.parity_test_run",
    entityType: "system",
    entityId: null,
    input: {
      fixture_label: payload.fixture_label,
    } as Record<string, unknown>,
    result: {
      factors_extracted:     payload.factors_extracted,
      factor_quality:        payload.factor_quality,
      bidirectional_correct: payload.bidirectional_correct,
    } as Record<string, unknown>,
    status: "info",
    decisionAuthority: "system",
    correlationId: payload.correlation_id ?? null,
  }).catch((err: unknown) =>
    logger.warn(
      { err: String(err), fixture_label: payload.fixture_label },
      "confluence-quality-audit: extraction.parity_test_run audit write failed (non-blocking)",
    )
  );
}
