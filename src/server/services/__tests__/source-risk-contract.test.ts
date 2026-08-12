/**
 * SOURCE-RISK-HANDOFF-1 / UNIT A + UNIT E (onboarding half)
 *
 * Authority: AR-1059 (gpt-rulings 8e9ea5bc) §4 UNIT A and UNIT E.
 *
 * THE DEFECT
 * ----------
 * `spec-onboarding-service.ts:849` constructs `stop_loss: { type: "atr", multiplier: 1.5 }`
 * UNCONDITIONALLY, before the framework overlay ever runs. So even when the teacher
 * explicitly taught a stop, the artifact that reaches the persisted `compiled_spec`
 * carries a Trading Forge ATR stop instead. That is the boundary AR-1056 §2.4 and
 * AR-1057 §4 both identified as a total loss of source risk.
 *
 * THE CONTRACT
 * ------------
 * `SOURCE_FAITHFUL` + a taught stop  -> the taught anchor survives.
 * Anything else (the entire existing library) -> byte-identical legacy behaviour.
 *
 * AR-1059 §4 UNIT E: "Do not silently make all existing strategies source-risk-driven.
 * Preserve legacy behavior unless an explicit source-faithful contract is present."
 *
 * ⚠️ QUOTE AUTHORITY: the teacher's exact words are the RAW TRANSCRIPT sliced by
 * span.start/span.end. The model-authored `rationale` is diagnostic ONLY and may never
 * become the authority (AR-1059 §4.C, and AR-1055 measured the emitted INVALIDATE
 * carrying rationale with span={0,0}).
 */
import { describe, expect, it } from "vitest";

import {
  ANCHOR_TO_RESOLVER,
  resolveSpecStopLoss,
  type SourceRiskContract,
} from "../source-risk-contract";

interface SpecArtifactBody {
  direction: string;
  entry_conditions: unknown[];
  and_groups: string[][];
  or_branches: string[][];
  invalidations: unknown[];
  entry_trigger_id: string;
  source_risk?: SourceRiskContract;
}

function baseSpec(): SpecArtifactBody {
  return {
    direction: "long",
    entry_conditions: [],
    and_groups: [],
    or_branches: [],
    invalidations: [],
    entry_trigger_id: "t1",
  };
}

describe("UNIT E — legacy artifacts are untouched", () => {
  it("a spec with NO source_risk keeps the exact legacy ATR stop", () => {
    expect(resolveSpecStopLoss(baseSpec())).toEqual({ type: "atr", multiplier: 1.5 });
  });

  it("TF_OVERLAY_VARIANT keeps the legacy ATR stop even when a stop was taught", () => {
    const spec = baseSpec();
    spec.source_risk = {
      mode: "TF_OVERLAY_VARIANT",
      stop: { anchor: "fvg_low", include_wick: true, span: { start: 13860, end: 15745 } },
    };
    expect(resolveSpecStopLoss(spec)).toEqual({ type: "atr", multiplier: 1.5 });
  });

  it("SOURCE_FAITHFUL with NO taught stop falls back to the framework stop, provenance-stamped", () => {
    const spec = baseSpec();
    spec.source_risk = { mode: "SOURCE_FAITHFUL" };
    const sl = resolveSpecStopLoss(spec) as Record<string, unknown>;
    expect(sl.type).toBe("atr");
    expect(sl.multiplier).toBe(1.5);
    // AR-1059 §4.D: framework fallback only for truly untaught fields, PROVENANCE-STAMPED.
    expect(sl.ownership).toBe("framework_default_untaught");
  });
});

