import type { Logger as PinoLogger } from "pino";

/**
 * Module augmentation for Express.Request.
 *
 * Adds `req.id` and `req.log` so every route handler can use them
 * without fragile `(req as typeof req & { log?: ... })` casts.
 *
 * These fields are populated by correlationMiddleware (src/server/middleware/correlation.ts):
 *   - req.id  — UUID from X-Request-ID header or generated; echoed in X-Request-ID response header
 *   - req.log — pino child logger bound with { requestId: req.id }
 *
 * requestId is kept as a legacy alias; prefer req.id in new code.
 */
declare global {
  namespace Express {
    interface Request {
      id?: string;
      requestId?: string; // legacy alias — prefer req.id
      log: PinoLogger;
    }
  }
}
