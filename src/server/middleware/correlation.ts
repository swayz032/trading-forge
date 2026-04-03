import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import { logger as rootLogger } from "../index.js";

/**
 * Correlation ID middleware.
 *
 * - Reads `X-Request-ID` header if present; otherwise generates a UUID v4.
 * - Attaches the ID to `req.id` for downstream use.
 * - Creates a child pino logger with `{ requestId }` bound and attaches it to `req.log`.
 * - Echoes the resolved ID back in the `X-Request-ID` response header so callers
 *   can link their own logs to the server-side trace.
 *
 * Usage in route handlers:
 *   req.log.info({ strategyId }, "Running backtest");
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId =
    (req.headers["x-request-id"] as string | undefined)?.trim() ||
    randomUUID();

  // Make requestId accessible on req for any code that needs the raw string
  (req as Request & { id: string }).id = requestId;

  // Attach a child logger so every log line from this request carries requestId
  (req as Request & { log: Logger }).log = rootLogger.child({ requestId });

  // Echo the ID back so clients can correlate their own logs
  res.setHeader("X-Request-ID", requestId);

  next();
}