describe("UNIT A — a taught stop survives the onboarding boundary", () => {
  it("SOURCE_FAITHFUL + fvg_low + wick produces a source-owned structural stop", () => {
    const spec = baseSpec();
    spec.source_risk = {
      mode: "SOURCE_FAITHFUL",
      stop: { anchor: "fvg_low", include_wick: true, span: { start: 13860, end: 15745 } },
    };
    const sl = resolveSpecStopLoss(spec) as Record<string, unknown>;

    expect(sl.type).toBe("source_structural");
    expect(sl.anchor).toBe("fvg_low");
    expect(sl.required_anchor).toBe("fvg"); // what compute_structural_stop() commands
    expect(sl.include_wick).toBe(true);
    expect(sl.source_exact).toBe(true); // no unstated framework buffer
    expect(sl.ownership).toBe("source");
    expect(sl.span).toEqual({ start: 13860, end: 15745 });

    // The framework ATR stop must be GONE, not merely accompanied.
    expect(sl.multiplier).toBeUndefined();
    expect(sl.type).not.toBe("atr");
  });

  it("include_wick=false is carried verbatim, not defaulted to true", () => {
    const spec = baseSpec();
    spec.source_risk = {
      mode: "SOURCE_FAITHFUL",
      stop: { anchor: "fvg_low", include_wick: false, span: { start: 1, end: 2 } },
    };
    const sl = resolveSpecStopLoss(spec) as Record<string, unknown>;
    expect(sl.include_wick).toBe(false);
  });

  it("a short spec maps fvg_high to the same resolver anchor", () => {
    const spec = baseSpec();
    spec.direction = "short";
    spec.source_risk = {
      mode: "SOURCE_FAITHFUL",
      stop: { anchor: "fvg_high", include_wick: true, span: { start: 1, end: 2 } },
    };
    const sl = resolveSpecStopLoss(spec) as Record<string, unknown>;
    expect(sl.anchor).toBe("fvg_high");
    expect(sl.required_anchor).toBe("fvg");
  });

  it("REFUSES a source-faithful stop whose span is the {0,0} rationale sentinel", () => {
    // AR-1055 measured the emitted INVALIDATE carrying the LLM rationale at span {0,0}.
    // A zero span is not quote authority, and accepting it would let a model paraphrase
    // masquerade as the teacher's words.
    const spec = baseSpec();
    spec.source_risk = {
      mode: "SOURCE_FAITHFUL",
      stop: { anchor: "fvg_low", include_wick: true, span: { start: 0, end: 0 } },
    };
    expect(() => resolveSpecStopLoss(spec)).toThrow(/span/i);
  });

  it("REFUSES an anchor outside the extractor's declared vocabulary", () => {
    const spec = baseSpec();
    spec.source_risk = {
      mode: "SOURCE_FAITHFUL",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stop: { anchor: "invented_anchor" as any, include_wick: true, span: { start: 1, end: 2 } },
    };
    expect(() => resolveSpecStopLoss(spec)).toThrow(/anchor/i);
  });
});

describe("anchor vocabulary is REUSED, not minted", () => {
  it("maps every extractor anchor to a resolver anchor the Python side implements", () => {
    // The 12 values come from src/agents/kb/transcript-extractor-minimal-schema.json.
    // AR-1057 §5.1: reuse this vocabulary rather than mint a second one.
    expect(ANCHOR_TO_RESOLVER.fvg_low).toBe("fvg");
    expect(ANCHOR_TO_RESOLVER.fvg_high).toBe("fvg");
    expect(ANCHOR_TO_RESOLVER.ob_low).toBe("order_block");
    expect(ANCHOR_TO_RESOLVER.ob_high).toBe("order_block");
    expect(ANCHOR_TO_RESOLVER.sweep_wick_below_entry).toBe("sweep_wick");
    expect(ANCHOR_TO_RESOLVER.sweep_wick_above_entry).toBe("sweep_wick");
    expect(ANCHOR_TO_RESOLVER.swing_low_below_entry).toBe("swing_point");
    expect(ANCHOR_TO_RESOLVER.swing_high_above_entry).toBe("swing_point");
  });

  it("atr_multiple is NOT a structural anchor and must not map to one", () => {
    expect(ANCHOR_TO_RESOLVER.atr_multiple).toBeUndefined();
  });
});
