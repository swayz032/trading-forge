/**
 * p0-429-storm-hardening.test.ts
 *
 * P0 incident 2026-07-11: a silent in-process localhost self-call storm hit the
 * rate limiter at ~112 req/s for hours, exhausting the tower's ephemeral TCP port
 * pool (16K+ TIME_WAIT sockets) and 429-ing all traffic — INCLUDING the HMAC
 * self-restart endpoint that exists to recover from exactly this failure (the
 * first recovery attempt was observed 429'd live) and the /api/health probe the
 * dead-man heartbeat + soak watcher depend on.
 *
 * Two hardening layers land here:
 *   1. rate-limit.ts: exempt /api/admin/self-restart for all callers (it carries
 *      its own HMAC auth) and /api/health for genuine local callers (no relay
 *      header) so recovery + monitoring never starve behind a 429.
 *   2. audit-log-helper.ts: coerce non-UUID entityId into input.entity_ref so
 *      audit rows PERSIST instead of being silently dropped by Postgres'
 *      `invalid input syntax for type uuid` (kill-switch DLL rows, bias-engine
 *      session rows, and the boot synthetic_regime_bank rows were all being lost).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http, { type Server } from "node:http";
import express from "express";

vi.mock("../index.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// audit-log-helper.ts eagerly imports ../db/index.js, which throws
// "DATABASE_URL environment variable is required" at module load. coerceEntityId
// is a pure function that never touches the DB — mock the db module so the pure
// helper is importable without a live Postgres connection.
vi.mock("../db/index.js", () => ({ db: { insert: () => ({ values: async () => undefined }) } }));

const RELAY_VERIFIED_IP_HEADER = "x-relay-verified-ip";
const MAX_REQUESTS = 2;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { rateLimit } = await import("../middleware/rate-limit.js");
  const app = express();
  // Mount limiter globally then two routes that the exemption logic keys on by path.
  app.use(rateLimit({ windowMs: 60_000, maxRequests: MAX_REQUESTS }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/admin/self-restart", (_req, res) => res.json({ ok: true }));
  app.get("/api/other", (_req, res) => res.json({ ok: true }));

  await new Promise<void>((resolve) => {
    server = http.createServer(app).listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("P0 429-storm fix — rate-limiter escape-valve exemptions", () => {
  it("POST /api/admin/self-restart is NEVER 429'd even when its bucket is far over budget", async () => {
    // Fire well past the 2-request budget on the self-restart path.
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${baseUrl}/api/admin/self-restart`, { method: "POST" });
      results.push(r.status);
    }
    expect(results.every((s) => s === 200)).toBe(true);
  });

  it("local /api/health (no relay header) is exempt — dead-man heartbeat / soak never starve", async () => {
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${baseUrl}/api/health`);
      results.push(r.status);
    }
    expect(results.every((s) => s === 200)).toBe(true);
  });

  it("relay-forwarded /api/health (has relay header) is STILL metered per-caller — external floods stay capped", async () => {
    const hdr = { [RELAY_VERIFIED_IP_HEADER]: "203.0.113.77" };
    const a1 = await fetch(`${baseUrl}/api/health`, { headers: hdr });
    const a2 = await fetch(`${baseUrl}/api/health`, { headers: hdr });
    const a3 = await fetch(`${baseUrl}/api/health`, { headers: hdr });
    expect([a1.status, a2.status]).toEqual([200, 200]);
    expect(a3.status).toBe(429);
  });

  it("a non-exempt route is still rate-limited (exemption is path-scoped, not a global bypass)", async () => {
    const hdr = { [RELAY_VERIFIED_IP_HEADER]: "198.51.100.42" };
    const r1 = await fetch(`${baseUrl}/api/other`, { headers: hdr });
    const r2 = await fetch(`${baseUrl}/api/other`, { headers: hdr });
    const r3 = await fetch(`${baseUrl}/api/other`, { headers: hdr });
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r3.status).toBe(429);
  });
});

describe("P0 429-storm fix — audit_log entityId UUID coercion", () => {
  it("preserves a real UUID entityId untouched", async () => {
    const { coerceEntityId } = await import("../lib/audit-log-helper.js");
    const uuid = "2c91bc41-d366-4c96-a01b-ba221aacb77e";
    const out = coerceEntityId({ action: "x", entityType: "y", entityId: uuid, status: "success" } as never);
    expect(out.entityId).toBe(uuid);
    expect((out.input as Record<string, unknown> | null)).toBeFalsy();
  });

  it("moves a non-UUID entityId (boot-<ts>) into input.entity_ref and nulls the uuid column", async () => {
    const { coerceEntityId } = await import("../lib/audit-log-helper.js");
    const out = coerceEntityId({
      action: "synthetic_regime_bank.self_heal_skipped_populated",
      entityType: "regime_bank",
      entityId: "boot-1783753205190",
      status: "success",
    } as never);
    expect(out.entityId).toBeNull();
    expect((out.input as Record<string, unknown>).entity_ref).toBe("boot-1783753205190");
  });

  it("merges entity_ref into an existing input object without clobbering it", async () => {
    const { coerceEntityId } = await import("../lib/audit-log-helper.js");
    const out = coerceEntityId({
      action: "kill_switch.dll_force_close",
      entityType: "account",
      entityId: "topstep",
      input: { bankCount: 23, reason: "dll_95pct" },
      status: "success",
    } as never);
    expect(out.entityId).toBeNull();
    const input = out.input as Record<string, unknown>;
    expect(input.entity_ref).toBe("topstep");
    expect(input.bankCount).toBe(23);
    expect(input.reason).toBe("dll_95pct");
  });

  it("leaves a null entityId as null (cron/system rows)", async () => {
    const { coerceEntityId } = await import("../lib/audit-log-helper.js");
    const out = coerceEntityId({ action: "x", entityType: "system", entityId: null, status: "success" } as never);
    expect(out.entityId).toBeNull();
  });
});
