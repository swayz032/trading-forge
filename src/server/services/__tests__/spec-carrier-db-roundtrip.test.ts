/**
 * B-DB-ROUNDTRIP-1 — AR-1130 §6: prove PERSISTENCE, do not infer it.
 *
 * AR-1128 tested the parser boundary and said so. AR-1129 then wrote that every
 * record-independent hop was complete, which overstated it: nothing had proven the
 * carriers survive `strategies.config` -> DB -> reload. GPT rejected that closure, and
 * this file is the missing half.
 *
 *   `A STRUCTURALLY PROMISING ARROW IS A HYPOTHESIS. JSON SERIALIZATION IS EXACTLY THE
 *    KIND OF STEP EVERYONE ASSUMES AND NOBODY WATCHES.`
 *
 * Uses the established PGlite pattern (mirrors spec-onboarding-service.test.ts): mock
 * the shared `db` with a module-level variable set in beforeAll, import the module under
 * test AFTER mock registration.
 *
 * The artifact is SYNTHETIC and labelled — AR-1130 §6 permits that for this
 * record-independent plumbing proof. It is NOT sVkm and NOT a §9.2 witness.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers/pglite-db.js";
import type { TestDb } from "../../__tests__/helpers/pglite-db.js";

let injectedDb: TestDb["db"] | null = null;

vi.mock("../../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));
vi.mock("../../index.js", () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

import { onboardSpecArtifact, parseSpecArtifact } from "../spec-onboarding-service.js";
import { strategies } from "../../db/schema.js";

const NEEDS_ARCHETYPE_QUEUE_DDL = `
CREATE TABLE IF NOT EXISTS needs_archetype_queue (
  id                       BIGSERIAL PRIMARY KEY,
  bucket_id                UUID NULL,
  speaker_term             TEXT NOT NULL,
  verbatim_description     TEXT NULL,
  transcript_quote         TEXT NULL,
  source_url               TEXT NULL,
  extraction_count         INTEGER NOT NULL DEFAULT 1,
  proposed_archetype_name  TEXT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT needs_archetype_queue_status_check CHECK (status IN ('pending', 'archetype_created', 'rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS needs_archetype_queue_term_idx ON needs_archetype_queue (speaker_term);
`;

const SYNTHETIC_QUOTE = "SYNTHETIC ROUND-TRIP PROBE — not sVkm, no source video";

const ROLES = {
  schema: "SOURCE_TIMEFRAME_ROLES/1",
  bindings: [
    { role: "OPENING_RANGE_WINDOW", timeframe: "5m", evidence_grade: "EXPLICIT", source_quote: SYNTHETIC_QUOTE, condition_id: "T1" },
    { role: "BREAKOUT_CONFIRMATION", timeframe: "1m", evidence_grade: "EXPLICIT", source_quote: SYNTHETIC_QUOTE, condition_id: "S1" },
    { role: "FVG_DETECTION", timeframe: "1m", evidence_grade: "SOURCE_RESOLVED_BY_CONTINUITY", source_quote: SYNTHETIC_QUOTE, condition_id: "C1" },
    { role: "ENTRY_COMPLETION", timeframe: "1m", evidence_grade: "SOURCE_RESOLVED_BY_CONTINUITY", source_quote: SYNTHETIC_QUOTE, condition_id: "C2" },
  ],
};

const SOURCE_RISK = {
  mode: "SOURCE_FAITHFUL",
  stop: { anchor: "sweep_wick_below_entry", include_wick: true, span: { start: 120, end: 260 } },
  target: { type: "FIXED_R", r_multiple: 2, span: { start: 300, end: 440 } },
};

function carrierSpec(specHash: string, video: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    video,
    spec_hash: specHash,
    graph_canonical_hash: "graph_roundtrip",
    ledger_d: "CONSERVED",
    transcript_chars: 25071,
    spec: {
      direction: "long",
      entry_conditions: [
        { id: "T1", type: "ENABLE_ENTRY", object: "order block entry trigger", role: "trigger", span: { start: 0, end: 10 }, evidence: "T-r-001" },
        { id: "S1", type: "WAIT_STRUCTURE", object: "session vwap reset", role: "spine", span: { start: 10, end: 20 }, evidence: "T-r-002" },
        { id: "C1", type: "FILTER", object: "higher timeframe bias", role: "confluence", span: { start: 20, end: 30 }, evidence: "T-r-003" },
        { id: "C2", type: "WAIT_BIAS", object: "killzone timing", role: "confluence", span: { start: 30, end: 40 }, evidence: "T-r-004" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "T1",
      framework_overlay: { stop: "framework_owned", take_profit: "framework_owned", sizing: "framework_owned" },
      source_timeframe_roles: ROLES,
      source_risk: SOURCE_RISK,
      ...overrides,
    },
  };
}

describe("B-DB-ROUNDTRIP-1 — the carriers survive DB save/reload", () => {
  let ctx: TestDb;
  let playbookRouterPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;
    await ctx.pg.exec(NEEDS_ARCHETYPE_QUEUE_DDL);

    tmpDir = mkdtempSync(join(tmpdir(), "carrier-roundtrip-"));
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
  });

  afterAll(async () => {
    await ctx.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("BOTH carriers deep-equal the input after a real insert + reload", async () => {
    const result = await onboardSpecArtifact(carrierSpec("hash_rt_001", "rtVid001"), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    expect(result.ok).toBe(true);

    const mes = result.perSymbol.find((p) => p.symbol === "MES")!;
    expect(mes.status).toBe("inserted");

    // RELOAD from the database — not the in-memory object we just built.
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mes.strategyId!));
    expect(row).toBeTruthy();

    const spec = (row.config as Record<string, any>).compiled_spec.spec;

    // POSITIVE WITNESS first, so a passing deep-equal cannot be two undefineds.
    expect(spec.source_timeframe_roles).toBeDefined();
    expect(spec.source_risk).toBeDefined();

    expect(spec.source_timeframe_roles).toEqual(ROLES);
    expect(spec.source_risk).toEqual(SOURCE_RISK);
  });

  it("the reloaded role carrier still names the 5m opening-range window", async () => {
    const result = await onboardSpecArtifact(carrierSpec("hash_rt_002", "rtVid002"), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    const mes = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mes.strategyId!));

    const bindings = (row.config as Record<string, any>).compiled_spec.spec.source_timeframe_roles.bindings;
    const byRole = Object.fromEntries(bindings.map((b: any) => [b.role, b]));
    expect(byRole.OPENING_RANGE_WINDOW.timeframe).toBe("5m");
    expect(byRole.BREAKOUT_CONFIRMATION.timeframe).toBe("1m");
    // The evidence grade and quote are what make it a SOURCE fact rather than a guess.
    expect(byRole.OPENING_RANGE_WINDOW.evidence_grade).toBe("EXPLICIT");
    expect(byRole.FVG_DETECTION.source_quote).toBe(SYNTHETIC_QUOTE);
  });

  it("the reloaded source-risk contract still yields the TAUGHT stop, not ATR", async () => {
    const { resolveSpecStopLoss } = await import("../source-risk-contract.js");
    const result = await onboardSpecArtifact(carrierSpec("hash_rt_003", "rtVid003"), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    const mes = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mes.strategyId!));

    const spec = (row.config as Record<string, any>).compiled_spec.spec;
    const stop = resolveSpecStopLoss(spec);

    // The end-to-end statement of the money-path defect: after a full DB round-trip the
    // teacher's stop is still the teacher's.
    expect(stop.type).toBe("source_structural");
    expect(stop.ownership).toBe("source");
    expect(stop.include_wick).toBe(true);
    expect(spec.source_risk.target.r_multiple).toBe(2);
  });

  it("MUTATION CONTROL — a malformed-present role carrier persists NO row", async () => {
    const before = await ctx.db.select().from(strategies);

    const bad = carrierSpec("hash_rt_bad", "rtVidBad", {
      source_timeframe_roles: { schema: "SOURCE_TIMEFRAME_ROLES/2", bindings: [] },
    });
    // parseSpecArtifact refuses it outright (B-FAILCLOSED-1) …
    expect(parseSpecArtifact(bad).ok).toBe(false);

    // … and onboarding must not insert anything either.
    const result = await onboardSpecArtifact(bad, {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    expect(result.ok).toBe(false);

    const after = await ctx.db.select().from(strategies);
    expect(after.length).toBe(before.length);
  });

  it("legacy artifact with NEITHER carrier still onboards (byte-compatible)", async () => {
    const legacy = carrierSpec("hash_rt_legacy", "rtVidLegacy", {
      source_timeframe_roles: undefined,
      source_risk: undefined,
    });
    const result = await onboardSpecArtifact(legacy, {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    expect(result.ok).toBe(true);

    const mes = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mes.strategyId!));
    const spec = (row.config as Record<string, any>).compiled_spec.spec;
    expect(spec.source_timeframe_roles).toBeUndefined();
    expect(spec.source_risk).toBeUndefined();
  });
});
