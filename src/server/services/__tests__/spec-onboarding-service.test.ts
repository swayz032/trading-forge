/**
 * spec-onboarding-service.test.ts — Band B (spec-onboarding-bridge, 2026-07-02)
 *
 * pglite integration tests for the spec->strategies-row converter. Covers:
 *   1. Spec fixture -> row shape (entry_quality real confluences, provenance fields).
 *   2. Gate 1 refusal — a spec with one empty direction side is REJECTED, never inserted.
 *   3. Archetype-mapped vs needs_archetype_queue routing split.
 *   4. x3 symbol fan-out (MES/MNQ/MCL) + W23F.M-style per-symbol naming.
 *   5. Idempotency — re-running onboarding on the same spec_hash+symbol does not duplicate.
 *   6. Playbook registration wired into the same transaction (registration-visibility).
 *
 * DB INJECTION PATTERN (mirrors composite-shadow.integration.test.ts — the standard
 * pattern for PGlite integration tests in this layer): vi.mock the shared `db` import
 * with a module-level variable set in beforeAll, import the module under test AFTER
 * mock registration.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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

// direct-bucket-graduator.ts (imported transitively for auditBidirectionalCompleteness /
// classifyFactorSources) imports `logger` from "../index.js" (src/server/index.ts — the
// full app entrypoint, which constructs AgentService()/mounts routes/starts crons at
// module scope). Mocking it here avoids pulling in that entire bootstrap for a unit-level
// gate-function import; this is the established pattern in this test suite (see e.g.
// scheduler-retry.test.ts, deepscan7-scheduler-autonomy.test.ts).
vi.mock("../../index.js", () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

// Import AFTER mock registration (vitest hoists vi.mock calls to the top of the file).
import {
  onboardSpecArtifact,
  parseSpecArtifact,
  deriveConfluenceFactors,
  buildDirectionalEntries,
  type SpecArtifact,
} from "../spec-onboarding-service.js";
import { strategies, needsArchetypeQueue } from "../../db/schema.js";

// ─── needs_archetype_queue DDL ───────────────────────────────────────────────
//
// Not present in pglite-db.ts's shared CORE_DDL (that helper covers 10 tables
// used by other suites) — created locally so this test file is self-contained
// and does not risk breaking other suites that share the helper.
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

// ─── Fixture: an archetype-mappable spec (order_block keyword hit) ───────────

function orderBlockSpec(overrides: Partial<SpecArtifact["spec"]> = {}): unknown {
  return {
    video: "testVid001",
    spec_hash: "hash_order_block_001",
    graph_canonical_hash: "graph001",
    ledger_d: "CONSERVED",
    transcript_chars: 5000,
    spec: {
      direction: "long",
      entry_conditions: [
        { id: "T1", type: "ENABLE_ENTRY", object: "order block entry trigger", role: "trigger", span: { start: 0, end: 10 }, evidence: "T-x-001" },
        { id: "S1", type: "WAIT_STRUCTURE", object: "session vwap reset", role: "spine", span: { start: 10, end: 20 }, evidence: "T-x-002" },
        { id: "C1", type: "FILTER", object: "higher timeframe bias", role: "confluence", span: { start: 20, end: 30 }, evidence: "T-x-003" },
        { id: "C2", type: "WAIT_BIAS", object: "killzone timing", role: "confluence", span: { start: 30, end: 40 }, evidence: "T-x-004" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "T1",
      framework_overlay: { stop: "framework_owned", take_profit: "framework_owned", sizing: "framework_owned" },
      ...overrides,
    },
  };
}

// ─── Fixture: an unmappable spec (generic VWAP vocabulary, no ICT keywords) ──

function vwapSpec(specHash: string, video: string): unknown {
  return {
    video,
    spec_hash: specHash,
    graph_canonical_hash: "graph_vwap",
    ledger_d: "CONSERVED",
    transcript_chars: 4000,
    spec: {
      direction: "short",
      entry_conditions: [
        { id: "T1", type: "ENTER", object: "vwap slope reversal cross", role: "trigger", span: { start: 0, end: 10 }, evidence: "T-y-001" },
        { id: "C1", type: "FILTER", object: "vwap band width", role: "confluence", span: { start: 10, end: 20 }, evidence: "T-y-002" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "T1",
    },
  };
}

// ─── Fixture: a genuinely degenerate spec — direction=both, blank trigger object ──

function degenerateBothDirectionSpec(): unknown {
  return {
    video: "degenerateVid",
    spec_hash: "hash_degenerate_001",
    graph_canonical_hash: "graph_degenerate",
    ledger_d: "CONSERVED",
    transcript_chars: 100,
    spec: {
      direction: "both",
      entry_conditions: [
        { id: "T1", type: "ENABLE_ENTRY", object: "   ", role: "trigger", span: { start: 0, end: 1 }, evidence: "x" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "T1",
    },
  };
}

describe("spec-onboarding-service — parseSpecArtifact", () => {
  it("rejects a non-object payload", () => {
    expect(parseSpecArtifact(null).ok).toBe(false);
    expect(parseSpecArtifact("string").ok).toBe(false);
  });

  it("rejects an invalid direction value", () => {
    const bad = orderBlockSpec({ direction: "sideways" as never });
    const result = parseSpecArtifact(bad);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("invalid_direction");
  });

  it("accepts a well-formed artifact", () => {
    const result = parseSpecArtifact(orderBlockSpec());
    expect(result.ok).toBe(true);
    expect(result.artifact?.video).toBe("testVid001");
  });
});

describe("spec-onboarding-service — deriveConfluenceFactors (Gate 2 input, never auto_floor)", () => {
  it("extracts ONLY role=confluence objects, normalized and deduped", () => {
    const parsed = parseSpecArtifact(orderBlockSpec());
    const factors = deriveConfluenceFactors(parsed.artifact!.spec);
    expect(factors).toContain("higher_timeframe_bias");
    expect(factors).toContain("killzone_timing");
    // The trigger and spine conditions must NOT leak into confluence_factors.
    expect(factors).not.toContain("order_block_entry_trigger");
    expect(factors).not.toContain("session_vwap_reset");
  });
});

describe("spec-onboarding-service — buildDirectionalEntries (Gate 1 input honesty contract)", () => {
  it("direction=long: entry_short is the BIDIR_SENTINEL, entry_long carries the marker", () => {
    const { entry_long, entry_short } = buildDirectionalEntries("long", "order_block", "some trigger text");
    expect(entry_short).toBe("high < low");
    expect(entry_long).toBe("archetype_dispatch:order_block");
  });

  it("direction=both + archetype mapped: both sides get the SAME real marker (archetype owns direction)", () => {
    const { entry_long, entry_short } = buildDirectionalEntries("both", "ict_bias_aligned_continuation", "x");
    expect(entry_long).toBe(entry_short);
    expect(entry_long).toBe("archetype_dispatch:ict_bias_aligned_continuation");
  });

  it("direction=both + unmapped + real trigger text: both sides get an honest pending_archetype placeholder", () => {
    const { entry_long, entry_short } = buildDirectionalEntries("both", null, "vwap slope reversal");
    expect(entry_long).toBe(entry_short);
    expect(entry_long).toMatch(/^pending_archetype:/);
  });

  it("direction=both + unmapped + NO trigger text: both sides are EMPTY (honest, not fabricated)", () => {
    const { entry_long, entry_short } = buildDirectionalEntries("both", null, "");
    expect(entry_long).toBe("");
    expect(entry_short).toBe("");
  });
});

describe("spec-onboarding-service — pglite integration", () => {
  let ctx: TestDb;
  let playbookRouterPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;
    await ctx.pg.exec(NEEDS_ARCHETYPE_QUEUE_DDL);

    tmpDir = mkdtempSync(join(tmpdir(), "playbook-router-onboard-test-"));
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

  it("ARCHETYPE-MAPPED: onboards to CANDIDATE, ×3 symbol fan-out, provenance chain, playbook registration", async () => {
    const result = await onboardSpecArtifact(orderBlockSpec(), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.ok).toBe(true);
    expect(result.archetypeMatch?.matched).toBe(true);
    expect(result.archetypeMatch?.archetypeKey).toBe("order_block");

    // x3 symbol fan-out: MES leader + MNQ + MCL.
    const symbols = result.perSymbol.map((p) => p.symbol).sort();
    expect(symbols).toEqual(["MCL", "MES", "MNQ"]);
    for (const p of result.perSymbol) {
      expect(p.status).toBe("inserted");
      expect(p.lifecycleState).toBe("CANDIDATE");
      expect(p.needsArchetype).toBe(false);
      // W23F.M-style naming: concept_symbol_timeframe, lowercase symbol suffix.
      expect(p.strategyName).toMatch(/_mes_5m$|_mnq_5m$|_mcl_5m$/);
    }

    const mesResult = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mesResult.strategyId!));
    expect(row).toBeTruthy();
    expect(row.symbol).toBe("MES");
    expect(row.symbols).toEqual(["MES"]);
    expect(row.lifecycleState).toBe("CANDIDATE");
    expect(row.source).toBe("spec_onboarding");
    expect(row.tags).toContain("cross-validated");
    expect(row.tags).toContain("spec_hash:hash_order_block_001");

    const config = row.config as Record<string, unknown>;
    // Provenance chain: config.metadata.extraction_provenance is exactly what
    // deriveSpecProvenanceRef() (provenance-stamp.ts) reads via
    // config.strategy.metadata.extraction_provenance once a backtest wraps
    // this row's config under a `strategy` key.
    const metadata = config.metadata as Record<string, unknown>;
    expect(metadata.extraction_provenance).toBe("spec:testVid001:hash_order_block_001");
    expect(metadata.spec_hash).toBe("hash_order_block_001");
    expect(metadata.source_url).toBe("https://www.youtube.com/watch?v=testVid001");

    // Lossless verbatim graph preserved for Band C.
    const compiledSpec = config.compiled_spec as Record<string, unknown>;
    expect(compiledSpec.video).toBe("testVid001");
    expect(compiledSpec.spec_hash).toBe("hash_order_block_001");
    const specBody = compiledSpec.spec as Record<string, unknown>;
    expect(Array.isArray(specBody.entry_conditions)).toBe(true);
    expect((specBody.entry_conditions as unknown[]).length).toBe(4);

    // entry_quality carries REAL extracted confluences, never the auto_floor fallback.
    const entryQuality = config.entry_quality as Record<string, unknown>;
    expect(entryQuality.confluence_factors).toContain("higher_timeframe_bias");
    expect(entryQuality.confluence_factors).toContain("killzone_timing");
    const factorSources = entryQuality.factor_sources as Record<string, string>;
    expect(factorSources.higher_timeframe_bias).toBe("extracted");
    expect(factorSources.killzone_timing).toBe("extracted");

    // Playbook registration wired into the same transaction (B2).
    const playbookSource = readFileSync(playbookRouterPath, "utf-8");
    expect(playbookSource).toContain(mesResult.strategyName);
  });

  it("UNMAPPED: onboards to NEEDS_ARCHETYPE, still passes gates, queues honestly (never silently dropped)", async () => {
    const result = await onboardSpecArtifact(vwapSpec("hash_vwap_002", "testVid002"), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.ok).toBe(true);
    expect(result.archetypeMatch?.matched).toBe(false);

    for (const p of result.perSymbol) {
      expect(p.status).toBe("inserted");
      expect(p.lifecycleState).toBe("NEEDS_ARCHETYPE");
      expect(p.needsArchetype).toBe(true);
    }

    const mesResult = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mesResult.strategyId!));
    expect(row.lifecycleState).toBe("NEEDS_ARCHETYPE");
    const config = row.config as Record<string, unknown>;
    const strategyBlock = config.strategy as Record<string, unknown>;
    expect(String(strategyBlock.entry_indicator)).toMatch(/^needs_archetype:/);

    // A needs_archetype_queue row exists — the strategy is PARKED, not silently dropped.
    const queueRows = await ctx.db.select().from(needsArchetypeQueue);
    const matching = queueRows.filter((q) => q.sourceUrl === "https://www.youtube.com/watch?v=testVid002");
    expect(matching.length).toBeGreaterThan(0);
    expect(matching[0].status).toBe("pending");
  });

  it("GATE 1 REFUSAL: a spec with an empty direction side is REJECTED — never inserted, does not poison the library", async () => {
    const before = await ctx.db.select().from(strategies);
    const beforeCount = before.length;

    const result = await onboardSpecArtifact(degenerateBothDirectionSpec(), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.ok).toBe(true); // artifact itself parses fine — the GATE rejects it, not the parser
    for (const p of result.perSymbol) {
      expect(p.status).toBe("rejected_gate1");
      expect(p.reason).toBe("incomplete_bidirectional_extraction");
      expect(p.strategyId).toBeUndefined();
    }

    const after = await ctx.db.select().from(strategies);
    expect(after.length).toBe(beforeCount); // zero rows inserted — no poisoning
  });

  it("IDEMPOTENCY: re-onboarding the same spec_hash+symbol skips as skipped_duplicate, never duplicates", async () => {
    const artifact = orderBlockSpec();
    (artifact as Record<string, unknown>).spec_hash = "hash_idempotency_003";
    (artifact as Record<string, unknown>).video = "testVid003";

    const first = await onboardSpecArtifact(artifact, {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    expect(first.perSymbol.every((p) => p.status === "inserted")).toBe(true);

    const second = await onboardSpecArtifact(artifact, {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    expect(second.perSymbol.every((p) => p.status === "skipped_duplicate")).toBe(true);

    const rows = await ctx.db.select().from(strategies).where(eq(strategies.symbol, "MES"));
    const matchingRows = rows.filter((r) => Array.isArray(r.tags) && r.tags.includes("spec_hash:hash_idempotency_003"));
    expect(matchingRows.length).toBe(1); // not 2
  });

  it("DRY RUN: computes and reports without writing any row", async () => {
    const artifact = orderBlockSpec();
    (artifact as Record<string, unknown>).spec_hash = "hash_dryrun_004";
    (artifact as Record<string, unknown>).video = "testVid004";

    const before = await ctx.db.select().from(strategies);

    const result = await onboardSpecArtifact(artifact, {
      dryRun: true,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.perSymbol.every((p) => p.status === "dry_run_planned")).toBe(true);

    const after = await ctx.db.select().from(strategies);
    expect(after.length).toBe(before.length);
  });
});
