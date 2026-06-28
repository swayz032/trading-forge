/**
 * Verdict harness — the falsification instrument. Zero-dependency; consumes real trades, renders the
 * grounded/inference + modality + cross-regime closure verdict. Proven offline with synthetic trades.
 */
import { describe, it, expect } from "vitest";
import { runVerdict, renderVerdict, type VerdictTrade } from "../verdict-harness.js";

const mk = (modality_class: VerdictTrade["modality_class"], pnl: number, extra: Partial<VerdictTrade> = {}): VerdictTrade =>
  ({ strategy_id: "s", pnl, modality_class, grounding_class: modality_class === "FULLY_GROUNDED" ? "FULLY_GROUNDED" : "INFERENCE_DEPENDENT", ...extra });
const rep = (f: (n: number) => VerdictTrade, vals: number[]) => vals.map(f);

describe("runVerdict — pooled grounded/inference + modality", () => {
  it("★ grounded edge real → GROUNDED_SIGNAL", () => {
    const trades = [...rep((p) => mk("FULLY_GROUNDED", p), [2, 1.5, 2, 1, 2]), ...rep((p) => mk("PERCEPTUAL", p), [-1, -1, -1, -1, -1])];
    const r = runVerdict(trades);
    expect(r.modality.verdict).toBe("GROUNDED_SIGNAL");
    expect(r.grounded_vs_inference.verdict).toBe("GROUNDED_EDGE");
  });

  it("★ inferred perceptual carries the alpha → PERCEPTUAL_SIGNAL_REAL (inference faithful, not noise)", () => {
    const trades = [...rep((p) => mk("FULLY_GROUNDED", p), [-1, -1, 0.5, -1, -0.5]), ...rep((p) => mk("PERCEPTUAL", p), [2, 1.5, 2, 1, 2]), ...rep((p) => mk("STRUCTURAL", p), [-1, -2, -1, -1, -2])];
    expect(runVerdict(trades).modality.verdict).toBe("PERCEPTUAL_SIGNAL_REAL");
  });
});

describe("runVerdict — closure across regimes (structural law vs corpus-conditional)", () => {
  it("★ same signal layer across strata → STRUCTURAL_LAW", () => {
    const trades = [
      ...rep((p) => mk("PERCEPTUAL", p, { regime: "trending" }), [2, 1.5, 2, 1, 2]), ...rep((p) => mk("STRUCTURAL", p, { regime: "trending" }), [-1, -1, -1, -1, -1]),
      ...rep((p) => mk("PERCEPTUAL", p, { regime: "ranging" }), [2, 1, 2, 1.5, 2]), ...rep((p) => mk("STRUCTURAL", p, { regime: "ranging" }), [-1, -2, -1, -1, -1]),
    ];
    const r = runVerdict(trades, { stratifyBy: "regime" });
    expect(r.closure.kind).toBe("STRUCTURAL_LAW");
    expect(r.closure.dominant_layer).toBe("perceptual"); // perceptual carries signal in BOTH regimes
  });

  it("★ signal layer VARIES across strata → CORPUS_CONDITIONAL (not universal)", () => {
    const trades = [
      ...rep((p) => mk("PERCEPTUAL", p, { regime: "trending" }), [2, 1.5, 2, 1, 2]), ...rep((p) => mk("STRUCTURAL", p, { regime: "trending" }), [-1, -1, -1, -1, -1]),
      ...rep((p) => mk("PERCEPTUAL", p, { regime: "ranging" }), [-1, -1, -1, -1, -1]), ...rep((p) => mk("STRUCTURAL", p, { regime: "ranging" }), [2, 1.5, 2, 1, 2]),
    ];
    const r = runVerdict(trades, { stratifyBy: "regime" });
    expect(r.closure.kind).toBe("CORPUS_CONDITIONAL");        // perceptual wins trending, structural wins ranging
    expect(r.closure.dominant_layer).toBeNull();
  });

  it("no stratification → closure INSUFFICIENT_DATA (closure REQUIRES unseen-regime strata)", () => {
    expect(runVerdict([mk("PERCEPTUAL", 1)]).closure.kind).toBe("INSUFFICIENT_DATA");
  });

  it("renderVerdict produces a readable report", () => {
    const md = renderVerdict(runVerdict([...rep((p) => mk("FULLY_GROUNDED", p), [2, 2, 2, 2, 2])], { stratifyBy: "regime" }));
    expect(md).toMatch(/# Verdict/);
    expect(md).toMatch(/Closure/);
  });
});
