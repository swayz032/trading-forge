import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB.execute pipeline ─────────────────────────────────────────
// assembleCribData issues 7 queries in deterministic order. We route by
// call index instead of by SQL content (Drizzle sql templates don't stringify
// usefully).
const ORDER = ["today", "open", "pot", "kill", "discord", "potRows", "crew"] as const;
type QueryKey = typeof ORDER[number];

let responses: Record<QueryKey, unknown[]> = freshResponses();

function freshResponses(): Record<QueryKey, unknown[]> {
  return {
    today: [{ today_pnl: 2847, trades_today: 7, wins: 5, losses: 2 }],
    open: [{ open_now: 2 }],
    pot: [{ in_pot: 14 }],
    kill: [{ value: "true" }],
    discord: [
      { name: "ICT Killzones", source: "youtube", status: "queued", age_min: 2 },
      { name: "FVG Setup", source: "discord", status: "extracting", age_min: 11 },
    ],
    potRows: [
      { id: "s1", name: "vwap-band-mes", stage: "TESTING", net_pnl: 1247, trades_count: 28 },
      { id: "s2", name: "orb-mnq-15m", stage: "PAPER", net_pnl: 418, trades_count: 9 },
    ],
    crew: [
      { jersey: 25, display_name: "Tonio", week_pnl: 3108 },
      { jersey: 11, display_name: "Cuz", week_pnl: 1847 },
    ],
  };
}

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../db/index.js", () => ({
  db: { execute: mocks.execute },
}));

describe("crib-data", () => {
  beforeEach(() => {
    responses = freshResponses();
    let i = 0;
    mocks.execute.mockReset();
    mocks.execute.mockImplementation(() => {
      const key = ORDER[i++];
      return Promise.resolve(responses[key] ?? []);
    });
  });

  it("returns banner + discordFeed + pot + crew shape", async () => {
    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000001" });
    expect(data.banner.todayBag).toBe("+$2,847");
    expect(data.banner.tradesToday.count).toBe(7);
    expect(data.banner.tradesToday.wins).toBe(5);
    expect(data.banner.tradesToday.losses).toBe(2);
    expect(data.banner.openNow).toBe(2);
    expect(data.banner.inPot).toBe(14);
    expect(data.banner.killSwitch).toBe("green");
    expect(data.discordFeed).toHaveLength(2);
    expect(data.discordFeed[0].name).toBe("ICT Killzones");
    expect(data.pot).toHaveLength(2);
    expect(data.pot[0].netPnl).toBe("+$1,247");
    expect(data.crew).toHaveLength(2);
    expect(data.crew[0].weekBag).toBe("+$3,108");
  });

  it("fails-soft to zero/empty on DB errors", async () => {
    mocks.execute.mockReset();
    mocks.execute.mockRejectedValue(new Error("db down"));
    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000002" });
    expect(data.banner.todayBag).toBe("$0");
    expect(data.banner.tradesToday.count).toBe(0);
    expect(data.banner.openNow).toBe(0);
    expect(data.banner.killSwitch).toBe("green"); // missing kill row = green default
    expect(data.discordFeed).toEqual([]);
    expect(data.pot).toEqual([]);
    expect(data.crew).toEqual([]);
  });

  it("treats system_parameters.pipeline_active='false' as kill switch RED", async () => {
    responses.kill = [{ value: "false" }];
    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000003" });
    expect(data.banner.killSwitch).toBe("red");
  });

  it("handles missing rows defensively (zero everything)", async () => {
    responses.today = [];
    responses.open = [];
    responses.pot = [];
    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000004" });
    expect(data.banner.todayBag).toBe("$0");
    expect(data.banner.openNow).toBe(0);
    expect(data.banner.inPot).toBe(0);
  });
});
