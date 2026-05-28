import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assembleCribData: vi.fn().mockResolvedValue({
    banner: { todayBag: "+$2,847", tradesToday: { count: 7, wins: 5, losses: 2 }, openNow: 2, inPot: 14, killSwitch: "green" },
    discordFeed: [],
    pot: [],
    crew: [],
  }),
  select: vi.fn().mockResolvedValue([{ discordUserId: "111", brokerAccountId: "00000000-0000-0000-0000-000000000001", displayName: "Kee" }]),
}));

vi.mock("../../lib/slumhouse/crib-data.js", () => ({ assembleCribData: mocks.assembleCribData }));
vi.mock("../../db/index.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => mocks.select() }) }),
  },
}));

function mockRes() {
  const res: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
  return res;
}

beforeEach(() => {
  process.env.SLUMHOUSE_SESSION_SECRET = "test-secret-32-chars-min-xxxxxxxxxx";
  mocks.assembleCribData.mockClear();
  mocks.select.mockClear();
  mocks.select.mockResolvedValue([{ discordUserId: "111", brokerAccountId: "00000000-0000-0000-0000-000000000001", displayName: "Kee" }]);
});

describe("crib api route", () => {
  it("returns 401 without session cookie", async () => {
    const { requireSlumhouseUser } = await import("../../lib/slumhouse/require-session.js");
    const req: any = { headers: {} };
    const res = mockRes();
    await requireSlumhouseUser(req, res, () => { throw new Error("next called"); });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("no_session");
  });

  it("returns 401 with tampered cookie", async () => {
    const { requireSlumhouseUser } = await import("../../lib/slumhouse/require-session.js");
    const req: any = { headers: { cookie: "slumhouse_sid=tampered:123:badsig" } };
    const res = mockRes();
    await requireSlumhouseUser(req, res, () => { throw new Error("next"); });
    expect(res.statusCode).toBe(401);
  });

  it("allows a session when user is present but broker_account_id is null", async () => {
    mocks.select.mockResolvedValue([{ discordUserId: "111", brokerAccountId: null, displayName: "Kee" }]);
    const { signSession } = await import("../../lib/slumhouse/session.js");
    const sid = signSession({ discordUserId: "111", ttlSec: 60 });
    const { requireSlumhouseUser } = await import("../../lib/slumhouse/require-session.js");
    const req: any = { headers: { cookie: `slumhouse_sid=${sid}` } };
    const res = mockRes();
    let nextCalled = false;
    await requireSlumhouseUser(req, res, () => { nextCalled = true; });
    expect(res.statusCode).toBe(200);
    expect(nextCalled).toBe(true);
    expect(req.slumhouseUser?.brokerAccountId).toBeNull();
  });

  it("calls assembleCribData with null brokerAccountId for unmapped session", async () => {
    const { signSession } = await import("../../lib/slumhouse/session.js");
    const sid = signSession({ discordUserId: "111", ttlSec: 60 });
    const { getCrib } = await import("../../routes/slumhouse/api/crib.js");
    const req: any = { headers: { cookie: `slumhouse_sid=${sid}` }, slumhouseUser: { discordUserId: "111", brokerAccountId: null } };
    const res = mockRes();
    await getCrib(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.banner.todayBag).toBe("+$2,847");
    expect(mocks.assembleCribData).toHaveBeenCalledWith({ brokerAccountId: null });
  });
});
