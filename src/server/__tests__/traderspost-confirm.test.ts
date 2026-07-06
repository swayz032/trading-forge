/**
 * traderspost-confirm.test.ts — Option B (deep-scan A) webhook consumer.
 *
 * Behavioral tests of the exported handler with a mocked db (the handler transitively imports
 * the real db, which boots on import — same mock-the-db convention as production-status.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  updateReturning: [] as Array<{ id: number }>, // rows stamped by the UPDATE
  selectRows: [] as Array<{ id: number }>,       // rows found by the follow-up SELECT
  audits: [] as string[],
}));

vi.mock("../db/index.js", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mockState.updateReturning),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mockState.selectRows),
        })),
      })),
    })),
  },
}));
vi.mock("../db/schema.js", () => ({ productionTrades: { traderspostWebhookId: {}, traderspostConfirmedAt: {}, id: {} } }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async (v: { action: string }) => { mockState.audits.push(v.action); return true; }),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(() => ({})), eq: vi.fn(() => ({})), isNull: vi.fn(() => ({})), sql: vi.fn(() => ({})) }));

import { handleTradersPostOrderStatus, extractWebhookId } from "../routes/traderspost-confirm.js";

function mockRes() {
  const captured = { status: 0, body: undefined as unknown };
  const res = {
    status: (c: number) => { captured.status = c; return { json: (b: unknown) => { captured.body = b; return b; } }; },
  };
  return { res, captured };
}
function req(body: unknown, headers: Record<string, string> = {}) {
  return { body, header: (n: string) => headers[n] };
}

beforeEach(() => {
  mockState.updateReturning = [];
  mockState.selectRows = [];
  mockState.audits = [];
  delete process.env.TRADERSPOST_CONFIRM_SECRET;
});

describe("extractWebhookId", () => {
  it("reads webhook_id / webhookId / external_id / externalId / reference", () => {
    expect(extractWebhookId({ webhook_id: "a" })).toBe("a");
    expect(extractWebhookId({ webhookId: "b" })).toBe("b");
    expect(extractWebhookId({ external_id: "c" })).toBe("c");
    expect(extractWebhookId({ externalId: "d" })).toBe("d");
    expect(extractWebhookId({ reference: "e" })).toBe("e");
    expect(extractWebhookId({ foo: "x" })).toBeNull();
    expect(extractWebhookId({ webhook_id: "" })).toBeNull();
  });
});

describe("handleTradersPostOrderStatus", () => {
  it("401 + audit when a secret is configured and the header is wrong", async () => {
    process.env.TRADERSPOST_CONFIRM_SECRET = "s3cret";
    const { res, captured } = mockRes();
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }, { "X-TradersPost-Confirm-Secret": "wrong" }), res);
    expect(captured.status).toBe(401);
    expect(mockState.audits).toContain("traderspost.order_confirm_unauthorized");
  });

  it("proceeds when no secret is configured", async () => {
    const { res, captured } = mockRes();
    mockState.updateReturning = [{ id: 7 }];
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }), res);
    expect(captured.status).toBe(200);
  });

  it("400 when webhook id is missing", async () => {
    const { res, captured } = mockRes();
    await handleTradersPostOrderStatus(req({ nope: 1 }), res);
    expect(captured.status).toBe(400);
  });

  it("matched: stamps and returns matched=true + order_confirmed audit", async () => {
    const { res, captured } = mockRes();
    mockState.updateReturning = [{ id: 42 }];
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }), res);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, matched: true, alreadyConfirmed: false });
    expect(mockState.audits).toContain("traderspost.order_confirmed");
  });

  it("idempotent replay: no stamp but row exists → alreadyConfirmed=true + idempotent audit", async () => {
    const { res, captured } = mockRes();
    mockState.updateReturning = [];        // nothing stamped (already confirmed)
    mockState.selectRows = [{ id: 42 }];   // but the row exists
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }), res);
    expect(captured.body).toMatchObject({ matched: false, alreadyConfirmed: true });
    expect(mockState.audits).toContain("traderspost.order_confirm_idempotent_skip");
  });

  it("no match: unknown id → matched=false, alreadyConfirmed=false + no_match audit (still 200)", async () => {
    const { res, captured } = mockRes();
    mockState.updateReturning = [];
    mockState.selectRows = [];
    await handleTradersPostOrderStatus(req({ webhook_id: "unknown" }), res);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ matched: false, alreadyConfirmed: false });
    expect(mockState.audits).toContain("traderspost.order_confirm_no_match");
  });
});
