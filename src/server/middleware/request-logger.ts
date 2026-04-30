import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { httpRequestDurationMs } from "../lib/metrics-registry.js";

// ─── In-memory latency tracker ──────────────────────────────────
// Keeps last 1000 requests per endpoint for P50/P95/P99 calculations.
const WINDOW_SIZE = 1000;
const latencies: Record<string, number[]> = {};

function recordLatency(key: string, ms: number) {
  if (!latencies[key]) latencies[key] = [];
  latencies[key].push(ms);
  if (latencies[key].length > WINDOW_SIZE) latencies[key].shift();
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function getSloMetrics() {
  const result: Record<string, { p50: number; p95: number; p99: number; count: number; errorRate: number }> = {};
  for (const [key, values] of Object.entries(latencies)) {
    if (key.endsWith(":errors")) continue;
    const errorKey = `${key}:errors`;
    const errorCount = latencies[errorKey]?.length ?? 0;
    result[key] = {
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
      count: values.length,
      errorRate: values.length > 0 ? errorCount / values.length : 0,
    };
  }
  return result;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const path = req.route?.path
      ? `${req.method} ${req.baseUrl}${req.route.path}`
      : `${req.method} ${req.path}`;

    // Record latency (in-memory SLO tracker)
    recordLatency(path, durationMs);

    // Track errors separately (in-memory SLO tracker)
    if (res.statusCode >= 500) {
      recordLatency(`${path}:errors`, durationMs);
    }

    // Emit Prometheus histogram observation.
    // route uses req.route?.path to group parameterised routes (e.g. /api/strategies/:id).
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.path;
    httpRequestDurationMs
      .labels({ method: req.method, route, status_code: String(res.statusCode) })
      .observe(durationMs);

    // Log slow requests (> 5s) or errors
    if (durationMs > 5000 || res.statusCode >= 500) {
      // Use req.id (set by correlationMiddleware) instead of the stale req.requestId alias
      logger.warn({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
        requestId: (req as any).id,
      }, `Slow/error request: ${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`);
    }
  });
  next();
}
