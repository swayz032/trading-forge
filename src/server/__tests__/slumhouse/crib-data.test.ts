import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock execution-mode for live-mode tests ──────────────────────────────
// Default: returns "paper" (matches natural env behavior; existing tests unaffected).
let _mockMode: "paper" | "live" = "paper";
vi.mock("../../lib/execution-mode.js", () => ({
  getExecutionMode: vi.fn(() => Promise.resolve(_mockMode)),
  isLiveExecutionConfigured: vi.fn(() => false),
}));

// ─── Mock the DB.execute pipeline ─────────────────────────────────────────
// assembleCribData issues 8 queries in deterministic order for the legacy DB
// fallback path. We route by
// call index instead of by SQL content (Drizzle sql templates don't stringify
// usefully).
const ORDER = ["today", "open", "pot", "kill", "sparkPnl", "discord", "potRows", "crew"] as const;
type QueryKey = typeof ORDER[number];

let responses: Record<QueryKey, unknown[]> = freshResponses();

function freshResponses(): Record<QueryKey, unknown[]> {
  return {
    today: [{ today_pnl: 2847, trades_today: 7, wins: 5, losses: 2 }],
    open: [{ open_now: 2 }],
    pot: [{ in_pot: 14 }],
    // DS19: kill-switch reads system_parameters.current_value WHERE param_name='pipeline_mode'.
    // Numeric mode code — "1"=ACTIVE (the only green state), "0"=PAUSED/"2"=VACATION/"3"=AUTOPAUSE (red).
    kill: [{ current_value: "1" }],
    sparkPnl: [
      { d: "2026-05-21", pnl: 412, cnt: 3 },
      { d: "2026-05-22", pnl: -98, cnt: 2 },
      { d: "2026-05-23", pnl: 705, cnt: 4 },
    ],
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
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.SLUMDAWG_FEED_PROXY_URL;
    delete process.env.DISCORD_CH_SLUMDAWG_FEED;
    responses = freshResponses();
    let i = 0;
    mocks.execute.mockReset();
    mocks.execute.mockImplementation(() => {
      const key = ORDER[i++];
      return Promise.resolve(responses[key] ?? []);
    });
    // Default fetch mock: return a failed response to force DB fallback
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("keeps accepted Discord/Youtube ideas visible after they graduate into the library", async () => {
    responses.discord = [
      { name: "YT Momentum Breakout", source: "youtube_transcript_npm", status: "accepted", age_min: 4, sort_at: "2026-05-29T10:00:00Z" },
      { name: "Discord FVG Setup", source: "discord", status: "rejected", age_min: 6 },
      { name: "Discord Mean Reversion", source: "discord", status: "graduated", age_min: 9, sort_at: "2026-05-29T10:05:00Z" },
    ];

    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000001" });

    expect(data.discordFeed).toHaveLength(2);
    expect(data.discordFeed.map((row) => row.name)).toEqual([
      "Discord Mean Reversion",
      "YT Momentum Breakout",
    ]);
    expect(data.discordFeed.map((row) => row.status)).toEqual(["graduated", "accepted"]);
  });

  it("prefers the live Discord channel when the bot token is present", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ([
        {
          author: { bot: true },
          embeds: [
            {
              title: "🔥 Slumdawg cooked it — play extracted",
              fields: [
                { name: "Video", value: "**BEST MACD Trading Strategy [86% Win Rate]**" },
              ],
              timestamp: "2026-05-29T08:09:07.000Z",
            },
          ],
          referenced_message: {
            title: "BEST MACD Trading Strategy [86% Win Rate]",
            content: "https://www.youtube.com/watch?v=abc123def45",
            embeds: [
              {
                provider: { name: "YouTube" },
              },
            ],
          },
          timestamp: "2026-05-29T08:09:07.000Z",
        },
      ]),
    }) as any));

    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000005" });

    expect(data.discordFeed).toHaveLength(1);
    expect(data.discordFeed[0]).toMatchObject({
      name: "BEST MACD Trading Strategy [86% Win Rate]",
      source: "youtube",
      status: "graduated",
    });
  });

  it("fails-soft to zero/empty on DB errors", async () => {
    mocks.execute.mockReset();
    mocks.execute.mockRejectedValue(new Error("db down"));
    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000002" });
    // WHY: formatBag() prefixes a sign for all values incl. zero (val>=0 → "+");
    // formatBag(0) === "+$0". Test fixture predated the sign-prefix formatter.
    expect(data.banner.todayBag).toBe("+$0");
    expect(data.banner.tradesToday.count).toBe(0);
    expect(data.banner.openNow).toBe(0);
    // DS19 (H-crib): kill-switch reads now fail SAFE to red — a DB error must NEVER show
    // a false green on the family crib (was "green default" under the old swallowed-error bug).
    expect(data.banner.killSwitch).toBe("red");
    expect(data.discordFeed).toEqual([]);
    expect(data.pot).toEqual([]);
    expect(data.crew).toEqual([]);
  });

  // DS19 (H-crib): pipeline_mode is a numeric mode code. Green ONLY when ACTIVE ("1");
  // every paused/halted mode + missing row must read red on the family crib.
  it("treats pipeline_mode='1' (ACTIVE) as kill switch GREEN", async () => {
    responses.kill = [{ current_value: "1" }];
    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000003" });
    expect(data.banner.killSwitch).toBe("green");
  });

  it.each([
    ["0", "PAUSED"],
    ["2", "VACATION"],
    ["3", "AUTOPAUSE_DD_VELOCITY"],
  ])("treats pipeline_mode='%s' (%s) as kill switch RED", async (modeCode) => {
    responses.kill = [{ current_value: modeCode }];
    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000003" });
    expect(data.banner.killSwitch).toBe("red");
  });

  it("treats a MISSING pipeline_mode row as kill switch RED (never a false green)", async () => {
    responses.kill = [];
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
    // WHY: formatBag(0) === "+$0" (sign-prefixed). See note above.
    expect(data.banner.todayBag).toBe("+$0");
    expect(data.banner.openNow).toBe(0);
    expect(data.banner.inPot).toBe(0);
  });

  // ── FIX 2: Unmapped user — accountUnmapped flag + disclosure (Track T) ────
  // When brokerAccountId is null, account-scoped data is unavailable.
  // The response MUST carry an explicit flag + plain-English copy, NOT "$0".

  it("sets accountUnmapped=true and accountDisclosure copy when brokerAccountId is null", async () => {
    // With null brokerAccountId, canReadAccountScopedData=false and the 3 account
    // queries (today, open, sparkPnl) are skipped. Only 5 db.execute calls fire:
    // pot → kill → discord-fallback → potRows → crew
    const unmappedQueryOrder = ["pot", "kill", "discord", "potRows", "crew"] as const;
    let j = 0;
    mocks.execute.mockReset();
    mocks.execute.mockImplementation(() => {
      const key = unmappedQueryOrder[j++];
      return Promise.resolve(responses[key as QueryKey] ?? []);
    });

    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: null });

    // Disclosure flags
    expect(data.accountUnmapped).toBe(true);
    expect(data.accountDataAvailable).toBe(false);
    expect(typeof data.accountDisclosure).toBe("string");
    expect(data.accountDisclosure).not.toBeNull();
    // Copy must explain why — not just "$0"
    expect(data.accountDisclosure!.toLowerCase()).toMatch(/linked|connect|account/);

    // Account-scoped metrics zeroed (no account to read from)
    expect(data.banner.todayBag).toBe("+$0");
    expect(data.banner.openNow).toBe(0);

    // Global data still populated (inPot, discordFeed, pot, crew)
    expect(data.banner.inPot).toBe(14);
    expect(data.pot).toHaveLength(2);
    expect(data.crew).toHaveLength(2);
  });

  it("sets accountUnmapped=false and accountDisclosure=null for a mapped user in paper mode", async () => {
    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000001" });

    expect(data.accountUnmapped).toBe(false);
    expect(data.accountDataAvailable).toBe(true);
    expect(data.accountDisclosure).toBeNull();
    // Banner has real data
    expect(data.banner.todayBag).toBe("+$2,847");
  });

  // ── FIX 3: Live mode — data-suppressed disclosure (Track T) ──────────────
  // When execution_mode=live AND the user IS mapped, account-scoped data is
  // suppressed (no live tape yet). Must carry liveModeDataDisclosure, not "$0".

  it("sets accountDataAvailable=false and live-mode disclosure when execution_mode=live", async () => {
    _mockMode = "live";

    // In live mode, canReadAccountScopedData=false even with a valid account ID.
    // Same 5-query order as the unmapped case (account queries are skipped).
    const liveQueryOrder = ["pot", "kill", "discord", "potRows", "crew"] as const;
    let k = 0;
    mocks.execute.mockReset();
    mocks.execute.mockImplementation(() => {
      const key = liveQueryOrder[k++];
      return Promise.resolve(responses[key as QueryKey] ?? []);
    });

    const { assembleCribData } = await import("../../lib/slumhouse/crib-data.js");
    const data = await assembleCribData({ brokerAccountId: "00000000-0000-0000-0000-000000000001" });

    // User IS mapped but live mode suppresses tape
    expect(data.accountUnmapped).toBe(false);
    expect(data.accountDataAvailable).toBe(false);
    expect(typeof data.accountDisclosure).toBe("string");
    expect(data.accountDisclosure!.toLowerCase()).toMatch(/live|broker/);

    expect(data.executionMode).toBe("live");
    expect(data.executionModeLabel).toBe("LIVE");

    // Account-scoped data suppressed
    expect(data.banner.todayBag).toBe("+$0");
    expect(data.banner.openNow).toBe(0);

    _mockMode = "paper"; // reset
  });
});
