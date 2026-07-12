import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { sseClientsConnected } from "../lib/metrics-registry.js";
import { computeReplayGap } from "../lib/sse-replay-gap.js";

const router = Router();

// ─── Connected clients ────────────────────────────────────────
const clients: Set<Response> = new Set();

// Deep-scan #5 M1 (2026-06-29): mirror clients.size into the Prometheus gauge after
// every mutation so the operator can alert on "0 SSE clients while paper engine active"
// or unbounded client accumulation. Never throws — a metric set must never break SSE.
function _syncSseClientGauge(): void {
  try { sseClientsConnected.set(clients.size); } catch { /* non-blocking */ }
}

// ─── Event sequence counter ───────────────────────────────────
// Monotonically increasing integer attached to every SSE event.
// Clients that reconnect with `Last-Event-ID` will receive any buffered
// events with seq > lastEventId before resuming live delivery.
let eventSeq = 0;

// fresh-scan HIGH#8 (2026-07-12): a per-BOOT nonce, stamped into every event id as `<bootId>.<seq>`.
// eventSeq + ringBuffer are in-memory and reset to 0/[] on every NSSM respawn/crash. The prior
// seq-only gap detection was ONE-DIRECTIONAL: it caught a client whose Last-Event-ID was ABOVE the
// fresh counter (5000 vs 12), but MISSED the common case — a client that connected shortly before the
// restart (small lastSeenSeq, e.g. 5), where the fresh process climbs the counter back past it (to 10)
// before the ~1-3s EventSource reconnect. Then oldestSeq>lastSeenSeq+1 and lastSeenSeq>eventSeq are
// both false → NO replay_gap → the real post-restart seq 1..5 (which can include production HALT /
// force-flatten / lifecycle demotions) are silently dropped as if contiguous. Comparing the client's
// echoed bootId against the current one detects EVERY restart regardless of seq values.
const SSE_BOOT_ID = randomUUID().slice(0, 8);

// ─── In-memory ring buffer (last 100 events) ─────────────────
// Pass 5 Track A F-10: stores SERIALIZED strings so replay on reconnect
// cannot crash on unserializable payloads (BigInt, circular refs). The
// live-broadcast path stringifies first; only the serialized form ever
// enters the buffer. Replay reads entry.serialized directly.
const RING_BUFFER_SIZE = 100;
interface BufferedEvent {
  seq: number;
  event: string;
  serialized: string;
}
const ringBuffer: BufferedEvent[] = [];

function pushToRingBuffer(entry: BufferedEvent): void {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
}

// ─── SSE heartbeat ────────────────────────────────────────────
// Keeps connections alive through proxies and removes stale clients.
const HEARTBEAT_INTERVAL_MS = 30_000;
// F8 FIX: capture the interval handle and unref() it so test runners (Jest/Vitest)
// exit cleanly. unref() is a Node.js-specific method; we guard for environments
// (e.g. some Bun builds) that may not expose it.
const _heartbeatInterval = setInterval(() => {
  for (const client of clients) {
    if (client.writableEnded || client.destroyed) {
      clients.delete(client);
      continue;
    }
    try {
      client.write(":ping\n\n");
    } catch {
      clients.delete(client);
    }
  }
}, HEARTBEAT_INTERVAL_MS);
if (typeof _heartbeatInterval.unref === "function") {
  _heartbeatInterval.unref();
}

