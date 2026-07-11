/**
 * SEMANTIC IDEMPOTENCE proof (v1.1): two extraction runs that capture the SAME decisions must canonicalize to
 * the IDENTICAL graph — even with different verbatim phrasing, different spans, different discovery order, and
 * restatements. This is the reproducibility invariant that makes a non-deterministic LLM yield a deterministic
 * compiler. A dropped decision MUST break idempotence (the guard works).
 */
import { describe, it, expect } from "vitest";
import { SPAN } from "../state-machine-ir.js";
import { atomId, type AtomType, type DecisionAtom } from "../decision-atom.js";
import { canonicalHash, checkIdempotence } from "../decision-graph-canonical.js";

const a = (type: AtomType, objCanon: string, verbatim: string, span: [number, number], deps: string[] = []): DecisionAtom => ({
  id: atomId(type, objCanon), type, temporal_kind: "event", object: verbatim, object_canonical: objCanon,
  depends_on: deps, provenance: SPAN(verbatim, span[0], span[1]),
});
const ID = (t: AtomType, o: string) => atomId(t, o);

// RUN A — clean, in teaching order, verbatim phrasing #1
const runA = { atoms: [
  a("WAIT_SESSION", "london", "the london session", [0, 30]),
  a("WAIT_STRUCTURE", "sweep", "a liquidity sweep of the asian high", [31, 70]),
  a("WAIT_RETEST", "retest", "the retest of the order block", [71, 100], [ID("WAIT_STRUCTURE", "sweep")]),
  a("WAIT_CONFIRMATION", "engulfing", "a bullish engulfing", [101, 130], [ID("WAIT_RETEST", "retest")]),
  a("ENTER", "entry", "enter long", [131, 150], [ID("WAIT_CONFIRMATION", "engulfing"), ID("WAIT_SESSION", "london")]),
] };

// RUN B — SAME decisions: different verbatim ("stop run" synonym, "engulfing candle"), different spans,
// SHUFFLED discovery order, and a RESTATEMENT (the speaker repeats the sweep -> duplicate atom).
const runB = { atoms: [
  a("ENTER", "entry", "we go long here", [400, 420], [ID("WAIT_CONFIRMATION", "engulfing"), ID("WAIT_SESSION", "london")]),
  a("WAIT_CONFIRMATION", "engulfing", "an engulfing candle", [300, 340], [ID("WAIT_RETEST", "retest")]),
  a("WAIT_STRUCTURE", "sweep", "a stop run above the asian highs", [120, 180]),       // synonym, diff span
  a("WAIT_RETEST", "retest", "price pulls back", [200, 240], [ID("WAIT_STRUCTURE", "sweep")]),
  a("WAIT_SESSION", "london", "during london", [0, 40]),
  a("WAIT_STRUCTURE", "sweep", "it sweeps liquidity again", [500, 540]),               // RESTATEMENT (duplicate)
] };

describe("semantic idempotence", () => {
  it("★ same decisions, different text/spans/order/restatements -> IDENTICAL canonical hash", () => {
    expect(canonicalHash(runA)).toBe(canonicalHash(runB));
    expect(checkIdempotence([runA, runB]).idempotent).toBe(true);
  });

  it("canonicalization absorbs a restatement (duplicate atom collapses to one)", () => {
    const withDup = { atoms: [...runA.atoms, a("WAIT_STRUCTURE", "sweep", "again the sweep", [900, 920])] };
    expect(canonicalHash(withDup)).toBe(canonicalHash(runA));
  });

  it("★ a DROPPED decision breaks idempotence (the guard catches the real loss)", () => {
    const dropRetest = { atoms: runA.atoms.filter((x) => x.type !== "WAIT_RETEST") };
    const r = checkIdempotence([runA, dropRetest]);
    expect(r.idempotent).toBe(false);
    expect(r.distinct).toBe(2);
    expect(r.drift).toBeDefined();
  });

  it("a HALLUCINATED extra decision also breaks idempotence", () => {
    const extra = { atoms: [...runA.atoms, a("WAIT_CONFIRMATION", "rsi_divergence", "rsi divergence", [800, 830])] };
    expect(checkIdempotence([runA, extra]).idempotent).toBe(false);
  });
});
