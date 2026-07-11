/**
 * deepscan-fixwave-rate-limit-relay-ip.test.ts
 *
 * Deep-Scan fix-wave 2026-07-10, Fix 3 (HIGH).
 *
 * `src/server/middleware/rate-limit.ts` keyed on `req.ip`, which — with no
 * `trust proxy` configured — resolves to the Express-observed socket peer.
 * Because `scripts/tower-relay-client.cjs` reissues every relay-forwarded
 * request as a fresh LOOPBACK `http.request()` to `localhost:4000`, EVERY
 * external caller reaching this app through the relay shares the exact same
 * `req.ip` (`127.0.0.1`) — collapsing all relay traffic into one rate-limit
 * bucket regardless of how many distinct real-world callers there are.
 *
 * Root cause is identical to Fix 2's admin-lockout bug; the fix reuses the
 * same mechanism (`resolveTrustedClientIp` / `RELAY_VERIFIED_IP_HEADER` from
 * `src/server/lib/relay-client-ip.ts`, minted by `railway-relay/server.js`).
 *
 * This test boots ONE real Express app (real `rateLimit()` middleware, real
 * HTTP socket — same pattern as `deepscan16-a1-self-restart-auth-gate.test.ts`)
 * for the whole file and gives each test its own relay-verified-IP / socket
 * key so the in-memory `hits` bucket map (module-level, persists across
 * `it()` blocks exactly like it would across real requests) does not leak
 * state between tests.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http, { type Server } from "node:http";
import express from "express";

vi.mock("../index.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const RELAY_VERIFIED_IP_HEADER = "x-relay-verified-ip";
const MAX_REQUESTS = 2;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { rateLimit } = await import("../middleware/rate-limit.js");
  const app = express();
  app.use(rateLimit({ windowMs: 60_000, maxRequests: MAX_REQUESTS }));
  app.get("/probe", (_req, res) => res.json({ ok: true }));

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

async function probe(extraHeaders: Record<string, string> = {}) {
  return fetch(`${baseUrl}/probe`, { headers: extraHeaders });
}

describe("Deep-Scan fix-wave 2026-07-10 Fix 3 — rate limiter keys on the relay-verified IP, not the shared loopback socket", () => {
  it("two DIFFERENT relay-verified callers each get their OWN 2-request budget (pre-fix: req.ip made them share ONE bucket)", async () => {
    const a1 = await probe({ [RELAY_VERIFIED_IP_HEADER]: "203.0.113.1" });
    const a2 = await probe({ [RELAY_VERIFIED_IP_HEADER]: "203.0.113.1" });
    const a3 = await probe({ [RELAY_VERIFIED_IP_HEADER]: "203.0.113.1" });
    expect([a1.status, a2.status]).toEqual([200, 200]);
    expect(a3.status).toBe(429);

    // Caller B, a genuinely different relay-verified IP, has NOT been touched by
    // caller A's requests — pre-fix (keyed on req.ip === always 127.0.0.1 for
    // this direct-loopback test, mirroring every relay-forwarded request on the
    // real tower), caller B would already be at 3/2 and 429 here too.
    const b1 = await probe({ [RELAY_VERIFIED_IP_HEADER]: "198.51.100.9" });
    expect(b1.status).toBe(200);
  });

  it("without a relay-verified header (direct/LAN caller), falls back to the real socket address — still functions", async () => {
    // No custom header on this test's requests — they land in the shared
    // fallback-socket bucket (same as the "spoofed XFF" test below, since
    // both omit the relay header and this file uses one shared connection
    // pool to one server). Exhaust it here, deliberately, then reuse it.
    const r1 = await probe();
    const r2 = await probe();
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const r3 = await probe();
    expect(r3.status).toBe(429); // same direct-loopback caller, shares its own bucket with itself — correct
  });

  it("a spoofed raw x-forwarded-for (no relay header) does NOT grant a fresh bucket — it is not read at all", async () => {
    // Continues from the previous test's already-exhausted fallback-socket
    // bucket (module-level `hits` map persists — exactly like production).
    // Attacker tries to evade by sending a rotating x-forwarded-for — must
    // not reset or bypass the limit, because rate-limit.ts never reads that
    // header at all.
    const evade = await probe({ "X-Forwarded-For": "9.9.9.9" });
    expect(evade.status).toBe(429);
  });
});
