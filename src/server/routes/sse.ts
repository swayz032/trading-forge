import { Router, Request, Response } from "express";
import { logger } from "../index.js";

const router = Router();

// Connected SSE clients
const clients: Set<Response> = new Set();

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

  req.on("close", () => {
    clients.delete(res);
    logger.info(`SSE client disconnected (${clients.size} total)`);
  });
});

// Helper to broadcast events from anywhere in the app
export function broadcastSSE(event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

export { router as sseRoutes };