// ─── GET /api/sse/events — SSE stream ────────────────────────
router.get("/events", (req: Request, res: Response) => {
  // SSE connections are intentionally long-lived — disable the socket-level
  // timeout that server.timeout would otherwise apply. Without this, the 5-minute
  // server timeout (set in index.ts production hardening) would kill every SSE
  // client after 5 minutes of inactivity, disrupting the dashboard.
  req.setTimeout(0);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // ── Replay missed events on reconnect ──
  // EventSource sets `Last-Event-ID` header to the last `id:` it received. Format is `<bootId>.<seq>`
  // (HIGH#8); a legacy plain-int id (pre-deploy client) or an id whose bootId differs from ours means
  // this process is not the one that issued it → a restart happened → force a gap so the client
  // refetches authoritative state rather than trusting a reset seq counter.
  const lastEventIdHeader = req.headers["last-event-id"];
  const lastEventIdRaw = lastEventIdHeader ? String(lastEventIdHeader) : "";
  const bufferEmpty = ringBuffer.length === 0;
  const oldestSeq   = bufferEmpty ? -1 : ringBuffer[0].seq;
  // HIGH#8 (2026-07-12): pure decision — bootMismatch catches EVERY restart (incl. the common
  // small-lastSeenSeq case the seq-only checks miss). See lib/sse-replay-gap.ts.
  const _gap = computeReplayGap({ lastEventIdRaw, currentBootId: SSE_BOOT_ID, ringEmpty: bufferEmpty, oldestSeq, eventSeq });
  const lastSeenSeq = _gap.lastSeenSeq;
  const bootMismatch = _gap.bootMismatch;

  if (_gap.shouldEvaluate) {
    const hasGap = _gap.hasGap;

    if (hasGap) {
      // H-6: Signal replay gap so the frontend can refetch authoritative state
      // instead of assuming the SSE stream is continuous.
      const gapPayload = JSON.stringify({
        lastSeenSeq,
        currentSeq: eventSeq,
        message: "replay_buffer_does_not_cover_gap",
      });
      res.write(`id: ${SSE_BOOT_ID}.0\nevent: sse:replay_gap\ndata: ${gapPayload}\n\n`);
      logger.warn(
        { lastSeenSeq, currentSeq: eventSeq, oldestBufferedSeq: oldestSeq, bufferEmpty },
        "SSE replay: gap detected — client must refetch state",
      );
    } else {
      // Buffer covers the gap — replay only the missed events.
      const missed = ringBuffer.filter((e) => e.seq > lastSeenSeq);
      for (const entry of missed) {
        // F-10: serialized form already in buffer — no JSON.stringify on replay.
        res.write(`id: ${SSE_BOOT_ID}.${entry.seq}\nevent: ${entry.event}\ndata: ${entry.serialized}\n\n`);
      }
      if (missed.length > 0) {
        logger.info(
          { lastSeenSeq, replayed: missed.length },
          "SSE replay: delivered missed events to reconnecting client",
        );
      }
    }
  } else {
    // Fresh connection — send connected sentinel (no id needed, not buffered)
    res.write("data: {\"type\":\"connected\"}\n\n");
  }

  clients.add(res);
  _syncSseClientGauge();
  logger.info(`SSE client connected (${clients.size} total)`);

  res.on("error", () => {
    clients.delete(res);
    _syncSseClientGauge();
  });

  req.on("close", () => {
    clients.delete(res);
    _syncSseClientGauge();
    logger.info(`SSE client disconnected (${clients.size} total)`);
  });
});

// ─── Internal SSE broadcast listeners (Carter issue watcher et al.) ──────────
// Additive hook for in-process subscribers that need to react to SSE events
// without going through the external HTTP SSE stream. Listeners are registered
// via onSseBroadcast() and receive the ORIGINAL data object BEFORE JSON
// serialization (no need to JSON.parse on the receiving end).
//
// Design invariant: listener errors are caught inside broadcastSSE() and MUST
// NOT abort the broadcast chain. A buggy or crashing internal listener must
// never prevent external SSE clients from receiving their event.
const _internalSseListeners: Array<(event: string, data: unknown) => void> = [];

/**
 * Register an in-process listener that fires on every broadcastSSE() call.
 * The callback receives (eventName, originalDataObject) before serialization.
 * Errors thrown by the callback are caught and swallowed — callers should be
 * fail-soft internally.
 *
 * Note: there is no deregistration API. Listeners are expected to be long-lived
 * (registered once at service startup, alive for the process lifetime).
 */
