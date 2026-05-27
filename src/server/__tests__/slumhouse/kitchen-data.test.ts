import { describe, it, expect, vi, beforeEach } from "vitest";

// assembleKitchenData issues 2 queries (group counts + ingest count) in order
// assembleTodaysMenu issues 1 query (deployed strategies)
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../db/index.js", () => ({ db: { execute: mocks.execute } }));

describe("kitchen-data", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  it("assembleKitchenData maps lifecycle counts to 6 stages + totals", async () => {
    // first call: group counts
    // second call: ingest count
    mocks.execute
      .mockResolvedValueOnce([
        { lifecycle_state: "CANDIDATE", count: 31 },
        { lifecycle_state: "TESTING", count: 9 },
        { lifecycle_state: "SHADOW", count: 2 },
        { lifecycle_state: "PAPER", count: 3 },
        { lifecycle_state: "DEPLOY_READY", count: 1 },
        { lifecycle_state: "PILOT", count: 2 },
        { lifecycle_state: "DEPLOYED", count: 4 },
        { lifecycle_state: "GRAVEYARD", count: 23 },
      ])
      .mockResolvedValueOnce([{ ingest_count: 17 }]);

    const { assembleKitchenData } = await import("../../lib/slumhouse/kitchen-data.js");
    const data = await assembleKitchenData();

    expect(data.stages.find((s) => s.name === "Ingredients")?.count).toBe(17);
    expect(data.stages.find((s) => s.name === "Prep Station")?.count).toBe(31);
    expect(data.stages.find((s) => s.name === "On the Stove")?.count).toBe(11); // 9+2
    expect(data.stages.find((s) => s.name === "Taste Test")?.count).toBe(3);
    expect(data.stages.find((s) => s.name === "Small Plates")?.count).toBe(3);  // 1+2
    expect(data.stages.find((s) => s.name === "On the Menu")?.count).toBe(4);
    expect(data.totalCooking).toBe(31 + 11 + 3 + 3);
    expect(data.totalOnMenu).toBe(4);
    expect(data.totalTossed).toBe(23);
  });

  it("assembleKitchenData fails-soft on DB error", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    const { assembleKitchenData } = await import("../../lib/slumhouse/kitchen-data.js");
    const data = await assembleKitchenData();
    expect(data.totalCooking).toBe(0);
    expect(data.totalOnMenu).toBe(0);
    expect(data.totalTossed).toBe(0);
    expect(data.stages).toHaveLength(6);
    for (const s of data.stages) expect(s.count).toBe(0);
  });

  it("assembleTodaysMenu returns dishes with translated symbol + monthly $", async () => {
    mocks.execute.mockResolvedValueOnce([
      { id: "s1", name: "vwap-band-mes", symbol: "MES", month_pnl: 8420, trades: 208, latest_critique: "Bread and butter." },
      { id: "s2", name: "killzone-mnq", symbol: "MNQ", month_pnl: 5180, trades: 94, latest_critique: null },
    ]);
    const { assembleTodaysMenu } = await import("../../lib/slumhouse/kitchen-data.js");
    const dishes = await assembleTodaysMenu();

    expect(dishes).toHaveLength(2);
    expect(dishes[0].dishName).toContain("Mini-S&P");
    expect(dishes[0].monthMade).toBe("+$8,420");
    expect(dishes[0].plays).toBe(208);
    expect(dishes[0].avgPerPlay).toBeCloseTo(40.48, 1);
    expect(dishes[0].slumdawgNote).toBe("Bread and butter.");
    expect(dishes[1].dishName).toContain("Mini-Nasdaq");
    expect(dishes[1].slumdawgNote).toBeNull();
  });

  it("assembleTodaysMenu handles zero-trades dishes", async () => {
    mocks.execute.mockResolvedValueOnce([
      { id: "s1", name: "fresh-deployed", symbol: "MES", month_pnl: 0, trades: 0, latest_critique: null },
    ]);
    const { assembleTodaysMenu } = await import("../../lib/slumhouse/kitchen-data.js");
    const dishes = await assembleTodaysMenu();
    expect(dishes[0].monthMade).toBe("$0");
    expect(dishes[0].avgPerPlay).toBe(0);
  });

  it("assembleTodaysMenu fails-soft on DB error", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    const { assembleTodaysMenu } = await import("../../lib/slumhouse/kitchen-data.js");
    const dishes = await assembleTodaysMenu();
    expect(dishes).toEqual([]);
  });
});
