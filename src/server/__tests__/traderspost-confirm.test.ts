/**
 * traderspost-confirm.test.ts — Option B (deep-scan A) webhook consumer.
 *
 * Behavioral tests of the exported handler with a mocked db (the handler transitively imports
 * the real db, which boots on import — same mock-the-db convention as production-status.test.ts).
 * Covers auth, idempotency, the S-1 production secret guard, and correlation_id/entityId threading.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type AuditRow = { action: string; entityId: string | null; correlationId: string | null };
const mockState = vi.hoisted(() => ({
  updateReturning: [] as Array<{ id: number; correlationId: string | null }>,
  selectRows: [] as Array<{ id: number; correlationId: string | null }>,
  audits: [] as AuditRow[],
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
vi.mock("../db/schema.js", () => ({ productionTrades: { traderspostWebhookId: {}, traderspostConfirmedAt: {}, id: {}, correlationId: {} } }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async (v: { action: string; entityId?: string | null; correlationId?: string | null }) => {
    mockState.audits.push({ action: v.action, entityId: v.entityId ?? null, correlationId: v.correlationId ?? null });
    return true;
  }),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(() => ({})), eq: vi.fn(() => ({})), isNull: vi.fn(() => ({})), sql: vi.fn(() => ({})) }));

import { handleTradersPostOrderStatus, extractWebhookId, traderspostConfirmSecretRequired } from "../routes/traderspost-confirm.js";

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
const actions = () => mockState.audits.map((a) => a.action);

beforeEach(() => {
  mockState.updateReturning = [];
  mockState.selectRows = [];
  mockState.audits = [];
  delete process.env.TRADERSPOST_CONFIRM_SECRET;
  delete process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT;
  delete process.env.NODE_ENV;
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

describe("traderspostConfirmSecretRequired (S-1)", () => {
  it("true only when NODE_ENV=production AND the independent leg is on", () => {
    expect(traderspostConfirmSecretRequired()).toBe(false);
    process.env.NODE_ENV = "production";
    expect(traderspostConfirmSecretRequired()).toBe(false);
    process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT = "true";
    expect(traderspostConfirmSecretRequired()).toBe(true);
    process.env.NODE_ENV = "development";
    expect(traderspostConfirmSecretRequired()).toBe(false);
  });
});

describe("handleTradersPostOrderStatus", () => {
  it("S-1: 503 + misconfigured audit when independent leg is live in prod but no secret set", async () => {
    process.env.NODE_ENV = "production";
    process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT = "true";
    const { res, captured } = mockRes();
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }), res);
    expect(captured.status).toBe(503);
    expect(actions()).toContain("traderspost.order_confirm_misconfigured");
    expect(mockState.audits[0].correlationId).toBeTruthy(); // never un-correlatable
  });

  it("401 + audit when a secret is configured and the header is wrong", async () => {
    process.env.TRADERSPOST_CONFIRM_SECRET = "s3cret";
    const { res, captured } = mockRes();
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }, { "X-TradersPost-Confirm-Secret": "wrong" }), res);
    expect(captured.status).toBe(401);
    expect(actions()).toContain("traderspost.order_confirm_unauthorized");
  });

  it("proceeds when no secret is configured (non-prod)", async () => {
    const { res, captured } = mockRes();
    mockState.updateReturning = [{ id: 7, correlationId: null }];
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }), res);
    expect(captured.status).toBe(200);
  });

  it("400 when webhook id is missing", async () => {
    const { res, captured } = mockRes();
    await handleTradersPostOrderStatus(req({ nope: 1 }), res);
    expect(captured.status).toBe(400);
  });

  it("matched: stamps, sets entityId from the row, and carries the row's correlation_id", async () => {
    const { res, captured } = mockRes();
    mockState.updateReturning = [{ id: 42, correlationId: "corr-42" }];
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }), res);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, matched: true, alreadyConfirmed: false });
    const row = mockState.audits.find((a) => a.action === "traderspost.order_confirmed");
    expect(row?.entityId).toBe("42");
    expect(row?.correlationId).toBe("corr-42"); // joined back to the production_trades row
  });

  it("inbound X-Correlation-Id wins over the row's correlation_id", async () => {
    const { res } = mockRes();
    mockState.updateReturning = [{ id: 42, correlationId: "corr-42" }];
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }, { "X-Correlation-Id": "inbound-9" }), res);
    const row = mockState.audits.find((a) => a.action === "traderspost.order_confirmed");
    expect(row?.correlationId).toBe("inbound-9");
  });

  it("idempotent replay: no stamp but row exists → alreadyConfirmed=true, entityId + correlation from the row", async () => {
    const { res, captured } = mockRes();
    mockState.updateReturning = [];
    mockState.selectRows = [{ id: 42, correlationId: "corr-42" }];
    await handleTradersPostOrderStatus(req({ webhook_id: "k1" }), res);
    expect(captured.body).toMatchObject({ matched: false, alreadyConfirmed: true });
    const row = mockState.audits.find((a) => a.action === "traderspost.order_confirm_idempotent_skip");
    expect(row?.entityId).toBe("42");
    expect(row?.correlationId).toBe("corr-42");
  });

  it("no match: unknown id → matched=false + no_match audit (still 200), correlation minted not null", async () => {
    const { res, captured } = mockRes();
    mockState.updateReturning = [];
    mockState.selectRows = [];
    await handleTradersPostOrderStatus(req({ webhook_id: "unknown" }), res);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ matched: false, alreadyConfirmed: false });
    const row = mockState.audits.find((a) => a.action === "traderspost.order_confirm_no_match");
    expect(row?.entityId).toBeNull();
    expect(row?.correlationId).toBeTruthy(); // minted fallback — never un-correlatable
  });
});
