/**
 * pine-export-same-origin-auth-order.test.ts — CRIT/HIGH (security-auth-hardening
 * 2026-07-17): dead auth-ordering in pine-export.ts, and the Origin-spoofing
 * bypass a naive fix would have introduced.
 *
 * ── Finding 1 (dead code, harmless) ──────────────────────────────────────────
 * pine-export.ts used to mount `requireOperatorApiKey` as a blanket
 * router-level `.use()` BEFORE any route was registered, while the download
 * route additionally listed a since-removed `injectApiKeyForSameOriginBrowser`
 * middleware with an inline comment claiming it "injects OPERATOR_API_KEY for
 * browser-originated requests before requireOperatorApiKey validates" (A3,
 * Pass 3 Track A). That claim was false by construction — Express runs
 * middleware in registration order regardless of `.use()` vs per-route
 * registration, so requireOperatorApiKey always ran first and the injection
 * never executed. Net effect in production: harmless (same-origin browser
 * downloads simply always got 401; the feature was dead, not exploitable).
 *
 * ── Finding 2 (the trap: reordering "fixes" the dead code by ACTIVATING a
 *    real auth bypass) ────────────────────────────────────────────────────────
 * The obvious "cleanup" — reorder so the injection middleware runs BEFORE
 * requireOperatorApiKey, restoring the documented intent — was attempted and
 * caught on review before landing. `Origin` is a client-supplied HTTP header;
 * the same-origin restriction it satisfies for genuine browsers is enforced
 * by the BROWSER via CORS, not by the server, and carries no authority for a
 * non-browser caller (curl, a script, `fetch` from Node). `FRONTEND_ORIGIN` is
 * a public URL, not a secret. Reordering meant: any caller who simply sets
 * `Origin: <FRONTEND_ORIGIN>` and omits Authorization gets the real
 * OPERATOR_API_KEY injected server-side and a 200 — full unauthenticated
 * access to Pine artifacts (which "contain per-recipient HMAC secret
 * references and routing metadata" per the module docstring), with ZERO
 * knowledge of the actual key. Verified empirically with an isolated Express
 * harness before this was caught.
 *
 * ── The actual fix ────────────────────────────────────────────────────────────
 * Remove the Origin-trust mechanism entirely rather than reorder it. This
 * preserves the behavior real production traffic already had (per Finding 1,
 * the injection was already dead — nothing changes for genuine callers) while
 * deleting the exploitable code path. Every route on this router is now
 * uniformly gated by the single blanket `requireOperatorApiKey` `.use()`,
 * with no origin-conditional bypass anywhere.
 *
 * This suite proves BOTH properties: the ordinary auth gate still works
 * (positive/negative controls), AND the specific attack this wave found and
 * almost shipped — a spoofed same-origin Origin header with no real
 * credential — is rejected.
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

describe("pine-export.ts auth gate — same-origin trust removed, not reordered (CRIT/HIGH security-auth-hardening 2026-07-17)", () => {
  let servers: Server[] = [];
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    servers = [];
    process.env.NODE_ENV = "production"; // disable dev auto-key path; force real gate
    process.env.OPERATOR_API_KEY = OPERATOR_API_KEY;
    process.env.FRONTEND_ORIGIN = FRONTEND_ORIGIN;
    delete process.env.TRADING_FORGE_PUBLIC_URL;
    mocks.getArtifact.mockResolvedValue(null); // 404 downstream is fine — we only care whether auth passed
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    for (const s of servers) s.close();
  });

  it("CRIT regression guard: a request with a SPOOFED Origin header matching " +
     "FRONTEND_ORIGIN and NO Authorization header is REJECTED 401 — this is the " +
     "exact Origin-spoofing bypass an incorrect 'fix' introduced and this test " +
     "would catch a regression back to it", async () => {
    const app = buildApp();
    const { status, body, server } = await getDownload(app, { Origin: FRONTEND_ORIGIN });
    servers.push(server);

    expect(status).toBe(401);
    expect(body["error"]).toBe("unauthorized");
    // Must never reach the handler / touch the artifact lookup without real auth.
    expect(mocks.getArtifact).not.toHaveBeenCalled();
  });

  it("positive control: a request WITH a valid Authorization header succeeds past auth " +
     "(sanity check that the harness itself is wired correctly, and that removing the " +
     "same-origin mechanism did not also break the real gate)", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, {
      Authorization: `Bearer ${OPERATOR_API_KEY}`,
    });
    servers.push(server);

    expect(status).not.toBe(401);
    expect(mocks.getArtifact).toHaveBeenCalled();
  });

  it("a request with a valid Authorization header but a spoofed/mismatched Origin still " +
     "succeeds — Origin is not part of the auth decision at all anymore, in either " +
     "direction", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, {
      Authorization: `Bearer ${OPERATOR_API_KEY}`,
      Origin: "https://evil.test",
    });
    servers.push(server);

    expect(status).not.toBe(401);
    expect(mocks.getArtifact).toHaveBeenCalled();
  });

  it("a CROSS-origin request (Origin does not match FRONTEND_ORIGIN) with no " +
     "Authorization header is rejected 401", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, { Origin: "https://evil.test" });
    servers.push(server);

    expect(status).toBe(401);
    expect(mocks.getArtifact).not.toHaveBeenCalled();
  });

  it("no Origin header and no Authorization header is rejected 401", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, {});
    servers.push(server);

    expect(status).toBe(401);
    expect(mocks.getArtifact).not.toHaveBeenCalled();
  });

  it("a bogus Authorization bearer token is rejected 401 even with a matching Origin " +
     "header (Origin cannot substitute for or weaken the credential check)", async () => {
    const app = buildApp();
    const { status, server } = await getDownload(app, {
      Origin: FRONTEND_ORIGIN,
      Authorization: "Bearer not-the-real-key",
    });
    servers.push(server);

    expect(status).toBe(401);
    expect(mocks.getArtifact).not.toHaveBeenCalled();
  });
});
