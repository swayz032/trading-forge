/**
 * Strategy Evidence Route Tests — Pass 19 Track B
 *
 * Covers GET /api/strategies/:id/evidence:
 *  1. Strategy with linked bucket → returns full evidence (bucket + mentions)
 *  2. Strategy without linked bucket → cross_validated:false + fallback note
 *  3. Non-existent strategy → 404
 *  4. Strategy with bucket but zero mentions → empty mentions array
 *
 * All DB calls are mocked through the drizzle chain so the test does not
 * touch Postgres. The route's only external dependency is `db`.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  PAPER_EXIT_EVENTS: {},
  COMPLIANCE_EVENTS: {},
  KILL_SWITCH_EVENTS: {},
}));

vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    getPipelineHealth = vi.fn().mockResolvedValue({});
    promoteStrategy = vi.fn().mockResolvedValue({ success: true });
    checkAutoPromotions = vi.fn().mockResolvedValue([]);
    checkAutoDemotions = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

// ─── Mock the schema with internal symbols. Factory must be self-contained
// because vi.mock is hoisted above any top-level const declarations.
vi.mock("../db/schema.js", () => {
  const tables = {
    strategies: Symbol("strategies"),
    backtests: Symbol("backtests"),
    backtestTrades: Symbol("backtestTrades"),
    monteCarloRuns: Symbol("monteCarloRuns"),
    stressTestRuns: Symbol("stressTestRuns"),
    backtestMatrix: Symbol("backtestMatrix"),
    systemJournal: Symbol("systemJournal"),
    complianceReviews: Symbol("complianceReviews"),
    paperSessions: Symbol("paperSessions"),
    skipDecisions: Symbol("skipDecisions"),
    strategyGraveyard: Symbol("strategyGraveyard"),
    auditLog: Symbol("auditLog"),
    strategyExports: Symbol("strategyExports"),
    strategyExportArtifacts: Symbol("strategyExportArtifacts"),
    strategyPendingBuckets: Symbol("strategyPendingBuckets"),
    strategyPendingMentions: Symbol("strategyPendingMentions"),
  };
  return tables;
});

// Mutable per-test fixtures — set in each test before issuing the request.
const fixtures: {
  strategyRow: Record<string, unknown> | null;
  bucketRow: Record<string, unknown> | null;
  mentionRows: Array<Record<string, unknown>>;
} = {
  strategyRow: null,
  bucketRow: null,
  mentionRows: [],
};

vi.mock("../db/index.js", async () => {
  // Resolve the schema mock so we can compare symbol identities at runtime.
  const schema = await import("../db/schema.js");

  function makeChain(table: unknown) {
    let resolved: unknown[];
    if (table === schema.strategies) {
      resolved = fixtures.strategyRow ? [fixtures.strategyRow] : [];
    } else if (table === schema.strategyPendingBuckets) {
      resolved = fixtures.bucketRow ? [fixtures.bucketRow] : [];
    } else if (table === schema.strategyPendingMentions) {
      resolved = fixtures.mentionRows;
    } else {
      resolved = [];
    }
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    chain.where = passthrough;
    chain.limit = passthrough;
    chain.orderBy = passthrough;
    chain.innerJoin = passthrough;
    chain.then = (resolve: (v: unknown[]) => void) => resolve(resolved);
    return chain;
  }

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => makeChain(table)),
      })),
      insert: vi.fn(() => ({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      })),
      update: vi.fn(() => ({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    },
  };
});

import { strategyRoutes } from "../routes/strategies.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/strategies", strategyRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.on("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
});

beforeEach(() => {
  fixtures.strategyRow = null;
  fixtures.bucketRow = null;
  fixtures.mentionRows = [];
});

async function getEvidence(id: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/strategies/${id}/evidence`);
  return { status: res.status, json: await res.json() };
}

describe("GET /api/strategies/:id/evidence", () => {
  it("returns full evidence payload for strategy with cross-validated bucket", async () => {
    const strategyId = "759b15e2-88ae-43c9-a1a6-c0c7812b97bc";
    const bucketId = "bucket-uuid-1";
    fixtures.strategyRow = { id: strategyId, name: "MES ORB Breakout", source: "scout" };
    fixtures.bucketRow = {
      id: bucketId,
      fingerprintHash: "abc12345def67890",
      market: "MES",
      entryArchetype: "opening_range_breakout",
      exitType: "atr_multiple",
      sourceCount: 3,
      distinctProviders: 3,
      status: "graduated",
      firstSeenAt: new Date("2026-05-09T12:00:00Z").toISOString(),
      lastSeenAt: new Date("2026-05-10T12:00:00Z").toISOString(),
      graduatedAt: new Date("2026-05-10T13:00:00Z").toISOString(),
      graduatedStrategyId: strategyId,
    };
    fixtures.mentionRows = [
      {
        id: "m1",
        bucketId,
        sourceProvider: "youtube",
        sourceUrl: "https://youtube.com/watch?v=abc",
        isCrossValidationResult: false,
        crossValidatorConfidence: null,
        createdAt: new Date("2026-05-09T12:00:00Z").toISOString(),
      },
      {
        id: "m2",
        bucketId,
        sourceProvider: "tavily",
        sourceUrl: "https://example.com/article",
        isCrossValidationResult: true,
        crossValidatorConfidence: "0.92",
        createdAt: new Date("2026-05-09T13:00:00Z").toISOString(),
      },
      {
        id: "m3",
        bucketId,
        sourceProvider: "reddit",
        sourceUrl: "https://reddit.com/r/futures/abc",
        isCrossValidationResult: true,
        crossValidatorConfidence: "0.85",
        createdAt: new Date("2026-05-09T14:00:00Z").toISOString(),
      },
    ];

    const r = await getEvidence(strategyId);
    expect(r.status).toBe(200);
    expect(r.json.cross_validated).toBe(true);
    expect(r.json.bucket).not.toBeNull();
    expect(r.json.bucket.source_count).toBe(3);
    expect(r.json.bucket.distinct_providers).toBe(3);
    expect(r.json.bucket.fingerprint_hash).toBe("abc12345def67890");
    expect(r.json.mentions).toHaveLength(3);
    expect(r.json.mentions[1].cross_validator_confidence).toBeCloseTo(0.92);
    expect(r.json.mentions[0].source_provider).toBe("youtube");
  });

  it("returns cross_validated:false with fallback note when no bucket linked", async () => {
    const strategyId = "manual-injection-id-1";
    fixtures.strategyRow = {
      id: strategyId,
      name: "Manual MES strategy",
      source: "manual_injection",
    };
    // fixtures.bucketRow stays null

    const r = await getEvidence(strategyId);
    expect(r.status).toBe(200);
    expect(r.json.cross_validated).toBe(false);
    expect(r.json.bucket).toBeNull();
    expect(r.json.mentions).toEqual([]);
    expect(r.json.fallback_source_note).toContain("pre-dates the cross-validation layer");
    expect(r.json.fallback_source_note).toContain("manual_injection");
  });

  it("returns 404 when strategy does not exist", async () => {
    // fixtures.strategyRow stays null
    const r = await getEvidence("nonexistent-id");
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("Strategy not found");
  });

  it("returns empty mentions array when bucket exists but has zero mentions", async () => {
    const strategyId = "edge-case-id";
    const bucketId = "bucket-empty";
    fixtures.strategyRow = { id: strategyId, name: "Edge case", source: "scout" };
    fixtures.bucketRow = {
      id: bucketId,
      fingerprintHash: "edge0000",
      market: "MNQ",
      entryArchetype: "mean_reversion",
      exitType: "trailing_stop",
      sourceCount: 0,
      distinctProviders: 0,
      status: "graduated",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      graduatedAt: new Date().toISOString(),
      graduatedStrategyId: strategyId,
    };
    fixtures.mentionRows = [];

    const r = await getEvidence(strategyId);
    expect(r.status).toBe(200);
    expect(r.json.cross_validated).toBe(true);
    expect(r.json.bucket).not.toBeNull();
    expect(r.json.mentions).toEqual([]);
  });
});
