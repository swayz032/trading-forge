/**
 * critique-knowledge-retriever.test.ts — Wave 1: institutional RAG grounding
 * + faithfulness verification for the trade-critique analyst.
 *
 * Coverage:
 *  1. Retriever assembles expected sections for a sample llmInput
 *  2. Missing KB card fails soft (no throw, partial block returned)
 *  3. Oracle-Fallacy guard header present with EXACT wording
 *  4. deriveArchetypeKey maps a strategy name to the right archetype
 *  5. Retriever does not mutate llmInput (additive-only; off-path safe)
 *  6. Prior critiques rendered; db error still yields the guard section
 *  7. Faithfulness flags a dimension weighted without its data field
 *  8. Faithfulness flags a parameter_hint whitelist violation
 *  9. Faithfulness clean critique → supported=true, no flags (no-op path)
 * 10. Faithfulness tolerates validated { td } shape + missing technical_diagnosis
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted controllable state for mocks ──────────────────────────────────────

const h = vi.hoisted(() => ({
  fsThrow: false,
  priorRows: [] as Array<Record<string, unknown>>,
  selectThrow: false,
}));

// fs mock: delegate to real fs unless h.fsThrow is set (simulates missing cards).
vi.mock("fs", async (importActual) => {
  const actual = await importActual<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: (p: unknown, e: unknown) => {
      if (h.fsThrow) throw new Error("simulated missing KB card");
      // @ts-expect-error passthrough
      return actual.readFileSync(p, e);
    },
  };
});

vi.mock("../db/index.js", () => ({
  db: {
    select: () => {
      if (h.selectThrow) throw new Error("db down");
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => Promise.resolve(h.priorRows);
      return chain;
    },
  },
}));

vi.mock("../db/schema.js", () => ({
  tradeCritique: {
    strategyId: "strategy_id",
    critiquedAt: "critiqued_at",
    grade: "grade",
    plainEnglishSummary: "plain_english_summary",
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  retrieveCritiqueKnowledge,
  deriveArchetypeKey,
  PRIOR_OBSERVATIONS_HEADER,
  __clearCritiqueKbCacheForTests,
} from "../services/critique-knowledge-retriever.js";
import { checkCritiqueFaithfulness } from "../services/critique-faithfulness-check.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function sampleInput() {
  return {
    position: { symbol: "MES", fill_probability: 0.9, slippage: 1.25, exit_reason: "tp1" },
    session: { strategy_id: "strat-1" },
    strategy: {
      name: "MES Silver Bullet NY_AM",
      symbol: "MES",
      preferred_regimes: ["TRENDING_UP"],
      entry_indicator: "archetype:silver_bullet",
      confirming_indicators: ["market_structure_aligned"],
      entry_quality: { use_weighted_scoring: true, min_factors_satisfied: 3 },
      stop_loss: { method: "atr", multiplier: 1.5 },
      take_profit: { style: "styleC" },
      position_size: { type: "risk_derived_pyramid" },
    },
    context: {
      regime_at_entry: "TRENDING_UP",
      structure_state: { bos: true },
      narrative_phase: { phase: "DISTRIBUTION" },
      confluence_factors_active: [{ factor: "market_structure_aligned", weight: 0.2, satisfied: true, decay_confidence: 0.9 }],
      nearest_liquidity_level: { level_type: "PDH", price: 5000 },
    },
  };
}

beforeEach(() => {
  h.fsThrow = false;
  h.priorRows = [];
  h.selectThrow = false;
  __clearCritiqueKbCacheForTests();
});

// ─── Retriever ─────────────────────────────────────────────────────────────────

describe("retrieveCritiqueKnowledge — assembly", () => {
  it("assembles the expected sections for a sample llmInput", async () => {
    h.priorRows = [
      { grade: "B", plainEnglishSummary: { one_liner: "Prior clean entry", what_to_watch: "slippage" }, critiquedAt: new Date() },
    ];
    const block = await retrieveCritiqueKnowledge(sampleInput());

    expect(block).toContain("# INSTITUTIONAL REFERENCE");
    // attribution-methodology (full) — the faithfulness spec
    expect(block).toContain("Attribution Methodology");
    expect(block).toContain("FAITHFULNESS RULE");
    // prop-firm rules (full)
    expect(block).toContain("Prop Firm Rules Summary");
    // archetype playbook — the ONE matching section
    expect(block).toContain("## ARCHETYPE PLAYBOOK");
    expect(block).toContain("ARCHETYPE: silver_bullet");
    // regime context slice
    expect(block).toContain("## REGIME CONTEXT");
    expect(block).toContain("TRENDING_UP");
    // symbol microstructure slice
    expect(block).toContain("## SYMBOL MICROSTRUCTURE");
    expect(block).toContain("SYMBOL: mes");
    // strategy own thesis
    expect(block).toContain("## STRATEGY'S OWN THESIS");
    expect(block).toContain("archetype:silver_bullet");
    // prior observations + guard
    expect(block).toContain(PRIOR_OBSERVATIONS_HEADER);
    expect(block).toContain("Prior clean entry");
  });

  it("fails soft when KB cards are missing (no throw, partial block)", async () => {
    h.fsThrow = true; // every card read throws → all card sections skipped
    const block = await retrieveCritiqueKnowledge(sampleInput());

    // Never throws; header + prior-observations guard (db-driven, not card-driven) remain.
    expect(typeof block).toBe("string");
    expect(block).toContain("# INSTITUTIONAL REFERENCE");
    expect(block).toContain(PRIOR_OBSERVATIONS_HEADER);
    // Card-derived sections are absent.
    expect(block).not.toContain("## ARCHETYPE PLAYBOOK");
    expect(block).not.toContain("## REGIME CONTEXT");
  });

  it("includes the Oracle-Fallacy guard header verbatim", async () => {
    const block = await retrieveCritiqueKnowledge(sampleInput());
    expect(block).toContain(
      "PRIOR OBSERVATIONS (UNVERIFIED HYPOTHESES — re-derive from THIS trade's data; do NOT treat as fact)",
    );
    expect(block).toContain("Oracle Fallacy");
  });

  it("renders prior critiques; a db error still yields the guard section", async () => {
    h.selectThrow = true;
    const block = await retrieveCritiqueKnowledge(sampleInput());
    expect(block).toContain(PRIOR_OBSERVATIONS_HEADER);
    expect(block).toContain("No prior critiques on record");
  });

  it("does not mutate llmInput (additive-only, off-path safe)", async () => {
    const input = sampleInput();
    const snapshot = JSON.stringify(input);
    await retrieveCritiqueKnowledge(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("deriveArchetypeKey", () => {
  it("maps a Silver Bullet strategy name to silver_bullet", () => {
    expect(deriveArchetypeKey("MES Silver Bullet NY_AM", "archetype:silver_bullet")).toBe("silver_bullet");
  });
  it("maps an ORB name to opening_range", () => {
    expect(deriveArchetypeKey("MNQ Opening Range Breakout 15m", "opening_range_breakout")).toBe("opening_range");
  });
  it("returns null when nothing matches", () => {
    expect(deriveArchetypeKey("Untitled", "")).toBeNull();
  });
});

// ─── Faithfulness check ────────────────────────────────────────────────────────

describe("checkCritiqueFaithfulness", () => {
  const supportedInput = sampleInput();

  const attribution = {
    regime: 0.2, structure: 0.15, narrative: 0.1, confluence: 0.15,
    decay: 0.05, liquidity: 0.1, fill: 0.15, exit_plan: 0.1,
  };

  it("flags a dimension weighted material without its evidencing data field", () => {
    // liquidity weighted 0.20 but nearest_liquidity_level absent.
    const input = { ...sampleInput(), context: { ...sampleInput().context, nearest_liquidity_level: null } };
    const critique = {
      technical_diagnosis: {
        attribution: { ...attribution, liquidity: 0.2, fill: 0.05 },
        parameter_hint: null,
      },
    };
    const result = checkCritiqueFaithfulness(critique, input);
    expect(result.supported).toBe(false);
    expect(result.flags.some((f) => f.includes("attribution.liquidity") && f.includes("nearest_liquidity_level"))).toBe(true);
  });

  it("flags a parameter_hint.field not in the rubric whitelist", () => {
    const critique = {
      technical_diagnosis: {
        attribution,
        parameter_hint: { field: "max_contracts", current: 9, suggested_range: "3-6", confidence: 0.5 },
      },
    };
    const result = checkCritiqueFaithfulness(critique, supportedInput);
    expect(result.supported).toBe(false);
    expect(result.flags.some((f) => f.includes("max_contracts") && f.includes("whitelist"))).toBe(true);
  });

  it("passes a fully-supported critique (supported=true, no flags)", () => {
    const critique = {
      technical_diagnosis: {
        attribution,
        parameter_hint: { field: "stop_multiplier", current: 1.5, suggested_range: "1.5-2.0", confidence: 0.6 },
      },
    };
    const result = checkCritiqueFaithfulness(critique, supportedInput);
    expect(result.supported).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it("accepts the validated { td } shape and reports missing technical_diagnosis", () => {
    // validated { td } shape is tolerated
    const viaTd = checkCritiqueFaithfulness({ td: { attribution, parameter_hint: null } }, supportedInput);
    expect(viaTd.supported).toBe(true);

    // missing technical_diagnosis entirely → unsupported
    const missing = checkCritiqueFaithfulness({}, supportedInput);
    expect(missing.supported).toBe(false);
    expect(missing.flags.length).toBeGreaterThan(0);
  });
});