export function onSseBroadcast(cb: (event: string, data: unknown) => void): void {
  _internalSseListeners.push(cb);
}

// ─── broadcastSSE ─────────────────────────────────────────────
// Exported for use throughout the server. Assigns a sequence number to every
// event, writes it to the ring buffer, then fans out to all live clients.
//
// Each client.write() is wrapped in try/catch. A socket can transition from
// writable to closed between the writableEnded check and the actual write —
// this is a real race condition on high-frequency broadcast paths (e.g., after
// a lifecycle transition that calls broadcastSSE immediately post-commit).
// A throw here would propagate to the caller and can abort the post-commit
// broadcast entirely, leaving other clients without the event.
export function broadcastSSE(event: string, data: unknown): void {
  // ── Notify internal in-process subscribers BEFORE external fan-out ──
  // Listeners receive the original data object (no JSON.parse needed).
  // Errors are caught so a crashing listener cannot abort the broadcast chain.
  for (const listener of _internalSseListeners) {
    try { listener(event, data); } catch { /* swallow — must not abort broadcast */ }
  }

  const seq = ++eventSeq;

  // Pass 5 Track A F-10: SERIALIZE FIRST. Push the serialized string into the
  // ring buffer so reconnect-replay cannot crash on unserializable payloads.
  // If serialization fails, buffer a safe sse_serialize_error sentinel under
  // the same seq so the gap-replay sequencing is preserved.
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch (serializeErr) {
    const dataType = Object.prototype.toString.call(data);
    logger.error(
      { event, dataType, err: String(serializeErr) },
      "broadcastSSE: data serialization failed — emitting sse_serialize_error event",
    );
    const errorPayload = JSON.stringify({
      event: "sse_serialize_error",
      reason: dataType,
      caller: event,
    });
    pushToRingBuffer({ seq, event: "sse_serialize_error", serialized: errorPayload });
    const errorMessage = `id: ${SSE_BOOT_ID}.${seq}\nevent: sse_serialize_error\ndata: ${errorPayload}\n\n`;
    for (const client of clients) {
      if (client.writableEnded || client.destroyed) continue;
      try { client.write(errorMessage); } catch { /* dead client — ignore */ }
    }
    return;
  }

  pushToRingBuffer({ seq, event, serialized });

  const message = `id: ${SSE_BOOT_ID}.${seq}\nevent: ${event}\ndata: ${serialized}\n\n`;
  const deadClients = new Set<Response>();

  for (const client of clients) {
    if (client.writableEnded || client.destroyed) {
      deadClients.add(client);
      continue;
    }
    try {
      client.write(message);
    } catch (err) {
      logger.warn({ err: String(err), event }, "sse client write failed — removing dead client");
      deadClients.add(client);
    }
  }

  // Purge dead clients from the live set
  for (const dead of deadClients) {
    clients.delete(dead);
  }
  if (deadClients.size > 0) _syncSseClientGauge();
}

// ─── POST /api/sse/broadcast — n8n / external broadcast ──────
router.post("/broadcast", (req: Request, res: Response) => {
  const body = req.body ?? {};
  const explicitType = typeof body.type === "string" ? body.type : null;
  const legacyEvent = typeof body.event === "string" ? body.event : null;
  const legacyAlertShape =
    typeof body.title === "string"
    || typeof body.message === "string"
    || typeof body.severity === "string";
  const type = explicitType ?? legacyEvent ?? (legacyAlertShape ? "alert:triggered" : null);

  if (!type) {
    res.status(400).json({ error: "type is required and must be a string" });
    return;
  }

  let data = body.data ?? {};
  if (legacyAlertShape) {
    data = {
      ...(typeof body.data === "object" && body.data !== null ? body.data : {}),
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.message === "string" ? { message: body.message } : {}),
      ...(typeof body.severity === "string" ? { severity: body.severity } : {}),
    };
  }

  broadcastSSE(type, data);
  logger.info({ type, clientCount: clients.size }, "SSE broadcast sent");
  res.json({ ok: true, clientCount: clients.size });
});

