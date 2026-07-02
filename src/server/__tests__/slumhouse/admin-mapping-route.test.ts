import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  insertCalled: [] as any[],
  insertOnConflict: vi.fn().mockResolvedValue(undefined),
  selectMock: vi.fn().mockResolvedValue([{ discordUserId: "111", displayName: "Kee", brokerAccountId: "acct-1", jerseyNumber: 25 }]),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../db/index.js", () => ({
  db: {
    insert: () => ({ values: (v: any) => { mocks.insertCalled.push(v); return { onConflictDoUpdate: mocks.insertOnConflict }; } }),
    select: () => ({ from: () => mocks.selectMock() }),
  },
}));

vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mocks.insertAuditRowSafe,
}));

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
  };
  return res;
}

describe("slumhouse admin mapping route", () => {
  beforeEach(() => {
    mocks.insertCalled.length = 0;
    mocks.insertAuditRowSafe.mockClear();
    // FIX 6: requireKeyOrAdminSession guard requires API key or admin session.
    // Use a known API key + Bearer token so all tests pass the guard.
    process.env.API_KEY = "test-api-key";
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it("postSlumhouseUser upserts a mapping row + audits", async () => {
    const { postSlumhouseUser } = await import("../../routes/slumhouse/admin-mapping.js");
    const req = { body: { discord_user_id: "111", display_name: "Kee", broker_account_id: "acct-1", jersey_number: 25 }, headers: { authorization: "Bearer test-api-key" } } as any;
    const res = mockRes();
    await postSlumhouseUser(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.insertCalled[0]).toMatchObject({
      discordUserId: "111",
      displayName: "Kee",
      brokerAccountId: "acct-1",
      jerseyNumber: 25,
    });
    expect(mocks.insertAuditRowSafe).toHaveBeenCalledWith(expect.objectContaining({ action: "slumhouse.user_mapped" }));
  });

  it("postSlumhouseUser rejects missing discord_user_id", async () => {
    const { postSlumhouseUser } = await import("../../routes/slumhouse/admin-mapping.js");
    const req = { body: { display_name: "Kee" }, headers: { authorization: "Bearer test-api-key" } } as any;
    const res = mockRes();
    await postSlumhouseUser(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("discord_user_id_required");
  });

  it("postSlumhouseUser rejects missing display_name", async () => {
    const { postSlumhouseUser } = await import("../../routes/slumhouse/admin-mapping.js");
    const req = { body: { discord_user_id: "111" }, headers: { authorization: "Bearer test-api-key" } } as any;
    const res = mockRes();
    await postSlumhouseUser(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("display_name_required");
  });

  it("postSlumhouseUser accepts null broker_account_id (unmapped friend)", async () => {
    const { postSlumhouseUser } = await import("../../routes/slumhouse/admin-mapping.js");
    const req = { body: { discord_user_id: "222", display_name: "Trav" }, headers: { authorization: "Bearer test-api-key" } } as any;
    const res = mockRes();
    await postSlumhouseUser(req, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.insertCalled[0].brokerAccountId).toBeNull();
  });

  it("listSlumhouseUsers returns mappings", async () => {
    const { listSlumhouseUsers } = await import("../../routes/slumhouse/admin-mapping.js");
    const res = mockRes();
    await listSlumhouseUsers({ headers: { authorization: "Bearer test-api-key" } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].displayName).toBe("Kee");
  });

  it("rejects unauthenticated request with 403 (FIX 6 — requireKeyOrAdminSession guard)", async () => {
    const { postSlumhouseUser } = await import("../../routes/slumhouse/admin-mapping.js");
    // No authorization header and no admin session cookie — guard must reject.
    const req = { body: { discord_user_id: "111", display_name: "Kee" }, headers: {} } as any;
    const res = mockRes();
    await postSlumhouseUser(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("forbidden");
    // Guard must block before any DB write.
    expect(mocks.insertCalled).toHaveLength(0);
  });
});
