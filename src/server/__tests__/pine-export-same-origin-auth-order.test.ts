/**
 * pine-export-same-origin-auth-order.test.ts — CRIT/HIGH (security-auth-hardening
 * 2026-07-17): dead auth-ordering in pine-export.ts.
 *
 * pine-export.ts mounts `requireOperatorApiKey` as a blanket router-level
 * `.use()` BEFORE any route is registered (see the module docstring at the
 * top of pine-export.ts). The download route additionally lists
 * `injectApiKeyForSameOriginBrowser` as route-specific middleware, with an
 * inline comment claiming it "injects OPERATOR_API_KEY for browser-originated
 * requests before requireOperatorApiKey validates" (A3, Pass 3 Track A).
 *
 * That claim was FALSE by construction: Express executes middleware in
 * registration order regardless of `.use()` vs per-route registration. Since
 * `requireOperatorApiKey` was registered via `.use()` BEFORE the download
 * route was ever defined, it always runs FIRST for every request on this
 * router — including the download route — and `injectApiKeyForSameOriginBrowser`
 * never gets a chance to inject anything: a legitimate same-origin browser
 * request with no Authorization header is already rejected 401 before the
 * injection middleware runs. The entire A3 same-origin proxy feature was
 * dead code.
 *
 * This test mounts the REAL `pineExportRoutes` router (no route-level
 * reimplementation) and issues a real HTTP request matching the exact
 * same-origin-browser scenario the injection middleware exists for: matching
 * Origin header, NO Authorization header, valid OPERATOR_API_KEY configured
 * server-side. Pre-fix this returns 401 (bug); post-fix it must NOT return
 * 401 (the injected key lets it reach the real handler / DB-backed 404).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";

const FRONTEND_ORIGIN = "https://app.example-tf.test";
const OPERATOR_API_KEY = "operator-api-key-at-least-16-chars";

const mocks = vi.hoisted(() => ({
  getExport: vi.fn(),
  getExportArtifacts: vi.fn(),
  getArtifact: vi.fn(),
  compilePineExport: vi.fn(),
  compileDualPineExport: vi.fn(),
  dbInsert: vi.fn(),
  assertNotShadow: vi.fn(),
  emitPineShadowRefused: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../services/pine-export-service.js", () => ({
  compilePineExport: mocks.compilePineExport,
  compileDualPineExport: mocks.compileDualPineExport,
  getExport: mocks.getExport,
  getExportArtifacts: mocks.getExportArtifacts,
  getArtifact: mocks.getArtifact,
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({ values: mocks.dbInsert }),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: Symbol("auditLog_mock"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/pine-export-shadow-guard.js", () => ({
  assertNotShadow: mocks.assertNotShadow,
  PineExportShadowError: class PineExportShadowError extends Error {},
}));

vi.mock("../lib/pine-shadow-observability.js", () => ({
  emitPineShadowRefused: mocks.emitPineShadowRefused,
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: mocks.notifyWarning,
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (msg: string) => msg,
}));

const { pineExportRoutes } = await import("../routes/pine-export.js");

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/pine-export", pineExportRoutes);
  return app;
}

async function getDownload(
  app: express.Express,
  headers: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown>; server: Server }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(
          `http://127.0.0.1:${port}/api/pine-export/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/artifacts/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/download`,
          { headers },
        );
        const responseBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        resolve({ status: res.status, body: responseBody, server });
      } catch (err) {
        reject(err);
      }
    });
    server.on("error", reject);
  });
}

describe("pine-export.ts same-origin auth-ordering (CRIT/HIGH security-auth-hardening 2026-07-17)", () => {
  let servers: Server[] = [];
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    servers = [];
    process.env.NODE_ENV = "production"; // disable dev auto-key path; force real gate
    process.env.OPERATOR_API_KEY = OPERATOR_API_KEY;
    process.env.FRONTEND_ORIGIN = FRONTEND_ORIGIN;
    delete process.env.TRADING_FORGE_PUBLIC_URL;
    mocks.getArtifact.mockResolvedValue(null); // 404 downstream is fine — we only care whether we REACH the handler
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    for (const s of servers) s.close();
  });

  it("a same-origin browser request with NO Authorization header must NOT be rejected 401 " +
     "— the injection middleware must run BEFORE the API-key gate", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, { Origin: FRONTEND_ORIGIN });
    servers.push(server);

    // Pre-fix: requireOperatorApiKey (mounted via blanket router.use() before any
    // route existed) always runs first and rejects 401 before
    // injectApiKeyForSameOriginBrowser ever executes — the whole point of the A3
    // same-origin proxy feature is defeated. Post-fix: the injected key lets the
    // request reach the real handler, which 404s on the (mocked, nonexistent)
    // artifact — proving auth passed and downstream logic ran.
    expect(status).not.toBe(401);
    expect(mocks.getArtifact).toHaveBeenCalled();
  });

  it("positive control: a request WITH a valid Authorization header always succeeds past auth " +
     "(sanity check that the harness itself is wired correctly)", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, {
      Authorization: `Bearer ${OPERATOR_API_KEY}`,
    });
    servers.push(server);

    expect(status).not.toBe(401);
    expect(mocks.getArtifact).toHaveBeenCalled();
  });

  it("negative control: a CROSS-origin request (Origin does not match FRONTEND_ORIGIN) with no " +
     "Authorization header is still correctly rejected 401 — the fix must not broaden the gate " +
     "beyond the documented same-origin scope", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, { Origin: "https://evil.test" });
    servers.push(server);

    expect(status).toBe(401);
    expect(mocks.getArtifact).not.toHaveBeenCalled();
  });

  it("negative control: no Origin header and no Authorization header is still rejected 401", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, {});
    servers.push(server);

    expect(status).toBe(401);
    expect(mocks.getArtifact).not.toHaveBeenCalled();
  });
});