/**
 * closeAllSseClients — used during graceful shutdown to drain SSE connections
 * before server.close() so that connected clients don't have to wait for the
 * 10-second force-kill. Each client gets a `system:shutdown` event followed by
 * an explicit end() call.
 */
export function closeAllSseClients(): void {
  for (const client of clients) {
    try {
      client.write(`event: system:shutdown\ndata: {"reason":"server_shutdown"}\n\n`);
      client.end();
    } catch {
      // Client may already be gone — ignore
    }
  }
  clients.clear();
}

export { router as sseRoutes };

// ─── Paper Execution SSE Event Names ─────────────────────────────────────────
// Centralized event-name constants used by paper-execution-service.ts when it
// broadcasts Style C exit-leg events. Names are SSE event channels — keep them
// stable; the frontend subscribes by exact name.
export const PAPER_EXIT_EVENTS = {
  TP1_FILLED:           "paper:tp1_filled",
  TP2_FILLED:           "paper:tp2_filled",
  BE_STOP_MOVED:        "paper:be_stop_moved",
  TRAIL_TIGHTENED:      "paper:trail_tightened",
  TIME_STOP_FLATTENED:  "paper:time_stop_flattened",
  HANDLER_ERROR:        "paper:handler_error",
} as const;

export type PaperExitEventName = (typeof PAPER_EXIT_EVENTS)[keyof typeof PAPER_EXIT_EVENTS];

// ─── Factory Pipeline SSE Event Names ────────────────────────────────────────
// Centralized event-name constants for scout/graduator pipeline events.
// broadcast by direct-bucket-graduator.ts and autonomous-scout-runner.ts.
// The frontend subscribes to these by exact name — do not rename without
// a coordinated frontend update.
export const FACTORY_EVENTS = {
  MULTI_MARKET_BUCKET:        "factory:multi_market_bucket",
  GRADUATION_ENTRY_QUALITY:   "factory:graduation_entry_quality",
  SCOUT_IDEA_EXTRACTED:       "factory:scout_idea_extracted",
  STRATEGY_CREATED:           "factory:strategy_created",
  FRAMEWORK_OVERLAY_APPLIED:  "factory:framework_overlay_applied",
  // Wave 26 Pass G (2026-05-26) — broadcast on every signal fired from the
  // two new engine archetypes (bounce_off_level, ict_bias_aligned_continuation).
  // Dashboard consumers subscribe to this event for real-time archetype activity.
  // Data shape: { strategy_id, correlation_id, direction, archetype, bar_timestamp }
  // plus archetype-specific fields (see archetype-signal-audit.ts).
  ARCHETYPE_SIGNAL_FIRED:     "factory:archetype_signal_fired",
  // Wave 26 Pass G B3 (2026-05-26) — confluence quality observability.
  // BIDIRECTIONAL_REJECTED: broadcast when Gate 1 fires (direction=both, one side
  //   empty). Dashboard shows graduation was rejected before strategy row written.
  //   Data shape: { strategy_name, correlation_id, rejection_reason, direction }
  // THIN_CONFLUENCE_GRADUATED: broadcast when Gate 3 fires (graduation completes
  //   with factor_quality="fallback_only"). Library debt indicator for dashboard.
  //   Data shape: { strategy_id, strategy_name, correlation_id, factor_quality,
  //                 confluence_factors, source_url }
  BIDIRECTIONAL_REJECTED:     "factory:bidirectional_rejected",
  THIN_CONFLUENCE_GRADUATED:  "factory:thin_confluence_graduated",
  // Deep-Scan #21 Band D (2026-07-05) — catalog-drift fix. Broadcast by
  // candidate-backtest-conveyor-service.ts when a CANDIDATE strategy is
  // enqueued for its next backtest cycle. Was emitted since the conveyor
  // shipped but never registered here — dashboards subscribing off this
  // catalog silently missed the event. Data shape: { strategyId, strategyName,
  // backtestId, correlationId }
  CANDIDATE_BACKTEST_ENQUEUED: "factory:candidate_backtest_enqueued",
} as const;

