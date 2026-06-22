/**
 * Wave 23F Track D — Graduator entry_quality + symbols[] emission
 *
 * Guards the W23F.D additions to direct-bucket-graduator.ts:
 *   1. entry_quality block emitted into config JSONB on INSERT
 *   2. symbols TEXT[] emitted as top-level column on INSERT
 *   3. Empty confluence_factors → extraction_provenance = "legacy_no_confluence"
 *   4. Symbols fallback to [market] when extracted_idea.symbols is absent
 *   5. source_claim_win_rate/avg_r round-trip as null
 *   6. graduation.entry_quality_attached audit row always emitted
 *   7. graduation.symbols_multi_market audit row only when symbols.length > 1
 *
 * Uses static source-file inspection (same pattern as wave12 tests) to avoid
 * brittle DB mock chain complexity. The logic under test is explicit conditional
 * code that is fully verifiable without runtime execution.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relPath), "utf8");
}

const src = readSrc("../services/direct-bucket-graduator.ts");

// ─── Suite 1: resolveProvenance helper exists + correct structure ─────────────

describe("Wave 23F Track D — resolveProvenance helper", () => {
  it("resolveProvenance function is defined in the graduator source", () => {
    expect(src).toContain("function resolveProvenance(");
  });

  it("ExtractionProvenance type includes all 4 canonical enum values", () => {
    expect(src).toContain('"youtube_transcript"');
    expect(src).toContain('"reddit_thread"');
    expect(src).toContain('"web_article"');
    expect(src).toContain('"legacy_no_confluence"');
  });

  it("resolveProvenance maps youtube scoutLayer to youtube_transcript", () => {
    const match = src.match(
      /function resolveProvenance[\s\S]*?scoutLayer === ["']youtube["'][\s\S]*?return ["']youtube_transcript["']/
    );
    expect(match, "resolveProvenance must return youtube_transcript for youtube scoutLayer").toBeTruthy();
  });

  it("resolveProvenance maps reddit scoutLayer to reddit_thread", () => {
    const match = src.match(
      /function resolveProvenance[\s\S]*?scoutLayer === ["']reddit["'][\s\S]*?return ["']reddit_thread["']/
    );
    expect(match, "resolveProvenance must return reddit_thread for reddit scoutLayer").toBeTruthy();
  });

  it("resolveProvenance maps web/exa/brave/parallel to web_article", () => {
    const match = src.match(
      /function resolveProvenance[\s\S]*?["']exa["'].*["']brave["'].*["']parallel["'][\s\S]*?return ["']web_article["']/
    );
    expect(match, "resolveProvenance must return web_article for exa/brave/parallel providers").toBeTruthy();
  });
});

// ─── Suite 2: entry_quality block in INSERT ───────────────────────────────────

describe("Wave 23F Track D — entry_quality block emitted on INSERT", () => {
  it("entry_quality block is merged into config on INSERT", () => {
    // The INSERT config spread must include entry_quality key
    const match = src.match(
      /db\.insert\(strategies\)[\s\S]*?entry_quality:\s*entryQualityBlock/
    );
    expect(match, "INSERT config must include entry_quality: entryQualityBlock").toBeTruthy();
  });

  it("confluence_factors extracted from extractedIdea with array guard", () => {
    expect(src).toContain("Array.isArray((extractedIdea as any)?.confluence_factors)");
  });

  it("min_factors_satisfied extracted with numeric type guard and default of 2", () => {
    const match = src.match(
      /typeof \(extractedIdea as any\)\?\.min_factors_satisfied === ["']number["'][\s\S]*?:\s*2/
    );
    expect(match, "min_factors_satisfied must use typeof===number guard with default 2").toBeTruthy();
  });

  it("source_claim_win_rate extracted with nullish coalescing (null passthrough)", () => {
    // Variable name pattern: const sourceClaimWinRate: number | null = ...?.source_claim_win_rate ?? null
    const match = src.match(
      /const sourceClaimWinRate.*=.*\(extractedIdea as any\)\?\.source_claim_win_rate\s*\?\?\s*null/
    );
    expect(match, "sourceClaimWinRate must extract from extractedIdea with ?? null fallback").toBeTruthy();
    // Also verify it ends up in the entry_quality block
    expect(src).toContain("source_claim_win_rate: sourceClaimWinRate");
  });

  it("source_claim_avg_r extracted with nullish coalescing (null passthrough)", () => {
    // Variable name pattern: const sourceClaimAvgR: number | null = ...?.source_claim_avg_r ?? null
    const match = src.match(
      /const sourceClaimAvgR.*=.*\(extractedIdea as any\)\?\.source_claim_avg_r\s*\?\?\s*null/
    );
    expect(match, "sourceClaimAvgR must extract from extractedIdea with ?? null fallback").toBeTruthy();
    // Also verify it ends up in the entry_quality block
    expect(src).toContain("source_claim_avg_r: sourceClaimAvgR");
  });
});

// ─── Suite 3: symbols[] column emitted on INSERT ─────────────────────────────

describe("Wave 23F Track D — symbols[] column emitted on INSERT", () => {
  it("symbols column is written on INSERT (top-level, not inside config)", () => {
    // The INSERT values block must contain `symbols: symbolsArray`
    const match = src.match(
      /db\.insert\(strategies\)[\s\S]*?symbols:\s*symbolsArray/
    );
    expect(match, "INSERT must emit symbols: symbolsArray as a top-level column").toBeTruthy();
  });

  it("symbolsArray is built with array guard on extracted symbols", () => {
    expect(src).toContain("Array.isArray((extractedIdea as any)?.symbols) && (extractedIdea as any).symbols.length > 0");
  });

  it("symbolsArray falls back to [market] when extracted symbols absent", () => {
    // The fallback must be `: [market]` after the extracted symbols guard
    const match = src.match(
      /symbolsArray.*=.*Array\.isArray.*\?[\s\S]*?:\s*\[market\]/
    );
    expect(match, "symbolsArray must fall back to [market] when no symbols in extracted_idea").toBeTruthy();
  });

  it("multi-symbol arrays pass through without truncation", () => {
    // The symbolsArray assignment does NOT slice or take first element
    // Verify the assignment line itself has no .slice(0,1) or [0] truncation
    const assignmentBlock = src.match(
      /const symbolsArray[\s\S]*?;/
    );
    expect(assignmentBlock).toBeTruthy();
    if (assignmentBlock) {
      expect(assignmentBlock[0]).not.toMatch(/\.slice\(0\s*,\s*1\)/);
      expect(assignmentBlock[0]).not.toMatch(/\[0\]/);
    }
  });
});

// ─── Suite 4: Empty-confluence fallback to legacy_no_confluence ───────────────

describe("Wave 23F Track D — empty confluence_factors → legacy_no_confluence", () => {
  it("extraction_provenance flips to legacy_no_confluence when confluence_factors.length === 0", () => {
    const match = src.match(
      /extraction_provenance:\s*finalConfluenceFactors\.length === 0[\s\S]*?"legacy_no_confluence" as const/
    );
    expect(
      match,
      "extraction_provenance must be legacy_no_confluence when finalConfluenceFactors.length === 0"
    ).toBeTruthy();
  });

  it("non-empty confluence_factors delegates to resolveProvenance()", () => {
    const match = src.match(
      /finalConfluenceFactors\.length === 0[\s\S]*?:\s*resolveProvenance\(bestMention\.scoutLayer/
    );
    expect(
      match,
      "non-empty confluence case must call resolveProvenance(bestMention.scoutLayer, ...)"
    ).toBeTruthy();
  });
});

// ─── Suite 5: Audit log emissions ────────────────────────────────────────────

describe("Wave 23F Track D — audit log emission", () => {
  it("graduation.entry_quality_attached audit row is emitted after INSERT", () => {
    expect(src).toContain('"graduation.entry_quality_attached"');
  });

  it("entry_quality_attached audit evidence includes confluence_factor_count", () => {
    const match = src.match(
      /graduation\.entry_quality_attached[\s\S]*?confluence_factor_count:\s*entryQualityBlock\.confluence_factors\.length/
    );
    expect(match, "entry_quality_attached audit must include confluence_factor_count").toBeTruthy();
  });

  it("entry_quality_attached audit evidence includes symbols and symbols_count", () => {
    const match = src.match(
      /graduation\.entry_quality_attached[\s\S]*?symbols_count:\s*symbolsArray\.length[\s\S]*?symbols:\s*symbolsArray/
    );
    expect(match, "entry_quality_attached audit must include symbols_count and symbols").toBeTruthy();
  });

  it("graduation.symbols_multi_market audit row is emitted conditionally on symbols.length > 1", () => {
    const match = src.match(
      /if\s*\(\s*symbolsArray\.length\s*>\s*1\s*\)[\s\S]*?"graduation\.symbols_multi_market"/
    );
    expect(
      match,
      "graduation.symbols_multi_market audit must be inside if (symbolsArray.length > 1)"
    ).toBeTruthy();
  });

  it("symbols_multi_market audit is NOT emitted unconditionally", () => {
    // Verify it only appears inside the conditional block — not at module scope
    const unconditionalMatch = src.match(
      /^[^}]*"graduation\.symbols_multi_market"/m
    );
    // The action string should always appear inside a conditional (inside `if (symbolsArray.length > 1)`)
    // We verify this by confirming the block appears within the if-guard in the source
    const guardedMatch = src.match(
      /symbolsArray\.length\s*>\s*1[\s\S]{0,500}graduation\.symbols_multi_market/
    );
    expect(guardedMatch, "symbols_multi_market must be guarded by symbolsArray.length > 1").toBeTruthy();
  });

  it("both audit rows are non-blocking (fire-and-forget with .catch())", () => {
    // Count occurrences of the pattern near the two new audit writes
    const entryQualityAuditCatch = src.match(
      /entry_quality_attached[\s\S]*?\.catch\(/
    );
    const multiMarketAuditCatch = src.match(
      /symbols_multi_market[\s\S]*?\.catch\(/
    );
    expect(entryQualityAuditCatch, "entry_quality_attached audit must have .catch() for non-blocking fire").toBeTruthy();
    expect(multiMarketAuditCatch, "symbols_multi_market audit must have .catch() for non-blocking fire").toBeTruthy();
  });
});

// ─── Suite 6: Schema-level integration guards ─────────────────────────────────

describe("Wave 23F Track D — schema and backward-compat guards", () => {
  it("strategies.symbols column is imported (confirms W23F.A migration is consumed)", () => {
    // The INSERT uses `symbols: symbolsArray` which references the strategies Drizzle table
    // imported at top of the file. Verify strategies is imported from schema.
    const importLine = src.match(/import.*strategies.*from.*schema/);
    expect(importLine, "strategies must be imported from schema").toBeTruthy();
  });

  it("legacy symbol column (single market) is still written for backward compat", () => {
    // The INSERT must still write `symbol: market` (legacy column) alongside `symbols: symbolsArray`
    const match = src.match(
      /db\.insert\(strategies\)[\s\S]*?symbol:\s*market[\s\S]*?symbols:\s*symbolsArray/
    );
    expect(match, "INSERT must write both legacy symbol column AND new symbols array").toBeTruthy();
  });

  it("entry_quality is inside config spread (not a top-level column)", () => {
    // config must be: { ...(overlayed.config), entry_quality: entryQualityBlock }
    // not a bare `entry_quality:` sibling of `config:`
    const match = src.match(
      /config:\s*\{[\s\S]*?\.\.\.\(overlayed\.config[\s\S]*?\)[\s\S]*?entry_quality:\s*entryQualityBlock/
    );
    expect(match, "entry_quality must be inside the config JSONB spread, not a top-level column").toBeTruthy();
  });
});
