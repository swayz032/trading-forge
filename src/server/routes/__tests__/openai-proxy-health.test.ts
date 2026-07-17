/**
 * openai-proxy-health.test.ts — 2026-07-17 liveness audit fix
 *
 * GET /api/openai-proxy/health previously hardcoded `status: "ok"`, ignoring
 * the real CircuitBreakerRegistry state the SAME file reads ~39 lines below
 * for the actual chat-completions call path (`cb.currentState === "OPEN"` at
 * openai-proxy.ts:229). That is the "manufactures a verdict true by
 * construction" pattern this project hardens against everywhere else: an
 * operator or automated health check hitting /health while the breaker is
 * OPEN would see "ok" even though every real proxied call is failing fast
 * with 503.
 *
 * This route has no live callers per the liveness audit, but the fix is
 * cheap and correctness-neutral (no business-logic change — /health always
 * derives its answer from the real breaker; it just no longer lies).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { openaiProxyRoutes } from "../openai-proxy.js";
import { CircuitBreakerRegistry } from "../../lib/circuit-breaker.js";

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: unknown, res: unknown) => unknown }>;
  };
};

function getHandler(
  router: { stack: RouteLayer[] },
  method: string,
  path: string,
): (req: unknown, res: unknown) => unknown {
  const layer = router.stack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method] === true,
  );
  if (!layer?.route) {
    throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: (code: number) => typeof res;
    json: (body: unknown) => typeof res;
  } = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe("GET /api/openai-proxy/health — derives status from real CircuitBreakerRegistry state", () => {
  beforeEach(() => {
    CircuitBreakerRegistry._resetForTests();
  });

  it("happy path: fresh process reports status ok + a real CLOSED breaker snapshot", () => {
    const handler = getHandler(openaiProxyRoutes as unknown as { stack: RouteLayer[] }, "get", "/health");
    const res = makeRes();

    handler({}, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("openai-proxy");
    expect(body.circuitBreaker).toBeDefined();
    expect((body.circuitBreaker as { state: string }).state).toBe("CLOSED");
  });

  it("reflects an OPEN (tripped) breaker instead of hardcoding ok — the regression this fix closes", async () => {
    // Trip the SAME registry key ("openai-proxy") the /v1/chat/completions
    // handler calls through — this is the exact real-world scenario where the
    // old hardcoded handler would have lied.
    const cb = CircuitBreakerRegistry.get("openai-proxy", { failureThreshold: 1, cooldownMs: 30_000 });
    await expect(cb.call(() => Promise.reject(new Error("upstream boom")))).rejects.toThrow();
    expect(cb.currentState).toBe("OPEN");

    const handler = getHandler(openaiProxyRoutes as unknown as { stack: RouteLayer[] }, "get", "/health");
    const res = makeRes();

    handler({}, res);

    expect(res.statusCode).toBe(503);
    const body = res.body as Record<string, unknown>;
    expect(body.status).not.toBe("ok");
    expect(body.status).toBe("unavailable");
    expect((body.circuitBreaker as { state: string }).state).toBe("OPEN");
  });
});
