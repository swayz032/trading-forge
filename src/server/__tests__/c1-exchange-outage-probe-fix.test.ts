/**
 * c1-exchange-outage-probe-fix.test.ts
 *
 * C1 fix 2026-07-11 (ratify packet 1). The dead CME venue-status probe (bot-blocked
 * cmegroup.com → 403/000) treated every transport failure as a CME outage, opening a
 * phantom outage on every 60s poll (80 stale rows → C1 hard-blocked all paper entries
 * on boot). The fix corroborates a venue-probe transport failure with the broker
 * (Tradovate) reachability probe:
 *   - broker reachable  → operational=true  (no phantom outage)
 *   - broker unreachable → operational=false (fail-CLOSED on the real routing signal)
 * An affirmative venue "degraded/halted" (200 + status body) still opens an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// exchange-status-service.ts eagerly imports db/sse/alert — mock them so the pure
// probe functions are importable without a live DB / side effects.
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { systemError: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CME_URL_FRAGMENT = "cmegroup.com";
const TRADOVATE_URL_FRAGMENT = "tradovateapi.com";

let brokerReachable = true;
let venueMode: "operational-200" | "halted-200" | "http-403" | "throws" = "http-403";

beforeEach(() => {
  brokerReachable = true;
  venueMode = "http-403";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes(TRADOVATE_URL_FRAGMENT)) {
      if (brokerReachable) return new Response(null, { status: 200 });
      throw new Error("broker network error");
    }
    if (u.includes(CME_URL_FRAGMENT)) {
      switch (venueMode) {
        case "operational-200":
          return new Response(JSON.stringify({ status: "operational" }), { status: 200 });
        case "halted-200":
          return new Response(JSON.stringify({ status: "halted" }), { status: 200 });
        case "http-403":
          return new Response("Forbidden", { status: 403 });
        case "throws":
          throw new Error("ETIMEDOUT");
      }
    }
    return new Response(null, { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("C1 probe fix — venue-transport-failure corroborates with broker reachability", () => {
  it("affirmative venue halt (200 + status:halted) STILL opens an outage", async () => {
    venueMode = "halted-200";
    const { checkCmeStatus } = await import("../services/exchange-status-service.js");
    const r = await checkCmeStatus();
    expect(r.operational).toBe(false);
    expect(r.reason).toContain("halted");
  });

  it("venue 200 + operational → operational=true (no outage)", async () => {
    venueMode = "operational-200";
    const { checkCmeStatus } = await import("../services/exchange-status-service.js");
    const r = await checkCmeStatus();
    expect(r.operational).toBe(true);
  });

  it("PHANTOM FIX: venue bot-blocked (403) + broker REACHABLE → operational=true (no phantom outage)", async () => {
    venueMode = "http-403";
    brokerReachable = true;
    const { checkCmeStatus } = await import("../services/exchange-status-service.js");
    const r = await checkCmeStatus();
    expect(r.operational).toBe(true); // pre-fix this was FALSE → the phantom block
  });

  it("FAIL-CLOSED PRESERVED: venue 403 + broker UNREACHABLE → operational=false", async () => {
    venueMode = "http-403";
    brokerReachable = false;
    const { checkCmeStatus } = await import("../services/exchange-status-service.js");
    const r = await checkCmeStatus();
    expect(r.operational).toBe(false);
    expect(r.reason).toContain("Broker (Tradovate) unreachable");
  });

  it("venue fetch THROWS (timeout) + broker reachable → operational=true (no phantom)", async () => {
    venueMode = "throws";
    brokerReachable = true;
    const { checkCmeStatus } = await import("../services/exchange-status-service.js");
    const r = await checkCmeStatus();
    expect(r.operational).toBe(true);
  });

  it("venue throws + broker unreachable → operational=false (fail-closed)", async () => {
    venueMode = "throws";
    brokerReachable = false;
    const { checkCmeStatus } = await import("../services/exchange-status-service.js");
    const r = await checkCmeStatus();
    expect(r.operational).toBe(false);
  });
});
