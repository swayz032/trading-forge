/**
 * SOURCE-RISK-HANDOFF-1 / STEP 2A — the source-risk canonical handoff.
 *
 * Authority: AR-1068 (gpt-rulings 06d63e2b) §4 and §10 NEXT UNIT 1.
 *
 * THE DEFECT AR-1068 §4 NAMED
 * ---------------------------
 * `ANCHOR_TO_RESOLVER` omitted `displacement_candle_*` and justified the omission with
 * "the Python resolver implements no candidate for them". That justification went STALE at
 * `64420de6`, when STEP 1 landed `"fvg_displacement"` in `structural_stops.py:267`. So the
 * one anchor the sVkm teacher actually taught was the one anchor the contract REFUSED,
 * while `fvg_low` — the GAP BOUNDARY, the wrong price per AR-1063 — resolved happily.
 *
 * THE REPAIR
 * ----------
 * Graduate the sVkm stop to its own declared anchor (`displacement_candle_low`) and map
 * THAT to `fvg_displacement`. Do NOT remap `fvg_low` (AR-1068 §4: "Do not globally remap"),
 * because `fvg_low` means the gap boundary for every other teacher and that meaning is correct.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It is NOT a certification of the money path. It proves the RISK CONTRACT hop only. Entry
 * causality — the opening-range lock, the close outside ORH/ORL, the matching-direction
 * post-breakout FVG, the exact qualifying zone identity — is AR-1068 §10 NEXT UNIT 2 and is
 * not touched here. AR-1068 §10: "A hand-built compute_structural_stop() test is not
 * certification."
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ANCHOR_TO_RESOLVER,
  resolveSpecStopLoss,
  type SourceRiskContract,
} from "../source-risk-contract";

/** Resolve from THIS FILE, never from cwd — the campaign has been bitten by cwd-sensitive
 *  suites before, and a suite that only passes from the repo root is a fragile instrument. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ARTIFACT_PATH = resolve(
  REPO_ROOT,
  "src/engine/extraction/fixtures/svkm_source_risk_canonical.json",
);

interface CanonicalArtifact {
  evidence: {
    transcript_path: string;
    transcript_sha256: string;
    transcript_bytes: number;
  };
  source_risk: SourceRiskContract;
  pinned_quotes: { stop: string; target: string };
  why_this_span_and_not_the_long_worked_example: {
    corroborating_span: { start: number; end: number };
  };
}

const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as CanonicalArtifact;
const transcriptBytes = readFileSync(resolve(REPO_ROOT, artifact.evidence.transcript_path));
const transcript = transcriptBytes.toString("utf8");

describe("STEP 2A — the Tier-A evidence is actually in this branch, and the span joins to it", () => {
  /** POSITIVE WITNESS FIRST. Every assertion below slices a string; a silently empty read
   *  would make several of them vacuous. Prove the instrument loaded something real. */
  it("loaded a non-empty transcript whose bytes hash to the artifact's pinned sha256", () => {
    expect(transcript.length).toBeGreaterThan(20_000);
    expect(transcriptBytes.byteLength).toBe(artifact.evidence.transcript_bytes);
    expect(createHash("sha256").update(transcriptBytes).digest("hex")).toBe(
      artifact.evidence.transcript_sha256,
    );
  });

  it("re-slices the pinned STOP span and gets the teacher's words back verbatim", () => {
    const { start, end } = artifact.source_risk.stop!.span;
    expect(transcript.slice(start, end)).toBe(artifact.pinned_quotes.stop);
  });

  it("re-slices the pinned TARGET span and gets the teacher's words back verbatim", () => {
    const { start, end } = artifact.source_risk.target!.span;
    expect(transcript.slice(start, end)).toBe(artifact.pinned_quotes.target);
  });

  /** The span is only authority if it is SPECIFIC. A span that also matches its neighbours
   *  would join to anything; this proves the pinned quote occurs exactly once. */
  it("the pinned stop quote occurs EXACTLY ONCE in the transcript, so the join key is unique", () => {
    const q = artifact.pinned_quotes.stop;
    expect(transcript.indexOf(q)).toBe(artifact.source_risk.stop!.span.start);
    expect(transcript.indexOf(q, artifact.source_risk.stop!.span.start + 1)).toBe(-1);
  });

  /** NEGATIVE CONTROL for the whole span mechanism: shifting the span must break the join.
   *  Without this, a slice test passes even if `slice` were returning the whole file. */
  it("a span shifted by one character NO LONGER matches — the join is exact, not approximate", () => {
    const { start, end } = artifact.source_risk.stop!.span;
    expect(transcript.slice(start + 1, end)).not.toBe(artifact.pinned_quotes.stop);
    expect(transcript.slice(start, end - 1)).not.toBe(artifact.pinned_quotes.stop);
  });

  it("the pinned quote names the CANDLE and the WICK — the two facts the anchor claims", () => {
    const q = artifact.pinned_quotes.stop;
    expect(q).toContain("fair value candle");
    expect(q).toContain("include the wick");
    expect(q).toContain("bottom of");
  });

  it("the corroborating LONG worked example resolves direction and confirms wick inclusion", () => {
    const { start, end } = artifact.why_this_span_and_not_the_long_worked_example
      .corroborating_span;
    const quote = transcript.slice(start, end);
    expect(quote).toContain("including the wick");
    expect(quote).toContain("low of the fair value gap");
  });
});

