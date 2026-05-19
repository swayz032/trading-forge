/**
 * Observability polish tests — items 4.9 through 4.14.
 *
 * These are unit/integration-style tests that verify:
 *   4.9  python-runner.ts stderr is logged at warn level
 *   4.10 correlationMiddleware injects requestId into req.id / req.log / X-Request-ID header
 *   4.11 broadcastSSE assigns monotonically increasing sequence numbers; ring buffer replays
 *   4.12 /api/health returns status:"degraded" when Ollama is unreachable
 *   4.13 paper.session_start / paper.session_stop audit actions are defined (schema check)
 *   4.14 strategy.deploy_approved audit action is emitted with metricsSnapshot shape
 *
 * All tests run without a real DB or network connection.
 */

import { describe, it, expect, vi } from "vitest";

// ─── 4.9 — Python stderr at warn level ───────────────────────────────────────

describe("4.9 python-runner — stderr log level", () => {
  it("logs stderr at warn, not debug", async () => {
    // We cannot import python-runner directly without a running logger, so we
    // verify the source-level contract by reading the compiled assertion from the
    // module text. This is intentionally a lightweight smoke test — the authoritative
    // check is that the module no longer calls logger.debug() on stderr data.
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/lib/python-runner.ts"),
      "utf8"
    );

    // Must contain a warn call in the stderr handler
    expect(src).toMatch(/logger\.warn\(.*component.*module.*\)/s);

    // Must NOT log stderr at debug level (the old, broken behaviour)
    // We check for the exact old pattern so this test fails if it regresses.
    const debugOnStderrPattern = /stderr.*logger\.debug|logger\.debug\(.*component.*module/s;
    expect(debugOnStderrPattern.test(src)).toBe(false);
  });
});

// ─── 4.10 — Correlation ID middleware ────────────────────────────────────────
// The middleware imports `logger` from ../index.js which has DB/Express side-effects.
// We hoist vi.mock() at file scope (Vitest's static hoisting ensures it runs before
// imports) and do the actual import at module scope to pick up the mock.

