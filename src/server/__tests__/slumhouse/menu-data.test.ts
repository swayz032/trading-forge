import { describe, it, expect, vi, beforeEach } from "vitest";

// menu-data assemblers read the `strategies` table via db.execute(sql`…`).
// assembleNowServing issues 2 queries (family query + assembleTodaysMenu $ query).
// The other three assemblers issue 1 query each.
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../db/index.js", () => ({ db: { execute: mocks.execute } }));

describe("menu-data", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  // ── assembleNowServing ─────────────────────────────────────────────
  it("assembleNowServing returns champions with premium names (DEPLOYED orb_15m → Opening Heist)", async () => {
    mocks.execute
      // 1st call: family grouping query
      .mockResolvedValueOnce([
        { id: "s1", name: "orb_15m", symbols: ["MES"], timeframe: "15m", lifecycle_state: "DEPLOYED", forge_score: 82, config: {} },
        { id: "s2", name: "orb_15m", symbols: ["MES"], timeframe: "15m", lifecycle_state: "DECLINING", forge_score: 60, config: {} },
        { id: "s3", name: "vwap_fade", symbols: ["MNQ"], timeframe: "5m", lifecycle_state: "DEPLOYED", forge_score: 71, config: {} },
      ])
      // 2nd call: assembleTodaysMenu $ stats
      .mockResolvedValueOnce([
        { id: "s1", name: "orb_15m", symbol: "MES", month_pnl: 8420, trades: 100, latest_critique: null },
      ]);

    const { assembleNowServing } = await import("../../lib/slumhouse/menu-data.js");
    const champions = await assembleNowServing();

    // two families: orb (2 variants) + vwap_fade (1 variant)
    expect(champions).toHaveLength(2);
    const orb = champions.find((c) => c.premiumName === "Opening Heist");
    expect(orb).toBeDefined();
    expect(orb?.id).toBe("s1"); // DEPLOYED beats DECLINING for champion
    expect(orb?.symbol).toBe("MES");
    expect(orb?.variantCount).toBe(2);
    expect(orb?.lifecycleState).toBe("DEPLOYED");
    expect(orb?.monthMade).toBe("+$8,420");

    const fade = champions.find((c) => c.premiumName === "The Fade");
    expect(fade?.id).toBe("s3");
    expect(fade?.monthMade).toBeNull(); // no $ row for s3
  });

  it("assembleNowServing fails-soft on DB error", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    const { assembleNowServing } = await import("../../lib/slumhouse/menu-data.js");
    expect(await assembleNowServing()).toEqual([]);
  });

  // ── assembleDeployReady ────────────────────────────────────────────
  it("assembleDeployReady returns champions from DEPLOY_READY only", async () => {
    mocks.execute.mockResolvedValueOnce([
      { id: "d1", name: "silver_bullet_ny_am", symbols: ["MES"], timeframe: "5m", lifecycle_state: "DEPLOY_READY", forge_score: 77, config: {} },
    ]);
    const { assembleDeployReady } = await import("../../lib/slumhouse/menu-data.js");
    const champions = await assembleDeployReady();
    expect(champions).toHaveLength(1);
    expect(champions[0].premiumName).toBe("Silver Bullet");
    expect(champions[0].variantCount).toBe(1);
    expect(champions[0].lifecycleState).toBe("DEPLOY_READY");
  });

  // ── assembleKitchenMenu ────────────────────────────────────────────
  it("assembleKitchenMenu('MES') groups variants into families", async () => {
    mocks.execute.mockResolvedValueOnce([
      { id: "k1", name: "orb_5m", symbols: ["MES"], timeframe: "5m", lifecycle_state: "CANDIDATE", forge_score: 40, config: {} },
      { id: "k2", name: "orb_15m", symbols: ["MES"], timeframe: "15m", lifecycle_state: "TESTING", forge_score: 55, config: {} },
      { id: "k3", name: "the_fade", symbols: ["MES"], timeframe: "5m", lifecycle_state: "PAPER", forge_score: 66, config: {} },
    ]);
    const { assembleKitchenMenu } = await import("../../lib/slumhouse/menu-data.js");
    const families = await assembleKitchenMenu("MES");

    // orb_5m + orb_15m collapse into one "Opening Heist" family; the_fade is its own
    expect(families).toHaveLength(2);
    const orb = families.find((f) => f.premiumName === "Opening Heist");
    expect(orb?.variants).toHaveLength(2);
    expect(orb?.champion.id).toBe("k2"); // higher forgeScore (both same lifecycle tier? no — PAPER not here)
    // every row is MES
    for (const f of families) for (const v of f.variants) expect(v.symbol).toBe("MES");
  });

  it("assembleKitchenMenu fails-soft on DB error", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    const { assembleKitchenMenu } = await import("../../lib/slumhouse/menu-data.js");
    expect(await assembleKitchenMenu("MES")).toEqual([]);
  });

  // ── assembleGraveyardMenu ──────────────────────────────────────────
  it("assembleGraveyardMenu groups by family with killReason per variant", async () => {
    mocks.execute.mockResolvedValueOnce([
      { id: "g1", name: "connors_rsi2", symbols: ["MES"], timeframe: "1d", lifecycle_state: "GRAVEYARD", forge_score: 12, config: { kill_reason: "PBO too high" } },
      { id: "g2", name: "connors_rsi2", symbols: ["MNQ"], timeframe: "1d", lifecycle_state: "GRAVEYARD", forge_score: 8, config: {} },
    ]);
    const { assembleGraveyardMenu } = await import("../../lib/slumhouse/menu-data.js");
    const families = await assembleGraveyardMenu();

    expect(families).toHaveLength(1);
    expect(families[0].premiumName).toBe("The Dip Snatch");
    expect(families[0].variants).toHaveLength(2);
    const g1 = families[0].variants.find((v) => v.id === "g1");
    expect(g1?.killReason).toBe("PBO too high");
    const g2 = families[0].variants.find((v) => v.id === "g2");
    expect(g2?.killReason).toBeNull();
  });
});
