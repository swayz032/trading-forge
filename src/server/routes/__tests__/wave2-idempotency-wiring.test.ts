/**
 * Wave 2 Track 2A — idempotency wiring verification.
 *
 * The Strategy Deep Analysis Pipeline + Slumdawg gateway webhooks can
 * double-fire (n8n / caller retry) and create duplicate matrix runs, MC runs,
 * and YouTube ingestions. The fix sends an X-Idempotency-Key header from n8n
 * AND wires `idempotencyMiddleware` onto the specific backend write routes
 * those webhooks hit which previously lacked it:
 *   - POST /api/backtests/matrix
 *   - POST /api/monte-carlo/
 *   - POST /api/admin/slumdawg/ingest-youtube
 *
 * The middleware's behaviour (fail-open on no-key, dedupe on repeat) is
 * covered by middleware/idempotency.test.ts. This test asserts the WIRING:
 * each target route registers a handler named `idempotencyMiddleware` ahead
 * of its body handler. Fail-open is structural — the middleware calls next()
 * when no key is present — so wiring it can never block a legitimate call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Slumdawg's router-level requireSlumdawgAuth gate + ingest handler pull in
// heavy/secret-bound deps; stub the leaf modules so the router imports cleanly
// in a unit context. We only inspect the Express layer stack, never execute.
vi.mock("../../db/index.js", () => ({
  db: { execute: () => Promise.resolve({ rows: [] }) },
}));
vi.mock("../../slumdawg-hmac.js", () => ({
  isUnconfiguredSlumdawgSecret: () => true,
  verifySlumdawgHmac: () => false,
}));
// backtests.js → sse.js → ../index.js is the full Express bootstrap (runs
// migrations + app.listen at module load). Stub ../index.js so the unit
// import only resolves the `logger` symbol and never boots the server.
const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};
vi.mock("../../index.js", () => ({ logger: noopLogger }));

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name: string }>;
  };
};

function routeHandlerNames(router: { stack: Layer[] }, method: string, path: string): string[] {
  const layer = router.stack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method] === true,
  );
  if (!layer || !layer.route) {
    throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack.map((s) => s.name);
}

describe("Wave 2 Track 2A — idempotency middleware wiring", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /matrix on backtestRoutes is guarded by idempotencyMiddleware", async () => {
    const { backtestRoutes } = await import("../backtests.js");
    expect(routeHandlerNames(backtestRoutes as any, "post", "/matrix")).toContain(
      "idempotencyMiddleware",
    );
  });

  it("POST / on monteCarloRoutes is guarded by idempotencyMiddleware", async () => {
    const { monteCarloRoutes } = await import("../monte-carlo.js");
    expect(routeHandlerNames(monteCarloRoutes as any, "post", "/")).toContain(
      "idempotencyMiddleware",
    );
  });

  it("POST /ingest-youtube on slumdawgRoutes is guarded by idempotencyMiddleware", async () => {
    const { slumdawgRoutes } = await import("../slumdawg.js");
    expect(routeHandlerNames(slumdawgRoutes as any, "post", "/ingest-youtube")).toContain(
      "idempotencyMiddleware",
    );
  });
});