describe("STEP 2A — the canonical anchor reaches the resolver", () => {
  /** THE RED→GREEN. Before this unit, `displacement_candle_low` had no mapping and this
   *  call THREW "has no implemented structural resolver anchor". */
  it("the canonical sVkm artifact resolves to required_anchor=fvg_displacement", () => {
    const stop = resolveSpecStopLoss({ source_risk: artifact.source_risk });

    expect(stop).toMatchObject({
      type: "source_structural",
      anchor: "displacement_candle_low",
      required_anchor: "fvg_displacement",
      include_wick: true,
      source_exact: true,
      ownership: "source",
    });
    expect(stop.span).toEqual({ start: 13912, end: 14135 });
  });

  /** THE AR-1063 DEFECT, GUARDED. The artifact used to say `fvg_low`, which resolves to the
   *  GAP BOUNDARY — a different price from the one taught. It must never come back. */
  it("the canonical artifact does NOT carry fvg_low, and does not resolve to the gap anchor", () => {
    const stop = resolveSpecStopLoss({ source_risk: artifact.source_risk });
    expect(artifact.source_risk.stop!.anchor).not.toBe("fvg_low");
    expect(stop.required_anchor).not.toBe("fvg");
  });

  it("maps displacement_candle_low to the displacement resolver, not the gap resolver", () => {
    expect(ANCHOR_TO_RESOLVER.displacement_candle_low).toBe("fvg_displacement");
  });
});

describe("STEP 2A — the narrowings AR-1068 required are structural, not conventions", () => {
  /** AR-1068 §4: "Do not globally remap fvg_low -> fvg_displacement." Generic gap-boundary
   *  semantics belong to every other teacher and must be untouched by the sVkm repair. */
  it("fvg_low / fvg_high still mean the GAP BOUNDARY for every other source", () => {
    expect(ANCHOR_TO_RESOLVER.fvg_low).toBe("fvg");
    expect(ANCHOR_TO_RESOLVER.fvg_high).toBe("fvg");
  });

  it("a spec still teaching fvg_low resolves to the gap anchor, unchanged by this unit", () => {
    const legacyGapTeacher: SourceRiskContract = {
      mode: "SOURCE_FAITHFUL",
      stop: { anchor: "fvg_low", include_wick: false, span: { start: 10, end: 40 } },
    };
    expect(resolveSpecStopLoss({ source_risk: legacyGapTeacher })).toMatchObject({
      anchor: "fvg_low",
      required_anchor: "fvg",
    });
  });

  /** AR-1068 §3.2 + §12: the short side is TEXT_AMBIGUOUS_VISUAL_UNCHECKED and stays
   *  FAIL-CLOSED. Leaving `displacement_candle_high` unmapped makes the refusal structural.
   *  ⚠️ This is a deliberate, declared narrowing of §4's "displacement_candle_low/high ->
   *  fvg_displacement"; see the comment in source-risk-contract.ts. It is a one-line open
   *  once the bounded visual question resolves the short side with source evidence. */
  it("displacement_candle_high REFUSES — short stays fail-closed until source authority resolves it", () => {
    expect(ANCHOR_TO_RESOLVER.displacement_candle_high).toBeUndefined();

    const shortByInference: SourceRiskContract = {
      mode: "SOURCE_FAITHFUL",
      stop: {
        anchor: "displacement_candle_high",
        include_wick: true,
        span: { start: 13912, end: 14135 },
      },
    };
    expect(() => resolveSpecStopLoss({ source_risk: shortByInference })).toThrow(
      /no implemented structural resolver/i,
    );
  });

  /** The refusal above must be caused by the ABSENT MAPPING, not by a hard-coded ban on the
   *  word "short" or on any high-side anchor. A guard nobody can characterise is not a guard. */
  it("the short refusal is the missing mapping, not a blanket ban on high-side anchors", () => {
    const highSideThatIsMapped: SourceRiskContract = {
      mode: "SOURCE_FAITHFUL",
      stop: { anchor: "fvg_high", include_wick: true, span: { start: 10, end: 40 } },
    };
    expect(resolveSpecStopLoss({ source_risk: highSideThatIsMapped })).toMatchObject({
      anchor: "fvg_high",
      required_anchor: "fvg",
    });
  });

  it("atr_multiple is still not a structural anchor", () => {
    expect(ANCHOR_TO_RESOLVER.atr_multiple).toBeUndefined();
  });
});

describe("STEP 2A — quote authority is still enforced on the canonical path", () => {
  /** The `span={0,0}` LLM-rationale sentinel must not ride in on the new anchor. */
  it("the new anchor does NOT bypass the zero-span refusal", () => {
    const rationaleSentinel: SourceRiskContract = {
      mode: "SOURCE_FAITHFUL",
      stop: {
        anchor: "displacement_candle_low",
        include_wick: true,
        span: { start: 0, end: 0, rationale: "stop below the displacement candle" },
      },
    };
    expect(() => resolveSpecStopLoss({ source_risk: rationaleSentinel })).toThrow(
      /not quote authority/i,
    );
  });

  it("legacy specs with no source_risk still get the framework ATR stop, byte-identical", () => {
    expect(resolveSpecStopLoss({})).toEqual({ type: "atr", multiplier: 1.5 });
  });
});
