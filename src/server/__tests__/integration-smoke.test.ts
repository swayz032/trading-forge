/**
 * Integration smoke tests for critical API routes.
 *
 * Spins up the Express app on an ephemeral port, hits key endpoints,
 * and verifies basic response shape. Uses native fetch (Node 18+).
 *
 * These tests require a running database (or will get degraded /health).
 * Auth is skipped in development mode when API_KEY is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Force dev mode so auth middleware is skipped
  process.env.NODE_ENV = "development";
  delete process.env.API_KEY;

  // Dynamic import to pick up env vars set above
  const { app } = await import("../index.js");

  await new Promise<void>((resolve) => {
    // Port 0 = OS assigns a free ephemeral port
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("Integration Smoke Tests", () => {
  it("GET /api/health returns 200", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("service", "trading-forge");
    expect(body).toHaveProperty("timestamp");
  });

  it("GET /api/strategies returns 200 with array", async () => {
    const res = await fetch(`${baseUrl}/api/strategies`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/strategies/library returns 200", async () => {
    const res = await fetch(`${baseUrl}/api/strategies/library`);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Library can be array or object with strategies key
    expect(body).toBeDefined();
  });

  it("POST /api/backtests with invalid body returns 400", async () => {
    const res = await fetch(`${baseUrl}/api/backtests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // Empty body — should fail validation
    });

    // 400 (validation error) or 422 (unprocessable) are both acceptable
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("GET /api/journal returns 200", async () => {
    const res = await fetch(`${baseUrl}/api/journal`);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Journal returns array of entries
    expect(body).toBeDefined();
  });

  it("GET /api/portfolio/heat returns 200", async () => {
    const res = await fetch(`${baseUrl}/api/portfolio/heat`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toBeDefined();
  });
});
