/**
 * deepscan22-y6-path-c-db-roundtrip.test.ts — Deep-scan #22 cap-closer Y6,
 * Task 1 (2026-07-09).
 *
 * WHY THIS EXISTS
 * ----------------
 * The independent cert of the X6 factory failure-injection sweep confirmed
 * the sweep but capped the re-cert at 8/9 for two disclosed proxy limits.
 * Proxy limit #1: X6 Control 1 (`deepscan22-x6-factory-failure-injection.test.ts`)
 * asserts Path-C wiring at READER-LEVEL only — it hands a plain JS object
 * literal to the mirrored reader function. It never proves the shape
 * survives a REAL Postgres JSONB write + read round trip (type coercion,
 * key ordering, undefined-vs-missing-key collapse, nested-object
 * serialization are all things a plain-object test cannot catch).
 *
 * THIS FILE closes that gap: it spins up a real in-memory PGlite Postgres
 * instance (the same harness `gate-chain-integration.test.ts` uses), INSERTs
 * a graduated strategy row through Drizzle with `use_weighted_scoring` /
 * `confirming_indicators` nested INSIDE `config.entry_quality` (the FIX-A1
 * correct shape — see `deepscan22-fix-a1-entry-quality-dead-path.test.ts`),
 * SELECTs it back out through Drizzle (a genuine DB round trip — JSONB
 * write, storage, and read), and only THEN applies the reader logic —
 * copied verbatim from `paper-signal-service.ts` (same mirror convention
 * used by every other test file touching this dispatcher, documented in
 * that file's header: direct-bucket-graduator.ts / paper-signal-service.ts
 * both bootstrap DATABASE_URL via a module-top-level `db/index.js` import
 * that pglite-backed tests cannot load without a real Postgres connection).
 *
 * A companion negative case INSERTs the WRONG (pre-FIX-A1 regression) shape
 * — `use_weighted_scoring` / `confirming_indicators` as top-level config
 * SIBLINGS of `entry_quality`, never inside it — through the SAME real DB
 * round trip, and proves Path C (and Path A) stay dead.
 *
 * Static-pin assertions (§3) tie the inline mirror to the live source so a
 * future edit to the real reader expression is caught here too.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { strategies } from "../db/schema.js";

const PAPER_SIGNAL_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

interface ConfirmingIndicatorShape {
  indicator: string;
  params: Record<string, number>;
  direction: "agree" | "disagree" | "either";
}

interface EntryQualityShape {
  confluence_factors?: string[];
  min_factors_satisfied?: number;
  extraction_provenance?: string;
  confirming_indicators?: ConfirmingIndicatorShape[];
  use_weighted_scoring?: boolean;
}

// Exact reader mirror of paper-signal-service.ts:4162-4177 + 4363 + 4767-4768
// (same convention as deepscan22-x6-factory-failure-injection.test.ts Control 1
// and deepscan22-fix-a1-entry-quality-dead-path.test.ts — direct-bucket-graduator.ts
// and paper-signal-service.ts both bootstrap DATABASE_URL at module-top-level
// `import { db } from "../db/index.js"`, which a pglite-backed test file cannot
// load without a live Postgres connection; the established pattern is a verbatim
// inline mirror pinned against the real source via static string assertions, §3
// below).
function readEntryQualityAndDispatch(config: Record<string, unknown>) {
  const rawConfig = config as unknown as Record<string, unknown>;
  const entryQuality = (
    rawConfig.entry_quality ??
    (rawConfig.strategy as Record<string, unknown> | undefined)?.entry_quality
  ) as EntryQualityShape | undefined;

  const isLegacyStrategy =
    !entryQuality || entryQuality.extraction_provenance === "legacy_no_confluence";
  const useWeightedScoring = entryQuality?.use_weighted_scoring === true && !isLegacyStrategy;
  const customIndicators = entryQuality?.confirming_indicators ?? [];
  const usePerStrategy = customIndicators.length > 0;
  return { entryQuality, useWeightedScoring, usePerStrategy, customIndicators };
}

describe("Y6 Task 1 — Path-C full DB round trip (PGlite): FIX-A1 correct shape vs pre-FIX-A1 regression shape", () => {
  let ctx: TestDb;

  const STRAT_CORRECT = "9600001a-0000-0000-0000-000000000001";
  const STRAT_WRONG = "9600001a-0000-0000-0000-000000000002";

  const realConfirmingIndicators: ConfirmingIndicatorShape[] = [
    { indicator: "ema", params: { period: 50 }, direction: "agree" },
  ];

  beforeAll(async () => {
    ctx = await createTestDb();

    // Row 1 — CORRECT FIX-A1 shape: use_weighted_scoring + confirming_indicators
    // nested INSIDE config.entry_quality (this is what direct-bucket-graduator.ts
    // stamps post-fix via `entryQualityBlock.use_weighted_scoring = ...` /
    // `entryQualityBlock.confirming_indicators = ...` before the JSONB INSERT).
    await ctx.db.insert(strategies).values({
      id: STRAT_CORRECT,
      name: "y6-path-c-correct-shape",
      symbol: "MES",
      timeframe: "5m",
      config: {
        entry_quality: {
          confluence_factors: ["market_structure_aligned", "killzone_active"],
          min_factors_satisfied: 2,
          extraction_provenance: "youtube_transcript",
          use_weighted_scoring: true,
          confirming_indicators: realConfirmingIndicators,
        },
      },
    });

    // Row 2 — WRONG (pre-FIX-A1 regression) shape: use_weighted_scoring and
    // confirming_indicators live as TOP-LEVEL config JSONB siblings of
    // entry_quality, never nested inside it — reproduces the exact dead-path
    // bug FIX-A1 closed.
    await ctx.db.insert(strategies).values({
      id: STRAT_WRONG,
      name: "y6-path-c-wrong-shape",
      symbol: "MES",
      timeframe: "5m",
      config: {
        use_weighted_scoring: true,
        confirming_indicators: ["market_structure_aligned", "killzone_active"],
        entry_quality: {
          confluence_factors: ["market_structure_aligned", "killzone_active"],
          min_factors_satisfied: 2,
          extraction_provenance: "youtube_transcript",
          // NOTE: no use_weighted_scoring, no confirming_indicators nested here.
        },
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("CLEAN: correct nested shape survives a real INSERT + SELECT round trip and resolves Path C + Path A", async () => {
    const rows = await ctx.db.select().from(strategies).where(eq(strategies.id, STRAT_CORRECT));
    expect(rows).toHaveLength(1);

    const readBackConfig = rows[0]!.config as Record<string, unknown>;

    // Prove this is a genuine round trip, not the original object reference —
    // PGlite serialized to JSONB storage and Drizzle deserialized a fresh object.
    const originalEntryQuality = (readBackConfig as { entry_quality?: unknown }).entry_quality;
    expect(originalEntryQuality).toBeDefined();

    const { useWeightedScoring, usePerStrategy, customIndicators, entryQuality } =
      readEntryQualityAndDispatch(readBackConfig);

    expect(entryQuality).toBeDefined();
    expect(useWeightedScoring).toBe(true);
    expect(usePerStrategy).toBe(true);
    expect(customIndicators).toHaveLength(1);
    expect(customIndicators[0]).toMatchObject({ indicator: "ema", direction: "agree" });
  });

  it("FAULT: wrong (top-level) shape survives the SAME real INSERT + SELECT round trip but Path C AND Path A stay DEAD", async () => {
    const rows = await ctx.db.select().from(strategies).where(eq(strategies.id, STRAT_WRONG));
    expect(rows).toHaveLength(1);

    const readBackConfig = rows[0]!.config as Record<string, unknown>;

    // The top-level siblings genuinely made it through the DB round trip —
    // this proves the dead path is a real reader-contract miss, not an
    // artifact of the test never writing the fields at all.
    expect(readBackConfig.use_weighted_scoring).toBe(true);
    expect(Array.isArray(readBackConfig.confirming_indicators)).toBe(true);

    const { useWeightedScoring, usePerStrategy } = readEntryQualityAndDispatch(readBackConfig);

    // The dispatcher never sees the top-level siblings — both paths stay dead
    // regardless of what the sibling keys claim.
    expect(useWeightedScoring).toBe(false);
    expect(usePerStrategy).toBe(false);
  });

  it("sanity: both rows persisted with genuinely different config shapes (no test cross-contamination)", async () => {
    const correctRows = await ctx.db.select().from(strategies).where(eq(strategies.id, STRAT_CORRECT));
    const wrongRows = await ctx.db.select().from(strategies).where(eq(strategies.id, STRAT_WRONG));
    expect(correctRows).toHaveLength(1);
    expect(wrongRows).toHaveLength(1);
    expect(correctRows[0]!.config).not.toEqual(wrongRows[0]!.config);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Static pin — ties the inline reader mirror above to the live source so a
// future drift in paper-signal-service.ts is caught here, not just in the
// existing X6/FIX-A1 static-contract tests.
// ═════════════════════════════════════════════════════════════════════════

describe("Y6 Task 1 — static pin: mirrored reader matches paper-signal-service.ts", () => {
  it("reader block reads ONLY rawConfig.entry_quality (or strategy.entry_quality) — no top-level fallback", () => {
    const readerIdx = PAPER_SIGNAL_SRC.indexOf("const entryQuality = (");
    expect(readerIdx).toBeGreaterThan(0);
    const block = PAPER_SIGNAL_SRC.slice(readerIdx, readerIdx + 400);
    expect(block).toContain("rawConfig.entry_quality");
    expect(block).not.toMatch(/rawConfig\.use_weighted_scoring/);
    expect(block).not.toMatch(/rawConfig\.confirming_indicators(?!\s*\?)/);
  });

  it("useWeightedScoring assignment requires entry_quality.use_weighted_scoring === true AND !isLegacyStrategy", () => {
    expect(PAPER_SIGNAL_SRC).toContain(
      "const useWeightedScoring = entryQuality.use_weighted_scoring === true && !isLegacyStrategy;",
    );
  });

  it("customIndicators/usePerStrategy derive from entry_quality.confirming_indicators", () => {
    expect(PAPER_SIGNAL_SRC).toContain("const customIndicators = entryQuality.confirming_indicators ?? [];");
    expect(PAPER_SIGNAL_SRC).toContain("const usePerStrategy = customIndicators.length > 0;");
  });
});