export type FactoryEventName = (typeof FACTORY_EVENTS)[keyof typeof FACTORY_EVENTS];

// Wave hardening 2026-06-22: payload type exports for factory:graduation_entry_quality
// and factory:multi_market_bucket SSE events.  Shapes derived from the actual
// broadcastSSE() call sites in direct-bucket-graduator.ts (lines ~2968 and ~3003).
export interface FactoryGraduationEntryQualityPayload {
  strategy_id: number;
  name: string;
  symbols: string[];
  confluence_factor_count: number;
  extraction_provenance: string;
  has_source_claim_win_rate: boolean;
  has_source_claim_avg_r: boolean;
  correlation_id: string | null;
}

export interface FactoryMultiMarketBucketPayload {
  bucket_fingerprint: string;
  concept_name: string;
  symbols: string[];
  layer_coverage: {
    web: boolean;
    youtube: boolean;
    reddit: boolean;
  };
  correlation_id: string | null;
}

// ─── Wave 29 Pass D.1 SSE Event Names ────────────────────────────────────────
//
// Centralized event-name constants for Wave 29 lifecycle, signal, and RL events.
// All names follow the existing `{subsystem}:{event_name}` convention.
// These constants are declared here so consumers can import a stable name
// rather than embed magic strings that may drift.
//
// Emission sites (as of Wave 29 Pass A + B + C close — use function anchors, not line
// numbers, as line numbers drift immediately after any insertion or deletion):
//   SHADOW_LOGGED             — paper-signal-service.ts::evaluateSignals() shadow-intercept block (Pass A.1)
//   PBO_EVALUATED             — lifecycle-service.ts::LifecycleService._promoteStrategyInner() PBO gate (Pass A.2)
//   SHADOW_DIVERGENCE_EVALUATED — lifecycle-service.ts::LifecycleService._promoteStrategyInner() SHADOW→PAPER gate (Pass A.3)
//   RL_AB_ROUTED              — paper-signal-service.ts::evaluateSignals() A/B paper routing branch (Pass C.3)
//   RL_TRAINING_COMPLETED     — quantum-rl-training-runner.ts post-subprocess-completion emit path
//   RL_KILL_SWITCH_ENGAGED    — rl-signal-fetcher.ts::fetchRlSignalForStrategy() kill-switch branch
//
// Data shapes:
//   SHADOW_LOGGED             { strategy_id, signal_ts, direction, regime, correlation_id }
//   PBO_EVALUATED             { strategy_id, pbo_overall, threshold, blocked, correlation_id }
//   SHADOW_DIVERGENCE_EVALUATED { strategy_id, divergence_pct, sample_size, outcome, correlation_id }
//   RL_AB_ROUTED              { strategy_id, target_account, composite_verdict, correlation_id }
//   RL_TRAINING_COMPLETED     { strategy_id, regime, epochs_completed, dsr_passed, correlation_id }
//   RL_KILL_SWITCH_ENGAGED    { strategy_id, reason, sharpe_gap_ratio, correlation_id }
export const WAVE29_EVENTS = {
  // Pass A.1 — shadow signal logged (TradersPost webhook suppressed)
  SHADOW_LOGGED: "signal:shadow_logged",
  // Pass A.2 — PBO gate evaluated at TESTING → SHADOW / TESTING → PAPER
  PBO_EVALUATED: "lifecycle:pbo_evaluated",
  // Pass A.3 — shadow-signal divergence gate evaluated at SHADOW → PAPER
  SHADOW_DIVERGENCE_EVALUATED: "lifecycle:shadow_divergence_evaluated",
  // Pass C.3 — strategy routed to A/B paper sub-account
  RL_AB_ROUTED: "signal:rl_ab_routed",
  // Pass C.2 — RL training epoch batch completed (emitted post-subprocess success)
  RL_TRAINING_COMPLETED: "quantum_rl:training_completed",
  // Pass C.2 — RL kill switch engaged (Sharpe gap > 30% over 20 sessions)
  RL_KILL_SWITCH_ENGAGED: "quantum_rl:kill_switch_engaged",
} as const;

