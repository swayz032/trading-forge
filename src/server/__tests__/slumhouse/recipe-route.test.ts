import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assembleRecipeData: vi.fn().mockResolvedValue({
    identity: { id: "s1", name: "vwap", symbol: "MES", stationStreet: "On the Menu", lifecycleState: "DEPLOYED" },
    slumdawgScore: 84, backtest: {}, monteCarlo: {}, calendar: [], otherTests: [],
  }),
}));

vi.mock("../../lib/slumhouse/recipe-data.js", () => ({ assembleRecipeData: mocks.assembleRecipeData }));
vi.mock("../../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }), execute: vi.fn().mockResolvedValue([]) },
}));

function mockRes() {
  const res: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
  return res;
}

beforeEach(() => mocks.assembleRecipeData.mockClear());

describe("recipe api route", () => {
  it("returns recipe data for a strategy id", async () => {
    const { getRecipe } = await import("../../routes/slumhouse/api/recipe.js");
    const req: any = { params: { strategyId: "s1" } };
    const res = mockRes();
    await getRecipe(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.slumdawgScore).toBe(84);
    expect(mocks.assembleRecipeData).toHaveBeenCalledWith({ strategyId: "s1" });
  });

  it("returns 400 when strategy id missing", async () => {
    const { getRecipe } = await import("../../routes/slumhouse/api/recipe.js");
    const req: any = { params: {} };
    const res = mockRes();
    await getRecipe(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when strategy not found", async () => {
    mocks.assembleRecipeData.mockRejectedValueOnce(new Error("strategy_not_found:abc"));
    const { getRecipe } = await import("../../routes/slumhouse/api/recipe.js");
    const req: any = { params: { strategyId: "abc" } };
    const res = mockRes();
    await getRecipe(req, res);
    expect(res.statusCode).toBe(404);
  });
});
