import { Router, Request, Response } from "express";
import { logger } from "../index.js";

const router = Router();

// Connected SSE clients
const clients: Set<Response> = new Set();

// SSE heartbeat — keeps connections alive through proxies and detects dead clients
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

// GET /api/sse/events — SSE stream
router.get("/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write("data: {\"type\":\"connected\"}\n\n");
  clients.add(res);
  logger.info(`SSE client connected (${clients.size} total)`);

  // Detect dead clients via error event (write() doesn't throw synchronously)
  res.on("error", () => {
    clients.delete(res);
  });

  req.on("close", () => {
    clients.delete(res);
    logger.info(`SSE client disconnected (${clients.size} total)`);
  });
});

// Helper to broadcast events from anywhere in the app
export function broadcastSSE(event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.writableEnded || client.destroyed) {
      clients.delete(client);
      continue;
    }
    client.write(message);
  }
}

// POST /api/sse/broadcast — broadcast event to all connected SSE clients (used by n8n)
router.post("/broadcast", (req: Request, res: Response) => {
  const { type, data } = req.body;
  if (!type || typeof type !== "string") {
    res.status(400).json({ error: "type is required and must be a string" });
    return;
  }
  broadcastSSE(type, data ?? {});
  logger.info({ type, clientCount: clients.size }, "SSE broadcast sent");
  res.json({ ok: true, clientCount: clients.size });
});

export { router as sseRoutes };
