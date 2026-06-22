/**
 * wave25-naked-pocs-batch-endpoint.test.ts — Wave 25 Pass 3 P3.A5
 *
 * Coverage for POST /api/admin/liquidity-map/naked-pocs-batch:
 *  1. Happy path: valid body → 200 ok=true with upserted count
 *  2. Malformed body: missing symbol → 400
 *  3. Malformed body: invalid as_of_date → 400
 *  4. Malformed body: records not array → 400
 *  5. Idempotency: second call with same records UPSERTs zero new rows
 *  6. Audit row: liquidity_map.naked_pocs_batched fires with correlation_id
 *  7. Shared-secret check: header mismatch → 401 when env set
 *
 * Mocks the db layer + insertAuditRow. We exercise the actual Express router.
 */

import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// ─── Test state (hoisted so mocks see it) ────────────────────────────────────

const state = vi.hoisted(() => ({
  insertCalls: [] as Array<Record<string, unknown>>,
  existingByKey: new Map<string, { id: string }>(),
  auditRows: [] as Array<Record<string, unknown>>,
  insertShouldThrow: false,
}));

function keyOf(symbol: string, levelType: string, priceStr: string): string {
  return `${symbol}|${levelType}|${priceStr}`;
}

// ─── Mock the db module ──────────────────────────────────────────────────────
// We do NOT mock schema.ts (other admin route imports need real exports).

vi.mock("../db/index.js", () => {
  const db = {
    select: vi.fn(() => {
      // Local closure scope per query — captures the where args.
      let captured: { sym?: string; lt?: string; price?: string } = {};
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn((predicate: Record<string, unknown>) => {
          const preds = (predicate?.preds as Array<Record<string, unknown>>) ?? [];
          captured = {
            sym: preds.find((p) => p.col === "symbol")?.val as string | undefined,
            lt: preds.find((p) => p.col === "level_type")?.val as string | undefined,
            price: preds.find((p) => p.col === "price")?.val as string | undefined,
          };
          return chain;
        }),
        limit: vi.fn(async () => {
          if (!captured.sym || !captured.lt || !captured.price) return [];
          const k = keyOf(captured.sym, captured.lt, captured.price);
          const found = state.existingByKey.get(k);
          return found ? [found] : [];
        }),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async (row: Record<string, unknown>) => {
        if (state.insertShouldThrow) throw new Error("insert_failure_for_test");
        state.insertCalls.push(row);
        const symbol = row.symbol as string;
        const levelType = row.levelType as string;
        const price = row.price as string;
        state.existingByKey.set(keyOf(symbol, levelType, price), { id: `mock-${state.insertCalls.length}` });
      }),
    })),
  };
  return { db };
});

vi.mock("../db/schema.js", async (importOriginal) => {
  // Pull real exports for everything the route file imports, but stub
  // liquidityLevels with a minimal object that supports field access.
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    liquidityLevels: {
      id: { name: "id" },
      symbol: { name: "symbol" },
      sessionDate: { name: "session_date" },
      levelType: { name: "level_type" },
      price: { name: "price" },
      htfSignificance: { name: "htf_significance" },
      sourceMeta: { name: "source_meta" },
      sweepProbability: { name: "sweep_probability" },
      touchedCount: { name: "touched_count" },
      expiredAt: { name: "expired_at" },
      createdAt: { name: "created_at" },
    },
  };
});

// drizzle-orm `eq` reads field metadata — intercept select args so the mocked
// limit() can look up `existingByKey`. Side-effect captured via _last.
vi.mock("drizzle-orm", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    eq: (col: { name?: string }, val: unknown) => ({ _eq: true, col: col?.name, val }),
    and: (...preds: Array<Record<string, unknown>>) => ({ _and: true, preds }),
    sql: (strs: TemplateStringsArray) => ({ _sql: strs.join("?") }),
  };
});

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn(async (row: Record<string, unknown>) => {
    state.auditRows.push(row);
  }),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub other services pulled by admin.ts so we don't drag the world in.
vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: vi.fn(async () => "ACTIVE"),
  setMode: vi.fn(async () => ({ mode: "ACTIVE" })),
}));
vi.mock("../services/harsh-regime-phase-service.js", () => ({
  getPhaseRecord: vi.fn(async () => ({})),
  setPhaseOverride: vi.fn(async () => ({})),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));

// Wave hardening 2026-06-22, test isolation: admin.js transitively pulls in
// index.ts → agent.ts, whose module scope runs `new AgentService()` (agent.ts:85).
// Under partial mocking AgentService resolves undefined → "is not a constructor"
// and the whole suite is skipped. Provide a constructable stub so the agent
// route module loads and the 7 admin-route tests run.
vi.mock("../services/agent-service.js", () => ({
  AgentService: class {
    assertCrossValidatedSource = vi.fn();
  },
}));

// ─── Server setup ────────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { adminRoutes } = await import("../routes/admin.js");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/admin", adminRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.on("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
});

