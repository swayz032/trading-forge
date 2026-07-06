/**
 * exchange-firm-classifier.test.ts — deep-scan broker/cookie F-5.
 *
 * Direct branch coverage for the two side-effect-free HTTP-response→status CLASSIFIERS that gate C1
 * (new-entry block on CME outage) and C2 (order block on firm suspension): checkCmeStatus() and
 * probeFirm(). Prior tests only exercised the simulateOutage/simulateSuspension admin hooks (which bypass
 * the classifier), leaving the actual decision trees — CME's JSON-status parse, non-200, timeout; and the
 * firm-probe 401 vs 403±body vs 500 branching — with ZERO regression protection. A false negative here
 * routes orders into a halted venue / banned account; a false positive halts entries needlessly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Heavy module-level deps are unused by the pure classifiers — stub them so importing the module is clean.
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { systemError: vi.fn() } }));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn(async () => {}) }));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { checkCmeStatus } from "../services/exchange-status-service.js";
import { probeFirm } from "../services/prop-firm-health-service.js";

function mockFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(impl as never));
}
function jsonResp(status: number, body: unknown) {
  return { status, json: async () => body, text: async () => JSON.stringify(body) };
}
function textResp(status: number, text: string) {
  return { status, json: async () => { throw new Error("not json"); }, text: async () => text };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("checkCmeStatus — CME outage classifier (C1 gate)", () => {
  it("200 + {status:'operational'} → operational=true", async () => {
    mockFetch(async () => jsonResp(200, { status: "operational" }));
    expect((await checkCmeStatus()).operational).toBe(true);
  });
  it.each(["degraded", "outage", "halted", "incident"])("200 + {status:'%s'} → operational=false", async (s) => {
    mockFetch(async () => jsonResp(200, { status: s }));
    const r = await checkCmeStatus();
    expect(r.operational).toBe(false);
    expect(r.reason).toContain(s);
  });
  it("200 + non-JSON body → operational=true (plain 200)", async () => {
    mockFetch(async () => textResp(200, "OK"));
    expect((await checkCmeStatus()).operational).toBe(true);
  });
  it("non-200 (503) → operational=false, reason mentions HTTP", async () => {
    mockFetch(async () => textResp(503, "unavailable"));
    const r = await checkCmeStatus();
    expect(r.operational).toBe(false);
    expect(r.reason).toContain("503");
  });
  it("fetch throws → operational=false with fetchError", async () => {
    mockFetch(async () => { throw new Error("ECONNREFUSED"); });
    const r = await checkCmeStatus();
    expect(r.operational).toBe(false);
    expect(r.fetchError).toContain("ECONNREFUSED");
  });
  it("AbortError (timeout) → operational=false, 'Request timed out'", async () => {
    mockFetch(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    const r = await checkCmeStatus();
    expect(r.operational).toBe(false);
    expect(r.fetchError).toBe("Request timed out");
  });
});

describe("probeFirm — firm suspension classifier (C2 gate)", () => {
  const CFG = {
    firmId: "topstep",
    apiKeyEnv: "TEST_FIRM_PROBE_KEY",
    probeUrl: "https://example.test/health",
    headerName: "Authorization",
    suspendedStatusCodes: [423],
    suspendedBodyPatterns: ["suspended", "banned"],
  };
  beforeEach(() => { process.env[CFG.apiKeyEnv] = "test-key"; });
  afterEach(() => { delete process.env[CFG.apiKeyEnv]; });

  it("no API key → skipped (no probe)", async () => {
    delete process.env[CFG.apiKeyEnv];
    expect((await probeFirm(CFG)).status).toBe("skipped");
  });
  it("200 clean body → healthy", async () => {
    mockFetch(async () => textResp(200, "all good"));
    expect((await probeFirm(CFG)).status).toBe("healthy");
  });
  it("200 but body says 'suspended' → suspended (not fooled by 200)", async () => {
    mockFetch(async () => textResp(200, "account suspended for review"));
    expect((await probeFirm(CFG)).status).toBe("suspended");
  });
  it("401 → auth_failure", async () => {
    mockFetch(async () => textResp(401, "unauthorized"));
    expect((await probeFirm(CFG)).status).toBe("auth_failure");
  });
  it("403 + NO suspended body → auth_failure", async () => {
    mockFetch(async () => textResp(403, "forbidden"));
    expect((await probeFirm(CFG)).status).toBe("auth_failure");
  });
  it("403 + suspended body → suspended (not auth_failure)", async () => {
    mockFetch(async () => textResp(403, "your account was banned"));
    expect((await probeFirm(CFG)).status).toBe("suspended");
  });
  it("suspended status code (423) → suspended", async () => {
    mockFetch(async () => textResp(423, "locked"));
    expect((await probeFirm(CFG)).status).toBe("suspended");
  });
  it("500 → degraded (not suspended, not healthy)", async () => {
    mockFetch(async () => textResp(500, "server error"));
    expect((await probeFirm(CFG)).status).toBe("degraded");
  });
  it("fetch throws → unreachable", async () => {
    mockFetch(async () => { throw new Error("ENOTFOUND"); });
    expect((await probeFirm(CFG)).status).toBe("unreachable");
  });
  it("timeout (AbortError) → unreachable", async () => {
    mockFetch(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    expect((await probeFirm(CFG)).status).toBe("unreachable");
  });
});