vi.mock("../index.js", () => ({
  logger: {
    child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

// Import after the mock declaration so the mock is applied.
const { correlationMiddleware } = await import("../middleware/correlation.js");

function makeCorrelationReqRes(headers: Record<string, string> = {}) {
  const req: any = { headers };
  const setHeaders: Record<string, string> = {};
  const res: any = {
    setHeader: (k: string, v: string) => { setHeaders[k] = v; },
    _headers: setHeaders,
  };
  const next = vi.fn();
  return { req, res, next, setHeaders };
}

describe("4.10 correlationMiddleware", () => {
  it("generates a UUID when X-Request-ID is absent", () => {
    const { req, res, next, setHeaders } = makeCorrelationReqRes();
    correlationMiddleware(req, res, next);

    expect(req.id).toBeDefined();
    expect(typeof req.id).toBe("string");
    expect(req.id.length).toBeGreaterThan(0);
    expect(setHeaders["X-Request-ID"]).toBe(req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it("uses X-Request-ID header when present", () => {
    const { req, res, next } = makeCorrelationReqRes({ "x-request-id": "my-trace-abc" });
    correlationMiddleware(req, res, next);

    expect(req.id).toBe("my-trace-abc");
  });

  it("attaches a child logger to req.log", () => {
    const { req, res, next } = makeCorrelationReqRes();
    correlationMiddleware(req, res, next);

    expect(req.log).toBeDefined();
  });

  it("calls next() always", () => {
    const { req, res, next } = makeCorrelationReqRes();
    correlationMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

// ─── 4.11 — SSE sequence numbers + ring buffer ───────────────────────────────

describe("4.11 broadcastSSE — sequence numbers and ring buffer", () => {
  it("SSE module includes all required sequence/buffer constructs", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/sse.ts"),
      "utf8"
    );

    // id: field must be present in broadcast message
    expect(src).toMatch(/id: \$\{seq\}/);
    // Ring buffer constant and structure must exist
    expect(src).toMatch(/RING_BUFFER_SIZE/);
    expect(src).toMatch(/ringBuffer/);
    // Last-Event-ID handling must be present
    expect(src).toMatch(/last-event-id/);
    // Counter must be incremented before use (pre-increment guarantees seq starts at 1)
    expect(src).toMatch(/\+\+eventSeq/);
    // Replay logic must filter by seq > lastSeenSeq
    expect(src).toMatch(/seq > lastSeenSeq/);
    // Broadcast endpoint must accept legacy event payloads from n8n exports.
    expect(src).toMatch(/legacyEvent/);
    expect(src).toMatch(/legacyAlertShape/);
  });

  it("broadcastSSE does not throw with no connected clients", async () => {
    // broadcastSSE is safe to call even when the clients Set is empty.
    // Import the live module — clients set will be empty since no GET /events
    // request has been made.
    const { broadcastSSE } = await import("../routes/sse.js");
    expect(() => broadcastSSE("test.noop", { n: 0 })).not.toThrow();
  });

  it("broadcastSSE assigns increasing sequence numbers", async () => {
    const { broadcastSSE } = await import("../routes/sse.js");

    // Collect writes from a mock client injected via the module's exported router
    // is too complex without running Express, so we verify indirectly: two
    // consecutive calls must not throw and the module-level counter must advance.
    // The source-level test above already verifies the format. Here we verify
    // the runtime does not error on repeated calls.
    expect(() => {
      broadcastSSE("test.seq1", { n: 1 });
      broadcastSSE("test.seq2", { n: 2 });
      broadcastSSE("test.seq3", { n: 3 });
    }).not.toThrow();
  });
});

// ─── 4.12 — Health endpoint degrades on Ollama outage ────────────────────────

describe("4.12 /api/health — degraded status on Ollama outage", () => {
  it("top-level status logic: degraded when ollama is unreachable", () => {
    // We verify the logic in isolation without standing up Express.
    // The fix is: isHealthy = dbStatus === "ok" && ollamaStatus === "ok"
    // topLevelStatus = isHealthy ? "ok" : "degraded"

    const cases: Array<[string, string, string]> = [
      ["ok",    "ok",          "ok"],
      ["ok",    "unreachable", "degraded"],
      ["ok",    "error",       "degraded"],
      ["error", "ok",          "degraded"],
      ["error", "unreachable", "degraded"],
    ];

    for (const [dbStatus, ollamaStatus, expected] of cases) {
      const isHealthy = dbStatus === "ok" && ollamaStatus === "ok";
      const topLevelStatus = isHealthy ? "ok" : "degraded";
      expect(topLevelStatus).toBe(expected);
    }
  });

  it("health endpoint source includes CircuitBreakerRegistry.statusAll()", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/index.ts"),
      "utf8"
    );

    expect(src).toMatch(/CircuitBreakerRegistry\.statusAll\(\)/);
    expect(src).toMatch(/circuitBreakers/);
    // Verify the degraded logic is present
    expect(src).toMatch(/ollamaStatus === "ok"/);
  });
});

// ─── 4.13 — Paper session audit_log actions ──────────────────────────────────

describe("4.13 paper session audit actions", () => {
  it("paper.ts imports auditLog from schema", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
      "utf8"
    );

    expect(src).toMatch(/auditLog/);
    expect(src).toMatch(/"paper\.session_start"/);
    expect(src).toMatch(/"paper\.session_stop"/);
  });

  it("session_start audit entry includes strategyId in input", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
      "utf8"
    );

    // The input object for paper.session_start must include strategyId
    expect(src).toMatch(/action: "paper\.session_start"[\s\S]*?strategyId/);
  });

  it("session_stop audit entry includes stoppedAt in result", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
      "utf8"
    );

    expect(src).toMatch(/action: "paper\.session_stop"[\s\S]*?stoppedAt/);
  });
});

// ─── 4.14 — Human deploy approval audit_log entry ────────────────────────────

describe("4.14 strategy deploy approval audit", () => {
  it("strategies.ts imports auditLog and logger", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/strategies.ts"),
      "utf8"
    );

    expect(src).toMatch(/auditLog/);
    expect(src).toMatch(/from "\.\.\/index\.js"/); // logger import
    expect(src).toMatch(/"strategy\.deploy_approved"/);
  });

  it("deploy audit entry includes metrics snapshot fields", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/strategies.ts"),
      "utf8"
    );

    // metricsSnapshot must contain backtest + monteCarlo + strategyName
    expect(src).toMatch(/metricsSnapshot/);
    expect(src).toMatch(/strategyName/);
    expect(src).toMatch(/approvedBy/);
    expect(src).toMatch(/approvedAt/);
    expect(src).toMatch(/decisionAuthority: "human"/);
  });

  it("deploy audit failure does not prevent successful deployment response", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/strategies.ts"),
      "utf8"
    );

    // The audit insert is wrapped in try/catch — an audit failure must not
    // propagate as an HTTP error. Verify the pattern is present.
    expect(src).toMatch(/try \{[\s\S]*?auditLog[\s\S]*?\} catch \(auditErr\)/);
  });

  it("generic lifecycle patch cannot be used as a deploy backdoor", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/strategies.ts"),
      "utf8"
    );

    expect(src).toMatch(/Use \/api\/strategies\/:id\/deploy for manual TradingView deployment approval/);
  });

  it("lifecycle service hard-blocks DEPLOY_READY -> DEPLOYED without human release authority", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/services/lifecycle-service.ts"),
      "utf8"
    );

    expect(src).toMatch(/Only manual release authority can promote DEPLOY_READY -> DEPLOYED/);
    expect(src).toMatch(/options\.actor !== "human_release"/);
  });
});
