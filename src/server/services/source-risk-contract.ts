/**
 * SOURCE-RISK-HANDOFF-1 / UNIT A — the source-risk contract.
 *
 * Authority: AR-1059 (gpt-rulings 8e9ea5bc) §4 UNIT A / UNIT E.
 *
 * WHY THIS IS ITS OWN MODULE (and not part of spec-onboarding-service.ts):
 * spec-onboarding-service.ts opens a DB connection at import time, so anything that
 * imports it inherits a `DATABASE_URL` requirement. The source-risk contract is pure
 * data + a pure resolver; it must be importable by the compiler, the overlay, and by
 * tests without standing up a database. spec-onboarding-service re-exports from here
 * so existing call sites keep one import surface.
 *
 * WHAT THIS FIXES
 * ---------------
 * `spec-onboarding-service.ts` constructed `stop_loss: { type: "atr", multiplier: 1.5 }`
 * unconditionally, before the framework overlay ran — so a teacher-taught stop was
 * already gone by the time anything downstream could honour it (AR-1056 §2.4).
 *
 * THE OWNERSHIP RULE (AR-1059 §3, superseding the historical overlay policy):
 *   - compiler fidelity preserves ALL source-owned executable logic, stop/target included;
 *   - framework defaults apply ONLY to genuinely untaught risk fields, provenance-stamped;
 *   - Trading Forge's institutional risk stays available as a separately labelled
 *     TF_OVERLAY_VARIANT — never as a silent replacement inside SOURCE_FAITHFUL.
 */

/** Which system owns risk/exit semantics for this artifact. */
export type RiskOwnershipMode = "SOURCE_FAITHFUL" | "TF_OVERLAY_VARIANT";

/**
 * The teacher's declared stop anchor vocabulary.
 *
 * ★ REUSED, NOT MINTED. These are exactly the `stop.anchor` enum values already
 * declared in `src/agents/kb/transcript-extractor-minimal-schema.json`. AR-1057 §5.1:
 * reuse the extractor's vocabulary rather than invent a second one that would then
 * need a mapping nobody maintains.
 */
export type SourceStopAnchor =
  | "sweep_wick_below_entry"
  | "sweep_wick_above_entry"
  | "ob_low"
  | "ob_high"
  | "fvg_low"
  | "fvg_high"
  | "swing_low_below_entry"
  | "swing_high_above_entry"
  | "displacement_candle_low"
  | "displacement_candle_high"
  | "swing_after_sfp"
  | "atr_multiple";

/**
 * Extractor anchor -> the `required_anchor` value `compute_structural_stop()` commands.
 *
 * `atr_multiple` is DELIBERATELY ABSENT: it is not a structural anchor, and mapping it
 * to one would let a non-structural teaching command a structural stop.
 * `displacement_candle_*` and `swing_after_sfp` are also absent — the Python resolver
 * implements no candidate for them, and inventing a mapping would silently bind the
 * teacher's stop to a DIFFERENT structure than the one taught.
 */
export const ANCHOR_TO_RESOLVER: Readonly<Partial<Record<SourceStopAnchor, string>>> =
  Object.freeze({
    fvg_low: "fvg",
    fvg_high: "fvg",
    ob_low: "order_block",
    ob_high: "order_block",
    sweep_wick_below_entry: "sweep_wick",
    sweep_wick_above_entry: "sweep_wick",
    swing_low_below_entry: "swing_point",
    swing_high_above_entry: "swing_point",
  });

/**
 * A span into the RAW TRANSCRIPT — the only quote authority.
 *
 * ⚠️ The teacher's exact words are `transcript_text[span.start:span.end]`. The
 * `rationale` field is a model-authored diagnostic echo and may NEVER become the
 * authority (AR-1059 §4.C). AR-1055 measured the emitted INVALIDATE carrying exactly
 * that rationale at `span={0,0}` — which is why a zero span is refused below.
 */
export interface SourceSpan {
  start: number;
  end: number;
  /** Diagnostic only. Never authority. */
  rationale?: string;
}

export interface SourceStopContract {
  anchor: SourceStopAnchor;
  /** Taught verbatim — "if this candle had a big wick, then you would also include the wick." */
  include_wick: boolean;
  span: SourceSpan;
}

export interface SourceTargetContract {
  /** Whole-position fixed R. NOT the Style-C 1R/2.5R/runner ladder (AR-1059 §4 UNIT D). */
  type: "FIXED_R";
  r_multiple: number;
  span: SourceSpan;
}

export interface SourceRiskContract {
  mode: RiskOwnershipMode;
  stop?: SourceStopContract;
  target?: SourceTargetContract;
}

/** The framework stop this system has always used when nothing was taught. */
const FRAMEWORK_ATR_STOP = Object.freeze({ type: "atr", multiplier: 1.5 });

/** Minimal structural shape — deliberately not the full SpecArtifactBody, so this
 *  module stays free of the onboarding service's DB-bearing import graph. */
export interface HasSourceRisk {
  source_risk?: SourceRiskContract;
}

function assertQuoteAuthority(span: SourceSpan, field: string): void {
  if (
    typeof span?.start !== "number" ||
    typeof span?.end !== "number" ||
    span.end <= span.start
  ) {
    throw new Error(
      `source_risk.${field}: span {${span?.start},${span?.end}} is not quote authority. ` +
        "A zero/'inverted' span is the LLM-rationale sentinel, not the teacher's words; " +
        "the authority is transcript_text[span.start:span.end]. Refusing.",
    );
  }
}

/**
 * Decide the `strategy.stop_loss` for a spec at the onboarding boundary.
 *
 * LEGACY IS THE DEFAULT AND IS BYTE-IDENTICAL: any spec without an explicit
 * `SOURCE_FAITHFUL` contract — i.e. the entire existing strategy library — gets exactly
 * `{ type: "atr", multiplier: 1.5 }`, unchanged. AR-1059 §4 UNIT E: "Do not silently
 * make all existing strategies source-risk-driven."
 */
export function resolveSpecStopLoss(spec: HasSourceRisk): Record<string, unknown> {
  const sr = spec?.source_risk;

  if (!sr || sr.mode !== "SOURCE_FAITHFUL") {
    // Legacy + TF_OVERLAY_VARIANT: the framework owns risk, exactly as before.
    return { ...FRAMEWORK_ATR_STOP };
  }

  if (!sr.stop) {
    // Source-faithful, but this teacher taught no stop. Framework fallback is correct
    // here — but it must be STAMPED, so nobody later reads it as a taught value.
    return { ...FRAMEWORK_ATR_STOP, ownership: "framework_default_untaught" };
  }

  const { anchor, include_wick, span } = sr.stop;
  const required = ANCHOR_TO_RESOLVER[anchor];
  if (!required) {
    throw new Error(
      `source_risk.stop.anchor=${String(anchor)} has no implemented structural resolver ` +
        `anchor. Known: ${Object.keys(ANCHOR_TO_RESOLVER).join(", ")}. Refusing rather than ` +
        "binding the taught stop to a different structure.",
    );
  }
  assertQuoteAuthority(span, "stop.span");

  return {
    type: "source_structural",
    anchor,
    required_anchor: required,
    include_wick,
    // No unstated framework buffer — the teacher taught the extreme, not extreme±3 ticks.
    source_exact: true,
    ownership: "source",
    span: { start: span.start, end: span.end },
  };
}
