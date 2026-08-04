/**
 * R-690 §5 Lane 19 — the leaf's own guard and its refusal fixtures.
 *
 * Two jobs:
 *   1. THE IMPORT-CLOSURE GUARD. R-690 §3 measured that this repository holds three
 *      stated-but-unenforced architectural rules and has violated all three, and put
 *      the guard at step 1 of the migration for that reason. The contract module is
 *      only a usable boundary while it imports nothing — the moment it takes an edge,
 *      the graduator (which sits in a real cycle through index.ts, AR-764 §1) can no
 *      longer import it, and the whole shape fails silently.
 *   2. THE PROHIBITED-SUBSTITUTION FIXTURES. One per substitution AR-752/AR-753
 *      measured in the shipped path: midpoint, engine default, compiler fallback,
 *      silent clamp, missing, conflicting, unknown key, provenance absent.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isOutsideAdvisoryRange,
  resolveExecutableParameters,
  type ParameterSpec,
  type SourceParameter,
} from "./executable-parameter-contract.js";

const CONTRACT_PATH = path.join(__dirname, "executable-parameter-contract.ts");

/** Any module-level edge: static import, dynamic import(), or require(). */
const ANY_IMPORT = /(^[ \t]*import\s[^;]*?from\s*['"])|(^[ \t]*import\s*['"])|(\bimport\s*\()|(\brequire\s*\()/gm;

function importEdgesIn(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return src.match(ANY_IMPORT) ?? [];
}

describe("import-closure guard — the leaf must stay a leaf", () => {
  it("the contract module has ZERO import edges of any kind", () => {
    const edges = importEdgesIn(CONTRACT_PATH);
    expect(
      edges,
      `executable-parameter-contract.ts took ${edges.length} import edge(s): ${JSON.stringify(edges)}. ` +
        "It must import nothing — the direct-bucket graduator sits in a static cycle through " +
        "index.ts (AR-764 §1) and can only reach a boundary that has no closure of its own.",
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: the same matcher finds edges in a module that has them", () => {
    // Without this, a broken regex would report ZERO for every file and the guard
    // above would pass forever while the leaf quietly grew a dependency.
    const edges = importEdgesIn(path.join(__dirname, "dsl-sanitizer.ts"));
    expect(edges.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prohibited substitutions. Each asserts a REFUSAL where the shipped path invents.
// ─────────────────────────────────────────────────────────────────────────────

const SMA: ParameterSpec = { required: ["fast_period", "slow_period"] };
const taught = (key: string, value: number): SourceParameter => ({
  key,
  value,
  provenance: "exact_source",
  evidence: "the lesson said so",
});

describe("prohibited substitutions — the contract refuses instead of inventing", () => {
  it("1. MIDPOINT: a missing required key blocks; it never becomes a range midpoint", () => {
    const r = resolveExecutableParameters(SMA, [taught("fast_period", 20)], "source_fidelity");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("missing_source_parameter");
    expect(r.key).toBe("slow_period");
    // dsl-sanitizer.ts:121-125 would have filled this with (20+200)/2 = 110.
    expect(JSON.stringify(r)).not.toContain("110");
  });

  it("2. ENGINE DEFAULT: a missing key never becomes the graduator's {50,200} table value", () => {
    const r = resolveExecutableParameters(SMA, [taught("slow_period", 200)], "source_fidelity");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("missing_source_parameter");
    expect(r.key).toBe("fast_period");
  });

  it("3. COMPILER FALLBACK: an empty supply blocks; it never becomes num(p.fast_period, 9)", () => {
    const r = resolveExecutableParameters(SMA, [], "source_fidelity");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("missing_source_parameter");
    expect(JSON.stringify(r)).not.toContain("9");
  });

  it("4. SILENT CLAMP: an out-of-range taught value survives UNCHANGED and is only reported", () => {
    const r = resolveExecutableParameters(SMA, [taught("fast_period", 2), taught("slow_period", 400)], "source_fidelity");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // the taught numbers, byte-for-byte — no clamp to [5,50] / [20,200]
    expect(r.parameters).toEqual({ fast_period: 2, slow_period: 400 });
    expect(isOutsideAdvisoryRange(2, [5, 50])).toBe(true);
    expect(isOutsideAdvisoryRange(400, [20, 200])).toBe(true);
    // POSITIVE CONTROL: the reporter is not simply always-true
    expect(isOutsideAdvisoryRange(20, [5, 50])).toBe(false);
  });

  it("5. MISSING: both keys absent blocks on a named key", () => {
    const r = resolveExecutableParameters({ required: ["period"] }, [], "source_fidelity");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("missing_source_parameter");
    expect(r.key).toBe("period");
  });

  it("6. CONFLICTING: two source values at the same tier block rather than one winning", () => {
    const r = resolveExecutableParameters(SMA, [
      taught("fast_period", 20),
      taught("fast_period", 50),
      taught("slow_period", 200),
    ], "source_fidelity");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("conflicting_source_parameters");
    expect(r.key).toBe("fast_period");
  });

  it("7. UNKNOWN KEY: a key outside the spec blocks instead of being dropped silently", () => {
    const r = resolveExecutableParameters(SMA, [
      taught("fast_period", 20),
      taught("slow_period", 200),
      taught("fast", 20),
    ], "source_fidelity");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("unknown_parameter_key");
    expect(r.key).toBe("fast");
  });

  it("8. PROVENANCE ABSENT: a value with provenance 'none' is not a source value", () => {
    const r = resolveExecutableParameters(SMA, [
      taught("fast_period", 20),
      { key: "slow_period", value: 200, provenance: "none" },
    ], "source_fidelity");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("missing_source_parameter");
    expect(r.key).toBe("slow_period");
  });
});

describe("positive controls — the contract is not simply always-refusing", () => {
  it("a fully taught set resolves, and the values are the taught ones", () => {
    const r = resolveExecutableParameters(SMA, [taught("fast_period", 20), taught("slow_period", 200)], "source_fidelity");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parameters).toEqual({ fast_period: 20, slow_period: 200 });
  });

  it("an INFERRED value never overwrites an explicit source value, and is not a conflict", () => {
    const r = resolveExecutableParameters(SMA, [
      taught("fast_period", 20),
      { key: "fast_period", value: 9, provenance: "inferred" },
      taught("slow_period", 200),
    ], "source_fidelity");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parameters.fast_period).toBe(20);
  });

  it("an inferred value is accepted when nothing stronger exists — IN RESEARCH MODE ONLY", () => {
    // CORRECTED AT R-691 §3, AND THE CORRECTION IS THE POINT OF THE MODES. This test
    // shipped at AR-766 asserting acceptance with no mode at all. That is right for a
    // research candidate and WRONG for a fidelity certificate, and the contract could
    // not tell the two apart. It now can, so this control moved to the mode it was
    // always describing rather than being deleted.
    const r = resolveExecutableParameters({ required: ["period"] }, [
      { key: "period", value: 14, provenance: "inferred" },
    ], "research_candidate");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parameters).toEqual({ period: 14 });
    expect(r.eligibleForFidelityCertification).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════
// R-691 §5(2)+(3) — the typed upstream status, and the two modes
// ══════════════════════════════════════════════════════════════════════════════════════

/** A value the upstream declared with an explicit status. */
function declared(
  key: string,
  value: number,
  status: "exact" | "ambiguous" | "missing" | "inferred" | "generated",
  provenance: SourceParameter["provenance"] = "exact_source",
): SourceParameter {
  return { key, value, provenance, status };
}

describe("upstream status — `unresolved_source_ambiguity` finally has a path", () => {
  it("AMBIGUOUS refuses with the ambiguity code, in BOTH modes", () => {
    // AR-766 §4 flagged this code as declared-with-no-path and refused to fake a
    // fixture for it. This is that fixture, and it exists because R-691 §3 put the
    // ambiguity UPSTREAM instead of asking the leaf to parse a transcript.
    for (const mode of ["source_fidelity", "research_candidate"] as const) {
      const r = resolveExecutableParameters(
        { required: ["fast_period", "slow_period"] },
        [declared("fast_period", 20, "ambiguous"), taught("slow_period", 200)],
        mode,
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.block).toBe("unresolved_source_ambiguity");
      expect(r.key).toBe("fast_period");
      expect(r.mode).toBe(mode);
    }
  });

  it("MISSING status refuses as missing, and not as something softer", () => {
    const r = resolveExecutableParameters(
      { required: ["period"] },
      [declared("period", 0, "missing")],
      "source_fidelity",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("missing_source_parameter");
  });

  it("EXACT resolves under the strict mode and is certification-eligible", () => {
    const r = resolveExecutableParameters(
      SMA,
      [declared("fast_period", 20, "exact"), declared("slow_period", 200, "exact")],
      "source_fidelity",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parameters).toEqual({ fast_period: 20, slow_period: 200 });
    expect(r.eligibleForFidelityCertification).toBe(true);
  });

  it("INFERRED refuses in source_fidelity with the NEW code, naming the key", () => {
    const r = resolveExecutableParameters(
      SMA,
      [declared("fast_period", 20, "exact"), declared("slow_period", 200, "inferred", "inferred")],
      "source_fidelity",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("source_parameter_not_exact");
    expect(r.key).toBe("slow_period");
  });

  it("GENERATED — an optimizer value — refuses in source_fidelity", () => {
    const r = resolveExecutableParameters(
      SMA,
      [declared("fast_period", 20, "exact"), declared("slow_period", 200, "generated", "inferred")],
      "source_fidelity",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.block).toBe("source_parameter_not_exact");
  });

  it("the SAME inferred value resolves in research_candidate — mode is the only difference", () => {
    // The discriminator for the two tests above: they must fail because of the MODE,
    // not because the input was malformed. Identical input, opposite outcome.
    const supplied = [
      declared("fast_period", 20, "exact"),
      declared("slow_period", 200, "inferred", "inferred"),
    ];
    const strict = resolveExecutableParameters(SMA, supplied, "source_fidelity");
    const research = resolveExecutableParameters(SMA, supplied, "research_candidate");
    expect(strict.ok).toBe(false);
    expect(research.ok).toBe(true);
    if (!research.ok) return;
    expect(research.parameters).toEqual({ fast_period: 20, slow_period: 200 });
  });
});

describe("the same value may not silently change provenance between modes (R-691 §5(3))", () => {
  it("a value that resolves only in research mode still REPORTS itself as inferred", () => {
    // The failure this forbids: a permissive mode that launders a guess into something
    // that reads as taught. The value is allowed through; the label is not upgraded.
    const supplied = [
      declared("fast_period", 20, "exact"),
      declared("slow_period", 200, "inferred", "inferred"),
    ];
    const research = resolveExecutableParameters(SMA, supplied, "research_candidate");
    expect(research.ok).toBe(true);
    if (!research.ok) return;
    expect(research.provenanceByKey.slow_period).toBe("inferred");
    expect(research.provenanceByKey.fast_period).toBe("exact_source");
    expect(research.eligibleForFidelityCertification).toBe(false);
  });

  it("an identical taught set reports identical provenance in BOTH modes", () => {
    // POSITIVE CONTROL for the test above: without it, "provenance never changes"
    // is also satisfied by a field that is always the same constant.
    const supplied = [declared("fast_period", 20, "exact"), declared("slow_period", 200, "exact")];
    const strict = resolveExecutableParameters(SMA, supplied, "source_fidelity");
    const research = resolveExecutableParameters(SMA, supplied, "research_candidate");
    expect(strict.ok && research.ok).toBe(true);
    if (!strict.ok || !research.ok) return;
    expect(strict.provenanceByKey).toEqual(research.provenanceByKey);
    // ...and the ONE thing that must still differ is the certification verdict.
    expect(strict.eligibleForFidelityCertification).toBe(true);
    expect(research.eligibleForFidelityCertification).toBe(false);
  });

  it("an out-of-policy taught value is returned UNCHANGED even as it is refused elsewhere", () => {
    // R-691 §5(1): "an out-of-policy source value is returned UNCHANGED and refused for
    // persistence." The refusal is the caller's; the non-editing is this module's.
    const r = resolveExecutableParameters(
      SMA,
      [declared("fast_period", 2, "exact"), declared("slow_period", 400, "exact")],
      "source_fidelity",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parameters).toEqual({ fast_period: 2, slow_period: 400 });
    expect(isOutsideAdvisoryRange(2, [5, 50])).toBe(true);
    expect(isOutsideAdvisoryRange(400, [20, 200])).toBe(true);
  });
});
