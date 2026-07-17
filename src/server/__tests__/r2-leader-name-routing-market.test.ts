/**
 * R2 fix (2026-07-16) — Leader strategy NAME must derive from the bucket's ROUTING
 * market, not the best-mention's LLM `extractedIdea.symbols[0]`.
 *
 * Bug (HIGH): after W23F.C dropped market from the bucket fingerprint (concept-only
 * hash), cross-market mentions of one concept converge into ONE bucket whose `market`
 * is the first mention's, while `bestMention` is chosen by richness. The leader name
 * was derived from `extractedIdea.symbols[0]` (best-mention LLM symbols), which could
 * be e.g. "MNQ" while the routing `market` (and the value the row is inserted with)
 * is "MES". Result: a leader NAMED `..._mnq_...` but SIZED/inserted as MES, colliding
 * with the real MNQ fan-out variant; and if that MNQ name pre-existed, the name-dedup
 * returned the unrelated MNQ id with skipped:true and the caller marked the MES bucket
 * graduated-pointing-at-the-MNQ-strategy — silently dropping the legit MES edge.
 *
 * Two-part fix:
 *   (a) direct-bucket-graduator.ts — `canonicalMarketForName = market` (routing market),
 *       not `extractedIdea.symbols[0]`.
 *   (b) agent.ts — the caller distinguishes `skipped:true` (dedup hit) from a genuine
 *       insert BEFORE marking the bucket graduated (records `graduation.deduped_to_existing`
 *       instead of the success "new strategy" audit + Discord ping).
 *
 * MED: the `graduation.symbols_multi_market` + `graduation.entry_quality_attached`
 * audits report the REAL per-market fan-out set actually created (`createdMarkets`),
 * not the decoupled `extractedIdea.symbols`.
 *
 * Test structure: static source-guards (the established pattern for the DB-heavy
 * graduator hot-path — see wave12-graduator-no-silent-leak.test.ts) + a behavioral
 * assertion on the exported `inferSymbolSet` invariant that fix (a) relies on.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { inferSymbolSet } from "../lib/wave25-strategy-defaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relPath), "utf8");
}

const graduatorSrc = readSrc("../services/direct-bucket-graduator.ts");
const agentSrc = readSrc("../routes/agent.ts");

// ─── Fix (a): leader name derives from routing `market` ──────────────────────

describe("R2 — leader name canonicalizes from routing market (fix a)", () => {
  it("canonicalMarketForName is assigned from `market`, not extractedIdea.symbols", () => {
    expect(graduatorSrc).toMatch(/const\s+canonicalMarketForName\s*=\s*market\s*;/);
  });

  it("the buggy symbolsForName[0] derivation is gone", () => {
    // RED-proof: the pre-fix code read `canonicalMarketForName = symbolsForName[0]`.
    expect(graduatorSrc).not.toContain("symbolsForName");
    expect(graduatorSrc).not.toMatch(/canonicalMarketForName\s*=\s*symbolsForName/);
    expect(graduatorSrc).not.toMatch(/canonicalMarketForName\s*=\s*\(extractedIdea/);
  });

  it("strategyName still derives via deriveStrategyName(conceptName, canonicalMarketForName, timeframe)", () => {
    expect(graduatorSrc).toContain(
      "deriveStrategyName(conceptName, canonicalMarketForName, timeframe)"
    );
  });
});

// ─── Invariant that fix (a) relies on: routing market IS symbols[0] ──────────

describe("R2 — inferSymbolSet places the routing (original) market first", () => {
  it.each(["MES", "MNQ", "MCL"] as const)(
    "leader routing market %s is symbols[0] of the fan-out set",
    (mkt) => {
      const set = inferSymbolSet("any_name", "any_concept", mkt);
      expect(set[0]).toBe(mkt);
      // fan-out variants (slice(1)) never include the leader market again
      expect(set.slice(1)).not.toContain(mkt);
    }
  );
});

// ─── Fix (b): caller distinguishes skipped dedup-hit from a genuine insert ───

describe("R2 — agent.ts distinguishes a dedup hit from a fresh graduation (fix b)", () => {
  it("guards `grad.skipped === true && graduatedStrategyId !== null`", () => {
    expect(agentSrc).toMatch(
      /grad\.skipped\s*===\s*true\s*&&\s*graduatedStrategyId\s*!==\s*null/
    );
  });

  it("the dedup branch is checked BEFORE the success `if (graduatedStrategyId !== null)` block", () => {
    const dedupIdx = agentSrc.indexOf(
      "if (grad.skipped === true && graduatedStrategyId !== null)"
    );
    const successIdx = agentSrc.indexOf("if (graduatedStrategyId !== null) {");
    expect(dedupIdx).toBeGreaterThan(-1);
    expect(successIdx).toBeGreaterThan(-1);
    expect(dedupIdx).toBeLessThan(successIdx);
  });

  it("records a `graduation.deduped_to_existing` audit (not a success cross_validated)", () => {
    expect(agentSrc).toContain("graduation.deduped_to_existing");
    // The dedup branch must return early before firing the new-graduation SSE/Discord.
    const branch = agentSrc.slice(
      agentSrc.indexOf("if (grad.skipped === true && graduatedStrategyId !== null)")
    );
    const branchBody = branch.slice(0, branch.indexOf("if (graduatedStrategyId !== null) {"));
    expect(branchBody).toMatch(/return;/);
  });
});

// ─── MED: provenance audits report the real fan-out set (createdMarkets) ─────

describe("R2 — provenance audits report the real per-market fan-out set (MED)", () => {
  it("tracks the markets actually created via createdVariantMarkets + createdMarkets", () => {
    expect(graduatorSrc).toContain("createdVariantMarkets");
    expect(graduatorSrc).toMatch(
      /const\s+createdMarkets:\s*string\[\]\s*=\s*\[\s*leaderSymbol\s*,\s*\.\.\.createdVariantMarkets\s*\]/
    );
  });

  it("graduation.symbols_multi_market gates + reports on createdMarkets, not symbolsArray", () => {
    const block = graduatorSrc.slice(
      graduatorSrc.indexOf('action: "graduation.symbols_multi_market"') - 400,
      graduatorSrc.indexOf('action: "graduation.symbols_multi_market"') + 400
    );
    expect(block).toContain("createdMarkets");
    expect(block).not.toContain("symbolsArray");
  });

  it("graduation.entry_quality_attached reports createdMarkets", () => {
    const block = graduatorSrc.slice(
      graduatorSrc.indexOf('action: "graduation.entry_quality_attached"'),
      graduatorSrc.indexOf('action: "graduation.entry_quality_attached"') + 700
    );
    expect(block).toContain("symbols: createdMarkets");
  });

  it("the dead symbolsArray provenance variable is removed", () => {
    // RED-proof: symbolsArray was the decoupled extractedIdea.symbols source.
    expect(graduatorSrc).not.toMatch(/const\s+symbolsArray\s*:/);
  });
});
