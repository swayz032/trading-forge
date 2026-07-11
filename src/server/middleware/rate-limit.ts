import { Request, Response, NextFunction } from "express";
import { logger } from "../index.js";
import { resolveTrustedClientIp } from "../lib/relay-client-ip.js";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(config: RateLimitConfig = { windowMs: 60_000, maxRequests: 100 }) {
  return (req: Request, res: Response, next: NextFunction) => {
    // deep-scan fix-wave 2026-07-10 (Fix 3): req.ip resolves to the Express-observed
    // socket peer, which for ALL relay-forwarded traffic is loopback (tower-relay-client
    // reissues every request as a fresh local http.request() to localhost:4000) — so
    // every external caller collapsed into one shared 127.0.0.1 bucket. Same root cause
    // as Fix 2; same fix — key on the relay-minted non-spoofable header, real socket for
    // direct/LAN callers. See src/server/lib/relay-client-ip.ts.
    const key = resolveTrustedClientIp(req);
    const now = Date.now();
    const record = hits.get(key);

    if (!record || now > record.resetAt) {
      hits.set(key, { count: 1, resetAt: now + config.windowMs });
      return next();
    }

    record.count++;
    if (record.count > config.maxRequests) {
      // 2026-07-11 P0 storm forensics: a silent in-process client hit 429 at ~150 req/s,
      // flooding this log (~13M lines/day) and exhausting the ephemeral port pool with
      // zero path attribution. Log the FIRST rejection per window + every 500th, and
      // carry path/method/UA so the offending caller is identifiable from the log alone.
      const overage = record.count - config.maxRequests;
      if (overage === 1 || overage % 500 === 0) {
        logger.warn(
          {
            ip: key,
            count: record.count,
            maxRequests: config.maxRequests,
            method: req.method,
            path: req.originalUrl?.slice(0, 200),
            userAgent: req.headers["user-agent"]?.slice(0, 120),
            correlationId: req.headers["x-correlation-id"],
          },
          "Rate limit exceeded",
        );
      }
      // Retry-After: seconds until the window resets — required by RFC 6585 §4
      // and consumed by automated callers (n8n, agent loops) to back off correctly.
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfterSec);
      res.status(429).json({ error: "Too many requests. Try again later.", retryAfterSec });
      return;
    }

    next();
  };
}

// Stricter rate limit for mutation endpoints
export const strictRateLimit = rateLimit({ windowMs: 60_000, maxRequests: 30 });
// Standard rate limit for read endpoints
export const standardRateLimit = rateLimit({ windowMs: 60_000, maxRequests: 200 });

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of hits) {
    if (now > record.resetAt) hits.delete(key);
  }
}, 300_000);
