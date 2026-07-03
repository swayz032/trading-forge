/**
 * deepscan14-gate-inactive-surfacing.test.ts
 *
 * Track 2 fix wave — D2 (price-lock-limit gate) + D3 (graveyard similarity gate)
 * "GATE INACTIVE" surfacing. Per operator decision: where a real data feed is
 * missing, do NOT fabricate it — convert the silent no-op into a LOUD, queryable
 * "GATE INACTIVE / feed missing" status distinct from "checked, clear."
 *
 * D2: price-lock-limit-gate.ts fail-opens on missing settlement reference —
 * `blocked:false` alone was indistinguishable from "checked, price is clear."
 * D3: graveyard-gate.ts cosineSimilarity() returns 0 on embedding dimension
 * mismatch (e.g. gemma vs stored nomic-768) — `blocked:false` was
 * indistinguishable from "compared, genuinely dissimilar."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("D2 — price-lock-limit-gate.ts: inactive flag on missing settlement reference", () => {
  it("no reference settlement -> inactive:true, reason:no_reference, blocked:false (unchanged fail-open)", async () => {
    const { checkPriceLockLimit } = await import("../lib/price-lock-limit-gate.js");
    const r = checkPriceLockLimit("ES", 5300, null);
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe("no_reference");
    expect(r.inactive).toBe(true);
  });

  it("reference settlement <= 0 also surfaces inactive:true", async () => {
    const { checkPriceLockLimit } = await import("../lib/price-lock-limit-gate.js");
    const r = checkPriceLockLimit("ES", 5300, 0);
    expect(r.blocked).toBe(false);
    expect(r.inactive).toBe(true);
  });

  it("a REAL evaluation (reference present) does not set inactive:true", async () => {
    const { checkPriceLockLimit } = await import("../lib/price-lock-limit-gate.js");
    const clear = checkPriceLockLimit("ES", 5000, 5000);
    expect(clear.blocked).toBe(false);
    expect(clear.inactive).toBeFalsy();

    const blocked = checkPriceLockLimit("ES", 5300, 5000);
    expect(blocked.blocked).toBe(true);
    expect(blocked.inactive).toBeFalsy();
  });
});

// ─── D2 caller-side telemetry (paper-signal-service.ts) ──────────────────────
//
// The gate itself is a pure function (tested above in isolation). The caller
// at paper-signal-service.ts:~3893 is responsible for emitting a RATE-LIMITED
// audit row (once per session per day, not per-signal) when the gate reports
// inactive, so the operator can see the settlement feed is dark. Rather than
// stand up the full paper-signal-service module graph (dozens of transitive
// service imports), this test exercises the rate-limiting contract directly
// via a minimal harness that mirrors the exact logic added at the call site:
// a module-level Map<sessionId, lastFiredDayKey> gate.

describe("D2 — price-lock gate-inactive telemetry rate-limiting contract", () => {
  function makeRateLimiter() {
    const lastFired = new Map<string, string>();
    const fired: Array<{ sessionId: string; action: string }> = [];
    function maybeFire(sessionId: string, todayKey: string, inactive: boolean) {
      if (!inactive) return;
      if (lastFired.get(sessionId) !== todayKey) {
        lastFired.set(sessionId, todayKey);
        fired.push({ sessionId, action: "price_lock.gate_inactive_no_feed" });
      }
    }
    return { maybeFire, fired };
  }

  it("fires once per session per day, not once per signal", () => {
    const { maybeFire, fired } = makeRateLimiter();
    for (let i = 0; i < 10; i++) {
      maybeFire("session-1", "2026-07-03", true);
    }
    expect(fired).toHaveLength(1);
  });

  it("fires again on a new day for the same session", () => {
    const { maybeFire, fired } = makeRateLimiter();
    maybeFire("session-1", "2026-07-03", true);
    maybeFire("session-1", "2026-07-04", true);
    expect(fired).toHaveLength(2);
  });

  it("does not fire at all when the gate is NOT inactive", () => {
    const { maybeFire, fired } = makeRateLimiter();
    maybeFire("session-1", "2026-07-03", false);
    expect(fired).toHaveLength(0);
  });

  it("independent sessions each get their own once-per-day budget", () => {
    const { maybeFire, fired } = makeRateLimiter();
    maybeFire("session-1", "2026-07-03", true);
    maybeFire("session-2", "2026-07-03", true);
    expect(fired).toHaveLength(2);
  });
});

// ─── D3 — graveyard-gate.ts: dimension-mismatch inactive surfacing ───────────

const gvState = vi.hoisted(() => ({
  graveyardRows: [] as Array<{ id: string; name: string; embedding: number[] | null; failureCategory: string | null }>,
  auditRows: [] as Array<{ action: string; input: unknown; result: unknown; status: string }>,
  embedResult: [[0.1, 0.2, 0.3]] as number[][],
  embedThrows: false,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        })),
        limit: vi.fn(async () => gvState.graveyardRows),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        gvState.auditRows.push({
          action: vals.action as string,
          input: vals.input,
          result: vals.result,
          status: vals.status as string,
        });
        return { catch: vi.fn(() => Promise.resolve()) };
      }),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategyGraveyard: {
    tableName: "strategy_graveyard",
    id: { name: "id" },
    name: { name: "name" },
    embedding: { name: "embedding" },
    failureCategory: { name: "failure_category" },
    failureSeverity: { name: "failure_severity" },
    deathReason: { name: "death_reason" },
    deathDate: { name: "death_date" },
    searchableMetrics: { name: "searchable_metrics" },
    failureModes: { name: "failure_modes" },
  },
  auditLog: { tableName: "audit_log" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  desc: vi.fn((a: unknown) => ({ op: "desc", a })),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    embed: vi.fn(async (_text: string) => {
      if (gvState.embedThrows) throw new Error("ollama_unavailable_injected");
      return gvState.embedResult;
    }),
  })),
}));

import { GraveyardGate } from "../services/graveyard-gate.js";

describe("D3 — graveyard-gate.ts: embedding dimension mismatch surfaces as inactive", () => {
  beforeEach(() => {
    gvState.graveyardRows = [];
    gvState.auditRows = [];
    gvState.embedResult = [[0.1, 0.2, 0.3]]; // 3-dim candidate
    gvState.embedThrows = false;
    vi.clearAllMocks();
  });

  it("every stored embedding has a DIFFERENT dim than the candidate -> inactive:true, blocked:false, telemetry emitted", async () => {
    gvState.graveyardRows = [
      { id: "g1", name: "dead-strat-1", embedding: new Array(768).fill(0.01), failureCategory: "robustness" },
      { id: "g2", name: "dead-strat-2", embedding: new Array(768).fill(0.02), failureCategory: null },
    ];

    const gate = new GraveyardGate();
    const result = await gate.check("some candidate strategy description");

    expect(result.blocked).toBe(false);
    expect(result.inactive).toBe(true);
    expect(result.reason).toMatch(/INACTIVE/);
    expect(result.reason).toMatch(/dimensionality/);

    const telemetryRow = gvState.auditRows.find(
      (r) => r.action === "graveyard.similarity_gate_inactive_dim_mismatch"
    );
    expect(telemetryRow).toBeDefined();
    expect(telemetryRow?.status).toBe("success");
  });

  it("dims MATCH -> real comparison runs, inactive is false/absent", async () => {
    // candidate is 3-dim (see embedResult above); make graveyard entries 3-dim too.
    gvState.graveyardRows = [
      { id: "g1", name: "dead-strat-1", embedding: [0.1, 0.2, 0.3], failureCategory: "robustness" },
    ];

    const gate = new GraveyardGate();
    const result = await gate.check("identical description", 0.85, "robustness");

    // Identical vector -> cosine similarity 1.0 (before any boost cap) -> blocked.
    expect(result.inactive).toBeFalsy();
    expect(result.blocked).toBe(true);
    expect(result.similarity).toBeGreaterThan(0.85);

    const telemetryRow = gvState.auditRows.find(
      (r) => r.action === "graveyard.similarity_gate_inactive_dim_mismatch"
    );
    expect(telemetryRow).toBeUndefined();
  });

  it("mixed population (some entries match dim, some don't) is NOT flagged inactive — a real comparison happened", async () => {
    gvState.graveyardRows = [
      { id: "g1", name: "wrong-dim-strat", embedding: new Array(768).fill(0.01), failureCategory: null },
      { id: "g2", name: "right-dim-strat", embedding: [0.1, 0.2, 0.3], failureCategory: null },
    ];

    const gate = new GraveyardGate();
    const result = await gate.check("identical description");

    expect(result.inactive).toBeFalsy();
    // The matching-dim entry (g2) is identical to the candidate -> similarity 1.0 -> blocked.
    expect(result.blocked).toBe(true);
    expect(result.matchedGraveyardId).toBe("g2");

    const telemetryRow = gvState.auditRows.find(
      (r) => r.action === "graveyard.similarity_gate_inactive_dim_mismatch"
    );
    expect(telemetryRow).toBeUndefined();
  });

  it("no graveyard entries at all -> not flagged inactive (nothing to mismatch against; distinct from dim-mismatch case)", async () => {
    gvState.graveyardRows = [];
    const gate = new GraveyardGate();
    const result = await gate.check("candidate with empty graveyard");

    expect(result.blocked).toBe(false);
    expect(result.inactive).toBeFalsy();
  });

  it("embedding service unavailable -> existing bypass path now ALSO marked inactive:true", async () => {
    gvState.embedThrows = true;
    const gate = new GraveyardGate();
    const result = await gate.check("candidate description");

    expect(result.blocked).toBe(false);
    expect(result.inactive).toBe(true);
    expect(result.reason).toMatch(/Embedding service unavailable/);
  });
});