beforeEach(() => {
  state.insertCalls = [];
  state.existingByKey.clear();
  state.auditRows = [];
  state.insertShouldThrow = false;
  delete process.env.LIQUIDITY_MAP_BATCH_SECRET;
});

async function post(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/admin/liquidity-map/naked-pocs-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json: j };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/liquidity-map/naked-pocs-batch", () => {
  it("happy path: persists naked POC records and returns upserted count", async () => {
    const { status, json } = await post({
      symbol: "MES",
      as_of_date: "2026-05-24",
      records: [
        { session_date: "2026-05-20", price: 5312.25, age_days: 2, establishing_high: 5320.0, establishing_low: 5298.75, establishing_volume: 18432.0 },
        { session_date: "2026-05-19", price: 5285.5,  age_days: 3, establishing_high: 5295.0, establishing_low: 5275.25, establishing_volume: 14000.0 },
      ],
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.symbol).toBe("MES");
    expect(json.as_of_date).toBe("2026-05-24");
    expect(json.upserted).toBe(2);
    expect(json.correlation_id).toBeTruthy();
    expect(state.insertCalls).toHaveLength(2);
    // All inserts must be level_type='naked_poc' with htf_significance=2
    for (const row of state.insertCalls) {
      expect(row.levelType).toBe("naked_poc");
      expect(row.htfSignificance).toBe(2);
      expect(row.symbol).toBe("MES");
      // source_meta must carry establishing fields and naked_poc_session
      const meta = row.sourceMeta as Record<string, unknown>;
      expect(meta.naked_poc_session).toBeTruthy();
      expect(meta.source).toBe("naked_poc_sync_cron");
    }
  });

  it("400 when symbol missing", async () => {
    const { status, json } = await post({ as_of_date: "2026-05-24", records: [] });
    expect(status).toBe(400);
    expect(json.error).toBe("missing_or_invalid_field");
    expect(json.field).toBe("symbol");
  });

  it("400 when as_of_date is malformed", async () => {
    const { status, json } = await post({ symbol: "MES", as_of_date: "May 24 2026", records: [] });
    expect(status).toBe(400);
    expect(json.field).toBe("as_of_date");
  });

  it("400 when records is not an array", async () => {
    const { status, json } = await post({ symbol: "MES", as_of_date: "2026-05-24", records: "nope" });
    expect(status).toBe(400);
    expect(json.field).toBe("records");
  });

  it("idempotent: second call with same records does not re-insert", async () => {
    const body = {
      symbol: "MES",
      as_of_date: "2026-05-24",
      records: [
        { session_date: "2026-05-20", price: 5312.25, age_days: 2, establishing_high: 5320.0, establishing_low: 5298.75, establishing_volume: 18432.0 },
      ],
    };
    const first = await post(body);
    expect(first.status).toBe(200);
    expect(first.json.upserted).toBe(1);

    const second = await post(body);
    expect(second.status).toBe(200);
    expect(second.json.upserted).toBe(0);
    expect(state.insertCalls).toHaveLength(1);
  });

  it("emits liquidity_map.naked_pocs_batched audit row carrying correlation_id", async () => {
    const { json } = await post({
      symbol: "MES",
      as_of_date: "2026-05-24",
      records: [{ session_date: "2026-05-20", price: 5312.25, age_days: 2, establishing_high: 5320.0, establishing_low: 5298.75, establishing_volume: 18432.0 }],
    });

    expect(state.auditRows).toHaveLength(1);
    const audit = state.auditRows[0];
    expect(audit.action).toBe("liquidity_map.naked_pocs_batched");
    expect(audit.entityType).toBe("liquidity_levels");
    expect(audit.correlationId).toBe(json.correlation_id);
    expect(audit.status).toBe("success");
  });

  it("401 when shared-secret env set and header missing/wrong", async () => {
    process.env.LIQUIDITY_MAP_BATCH_SECRET = "test-secret-xyz";
    const { status, json } = await post(
      { symbol: "MES", as_of_date: "2026-05-24", records: [] },
      { "x-liquidity-map-secret": "wrong-secret" },
    );
    expect(status).toBe(401);
    expect(json.error).toBe("shared_secret_mismatch");

    // Correct header passes
    const ok = await post(
      { symbol: "MES", as_of_date: "2026-05-24", records: [] },
      { "x-liquidity-map-secret": "test-secret-xyz" },
    );
    expect(ok.status).toBe(200);
  });
});
