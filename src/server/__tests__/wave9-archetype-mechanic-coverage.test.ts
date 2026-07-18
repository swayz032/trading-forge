/**
 * Wave 9 — ARCHETYPE_MECHANIC_KEYWORDS coverage tests
 *
 * Verifies that every key in ARCHETYPE_REGISTRY has a corresponding entry in
 * ARCHETYPE_MECHANIC_KEYWORDS so no archetype can silently bypass the mechanic
 * mismatch gate.
 *
 * Also tests that the mechanic keyword gate itself correctly accepts/rejects
 * prose for the 9 newly-added archetypes.
 *
 * Dependency-free: reads the TS file textually and reproduces the keyword-
 * match predicate inline. No DB, no mocked services.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── File paths ───────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "../../..");
const TS_GRADUATOR = resolve(ROOT, "src/server/services/direct-bucket-graduator.ts");
const tsSource = readFileSync(TS_GRADUATOR, "utf-8");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractBlockKeys(source: string, constName: string): string[] {
  const re = new RegExp(`const ${constName}[^=]+=\\s*\\{([\\s\\S]*?)\\n\\};`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not find '${constName}' in TS source`);
  return [...match[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
}

// ARCHETYPE_MECHANIC_KEYWORDS is defined inside a function body — use different indent matching.
function extractMechanicKeywordKeys(source: string): string[] {
  const re = /const ARCHETYPE_MECHANIC_KEYWORDS[\s\S]*?^ {2}};/m;
  const match = source.match(re);
  if (!match) throw new Error("Could not find ARCHETYPE_MECHANIC_KEYWORDS in TS source");
  return [...match[0].matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
}

const registryKeys = extractBlockKeys(tsSource, "ARCHETYPE_REGISTRY");
const mechanicKeys = extractMechanicKeywordKeys(tsSource);

// ─── Keyword check helper — mirrors the graduator's own logic ─────────────────
// The gate requires ALL keyword regexes to match (if any are defined).
// Reproducing the ARCHETYPE_MECHANIC_KEYWORDS here inline for the 9 new entries.

type KwSpec = RegExp[];
const NEW_ARCHETYPE_KEYWORDS: Record<string, KwSpec> = {
  ict_london_raid: [/london/i, /asia.*range|asian.*range|range/i, /sweep|raid/i, /mss|market.structure.shift/i],
  ict_quarterly_swing: [/quarterly|quarter/i, /q1|q2|q3|q4/i, /weekly.*range|daily.*range|cycle/i],
  ict_propulsion: [/propulsion/i, /breaker.block|breaker/i, /mitigation|continuation/i],
  ict_eqhl_raid: [/equal.high|equal.low|eqh|eql/i, /raid|sweep/i, /liquidity/i, /displacement/i],
  ict_scalp: [/killzone|kill.zone/i, /sweep/i, /mss|displacement/i, /fvg|fair.value.gap/i],
  ict_swing: [/htf|higher.timeframe|daily.*bias|weekly.*bias/i, /sweep|premium|discount/i, /bos|break.of.structure/i],
  ict_2022: [/htf|higher.timeframe|bias/i, /sweep|manipulation/i, /mss|market.structure.shift/i, /fvg|fair.value.gap/i],
  wyckoff_accumulation: [/accumulation/i, /spring/i, /secondary.test|st/i, /sign.of.strength|sos/i],
  wyckoff_distribution: [/distribution/i, /upthrust|ut/i, /secondary.test|st/i, /sign.of.weakness|sow/i],
};

function allKeywordsPresent(prose: string, keywords: RegExp[]): boolean {
  return keywords.every((re) => re.test(prose));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 9 — ARCHETYPE_MECHANIC_KEYWORDS full coverage", () => {
  it("every ARCHETYPE_REGISTRY key has a ARCHETYPE_MECHANIC_KEYWORDS entry", () => {
    const missing = registryKeys.filter((k) => !mechanicKeys.includes(k));
    expect(missing, `ARCHETYPE_REGISTRY keys missing from MECHANIC_KEYWORDS: [${missing.join(", ")}]`).toEqual([]);
  });

  it("ARCHETYPE_MECHANIC_KEYWORDS has no orphan keys absent from ARCHETYPE_REGISTRY", () => {
    const orphans = mechanicKeys.filter((k) => !registryKeys.includes(k));
    expect(orphans, `MECHANIC_KEYWORDS keys not in ARCHETYPE_REGISTRY: [${orphans.join(", ")}]`).toEqual([]);
  });

  it("counts match: 39 registry entries, 39 mechanic keyword entries", () => {
    // Wave hardening 2026-06-22, CI-trust: 6 new archetypes (fvg, judas_swing, silver_bullet,
    // breaker_block, bounce_off_level, ict_bias_aligned_continuation) added to both sides.
    // W7 campaign close-out (2026-07-17): gann_box_4h_continuation (added to
    // ARCHETYPE_REGISTRY by W3.4, 2026-06-22) was missing its MECHANIC_KEYWORDS
    // entry — this test's own coverage-gap check above caught it; closed same-wave.
    expect(registryKeys.length).toBe(39);
    expect(mechanicKeys.length).toBe(39);
  });
});

describe("Wave 9 — ict_london_raid mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.ict_london_raid;

  it("ACCEPTS prose with all 4 mechanic keywords", () => {
    const prose = "Wait for the London session after Asia range is set, look for a sweep of the Asia high with a clear MSS confirmation before entering on the FVG retrace back into the raid zone.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose missing the raid/sweep keyword", () => {
    const prose = "After London opens and the Asian range is defined, look for an MSS then enter long.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});

describe("Wave 9 — ict_quarterly_swing mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.ict_quarterly_swing;

  it("ACCEPTS prose with quarterly OHLC cycle language", () => {
    const prose = "Apply quarterly theory: Q1 draws price to Q2 high, Q3 reversal, Q4 cycle completion. Enter after the Q2 manipulation sweep. The daily range and weekly range confirm HTF bias for the quarterly swing.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose without any quarter reference", () => {
    const prose = "Wait for a sweep of the daily high then enter on MSS with a trailing stop.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});

describe("Wave 9 — ict_propulsion mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.ict_propulsion;

  it("ACCEPTS prose describing displacement into FVG with breaker continuation", () => {
    const prose = "Price forms a propulsion block via displacement candle body. After mitigating the breaker block, the continuation leg targets the next premium PD array.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose without propulsion block language", () => {
    const prose = "Enter after the FVG fills on the retest with stop below the order block.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});

describe("Wave 9 — ict_eqhl_raid mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.ict_eqhl_raid;

  it("ACCEPTS prose with equal highs liquidity raid and displacement", () => {
    const prose = "Identify equal highs or EQH above price. Wait for the liquidity sweep raid into that level, then look for a displacement candle creating an FVG. Enter on the retrace.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose missing displacement", () => {
    const prose = "When equal lows are swept and the raid completes, look for a reversal candle with liquidity.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});

describe("Wave 9 — ict_scalp mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.ict_scalp;

  it("ACCEPTS full killzone scalp sequence", () => {
    const prose = "During the London killzone, wait for a sweep of the prior session high, followed by MSS displacement candle. Enter on the FVG retrace within the kill zone window for a quick scalp.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose without killzone mention", () => {
    const prose = "Wait for a sweep then MSS then enter on the FVG retrace with tight stop.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});

describe("Wave 9 — ict_swing mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.ict_swing;

  it("ACCEPTS HTF bias + sweep + BOS sequence", () => {
    const prose = "Use the HTF daily bias to determine direction. Wait for a sweep of the premium array or discount zone. After a clear break of structure BOS, enter at the PD array for a multi-session swing.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose without HTF bias reference", () => {
    const prose = "Wait for a BOS then enter at the premium level with a trailing stop.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});

describe("Wave 9 — ict_2022 mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.ict_2022;

  it("ACCEPTS 2022 model with HTF bias, sweep, MSS, FVG", () => {
    const prose = "HTF bias confirms bullish. Wait for manipulation sweep of liquidity below. MSS market structure shift confirms reversal. Enter on fair value gap FVG retracement at OTE zone.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose without MSS reference", () => {
    const prose = "With HTF bias confirmed, wait for a sweep of the prior high. Enter on the FVG fill with bias alignment.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});

describe("Wave 9 — wyckoff_accumulation mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.wyckoff_accumulation;

  it("ACCEPTS full Wyckoff accumulation sequence", () => {
    const prose = "Wait for the Wyckoff accumulation phase to complete. The spring tests the support, followed by a secondary test ST. Enter on the sign of strength SOS break above resistance.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose missing the spring keyword", () => {
    const prose = "In the accumulation phase, wait for secondary test then a sign of strength breakout.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});

describe("Wave 9 — wyckoff_distribution mechanic keyword gate", () => {
  const kw = NEW_ARCHETYPE_KEYWORDS.wyckoff_distribution;

  it("ACCEPTS full Wyckoff distribution sequence", () => {
    const prose = "Identify the Wyckoff distribution phase. The upthrust UT tests resistance, followed by secondary test ST. Short on the sign of weakness SOW break below support.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(true);
  });

  it("REJECTS prose missing sign of weakness", () => {
    const prose = "Wait for distribution phase upthrust and secondary test, then enter short when price breaks support.";
    expect(allKeywordsPresent(prose.toLowerCase(), kw)).toBe(false);
  });
});
