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
// Stores { seq, event, data } so missed events can be replayed on reconnect.
const RING_BUFFER_SIZE = 100;
interface BufferedEvent {
  seq: number;
  event: string;
  data: unknown;
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

  if (!isNaN(lastSeenSeq) && ringBuffer.length > 0) {
    const missed = ringBuffer.filter((e) => e.seq > lastSeenSeq);
    for (const entry of missed) {
      res.write(`id: ${entry.seq}\nevent: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`);
    }
    if (missed.length > 0) {
      logger.info(
        { lastSeenSeq, replayed: missed.length },
        "SSE replay: delivered missed events to reconnecting client",
      );
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
  pushToRingBuffer({ seq, event, data });

  const message = `id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
