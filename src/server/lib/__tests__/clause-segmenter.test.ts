/** Clause segmenter: permanent ids, exact offsets, deterministic. */
import { describe, it, expect } from "vitest";
import { segmentTranscript, clausesReconstruct } from "../clause-segmenter.js";

const T = "We only trade the london session. Then we wait for a liquidity sweep of the asian high. " +
  "Once price retests the order block, look for a bullish engulfing. Then we enter long. This is called the judas swing.";

describe("clause segmenter", () => {
  it("produces permanent ids + exact offsets that reconstruct the transcript", () => {
    const c = segmentTranscript(T, "T-demo");
    expect(c.length).toBeGreaterThan(3);
    expect(c[0].id).toBe("T-demo-C0000");
    expect(clausesReconstruct(T, c)).toBe(true);              // every clause's offsets are exact
    expect(T.slice(c[1].start, c[1].end)).toBe(c[1].text);
  });

  it("is deterministic (same input -> identical ids, offsets, text)", () => {
    expect(segmentTranscript(T, "T-demo")).toEqual(segmentTranscript(T, "T-demo"));
  });

  it("splits on discourse markers, not just punctuation (ASR has little punctuation)", () => {
    const asr = "we wait for london open then we wait for a sweep then once it retests we enter on the engulfing";
    const c = segmentTranscript(asr, "T-asr");
    expect(c.length).toBeGreaterThan(2);             // segmented despite zero terminators
    expect(clausesReconstruct(asr, c)).toBe(true);
  });

  it("merges trivially short fragments forward (no 1-word clauses)", () => {
    const c = segmentTranscript(T, "T-demo");
    expect(c.every((x) => x.text.trim().length >= 8)).toBe(true);
  });
});
