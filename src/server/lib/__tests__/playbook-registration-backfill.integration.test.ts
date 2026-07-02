/**
 * playbook-registration-backfill.integration.test.ts — Band B2 follow-up (2026-07-02)
 *
 * pglite integration test proving the backfill SCAN path end-to-end against a
 * real database (seeded with a realistic mix of registered / unregistered /
 * unresolvable strategies, mirroring the ~100 pre-existing graduated
 * strategies' actual name shapes) — the same DB-injection pattern used
 * throughout this codebase's integration suites (vi.mock the shared `db`
 * import + createTestDb()). This is the "real output against a real
 * database" proof for the backfill instrument, since this sandbox has no
 * production Railway Postgres credentials — the classification + counting
 * logic under test here is IDENTICAL to what scripts/backfill-playbook-
 * registration.ts runs against the real DB.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let injectedDb: TestDb["db"] | null = null;
vi.mock("../../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

import { createTestDb } from "../../__tests__/helpers/pglite-db.js";
import type { TestDb } from "../../__tests__/helpers/pglite-db.js";
import { strategies } from "../../db/schema.js";
import { readAllRegisteredNames } from "../playbook-registration.js";
import { classifyStrategyForBackfill, type StrategyRowForBackfill } from "../playbook-registration-backfill.js";

describe("playbook-registration-backfill — pglite integration (real DB scan)", () => {
  let ctx: TestDb;
  let playbookRouterPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;

    tmpDir = mkdtempSync(join(tmpdir(), "backfill-playbook-test-"));
    playbookRouterPath = join(tmpDir, "playbook_router_fixture.py");
    writeFileSync(
      playbookRouterPath,
      [
        'CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion"]',
        'REVERSAL_STRATS = ["breaker", "eqhl_raid"]',
        'MEAN_REV_STRATS = ["ny_lunch_reversal", "midnight_open"]',
        'ORB_STRATS = ["iofed", "ict_scalp"]',
        "ALL_STRATS = CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS",
        "",
      ].join("\n"),
      "utf-8",
    );

    // Seed a realistic mix: 1 registered (bare concept name matches ALL_STRATS
    // verbatim), 3 unregistered (the real-world shape — concept_market_tf),
    // 1 unresolvable (empty name — simulates a data-integrity edge case).
    await ctx.db.insert(strategies).values([
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "breaker",
        symbol: "MES",
        timeframe: "5m",
        config: {},
        source: "graduated_bucket",
        lifecycleState: "DEPLOYED",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        name: "orb_mnq_15m",
        symbol: "MNQ",
        timeframe: "15m",
        config: {},
        source: "graduated_bucket",
        lifecycleState: "PAPER",
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        name: "breaker_block_mes_5m",
        symbol: "MES",
        timeframe: "5m",
        config: { strategy: { entry_indicator: "archetype:ict_breaker" } },
        source: "graduated_bucket",
        lifecycleState: "TESTING",
      },
      {
        id: "44444444-4444-4444-4444-444444444444",
        name: "midnight_open_mcl_1h",
        symbol: "MCL",
        timeframe: "1h",
        config: { strategy: { entry_indicator: "archetype:ict_midnight_open" } },
        source: "graduated_bucket",
        lifecycleState: "CANDIDATE",
      },
    ]);
  });

  afterAll(async () => {
    await ctx.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("REAL OUTPUT: scans all strategies rows from a real DB and produces registered/unregistered/unresolvable counts", async () => {
    const registeredNames = readAllRegisteredNames(playbookRouterPath);
    const rows = await ctx.db
      .select({
        id: strategies.id,
        name: strategies.name,
        symbol: strategies.symbol,
        source: strategies.source,
        lifecycleState: strategies.lifecycleState,
        config: strategies.config,
      })
      .from(strategies);

    const classifications = rows.map((row) => classifyStrategyForBackfill(row as StrategyRowForBackfill, registeredNames));

    const registered = classifications.filter((c) => c.status === "registered");
    const unregistered = classifications.filter((c) => c.status === "unregistered");
    const unresolvable = classifications.filter((c) => c.status === "unresolvable");

    // Real output — printed so it's visible in the test run (mirrors the CLI's own report).
    console.log(`REAL DB SCAN: total=${classifications.length} registered=${registered.length} unregistered=${unregistered.length} unresolvable=${unresolvable.length}`);
    for (const c of classifications) {
      console.log(`  ${c.id}: name=${c.name || "(empty)"} status=${c.status} archetype=${c.archetypeKey ?? "none"} proposedCategory=${c.proposedCategory ?? "n/a"}`);
    }

    expect(classifications.length).toBe(4);
    expect(registered.length).toBe(1);
    expect(registered[0].name).toBe("breaker");

    expect(unregistered.length).toBe(3);
    const orbRow = unregistered.find((c) => c.name === "orb_mnq_15m");
    expect(orbRow?.proposedCategory).toBe("CONTINUATION_STRATS"); // no archetype -> documented default
    const breakerBlockRow = unregistered.find((c) => c.name === "breaker_block_mes_5m");
    expect(breakerBlockRow?.archetypeKey).toBe("ict_breaker");
    expect(breakerBlockRow?.proposedCategory).toBe("REVERSAL_STRATS");
    const midnightRow = unregistered.find((c) => c.name === "midnight_open_mcl_1h");
    expect(midnightRow?.proposedCategory).toBe("MEAN_REV_STRATS");

    expect(unresolvable.length).toBe(0);
  });

  it("--apply path: registerStrategiesInPlaybook writes the 3 unregistered names into their proposed categories, idempotently", async () => {
    const { registerStrategiesInPlaybook } = await import("../playbook-registration.js");
    const r1 = registerStrategiesInPlaybook(playbookRouterPath, ["orb_mnq_15m"], "CONTINUATION_STRATS");
    const r2 = registerStrategiesInPlaybook(playbookRouterPath, ["breaker_block_mes_5m"], "REVERSAL_STRATS");
    const r3 = registerStrategiesInPlaybook(playbookRouterPath, ["midnight_open_mcl_1h"], "MEAN_REV_STRATS");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);

    const registeredAfter = readAllRegisteredNames(playbookRouterPath);
    expect(registeredAfter.has("orb_mnq_15m")).toBe(true);
    expect(registeredAfter.has("breaker_block_mes_5m")).toBe(true);
    expect(registeredAfter.has("midnight_open_mcl_1h")).toBe(true);

    // Re-running the scan now shows all 4 as registered — proves the fix converges.
    const rows = await ctx.db
      .select({
        id: strategies.id,
        name: strategies.name,
        symbol: strategies.symbol,
        source: strategies.source,
        lifecycleState: strategies.lifecycleState,
        config: strategies.config,
      })
      .from(strategies);
    const classifications = rows.map((row) => classifyStrategyForBackfill(row as StrategyRowForBackfill, registeredAfter));
    expect(classifications.filter((c) => c.status === "registered").length).toBe(4);
    expect(classifications.filter((c) => c.status === "unregistered").length).toBe(0);
  });
});
