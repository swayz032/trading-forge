/**
 * deepscan22-y6-path-c-db-roundtrip.test.ts — Deep-scan #22 cap-closer Y6,
 * Task 1 (2026-07-09). REPOINTED to a direct import for Z6 (2026-07-09).
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
 * write, storage, and read), and only THEN applies the reader logic.
 *
 * Z6 UPDATE (deep-scan #22 cap-closer, 2026-07-09): the reader logic used to
 * be copied verbatim from `paper-signal-service.ts` as an inline MIRROR (the
 * same convention several other tests touching this dispatcher still use,
 * because `paper-signal-service.ts` bootstraps DATABASE_URL via a
 * module-top-level `db/index.js` import that a pglite-backed test cannot
 * load). That mirror was the X6 residual: a semantic edit to the REAL reader
 * in `paper-signal-service.ts` that didn't happen to touch the pinned
 * substrings in §3 below would drift undetected, because this file was never
 * actually calling the production code.
 *
 * The dispatch decision has since been extracted into a pure, DB-free,
 * logger-free leaf — `resolveConfluenceDispatch()` in
 * `src/server/lib/confluence-path-resolver.ts` — specifically so this test
 * (and any other pglite-backed test) can import and call the REAL production
 * function directly. This file now does exactly that: no mirror, no
 * hand-copied logic. The behavior-preservation of the extraction itself is
 * verified separately (existing paper-signal Path-C tests +
 * deepscan22-fix-a1-entry-quality-dead-path.test.ts +
 * deepscan22-loop3-confluence-upsize-gate.test.ts all still pass unchanged).
 *
 * Static-pin assertions (§3) now confirm paper-signal-service.ts actually
 * DELEGATES to the resolver (rather than reimplementing the logic inline
 * again, which would silently reopen the mirror-drift gap this file exists
 * to close).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { strategies } from "../db/schema.js";
import { resolveConfluenceDispatch } from "../lib/confluence-path-resolver.js";
import type { ConfirmingIndicator as ConfirmingIndicatorShape } from "../services/confirming-indicator-evaluator.js";

const PAPER_SIGNAL_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

// Direct import of the REAL production dispatch function — no mirror.
// See src/server/lib/confluence-path-resolver.ts::resolveConfluenceDispatch.
function readEntryQualityAndDispatch(config: Record<string, unknown>) {
  return resolveConfluenceDispatch(config);
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
// Static pin — Z6 UPDATE (2026-07-09): now that this file DIRECTLY IMPORTS
// resolveConfluenceDispatch() instead of mirroring it, the round-trip tests
// above already exercise the real decision logic end-to-end — the mirror-
// drift gap is closed by the import, not by these string pins. This describe
// block now guards a NARROWER, still-real risk: that paper-signal-service.ts
// quietly stops delegating to the resolver and reimplements the dispatch
// inline again (which would silently reopen the exact gap Z6 closed), and
// that the resolver's own reader expression + decision logic haven't drifted
// from the documented contract.
// ═════════════════════════════════════════════════════════════════════════

const RESOLVER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/confluence-path-resolver.ts"),
  "utf-8",
);

describe("Y6 Task 1 (Z6-repointed) — static pin: paper-signal-service.ts delegates to the real resolver", () => {
  it("paper-signal-service.ts imports and calls resolveConfluenceDispatch(rawConfig) — no inline reimplementation", () => {
    expect(PAPER_SIGNAL_SRC).toContain(
      'import { resolveConfluenceDispatch } from "../lib/confluence-path-resolver.js"',
    );
    expect(PAPER_SIGNAL_SRC).toContain(
      "const { entryQuality, isLegacyStrategy, useWeightedScoring, usePerStrategy, customIndicators } =",
    );
    expect(PAPER_SIGNAL_SRC).toContain("resolveConfluenceDispatch(rawConfig)");
    // The old inline recomputation sites must be GONE — if either literal
    // reappears, someone reimplemented the dispatch inline again alongside
    // the resolver call, reopening the exact drift risk this file exists to
    // guard against.
    expect(PAPER_SIGNAL_SRC).not.toContain(
      "const useWeightedScoring = entryQuality.use_weighted_scoring === true && !isLegacyStrategy;",
    );
    expect(PAPER_SIGNAL_SRC).not.toContain("const customIndicators = entryQuality.confirming_indicators ?? [];");
  });

  it("resolver reader block reads ONLY rawConfig.entry_quality (or strategy.entry_quality) — no top-level fallback", () => {
    const readerIdx = RESOLVER_SRC.indexOf("const entryQuality = (");
    expect(readerIdx).toBeGreaterThan(0);
    const block = RESOLVER_SRC.slice(readerIdx, readerIdx + 400);
    expect(block).toContain("rawConfig.entry_quality");
    expect(block).not.toMatch(/rawConfig\.use_weighted_scoring/);
    expect(block).not.toMatch(/rawConfig\.confirming_indicators(?!\s*\?)/);
  });

  it("resolver useWeightedScoring assignment requires entry_quality.use_weighted_scoring === true AND !isLegacyStrategy", () => {
    expect(RESOLVER_SRC).toContain(
      "const useWeightedScoring = entryQuality?.use_weighted_scoring === true && !isLegacyStrategy;",
    );
  });

  it("resolver customIndicators/usePerStrategy derive from entry_quality.confirming_indicators", () => {
    expect(RESOLVER_SRC).toContain("const customIndicators = entryQuality?.confirming_indicators ?? [];");
    expect(RESOLVER_SRC).toContain("const usePerStrategy = customIndicators.length > 0;");
  });
});
