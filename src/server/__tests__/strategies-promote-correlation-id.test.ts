/**
 * strategies-promote-correlation-id.test.ts — F-1 (2026-06-29)
 *
 * Human-triggered promotions (PATCH /:id/lifecycle, POST /:id/deploy) must forward
 * the inbound HTTP request's correlationId (req.id) into promoteStrategy() so every
 * gate audit row written under the promotion links back to the request. Previously
 * the calls omitted it, leaving human promotions forensically untraceable.
 *
 * Behavioral test: mount the real strategyRoutes router, spy on
 * LifecycleService.promoteStrategy, and assert it receives correlationId: req.id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createHmac } from "crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "http";

// ─── Constants ────────────────────────────────────────────────────────────────

const ADMIN_SECRET = "admin-promote-hmac-secret-must-be-long-enough-32!!";
const STRATEGY_ID = "cccc0000-0000-0000-0000-000000000001";
const TEST_CID = "dddd0000-0000-0000-0000-000000000099";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  promoteStrategy: vi.fn(),
  checkAutoPromotions: vi.fn(),
  checkAutoDemotions: vi.fn(),
  checkPilotAutoPromotions: vi.fn(),
  broadcastSSE: vi.fn(),
  isPipelineActive: vi.fn(),
  assertCrossValidatedSource: vi.fn(),
  insertAuditRowSafe: vi.fn(),
}));

// ─── Module mocks (keep the heavy strategies.ts import graph inert) ──────────

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db/index.js", () => ({ db: {} }));

// schema named imports are only used in DB query builders we never reach here
vi.mock("../db/schema.js", () => ({}));

vi.mock("./sse.js", () => ({ broadcastSSE: mocks.broadcastSSE }));

vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    promoteStrategy = mocks.promoteStrategy;
    checkAutoPromotions = mocks.checkAutoPromotions;
    checkAutoDemotions = mocks.checkAutoDemotions;
    checkPilotAutoPromotions = mocks.checkPilotAutoPromotions;
  },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: mocks.isPipelineActive,
}));

vi.mock("../services/agent-service.js", () => ({
  assertCrossValidatedSource: mocks.assertCrossValidatedSource,
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mocks.insertAuditRowSafe,
}));

// ─── Lazy import (after mocks are wired) ─────────────────────────────────────

const { strategyRoutes } = await import("../routes/strategies.js");

// ─── Test helpers ─────────────────────────────────────────────────────────────

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Stand in for the production correlation-id middleware that sets req.id.
  app.use((req, _res, next) => {
    (req as unknown as { id: string }).id = TEST_CID;
    next();
  });
  app.use("/api/strategies", strategyRoutes);
  return app;
}

async function patchLifecycle(
  app: express.Express,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown>; server: Server }> {
  return await new Promise((resolve_, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/strategies/${STRATEGY_ID}/lifecycle`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const responseBody = (await res.json()) as Record<string, unknown>;
        resolve_({ status: res.status, body: responseBody, server });
      } catch (err) {
        reject(err);
      }
    });
    server.on("error", reject);
  });
}

function signLifecycle(timestamp: number, fromState: string, toState: string): string {
  const payload = `${timestamp}:${STRATEGY_ID}:${fromState}:${toState}`;
  return createHmac("sha256", ADMIN_SECRET).update(payload, "utf8").digest("hex");
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("F-1 — human promotions forward req.id correlationId into promoteStrategy", () => {
  let server: Server | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PROMOTE_HMAC_SECRET = ADMIN_SECRET;
    mocks.promoteStrategy.mockResolvedValue({ success: true });
    mocks.isPipelineActive.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.ADMIN_PROMOTE_HMAC_SECRET;
    if (server) {
      server.close();
      server = null;
    }
  });

  it("PATCH /:id/lifecycle forwards correlationId: req.id into promoteStrategy", async () => {
    const fromState = "PAPER";
    const toState = "DEPLOY_READY";
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signLifecycle(timestamp, fromState, toState);

    const app = buildApp();
    const res = await patchLifecycle(app, { fromState, toState, timestamp, signature });
    server = res.server;

    expect(res.status).toBe(200);
    expect(mocks.promoteStrategy).toHaveBeenCalledOnce();
    expect(mocks.promoteStrategy).toHaveBeenCalledWith(
      STRATEGY_ID,
      fromState,
      toState,
      expect.objectContaining({ correlationId: TEST_CID }),
    );
  });

  it("source: POST /:id/deploy call site passes correlationId: req.id", () => {
    // The deploy route's promote call is heavy (db snapshot + dynamic pine-export
    // import); a source assertion confirms the correlationId thread without the
    // full mock graph. The behavioral test above proves the threading works.
    const src = readFileSync(resolve(process.cwd(), "src/server/routes/strategies.ts"), "utf8");
    const reasonIdx = src.indexOf("manual_tradingview_deployment_approval");
    expect(reasonIdx).toBeGreaterThan(-1);
    // The correlationId is threaded in the same options object, a few lines below.
    const deployBlock = src.slice(reasonIdx, reasonIdx + 300);
    expect(deployBlock).toContain("correlationId: req.id");
  });
});
