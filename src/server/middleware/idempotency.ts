import { Request, Response, NextFunction } from "express";
import { db } from "../db/index.js";
import { idempotencyKeys } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Idempotency middleware for POST/PATCH endpoints.
 * If request has an Idempotency-Key header:
 *   - Existing key with cached response → return cached response immediately
 *   - New key → process request, cache response for 24h
 * If no header → process normally (no caching)
 *
 * Header naming: `x-idempotency-key` is the canonical name (matches CLAUDE.md
 * and PRODUCTION-HARDENING.md Wave 3 #14). The non-prefixed `idempotency-key`
 * variant is also accepted for backwards compatibility with existing callers
 * (n8n workflows, dashboard, external clients) that adopted the unprefixed
 * header before the canonical name was finalized. Either header form is
 * treated identically; if both are sent the canonical `x-idempotency-key`
 * wins.
 */
export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // P1-2: dual-read header. Prefer canonical `x-idempotency-key`; fall back
  // to legacy `idempotency-key` for backwards compatibility.
  const headerCanonical = req.headers["x-idempotency-key"];
  const headerLegacy = req.headers["idempotency-key"];
  const key = (headerCanonical || headerLegacy) as string | undefined;

  if (!key || (req.method !== "POST" && req.method !== "PATCH")) {
    next();
    return;
  }

  // Check for existing cached response
  db.select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1)
    .then(([existing]) => {
      if (existing) {
        // Check TTL — 24h
        const ageMs = Date.now() - existing.createdAt.getTime();
        if (ageMs < 24 * 60 * 60 * 1000) {
          logger.info({ key: key.slice(0, 8) }, "Idempotency cache hit — returning cached response");
          res.status(existing.responseStatus).json(existing.responseBody);
          return;
        }
        // Expired — delete and proceed
        db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key)).catch(() => {});
      }

      // Intercept response to cache it
      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        // Only cache successful responses (2xx)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          db.insert(idempotencyKeys)
            .values({
              key,
              responseStatus: res.statusCode,
              responseBody: body as Record<string, unknown>,
            })
            .onConflictDoNothing()
            .catch((err) => {
              logger.warn({ err, key: key.slice(0, 8) }, "Failed to cache idempotency response");
            });
        }
        return originalJson(body);
      };

      next();
    })
    .catch((err) => {
      // DB error — proceed without idempotency (graceful degradation)
      logger.warn({ err }, "Idempotency check failed — proceeding without cache");
      next();
    });
}
