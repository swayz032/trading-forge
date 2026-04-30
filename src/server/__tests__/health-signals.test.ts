/**
 * Tests for the three new signals added to GET /api/health (2026-04-29):
 *   - pythonPool  (subprocess pool saturation visibility)
 *   - massive     (Massive WebSocket data-feed status)
 *   - n8n         (n8n reachability)
 *
 * Mounts the app on an ephemeral port. Auth is bypassed in dev mode (no
 * API_KEY).  Database / Ollama / Python calls may fail in CI — only the
 * shape and types of the new fields are asserted, not their live values.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  delete process.env.API_KEY;
  // Ensure N8N_BASE_URL is absent so the n8n probe returns "disabled"
  // (avoids a real outbound HTTP call in unit/CI context)
  delete process.env.N8N_BASE_URL;

  const { app } = await import("../index.js");

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}, 15_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("GET /api/health — pythonPool signal", () => {
  it("response contains pythonPool with required fields", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("pythonPool");

    const pool = body.pythonPool as Record<string, unknown>;
    expect(typeof pool.active).toBe("number");
    expect(typeof pool.queued).toBe("number");
    expect(typeof pool.cap).toBe("number");
    expect(typeof pool.saturated).toBe("boolean");
  }, 15_000);

  it("pythonPool.cap matches MAX_PYTHON_SUBPROCESSES (default 6)", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { pythonPool: { cap: number } };
    // Default cap is 6 unless overridden by env
    const expectedCap = parseInt(process.env.MAX_PYTHON_SUBPROCESSES ?? "6", 10) || 6;
    expect(body.pythonPool.cap).toBe(expectedCap);
  }, 15_000);

  it("pythonPool.saturated is false when active < cap at idle", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { pythonPool: { active: number; cap: number; saturated: boolean } };
    // At idle, no Python subprocesses are active
    if (body.pythonPool.active < body.pythonPool.cap) {
      expect(body.pythonPool.saturated).toBe(false);
    }
    // If somehow saturated at test time, saturated must be true
    if (body.pythonPool.active >= body.pythonPool.cap) {
      expect(body.pythonPool.saturated).toBe(true);
    }
  }, 15_000);
});

describe("GET /api/health — massive signal", () => {
  it("response contains massive with required fields", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("massive");

    const massive = body.massive as Record<string, unknown>;
    expect(typeof massive.status).toBe("string");
    expect(typeof massive.activeStreams).toBe("number");
    // lastConnectedAt is null or an ISO string
    expect(massive.lastConnectedAt === null || typeof massive.lastConnectedAt === "string").toBe(true);
  }, 15_000);

  it("massive.status is one of the allowed enum values", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { massive: { status: string } };
    expect(["connected", "disconnected", "unknown"]).toContain(body.massive.status);
  }, 15_000);

  it("massive.activeStreams is 0 when no paper sessions are running", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { massive: { activeStreams: number; status: string } };
    // No paper sessions are started in this test context
    expect(body.massive.activeStreams).toBe(0);
    expect(body.massive.status).toBe("disconnected");
  }, 15_000);
});

describe("GET /api/health — n8n signal", () => {
  it("response contains n8n with required fields", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("n8n");

    const n8n = body.n8n as Record<string, unknown>;
    expect(typeof n8n.status).toBe("string");
    // latencyMs is null or a number
    expect(n8n.latencyMs === null || typeof n8n.latencyMs === "number").toBe(true);
  }, 15_000);

  it("n8n.status is 'disabled' when N8N_BASE_URL is not set", async () => {
    // N8N_BASE_URL was deleted in beforeAll
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { n8n: { status: string; latencyMs: null } };
    expect(body.n8n.status).toBe("disabled");
    expect(body.n8n.latencyMs).toBeNull();
  }, 15_000);

  it("n8n.status is one of the allowed enum values", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { n8n: { status: string } };
    expect(["ok", "unreachable", "error", "disabled"]).toContain(body.n8n.status);
  }, 15_000);
});
