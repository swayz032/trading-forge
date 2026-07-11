/**
 * v1.1 conservation-ledger proofs: the three ledgers ISOLATE failures by stage, and the adversarial half
 * catches hallucination. Demonstrates the localization payoff (A/B/C tell you WHICH stage broke).
 */
import { describe, it, expect } from "vitest";
import { SPAN } from "../state-machine-ir.js";
import { atomId, type AtomType, type DecisionAtom, type DecisionGraph, type TemporalKind } from "../decision-atom.js";
import {
  ledgerA, ledgerAOrThrow, ledgerB, ledgerBOrThrow, ledgerC, ledgerCOrThrow,
  structuralHallucinations, type Clause,
} from "../conservation-ledgers.js";

const atom = (type: AtomType, obj: string, span: [number, number], deps: string[] = [], tk: TemporalKind = "event"): DecisionAtom => ({
  id: atomId(type, obj), type, temporal_kind: tk, object: obj, object_canonical: obj, depends_on: deps,
  provenance: SPAN(obj, span[0], span[1]),
});

// canonical correct decision: london -> sweep -> retest -> engulfing -> ENTER
const A_SESSION = atom("WAIT_SESSION", "london", [0, 33], [], "condition");
const A_SWEEP = atom("WAIT_STRUCTURE", "sweep", [34, 80]);
const A_RETEST = atom("WAIT_RETEST", "retest", [81, 100], [A_SWEEP.id]);
const A_CONF = atom("WAIT_CONFIRMATION", "engulfing", [101, 130], [A_RETEST.id]);
const A_ENTER = atom("ENTER", "entry", [101, 130], [A_CONF.id, A_SESSION.id]);
const ATOMS = [A_SESSION, A_SWEEP, A_RETEST, A_CONF, A_ENTER];
const GRAPH: DecisionGraph = { atoms: ATOMS };

const CLAUSES: Clause[] = [
  { id: "c1", text: "we only trade the london session", span: { start: 0, end: 33 }, disposition: "decision_bearing" },
  { id: "c2", text: "wait for a liquidity sweep", span: { start: 34, end: 80 }, disposition: "decision_bearing" },
  { id: "c3", text: "wait for the retest", span: { start: 81, end: 100 }, disposition: "decision_bearing" },
  { id: "c4", text: "enter on a bullish engulfing", span: { start: 101, end: 130 }, disposition: "decision_bearing" },
  { id: "c5", text: "this is called the judas swing", span: { start: 131, end: 160 }, disposition: "semantic_only" },
  { id: "c6", text: "ICT teaches this", span: { start: 161, end: 175 }, disposition: "contextual" },
  { id: "c7", text: "stay disciplined", span: { start: 176, end: 190 }, disposition: "motivational" },
];

describe("Ledger A — transcript conservation", () => {
  it("passes when every clause has a disposition", () => {
    expect(ledgerAOrThrow(ledgerA(CLAUSES)).conserved).toBe(true);
  });
  it("FAILS (classifier dropped a clause) when a clause has no disposition", () => {
    const r = ledgerA([...CLAUSES, { id: "cX", text: "and then something", span: { start: 191, end: 210 } }]);
    expect(r.conserved).toBe(false);
    expect(r.unclassified.map((c) => c.id)).toEqual(["cX"]);
    expect(() => ledgerAOrThrow(r)).toThrow(/no disposition/i);
  });
  it("FAILS the escape-hatch guard when a clause is 'ignored' without a reason", () => {
    const r = ledgerA([...CLAUSES, { id: "cI", text: "buy my course", span: { start: 191, end: 210 }, disposition: "ignored" }]);
    expect(r.ignoredWithoutReason.map((c) => c.id)).toEqual(["cI"]);
    expect(() => ledgerAOrThrow(r)).toThrow(/without a reason/i);
  });
});

describe("Ledger B — decision conservation (OMISSION)", () => {
  it("passes when every decision-bearing clause is cited by an atom", () => {
    expect(ledgerBOrThrow(ledgerB(CLAUSES, ATOMS)).conserved).toBe(true);
  });
  it("★ A passes but B FAILS -> the EXTRACTOR missed an atom (retest clause has no atom)", () => {
    expect(ledgerA(CLAUSES).conserved).toBe(true);              // transcript fine
    const r = ledgerB(CLAUSES, ATOMS.filter((a) => a !== A_RETEST)); // extractor dropped WAIT_RETEST
    expect(r.conserved).toBe(false);
    expect(r.orphanClauses.map((c) => c.id)).toEqual(["c3"]);   // localized to the retest clause
    expect(() => ledgerBOrThrow(r)).toThrow(/OMISSION/);
  });
});

describe("Ledger C — graph conservation (assembler)", () => {
  it("passes for a well-formed graph (reaches ENTER, deps resolve, acyclic)", () => {
    expect(ledgerCOrThrow(ledgerC(GRAPH)).conserved).toBe(true);
  });
  it("★ A+B pass but C FAILS -> the ASSEMBLER forgot a dependency (atom unreachable from ENTER)", () => {
    // atoms all extracted (B passes) but ENTER's depends_on omits the confirmation -> A_CONF is unplaced.
    const enterMissingDep = atom("ENTER", "entry", [101, 130], [A_SESSION.id]); // forgot A_CONF dep
    const r = ledgerC({ atoms: [A_SESSION, A_SWEEP, A_RETEST, A_CONF, enterMissingDep] });
    expect(r.conserved).toBe(false);
    expect(r.unreachable.map((a) => a.type)).toEqual(expect.arrayContaining(["WAIT_CONFIRMATION", "WAIT_RETEST", "WAIT_STRUCTURE"]));
    expect(() => ledgerCOrThrow(r)).toThrow(/unreachable from ENTER/);
  });
  it("FAILS on a dangling dependency edge", () => {
    const bad = atom("ENTER", "entry", [101, 130], ["WAIT_CONFIRMATION:ghost#0"]);
    const r = ledgerC({ atoms: [A_SESSION, bad] });
    expect(r.danglingDeps.length).toBeGreaterThan(0);
    expect(() => ledgerCOrThrow(r)).toThrow(/dangling dependency/);
  });
  it("FAILS on a dependency cycle", () => {
    const x = atom("WAIT_RETEST", "retest", [81, 100], ["WAIT_CONFIRMATION:engulfing#0"]);
    const y = atom("WAIT_CONFIRMATION", "engulfing", [101, 130], ["WAIT_RETEST:retest#0"]);
    const enter = atom("ENTER", "entry", [101, 130], [y.id]);
    const r = ledgerC({ atoms: [x, y, enter] });
    expect(r.cyclic.length).toBeGreaterThan(0);
    expect(() => ledgerCOrThrow(r)).toThrow(/cycle/);
  });
});

describe("Bidirectional adversarial — HALLUCINATION (reverse traceability)", () => {
  const transcript = "we wait for a liquidity sweep then enter on the engulfing";
  it("clean atom (quote present at span) is not flagged", () => {
    const good = atom("WAIT_STRUCTURE", "sweep", [0, transcript.length]);
    expect(structuralHallucinations([{ ...good, provenance: SPAN("liquidity sweep", 0, transcript.length) }], transcript)).toHaveLength(0);
  });
  it("★ atom whose evidence is NOT in the transcript is flagged hallucination", () => {
    const fabricated = { ...atom("WAIT_CONFIRMATION", "head_and_shoulders", [0, transcript.length]),
      provenance: SPAN("head and shoulders pattern", 0, transcript.length) };
    const f = structuralHallucinations([fabricated], transcript);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("hallucination");
  });
});
