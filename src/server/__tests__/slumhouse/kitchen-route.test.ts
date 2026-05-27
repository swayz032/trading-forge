import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assembleKitchenData: vi.fn().mockResolvedValue({
    stages: [{ name: "On the Menu", subtitle: "", count: 4, countLabel: "" }],
    totalCooking: 14, totalOnMenu: 4, totalTossed: 23,
  }),
  assembleTodaysMenu: vi.fn().mockResolvedValue([
    { id: "s1", dishName: "vwap-band-mes · Mini-S&P", monthMade: "+$8,420", plays: 208, avgPerPlay: 40.48, slumdawgNote: "Bread and butter.", recentDailyPnL: [] },
  ]),
}));

vi.mock("../../lib/slumhouse/kitchen-data.js", () => ({
  assembleKitchenData: mocks.assembleKitchenData,
  assembleTodaysMenu: mocks.assembleTodaysMenu,
}));

vi.mock("../../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }), execute: vi.fn().mockResolvedValue([]) },
}));

function mockRes() {
  const res: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
  return res;
}

beforeEach(() => {
  mocks.assembleKitchenData.mockClear();
  mocks.assembleTodaysMenu.mockClear();
});

describe("kitchen api routes", () => {
  it("getKitchen returns pipeline data", async () => {
    const { getKitchen } = await import("../../routes/slumhouse/api/kitchen.js");
    const res = mockRes();
    await getKitchen({} as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.totalOnMenu).toBe(4);
    expect(mocks.assembleKitchenData).toHaveBeenCalledOnce();
  });

  it("getMenu returns dishes wrapped in {dishes:[...]} shape", async () => {
    const { getMenu } = await import("../../routes/slumhouse/api/kitchen.js");
    const res = mockRes();
    await getMenu({} as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.dishes).toHaveLength(1);
    expect(res.body.dishes[0].monthMade).toBe("+$8,420");
  });
});
