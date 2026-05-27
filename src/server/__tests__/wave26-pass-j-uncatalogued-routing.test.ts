/**
 * Wave 26 Pass J Phase 3 — Uncatalogued routing graduator extension (2026-05-26)
 *
 * Verifies:
 *   1. deriveEntryIndicator's NEW final fallback emits `uncatalogued:<term>`
 *      instead of null when the concept doesn't match a canonical indicator
 *      or known archetype. Test via inlined sanitizer logic (avoids the
 *      DATABASE_URL bootstrap that direct graduator import would trigger —
 *      mirrors wave26-pass-h-graduator-fixes.test.ts pattern).
 *   2. The graduator caller has a `uncatalogued:*` branch that inserts into
 *      needs_archetype_queue + emits `graduation.queued_for_archetype` audit.
 *      Verified via static source inspection.
 *   3. Migration 0162 file exists and has the right shape.
 *   4. Schema export needsArchetypeQueue exists.
 *
 * Pattern: static source inspection + inlined pure-function logic.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const GRADUATOR_PATH = path.resolve(__dirname, "../services/direct-bucket-graduator.ts");
const GRADUATOR_SRC = fs.readFileSync(GRADUATOR_PATH, "utf-8");

const SCHEMA_PATH = path.resolve(__dirname, "../db/schema.ts");
const SCHEMA_SRC = fs.readFileSync(SCHEMA_PATH, "utf-8");

const MIGRATION_PATH = path.resolve(__dirname, "../db/migrations/0162_needs_archetype_queue.sql");
const JOURNAL_PATH = path.resolve(__dirname, "../db/migrations/meta/_journal.json");

// ── Inlined sanitizer logic (copy of Pass J Phase 3 fallback in deriveEntryIndicator) ──
function sanitizeForUncatalogued(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function inlinedUncataloguedFallback(
  llmEntryIndicator: string | null,
  fallback: string | null,
  conceptName: string,
): string | null {
  const speakerCandidate =
    (llmEntryIndicator?.toLowerCase().trim() ?? "") ||
    (fallback?.toLowerCase().trim() ?? "") ||
    conceptName.toLowerCase();
  const sanitized = sanitizeForUncatalogued(speakerCandidate);
  if (sanitized.length > 0) return `uncatalogued:${sanitized}`;
  return null;
}

describe("Pass J Phase 3 — uncatalogued sanitizer (inlined)", () => {
  it("emits uncatalogued:<speaker_term> for novel LLM indicator", () => {
    const r = inlinedUncataloguedFallback("Hidden_Level_Continuation", null, "novel_concept");
    expect(r).toBe("uncatalogued:hidden_level_continuation");
  });

  it("falls back to fallback param when LLM indicator empty", () => {
    const r = inlinedUncataloguedFallback(null, "Custom Framework V3", "concept_name");
    expect(r).toBe("uncatalogued:custom_framework_v3");
  });

  it("falls back to conceptName when both LLM and fallback are empty", () => {
    const r = inlinedUncataloguedFallback(null, null, "the_speakers_proprietary_setup");
    expect(r).toBe("uncatalogued:the_speakers_proprietary_setup");
  });

  it("strips special characters cleanly", () => {
    const r = inlinedUncataloguedFallback("IRS-Model (v2)!!", null, "x");
    expect(r).toBe("uncatalogued:irs_model_v2");
  });

  it("strips leading and trailing underscores after substitution", () => {
    const r = inlinedUncataloguedFallback("...hidden level...", null, "x");
    expect(r).toBe("uncatalogued:hidden_level");
  });

  it("caps sanitized term at 64 chars", () => {
    const huge = "a_very_long_speaker_concept_name_that_far_exceeds_the_sixty_four_character_limit";
    const r = inlinedUncataloguedFallback(huge, null, "x");
    expect(r).not.toBeNull();
    const term = r!.slice("uncatalogued:".length);
    expect(term.length).toBeLessThanOrEqual(64);
  });

  it("returns null when ALL inputs sanitize to empty", () => {
    const r = inlinedUncataloguedFallback("...", "***", "!!!");
    expect(r).toBeNull();
  });

  it("returns null on whitespace-only inputs", () => {
    const r = inlinedUncataloguedFallback("   ", "   ", "   ");
    expect(r).toBeNull();
  });

  it("preserves underscores in already-clean inputs", () => {
    const r = inlinedUncataloguedFallback("4hr_box_continuation_with_optimum_zone", null, "x");
    expect(r).toBe("uncatalogued:4hr_box_continuation_with_optimum_zone");
  });
});

describe("Pass J Phase 3 — graduator source contract", () => {
  it("deriveEntryIndicator returns uncatalogued:<sanitized> for unmapped concepts", () => {
    expect(GRADUATOR_SRC).toMatch(/UNCATALOGUED SPEAKER TERM/);
    expect(GRADUATOR_SRC).toMatch(/return\s+`uncatalogued:\$\{sanitized\}`/);
  });

  it("derive path is tagged 'uncatalogued_speaker_term' for observability", () => {
    expect(GRADUATOR_SRC).toMatch(/_derivePathOut\.path\s*=\s*["']uncatalogued_speaker_term["']/);
  });

  it("caller branches on uncatalogued: prefix BEFORE the legacy null-reject path", () => {
    const uncatBranchIdx = GRADUATOR_SRC.indexOf("entryIndicator.startsWith(\"uncatalogued:\")");
    const nullRejectIdx = GRADUATOR_SRC.indexOf("if (entryIndicator === null)");
    expect(uncatBranchIdx).toBeGreaterThan(0);
    expect(nullRejectIdx).toBeGreaterThan(0);
    expect(uncatBranchIdx).toBeLessThan(nullRejectIdx);
  });

  it("UPSERT into needs_archetype_queue bumps extraction_count on conflict", () => {
    expect(GRADUATOR_SRC).toMatch(/INSERT INTO needs_archetype_queue/);
    expect(GRADUATOR_SRC).toMatch(/ON CONFLICT\s*\(speaker_term\)/);
    expect(GRADUATOR_SRC).toMatch(/extraction_count\s*=\s*needs_archetype_queue\.extraction_count\s*\+\s*1/);
  });

  it("emits graduation.queued_for_archetype audit row", () => {
    expect(GRADUATOR_SRC).toMatch(/action:\s*["']graduation\.queued_for_archetype["']/);
  });

  it("UPSERT failure is non-blocking (caught with warn log)", () => {
    expect(GRADUATOR_SRC).toMatch(/needs_archetype_queue UPSERT failed/);
  });

  it("returns skipped:true with reason 'queued_for_archetype'", () => {
    expect(GRADUATOR_SRC).toMatch(/reason:\s*["']queued_for_archetype["']/);
  });
});

describe("Pass J Phase 3 — migration 0162 contract", () => {
  it("migration file exists", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("migration creates needs_archetype_queue table idempotently", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS needs_archetype_queue/i);
  });

  it("migration has status CHECK constraint with the 3 allowed values", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/CHECK\s*\(\s*status IN\s*\(\s*'pending',\s*'archetype_created',\s*'rejected'\s*\)\s*\)/i);
  });

  it("migration has UNIQUE INDEX on speaker_term for UPSERT path", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS needs_archetype_queue_term_idx/i);
  });

  it("migration has STATUS index for dashboard top-N queries", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS needs_archetype_queue_status_idx/i);
  });

  it("journal includes idx 162 with tag 0162_needs_archetype_queue", () => {
    const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8"));
    const entry = journal.entries.find((e: { idx: number; tag: string }) => e.idx === 162);
    expect(entry).toBeDefined();
    expect(entry.tag).toBe("0162_needs_archetype_queue");
  });
});

describe("Pass J Phase 3 — schema export", () => {
  it("schema.ts exports needsArchetypeQueue table", () => {
    expect(SCHEMA_SRC).toMatch(/export const needsArchetypeQueue\s*=\s*pgTable\s*\(/);
  });

  it("schema declares the canonical columns", () => {
    expect(SCHEMA_SRC).toMatch(/speakerTerm:\s*text\("speaker_term"\)\.notNull\(\)/);
    expect(SCHEMA_SRC).toMatch(/extractionCount:\s*integer\("extraction_count"\)\.notNull\(\)\.default\(1\)/);
    expect(SCHEMA_SRC).toMatch(/status:\s*text\("status"\)\.notNull\(\)\.default\("pending"\)/);
  });

  it("schema declares unique index on speaker_term", () => {
    expect(SCHEMA_SRC).toMatch(/uniqueIndex\("needs_archetype_queue_term_idx"\)\.on\(table\.speakerTerm\)/);
  });
});

describe("Pass J Phase 3 — agent.ts route mechanic classifier wiring", () => {
  const AGENT_PATH = path.resolve(__dirname, "../routes/agent.ts");
  const AGENT_SRC = fs.readFileSync(AGENT_PATH, "utf-8");

  it("imports classifyMechanicPortability and explainRejectClass", () => {
    expect(AGENT_SRC).toMatch(/import\s*\{\s*classifyMechanicPortability,\s*explainRejectClass\s*\}\s*from\s*["']\.\.\/lib\/mechanic-portability\.js["']/);
  });

  it("emits extraction.mechanic_portability_classified audit row", () => {
    expect(AGENT_SRC).toMatch(/action:\s*["']extraction\.mechanic_portability_classified["']/);
  });

  it("override path emits extraction.mechanic_classification_override audit row when LLM said non_futures_primary but mechanics port", () => {
    expect(AGENT_SRC).toMatch(/action:\s*["']extraction\.mechanic_classification_override["']/);
  });

  it("empty-ideas reject path uses mechanic classifier reason instead of hardcoded no_supported_market", () => {
    expect(AGENT_SRC).toMatch(/reason:\s*portability\.reject_class!/);
    expect(AGENT_SRC).toMatch(/reason:\s*["']no_strategy_content["']/);
  });

  it("response carries mechanic_portable flag", () => {
    expect(AGENT_SRC).toMatch(/mechanic_portable:\s*portability\.portable/);
  });
});

describe("Pass J Phase 2 — Discord bot embed mechanic-class branches", () => {
  const BOT_PATH = path.resolve(__dirname, "../../discord/bot.ts");
  const BOT_SRC = fs.readFileSync(BOT_PATH, "utf-8");

  it("has a dedicated embed for options_derivative reject", () => {
    expect(BOT_SRC).toMatch(/r\.reason\s*===\s*["']options_derivative["']/);
    expect(BOT_SRC).toMatch(/Options play/);
  });

  it("has a dedicated embed for forex_specific_mechanics reject", () => {
    expect(BOT_SRC).toMatch(/r\.reason\s*===\s*["']forex_specific_mechanics["']/);
    expect(BOT_SRC).toMatch(/Forex mechanic/);
  });

  it("has a dedicated embed for stock_specific_mechanics reject", () => {
    expect(BOT_SRC).toMatch(/r\.reason\s*===\s*["']stock_specific_mechanics["']/);
    expect(BOT_SRC).toMatch(/Stock mechanic/);
  });

  it("has a dedicated embed for crypto_specific_mechanics reject", () => {
    expect(BOT_SRC).toMatch(/r\.reason\s*===\s*["']crypto_specific_mechanics["']/);
    expect(BOT_SRC).toMatch(/Crypto mechanic/);
  });

  // Wave 26 Pass K Phase 5 (2026-05-26) — voice + ET footer
  it("emits ET-localized footer via nowEtFooter helper (not Discord browser-local time)", () => {
    expect(BOT_SRC).toMatch(/function nowEtFooter\(\)/);
    expect(BOT_SRC).toMatch(/America\/New_York/);
    expect(BOT_SRC).toMatch(/setFooter\(\{\s*text:\s*nowEtFooter\(\)\s*\}\)/);
  });

  it("uses videoHeaderField helper for consistent video-title row", () => {
    expect(BOT_SRC).toMatch(/function videoHeaderField\(/);
  });
});