export type Wave29EventName = (typeof WAVE29_EVENTS)[keyof typeof WAVE29_EVENTS];

// ─── Pass 4.5 Track D — Archetype routing observability SSE events (2026-06-23) ─
//
// Emitted by archetype-routing-observability.ts helpers on every stage of the
// /api/live-order archetype_signal handler lifecycle. Track B calls these helpers
// directly — no SSE logic lives in the route itself.
//
// Payload shapes:
//   SIGNAL_RECEIVED   { strategy_id, archetype, account_id, correlation_id, bar_timestamp }
//   SIGNAL_RESOLVED   { strategy_id, archetype, resolved_action, account_id, correlation_id, reason }
//   EVALUATOR_FAILED  { strategy_id, archetype, error_class, correlation_id }
//
// resolved_action closed enum (mirrors tf_archetype_signals_routed_total labels):
//   enter_long | enter_short | exit_long | exit_short | hold | evaluator_failed
//
// error_class is a string — typically the constructor name of the thrown error
//   (e.g. "TimeoutError", "SubprocessError") so dashboards can group failure modes.
export const ARCHETYPE_ROUTING_EVENTS = {
  // Fired when /api/live-order accepts an action:"archetype_signal" request
  // and before the Python evaluator subprocess is dispatched.
  SIGNAL_RECEIVED: "archetype:signal_received",
  // Fired after the archetype_evaluator returns a verdict. Carries the resolved
  // direction and reason from the evaluator response.
  SIGNAL_RESOLVED: "archetype:signal_resolved",
  // Fired when the Python evaluator subprocess fails or times out.
  EVALUATOR_FAILED: "archetype:evaluator_failed",
  // Deep-Scan #21 Band D (2026-07-05) — catalog-drift fix. Broadcast by
  // scheduler.ts::classifyDayArchetype() after a daily archetype prediction
  // is persisted to day_archetypes. Was emitted since the day-archetype
  // classifier shipped but never registered here. Data shape: { symbol, date,
  // predicted, confidence }
  PREDICTED: "archetype:predicted",
} as const;

export type ArchetypeRoutingEventName =
  (typeof ARCHETYPE_ROUTING_EVENTS)[keyof typeof ARCHETYPE_ROUTING_EVENTS];

