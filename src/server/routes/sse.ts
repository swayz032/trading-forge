import { Router, Request, Response } from "express";
import { logger } from "../index.js";

const router = Router();

// ─── Connected clients ────────────────────────────────────────
const clients: Set<Response> = new Set();

// ─── Event sequence counter ───────────────────────────────────
// Monotonically increasing integer attached to every SSE event.
// Clients that reconnect with `Last-Event-ID` will receive any buffered
// events with seq > lastEventId before resuming live delivery.
let eventSeq = 0;

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
setInterval(() => {
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
  // EventSource sets `Last-Event-ID` header to the last `id:` it received.
  const lastEventIdHeader = req.headers["last-event-id"];
  const lastSeenSeq = lastEventIdHeader ? parseInt(String(lastEventIdHeader), 10) : NaN;

  if (!isNaN(lastSeenSeq) && lastSeenSeq > 0) {
    // Detect replay gap: buffer is empty OR the oldest buffered seq does not cover
    // the client's last-seen position. In either case we cannot guarantee continuity.
    const bufferEmpty = ringBuffer.length === 0;
    const oldestSeq   = bufferEmpty ? -1 : ringBuffer[0].seq;
    const hasGap      = bufferEmpty || oldestSeq > lastSeenSeq + 1;

    if (hasGap) {
      // H-6: Signal replay gap so the frontend can refetch authoritative state
      // instead of assuming the SSE stream is continuous.
      const gapPayload = JSON.stringify({
        lastSeenSeq,
        currentSeq: eventSeq,
        message: "replay_buffer_does_not_cover_gap",
      });
      res.write(`id: 0\nevent: sse:replay_gap\ndata: ${gapPayload}\n\n`);
      logger.warn(
        { lastSeenSeq, currentSeq: eventSeq, oldestBufferedSeq: oldestSeq, bufferEmpty },
        "SSE replay: gap detected — client must refetch state",
      );
    } else {
      // Buffer covers the gap — replay only the missed events.
      const missed = ringBuffer.filter((e) => e.seq > lastSeenSeq);
      for (const entry of missed) {
        // F-10: serialized form already in buffer — no JSON.stringify on replay.
        res.write(`id: ${entry.seq}\nevent: ${entry.event}\ndata: ${entry.serialized}\n\n`);
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
  logger.info(`SSE client connected (${clients.size} total)`);

  res.on("error", () => {
    clients.delete(res);
  });

  req.on("close", () => {
    clients.delete(res);
    logger.info(`SSE client disconnected (${clients.size} total)`);
  });
});

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
    const errorMessage = `id: ${seq}\nevent: sse_serialize_error\ndata: ${errorPayload}\n\n`;
    for (const client of clients) {
      if (client.writableEnded || client.destroyed) continue;
      try { client.write(errorMessage); } catch { /* dead client — ignore */ }
    }
    return;
  }

  pushToRingBuffer({ seq, event, serialized });

  const message = `id: ${seq}\nevent: ${event}\ndata: ${serialized}\n\n`;
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
// Emission sites (as of Wave 29 Pass A + B + C close):
//   SHADOW_LOGGED             — paper-signal-service.ts:4375   (Pass A.1)
//   PBO_EVALUATED             — lifecycle-service.ts:940/965   (Pass A.2)
//   SHADOW_DIVERGENCE_EVALUATED — lifecycle-service.ts:2049/2088 (Pass A.3)
//   RL_AB_ROUTED              — paper-signal-service.ts:4520   (Pass C.3)
//   RL_TRAINING_COMPLETED     — quantum-rl-training-runner.ts post-completion callers
//   RL_KILL_SWITCH_ENGAGED    — rl-signal-fetcher.ts kill-switch path callers
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
} as const;

export type PineEventName = (typeof PINE_EVENTS)[keyof typeof PINE_EVENTS];
