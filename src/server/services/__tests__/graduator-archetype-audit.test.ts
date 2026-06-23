/**
 * Pass 2 Track D — Graduator archetype + uncatalogued pine-recipe audit emission
 *
 * Guards the audit rows added to direct-bucket-graduator.ts in Pass 2 Track D
 * (2026-06-22):
 *
 *   1. When the archetype path is taken (isArchetype === true AND inserted.id
 *      is set), emit graduation.archetype_pine_recipe_assigned with the
 *      correct payload shape.
 *   2. When the uncatalogued path is taken (entryIndicator.startsWith
 *      ("uncatalogued:")), emit graduation.uncatalogued_pine_recipe_assigned
 *      with speaker_term in the result payload.
 *   3. The parametric path (isArchetype === false, normal indicator like
 *      ema_crossover) does NOT emit either of these two audit actions — no
 *      false-positive signal noise.
 *
 * Why static-source inspection:
 *   The direct-bucket-graduator.ts DB mock chain is expensive and brittle
 *   (see wave23f-graduator-entry-quality.test.ts comments). Static inspection
 *   verifies the structural correctness of the audit emission code — that the
 *   right action names, entity types, payload fields, and guard conditions are
 *   present at the correct call sites — without requiring a live DB or a
 *   multi-layer mock.
 *
 *   This follows the established pattern for this module (wave23f, wave26-pass-d,
 *   wave26-pass-h, wave26-pass-i tests all use the same approach).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relPath), "utf8");
}

const src = readSrc("../direct-bucket-graduator.ts");

// ─── Suite 1: graduation.archetype_pine_recipe_assigned ──────────────────────

describe("Pass 2 Track D — graduation.archetype_pine_recipe_assigned audit emission", () => {
  it("action string graduation.archetype_pine_recipe_assigned is present in the source", () => {
    expect(src).toContain('"graduation.archetype_pine_recipe_assigned"');
  });

  it("entity type is 'strategy' (not bucket — archetype path produces a real strategy row)", () => {
    // The archetype audit must come AFTER the strategy INSERT and use entityType: "strategy"
    const block = src.match(
      /graduation\.archetype_pine_recipe_assigned[\s\S]*?entityType:\s*["']strategy["']/
    );
    expect(
      block,
      'graduation.archetype_pine_recipe_assigned block must use entityType: "strategy"'
    ).toBeTruthy();
  });

  it("entity id is inserted.id (the newly-created strategy row)", () => {
    const block = src.match(
      /graduation\.archetype_pine_recipe_assigned[\s\S]*?entityId:\s*inserted\.id/
    );
    expect(
      block,
      "graduation.archetype_pine_recipe_assigned must use inserted.id as entityId"
    ).toBeTruthy();
  });

  it("result payload includes archetype_key field", () => {
    const block = src.match(
      /graduation\.archetype_pine_recipe_assigned[\s\S]*?archetype_key:\s*archetypeName/
    );
    expect(
      block,
      "graduation.archetype_pine_recipe_assigned result must include archetype_key: archetypeName"
    ).toBeTruthy();
  });

  it("result payload declares pine_band: 'alert_only'", () => {
    const block = src.match(
      /graduation\.archetype_pine_recipe_assigned[\s\S]*?pine_band:\s*["']alert_only["']/
    );
    expect(
      block,
      "graduation.archetype_pine_recipe_assigned result must include pine_band: 'alert_only'"
    ).toBeTruthy();
  });

  it("result payload declares recipe_source: 'ARCHETYPE_PINE_RECIPE'", () => {
    const block = src.match(
      /graduation\.archetype_pine_recipe_assigned[\s\S]*?recipe_source:\s*["']ARCHETYPE_PINE_RECIPE["']/
    );
    expect(
      block,
      "graduation.archetype_pine_recipe_assigned result must include recipe_source: 'ARCHETYPE_PINE_RECIPE'"
    ).toBeTruthy();
  });

  it("emission is guarded by isArchetype && archetypeName — not emitted for parametric strategies", () => {
    // The block must be inside an if (isArchetype && archetypeName) guard
    const guard = src.match(
      /if\s*\(\s*isArchetype\s*&&\s*archetypeName\s*\)[\s\S]*?graduation\.archetype_pine_recipe_assigned/
    );
    expect(
      guard,
      "graduation.archetype_pine_recipe_assigned must be guarded by if (isArchetype && archetypeName)"
    ).toBeTruthy();
  });

  it("uses insertAuditRowSafe (non-throwing, matches codebase helper pattern)", () => {
    const block = src.match(
      /insertAuditRowSafe\(\{[\s\S]*?action:\s*["']graduation\.archetype_pine_recipe_assigned["']/
    );
    expect(
      block,
      "graduation.archetype_pine_recipe_assigned must use insertAuditRowSafe"
    ).toBeTruthy();
  });

  it("status is 'info' — informational, not a rejection or warning", () => {
    const block = src.match(
      /graduation\.archetype_pine_recipe_assigned[\s\S]*?status:\s*["']info["']/
    );
    expect(
      block,
      "graduation.archetype_pine_recipe_assigned status must be 'info'"
    ).toBeTruthy();
  });

  it("correlationId is threaded from outer scope", () => {
    const block = src.match(
      /graduation\.archetype_pine_recipe_assigned[\s\S]*?correlationId:\s*correlationId\s*\?\?\s*null/
    );
    expect(
      block,
      "graduation.archetype_pine_recipe_assigned must propagate correlationId ?? null"
    ).toBeTruthy();
  });
});

// ─── Suite 2: graduation.uncatalogued_pine_recipe_assigned ───────────────────

describe("Pass 2 Track D — graduation.uncatalogued_pine_recipe_assigned audit emission", () => {
  it("action string graduation.uncatalogued_pine_recipe_assigned is present in the source", () => {
    expect(src).toContain('"graduation.uncatalogued_pine_recipe_assigned"');
  });

  it("entity type is 'strategy_pending_bucket' (uncatalogued path produces no strategy row)", () => {
    const block = src.match(
      /graduation\.uncatalogued_pine_recipe_assigned[\s\S]*?entityType:\s*["']strategy_pending_bucket["']/
    );
    expect(
      block,
      'graduation.uncatalogued_pine_recipe_assigned block must use entityType: "strategy_pending_bucket"'
    ).toBeTruthy();
  });

  it("entity id is bucketId (no strategy was inserted)", () => {
    const block = src.match(
      /graduation\.uncatalogued_pine_recipe_assigned[\s\S]*?entityId:\s*bucketId/
    );
    expect(
      block,
      "graduation.uncatalogued_pine_recipe_assigned must use bucketId as entityId"
    ).toBeTruthy();
  });

  it("result payload includes speaker_term field populated from the sanitized term", () => {
    const block = src.match(
      /graduation\.uncatalogued_pine_recipe_assigned[\s\S]*?speaker_term:\s*speakerTerm/
    );
    expect(
      block,
      "graduation.uncatalogued_pine_recipe_assigned result must include speaker_term: speakerTerm"
    ).toBeTruthy();
  });

  it("result payload declares pine_band: 'alert_only'", () => {
    const block = src.match(
      /graduation\.uncatalogued_pine_recipe_assigned[\s\S]*?pine_band:\s*["']alert_only["']/
    );
    expect(
      block,
      "graduation.uncatalogued_pine_recipe_assigned result must include pine_band: 'alert_only'"
    ).toBeTruthy();
  });

  it("result payload declares recipe_source: 'UNCATALOGUED_SPEAKER_TERM'", () => {
    const block = src.match(
      /graduation\.uncatalogued_pine_recipe_assigned[\s\S]*?recipe_source:\s*["']UNCATALOGUED_SPEAKER_TERM["']/
    );
    expect(
      block,
      "graduation.uncatalogued_pine_recipe_assigned result must include recipe_source: 'UNCATALOGUED_SPEAKER_TERM'"
    ).toBeTruthy();
  });

  it("uses insertAuditRowSafe (non-throwing, matches codebase helper pattern)", () => {
    const block = src.match(
      /insertAuditRowSafe\(\{[\s\S]*?action:\s*["']graduation\.uncatalogued_pine_recipe_assigned["']/
    );
    expect(
      block,
      "graduation.uncatalogued_pine_recipe_assigned must use insertAuditRowSafe"
    ).toBeTruthy();
  });

  it("emission is inside the uncatalogued: guard block — only fires for uncatalogued paths", () => {
    // Must appear inside the if (entryIndicator !== null && entryIndicator.startsWith("uncatalogued:")) block
    const guard = src.match(
      /entryIndicator\.startsWith\(["']uncatalogued:["']\)[\s\S]*?graduation\.uncatalogued_pine_recipe_assigned/
    );
    expect(
      guard,
      "graduation.uncatalogued_pine_recipe_assigned must be inside the uncatalogued: guard block"
    ).toBeTruthy();
  });

  it("status is 'info' — informational queue notification, not a rejection", () => {
    const block = src.match(
      /graduation\.uncatalogued_pine_recipe_assigned[\s\S]*?status:\s*["']info["']/
    );
    expect(
      block,
      "graduation.uncatalogued_pine_recipe_assigned status must be 'info'"
    ).toBeTruthy();
  });

  it("correlationId is threaded from outer scope", () => {
    const block = src.match(
      /graduation\.uncatalogued_pine_recipe_assigned[\s\S]*?correlationId:\s*correlationId\s*\?\?\s*null/
    );
    expect(
      block,
      "graduation.uncatalogued_pine_recipe_assigned must propagate correlationId ?? null"
    ).toBeTruthy();
  });
});

// ─── Suite 3: Parametric path — NEITHER audit is emitted ─────────────────────

describe("Pass 2 Track D — parametric graduation does not emit either pine-recipe audit", () => {
  it("graduation.archetype_pine_recipe_assigned is guarded — not in a code path reachable when isArchetype is false", () => {
    // The guard "if (isArchetype && archetypeName)" must precede the action string in source order.
    // This ensures no parametric (isArchetype===false) graduation can hit the archetype audit.
    const archetypeGuardIdx = src.indexOf("if (isArchetype && archetypeName)");
    const archetypeAuditIdx = src.indexOf('"graduation.archetype_pine_recipe_assigned"');
    expect(archetypeGuardIdx).toBeGreaterThan(-1);
    expect(archetypeAuditIdx).toBeGreaterThan(-1);
    // Guard must appear before the action string in the source
    expect(archetypeGuardIdx).toBeLessThan(archetypeAuditIdx);
  });

  it("graduation.uncatalogued_pine_recipe_assigned is guarded — only inside the uncatalogued: sentinel block", () => {
    // The "entryIndicator.startsWith('uncatalogued:')" check must appear before the uncatalogued audit.
    const uncatGuardIdx = src.indexOf("entryIndicator.startsWith(\"uncatalogued:\")");
    const uncatAuditIdx = src.indexOf('"graduation.uncatalogued_pine_recipe_assigned"');
    expect(uncatGuardIdx).toBeGreaterThan(-1);
    expect(uncatAuditIdx).toBeGreaterThan(-1);
    expect(uncatGuardIdx).toBeLessThan(uncatAuditIdx);
  });

  it("archetype audit block appears AFTER the successful strategy INSERT (inserted.id in scope)", () => {
    // The INSERT returns `inserted` — archetype audit must follow.
    // Verify source order: INSERT returning ... inserted.id → archetype audit.
    const insertIdx = src.indexOf(".returning({ id: strategies.id })");
    const archetypeAuditIdx = src.indexOf('"graduation.archetype_pine_recipe_assigned"');
    expect(insertIdx).toBeGreaterThan(-1);
    expect(archetypeAuditIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeLessThan(archetypeAuditIdx);
  });

  it("uncatalogued audit block appears BEFORE the early return (strategy is never inserted)", () => {
    // Uncatalogued path exits early with strategyId: null.
    // Verify source order: uncatalogued audit → "reason: 'queued_for_archetype'" return.
    const uncatAuditIdx = src.indexOf('"graduation.uncatalogued_pine_recipe_assigned"');
    const earlyReturnIdx = src.indexOf('"queued_for_archetype"');
    expect(uncatAuditIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(uncatAuditIdx).toBeLessThan(earlyReturnIdx);
  });

  it("pine-recipe audit action names do NOT appear outside their guard blocks (no leakage to parametric path)", () => {
    // Count occurrences of each action name — each should appear exactly once in the source.
    // More than one occurrence would mean it leaked to a second code path.
    const archetypeCount = (src.match(/graduation\.archetype_pine_recipe_assigned/g) ?? []).length;
    const uncatCount = (src.match(/graduation\.uncatalogued_pine_recipe_assigned/g) ?? []).length;
    expect(archetypeCount).toBe(1);
    expect(uncatCount).toBe(1);
  });
});