// ─── Lifecycle Gate SSE Event Names ─────────────────────────────────────────
//
// Centralized event-name constants for W27.5 lifecycle gate broadcasts emitted
// from lifecycle-service.ts, plus the Pass 7 evidence-completeness block event.
//
// All names follow the `lifecycle:{gate_name}` convention. Importing these
// constants instead of raw strings prevents silent magic-string drift when gate
// names need to change.
//
// Emission sites (stable function/method anchors — NOT line numbers):
//   WFE_EVALUATED            — evaluateWfeGate() call sites inside
//                               checkAndAdvanceLifecycleState() PAPER→DEPLOY_READY path
//   B14_EVALUATED            — evaluateB14CiGate() call sites in both the
//                               TESTING→PAPER and PAPER→DEPLOY_READY paths
//   PARAMETER_DRIFT_EVALUATED — evaluateParameterDriftGate() call sites in both paths
//   FROZEN_POLICY_DRIFT_BLOCKED — evaluateFrozenPolicyDriftAtPromotion() block path
//   COMPLIANCE_DRIFT_BLOCKED — findFirmsWithComplianceDrift() block path
//   BACKTEST_STALE           — stale-backtest staleness check block path
//   PROMOTION_EVIDENCE_INCOMPLETE — Track A.2 evidence-completeness gate block path
//
// Data shapes:
//   WFE_EVALUATED            { strategyId, wfe_overall, status, passed, correlation_id }
//   B14_EVALUATED            { strategyId, ci_high, threshold, passed, correlation_id }
//   PARAMETER_DRIFT_EVALUATED { strategyId, classification, confidence, passed, correlation_id }
//   FROZEN_POLICY_DRIFT_BLOCKED { strategyId, current_hash, frozen_hash, correlation_id }
//   COMPLIANCE_DRIFT_BLOCKED { strategyId, drift_firms, correlation_id }
//   BACKTEST_STALE           { strategyId, age_days, limit_days, correlation_id }
//   PROMOTION_EVIDENCE_INCOMPLETE { strategyId, incomplete_count, total_gates,
//                                   gate_evidence_statuses, correlation_id }
export const LIFECYCLE_GATE_EVENTS = {
  // W27.5 Pass B — WFE gate evaluated at PAPER → DEPLOY_READY
  WFE_EVALUATED: "lifecycle:wfe_evaluated",
  // W27.5 Pass B — B14 Survival Twin CI gate evaluated
  B14_EVALUATED: "lifecycle:b14_evaluated",
  // W27.5 Pass B — parameter drift gate evaluated at PAPER → DEPLOY_READY
  PARAMETER_DRIFT_EVALUATED: "lifecycle:parameter_drift_evaluated",
  // Wave 29 Pass B — frozen-policy hash drift gate blocked promotion
  FROZEN_POLICY_DRIFT_BLOCKED: "lifecycle:frozen_policy_drift_blocked",
  // PAPER → DEPLOY_READY — compliance ruleset drift gate blocked promotion
  COMPLIANCE_DRIFT_BLOCKED: "lifecycle:compliance_drift_blocked",
  // PAPER / TESTING → PAPER — backtest staleness gate blocked promotion
  BACKTEST_STALE: "lifecycle:backtest_stale",
  // Pass 7 Track A.2 — evidence completeness gate blocked promotion
  // (>= 3 of 8 tracked gates lack institutional-quality data)
  PROMOTION_EVIDENCE_INCOMPLETE: "lifecycle:promotion_evidence_incomplete",
  // Wave 3 Track 3B — BIF (Bias Information Factor) gate evaluated at PAPER → DEPLOY_READY
  BIF_EVALUATED: "lifecycle:bif_evaluated",
  // Wave A — Slippage-Survival gate evaluated at PAPER → DEPLOY_READY
  SLIPPAGE_SURVIVAL_EVALUATED: "lifecycle:slippage_survival_evaluated",
  // Auto-Graveyard: N consecutive hard gate failures → archived to GRAVEYARD
  // Payload: { strategyId, gate, consecutiveFailures, threshold, fromState, metrics, correlationId }
  AUTO_GRAVEYARD: "lifecycle:auto_graveyard",
  // PAPER → DEPLOY_READY blocked by evaluatePaperToDeployReadyGates composite gate
  // Payload: { strategyId, reason, passed: false }
  PAPER_TO_DEPLOY_READY_BLOCKED: "lifecycle:paper_to_deploy_ready_blocked",
  // SHADOW → PAPER blocked by shadow divergence gate
  // Payload: { strategyId, reason, passed: false }
  SHADOW_TO_PAPER_BLOCKED: "lifecycle:shadow_to_paper_blocked",
  // Strategy successfully promoted between lifecycle states (CANDIDATE→TESTING, TESTING→PAPER, SHADOW→PAPER, PAPER→DEPLOY_READY, PILOT→DEPLOYED, PILOT→GRAVEYARD)
  // Payload: { strategyId, from, to, name, ...transition-specific fields }
  PROMOTED: "lifecycle:promoted",
  // Deep-Scan #16 Wave 3 — portfolio-drift auto-demotion (DEPLOYED → DECLINING → TESTING)
  // fired when a DEPLOYED strategy's rolling_sharpe_30d falls below the floor.
  // Payload: { strategyId, strategyName, rollingSharpe30d, floor, from, to, correlationId }
  PORTFOLIO_DRIFT_DEMOTED: "lifecycle:portfolio_drift_demoted",
  // Deep-Scan #21 Band D (2026-07-05) — catalog-drift fix. 4 events broadcast
  // since their respective features shipped but never registered in this
  // catalog constant (dashboards/queries built against LIFECYCLE_GATE_EVENTS
  // silently missed them). Emission sites:
  //   DSL_GUARDS_EVALUATED         — lifecycle-service.ts evaluateDslGuardsGate() call sites
  //                                  (TESTING→PAPER, PAPER→DEPLOY_READY, + 3 cron sites)
  //   AUTO_CHECK                   — scheduler.ts lifecycle-auto-check cron summary broadcast
  //   GATE_EVALUATED                — scheduler.ts harsh-regime-phase hardening event
  //                                  (system-level entity, not strategy-specific)
  //   OPERATOR_ABSENT_AUTOPROMOTED  — operator-absent-mode-service.ts Tier-1 auto-promote
  DSL_GUARDS_EVALUATED: "lifecycle:dsl_guards_evaluated",
  AUTO_CHECK: "lifecycle:auto-check",
  GATE_EVALUATED: "lifecycle:gate_evaluated",
  OPERATOR_ABSENT_AUTOPROMOTED: "lifecycle:operator_absent_autopromoted",
} as const;

export type LifecycleGateEventName =
  (typeof LIFECYCLE_GATE_EVENTS)[keyof typeof LIFECYCLE_GATE_EVENTS];

// ─── Pass 3 Track D — Pine Export SHADOW refusal SSE events (2026-06-22) ──────
//
// Emitted by pine-shadow-observability.ts::emitPineShadowRefused() whenever a
// Pine export request is blocked because the strategy is in SHADOW lifecycle
// state or has shadow_mode_enabled=true.
//
// Consumer: Dashboard tiles subscribe to "pine:refused_shadow_strategy" to show
//   the SHADOW-refusal rate without querying audit_log.
//
// Payload shape:
//   {
//     strategy_id:          string  — strategy UUID from the strategies table
//     lifecycle_state:      string  — current lifecycle state (e.g. "SHADOW")
//     shadow_mode_enabled:  boolean — value of strategies.shadow_mode_enabled
//     blocked_at:           string  — call-site name enum (see below)
//     correlation_id:       string | null
//   }
//
// blocked_at closed enum (mirrors tf_pine_shadow_refusals_total label):
//   "compileDualPineExport"   — pine-export-service.ts compileDualPineExport() entry
//   "compilePineExport"       — pine-export-service.ts compilePineExport() entry
//   "recipient_build"         — pine-export-recipient-service.ts build path
//   "artifact_download"       — GET artifact-download route (pine-export.ts)
export const PINE_EVENTS = {
  // Pass 3 Track C calls emitPineShadowRefused() from the four refusal sites;
  // Track D (this file) registers the SSE constant so Track C can import it.
  REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy",
  // Deep-Scan #21 Band D (2026-07-05) — catalog-drift fix. Broadcast by
  // pine-export-service.ts (compileDualPineExport + compilePineExport) on
  // every export completion/failure. Was emitted since dual-export shipped
  // but never registered here.
  // EXPORT_COMPLETED payload: { strategyId, exportId, contentHash, exportabilityScore, durationMs }
  // EXPORT_FAILED payload:    { strategyId, errorCode, message, durationMs }
  EXPORT_COMPLETED: "pine:export-completed",
  EXPORT_FAILED: "pine:export-failed",
} as const;

export type PineEventName = (typeof PINE_EVENTS)[keyof typeof PINE_EVENTS];
