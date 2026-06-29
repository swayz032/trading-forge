/**
 * v1.1 PHASE 1 — one transcript -> one atom ledger (2026-06-29).
 *
 * The smallest end-to-end vertical slice that answers the research question: "can decision atoms represent
 * everything needed for transcript-faithful compilation?" Pipeline:
 *   Transcript -> Clause Segmenter -> (gemma) Decision-Atom Extractor -> 3 Conservation Ledgers ->
 *   Canonical Decision Graph -> Atom-Stability (2 passes) -> brutally-explicit Report.
 *
 * Deliberately NO cloud critic and NO N-sample union yet (operator/GPT scope): first prove the representation
 * is expressive + the single deterministic pass is STABLE. Extraction is binary PER CLAUSE (decompose, don't
 * summarize). Usage:  npx tsx scripts/atomize-transcript.ts [videoId]   (default: psH--oXkD8M)
 */
import { readFileSync } from "fs"; import { join } from "path";
import { segmentTranscript, type SegmentedClause } from "../src/server/lib/clause-segmenter.js";
import { SPAN } from "../src/server/lib/state-machine-ir.js";
import { atomId, canonObject, canonKey, type AtomType, type DecisionAtom, type DecisionGraph, type TemporalKind } from "../src/server/lib/decision-atom.js";
import { ledgerA, ledgerB, ledgerC, structuralHallucinations, type Clause, type ClauseDisposition } from "../src/server/lib/conservation-ledgers.js";
import { canonicalHash, checkIdempotence } from "../src/server/lib/decision-graph-canonical.js";

const VIDEO = process.argv[2] ?? "psH--oXkD8M";
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";
const BATCH = 6;

const ATOM_TYPES: AtomType[] = ["WAIT_SESSION","FILTER","WAIT_BIAS","WAIT_STRUCTURE","VERIFY_STRUCTURE","WAIT_RETEST","WAIT_CONFIRMATION","CONFIRM_DIRECTION","ENABLE_ENTRY","ENTER","INVALIDATE","EXCEPTION","RESET","EXIT_HINT"];
const CLASS_MAP: Record<string, ClauseDisposition> = {
  decision_bearing: "decision_bearing", terminology: "semantic_only", context: "contextual",
  motivation: "motivational", observation: "contextual", visual_reference: "visual_only", non_strategy: "ignored",
  // Decision Introduction Gate (2026-06-29) — new non-decision classes for clauses that DISCUSS rather than INTRODUCE:
  explanation: "contextual", justification: "contextual", recap: "contextual", example: "contextual",
  warning: "motivational", framework_owned: "ignored",
};

const SCHEMA = {
  type: "object", properties: { results: { type: "array", items: { type: "object", properties: {
    clause_id: { type: "string" }, is_decision: { type: "boolean" },
    atom_type: { type: "string", enum: [...ATOM_TYPES, "NONE"] },
    temporal_kind: { type: "string", enum: ["event", "condition", "none"] },
    object: { type: "string" }, polarity: { type: "string", enum: ["long", "short", "both", "none"] },
    parameters: { type: "string" }, evidence_span: { type: "string" },
    classification: { type: "string", enum: ["decision_bearing","terminology","explanation","justification","motivation","recap","example","warning","observation","visual_reference","framework_owned","non_strategy"] },
  }, required: ["clause_id", "is_decision", "classification"] } } }, required: ["results"],
} as const;

const PROMPT = `You are compiling a trading-strategy transcript into EXECUTABLE decision atoms for a DETERMINISTIC backtest engine.

DECISION INTRODUCTION GATE — apply to EVERY clause FIRST, before emitting any atom:
A clause is a DECISION only if removing it would CHANGE the behavior of a deterministic trading engine — i.e. it
INTRODUCES a new entry / wait / confirmation / filter / invalidation / exit-trigger RULE the engine executes.
A clause that merely DISCUSSES, explains, defines, recaps, justifies, motivates, warns, or gives an example of a
rule is NOT a decision — even if it mentions indicators or price.
  "wait for the EMA10 to cross above the EMA20"  -> YES (the engine changes)
  "this is called a liquidity sweep" / "CCI measures deviation from average"  -> NO (terminology / explanation)
  "this setup has a high win rate" / "you stop trusting yourself"  -> NO (justification / motivation)
  "the engulfing candle confirms buyers"  -> YES only if it introduces a confirmation rule not already stated, else explanation.

OWNERSHIP BOUNDARY: stop-loss, take-profit, target, position size, risk amount, and risk/reward are
FRAMEWORK-OWNED (outside the strategy edge). They are valid concepts but NEVER decision atoms — classify them
"framework_owned".

For EACH clause:
- PASSES the gate -> is_decision=true, classification="decision_bearing", fill atom_type (one of ${ATOM_TYPES.join(", ")}),
  temporal_kind (event=occurs once / condition=stays true), object (the core concept), polarity, parameters, evidence_span.
- FAILS the gate -> is_decision=false, atom_type="NONE", classify: terminology / explanation / justification /
  motivation / recap / example / warning / observation / visual_reference / framework_owned / non_strategy.
Be STRICT: when unsure whether a clause introduces a rule or merely discusses one, it is NOT a decision.
Return EXACTLY one result per clause, preserving clause_id order. Return JSON matching the schema.`;

interface GemmaResult { clause_id: string; is_decision: boolean; atom_type: string; temporal_kind?: string; object?: string; polarity?: string; parameters?: string; evidence_span?: string; classification: string }

async function classifyBatch(clauses: SegmentedClause[]): Promise<GemmaResult[]> {
  const input = clauses.map((c) => ({ clause_id: c.id, text: c.text.trim() }));
  const body = { model: MODEL, stream: false, keep_alive: -1, format: SCHEMA,
    options: { temperature: 0, top_p: 0.9, top_k: 20, seed: 42, num_ctx: 8192 },
    messages: [{ role: "user", content: `${PROMPT}\n\nCLAUSES:\n${JSON.stringify(input)}\n\nReturn JSON matching the schema.` }] };
  const resp = await fetch(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  const j: any = await resp.json();
  try { return JSON.parse(j.message?.content ?? "{}").results ?? []; } catch { return []; }
}

interface PerClause { is_decision: boolean; atom_type: string; object_canonical: string; classification: string }
async function extractAtoms(clauses: SegmentedClause[]): Promise<{ clauseLedger: Clause[]; atoms: DecisionAtom[]; rows: Array<{ c: SegmentedClause; cls: string; atomIds: string[] }>; byClause: Map<string, PerClause> }> {
  const byId = new Map(clauses.map((c) => [c.id, c]));
  const results: GemmaResult[] = [];
  for (let i = 0; i < clauses.length; i += BATCH) {
    process.stderr.write(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(clauses.length / BATCH)}\r`);
    results.push(...await classifyBatch(clauses.slice(i, i + BATCH)));
  }
  const resById = new Map(results.map((r) => [r.clause_id, r]));

  const clauseLedger: Clause[] = []; const atoms: DecisionAtom[] = []; const rows: Array<{ c: SegmentedClause; cls: string; atomIds: string[] }> = [];
  const ordinal = new Map<string, number>();
  for (const c of clauses) {
    const r = resById.get(c.id);
    if (!r) { clauseLedger.push({ id: c.id, text: c.text, span: { start: c.start, end: c.end } }); rows.push({ c, cls: "UNCLASSIFIED", atomIds: [] }); continue; }
    const dispo = CLASS_MAP[r.classification] ?? "ignored";
    const clause: Clause = { id: c.id, text: c.text, span: { start: c.start, end: c.end }, disposition: dispo };
    if (dispo === "ignored") clause.ignore_reason = r.classification;
    clauseLedger.push(clause);
    const atomIds: string[] = [];
    if (r.is_decision && r.atom_type && r.atom_type !== "NONE" && ATOM_TYPES.includes(r.atom_type as AtomType)) {
      const objc = canonObject(r.object ?? c.normalized);
      const key = `${r.atom_type}:${objc}`; const ord = ordinal.get(key) ?? 0; ordinal.set(key, ord + 1);
      const tk: TemporalKind = r.temporal_kind === "condition" ? "condition" : "event";
      const a: DecisionAtom = { id: atomId(r.atom_type as AtomType, objc, ord), type: r.atom_type as AtomType, temporal_kind: tk,
        object: r.object ?? c.text.trim(), object_canonical: objc, depends_on: [], provenance: SPAN((r.evidence_span || c.text).trim(), c.start, c.end) };
      atoms.push(a); atomIds.push(a.id);
    }
    rows.push({ c, cls: r.is_decision ? (r.atom_type || "DECISION") : r.classification, atomIds });
    void byId;
  }
  assembleDeps(atoms);
  const byClause = new Map<string, PerClause>();
  for (const [cid, r] of resById) byClause.set(cid, { is_decision: !!r.is_decision, atom_type: r.atom_type ?? "NONE", object_canonical: canonObject(r.object ?? ""), classification: r.classification });
  return { clauseLedger, atoms, rows, byClause };
}

/** v1 sequential assembler: preconditions are roots; the spine chains in transcript order; ENTER needs both. */
function assembleDeps(atoms: DecisionAtom[]): void {
  const PRE: AtomType[] = ["WAIT_SESSION", "FILTER", "WAIT_BIAS"];
  const pre = atoms.filter((a) => PRE.includes(a.type)); const preIds = pre.map((a) => a.id);
  const spine = atoms.filter((a) => !PRE.includes(a.type));
  spine.forEach((a, i) => { a.depends_on = i === 0 ? [...preIds] : [spine[i - 1].id]; if (a.type === "ENTER") a.depends_on = [...new Set([...a.depends_on, ...preIds])]; });
}

(async () => {
  const transcript = readFileSync(join("tmp/generalization", `${VIDEO}.transcript.txt`), "utf8");
  const tid = `T-${VIDEO.slice(0, 4)}`;
  const clauses = segmentTranscript(transcript, tid);
  console.log(`\n=== v1.1 PHASE 1 ATOM LEDGER — ${VIDEO} (${clauses.length} clauses, ${transcript.length} chars) ===\n`);

  process.stderr.write("pass 1...\n");
  const p1 = await extractAtoms(clauses);
  process.stderr.write("\npass 2 (stability)...\n");
  const p2 = await extractAtoms(clauses);

  // ── brutally explicit ledger ──
  console.log("clause       | classification        | atom(s)                              | status");
  console.log("-".repeat(110));
  for (const r of p1.rows) {
    const status = r.atomIds.length ? "compiled" : (r.cls === "UNCLASSIFIED" ? "SILENT-LOSS" : `consumed/${r.cls}`);
    console.log(`${r.c.id.padEnd(12)} | ${String(r.cls).padEnd(21)} | ${(r.atomIds.join(", ") || "—").slice(0, 36).padEnd(36)} | ${status}`);
  }

  const A = ledgerA(p1.clauseLedger), B = ledgerB(p1.clauseLedger, p1.atoms);
  const graph: DecisionGraph = { atoms: p1.atoms }; const C = ledgerC(graph);
  const hall = structuralHallucinations(p1.atoms, transcript);
  const stab = checkIdempotence([{ atoms: p1.atoms }, { atoms: p2.atoms }]);
  const keysA = new Set(p1.atoms.map(canonKey)), keysB = new Set(p2.atoms.map(canonKey));
  const keyDiff = [...keysA].filter((k) => !keysB.has(k)).concat([...keysB].filter((k) => !keysA.has(k)));

  console.log(`\nSUMMARY`);
  console.log(`  clauses:           ${A.total}`);
  console.log(`  decision-bearing:  ${B.decisionBearing}`);
  console.log(`  compiled (atoms):  ${p1.atoms.length}`);
  console.log(`  OMISSIONS (decision clause, no atom): ${B.orphanClauses.length}  ${B.orphanClauses.map((c) => c.id).join(", ")}`);
  console.log(`  unclassified (SILENT LOSS):           ${A.unclassified.length}`);
  console.log(`  ignored/non-executable:`);
  for (const [k, v] of Object.entries(A.byDisposition)) if (k !== "decision_bearing" && v) console.log(`     ${k}: ${v}`);
  console.log(`\nLEDGERS`);
  console.log(`  A transcript conservation: ${A.conserved ? "PASS" : "FAIL"} (unclassified ${A.unclassified.length}, ignored-no-reason ${A.ignoredWithoutReason.length})`);
  console.log(`  B decision conservation:   ${B.conserved ? "PASS" : "FAIL"} (omissions ${B.orphanClauses.length})`);
  console.log(`  C graph conservation:      ${C.conserved ? "PASS" : "FAIL"} (hasEntry ${C.hasEntry}, dangling ${C.danglingDeps.length}, cyclic ${C.cyclic.length}, unreachable ${C.unreachable.length})`);
  console.log(`  hallucinations (structural reverse-traceability): ${hall.length}`);
  console.log(`\nCANONICAL GRAPH: ${canonicalHash(graph)} (${new Set(p1.atoms.map(canonKey)).size} distinct atoms)`);
  console.log(`ATOM STABILITY (2 passes): countA=${p1.atoms.length} countB=${p2.atoms.length} Δ=${Math.abs(p1.atoms.length - p2.atoms.length)} | canonical-key diff=${keyDiff.length} ${keyDiff.length ? "[" + keyDiff.slice(0, 6).join(", ") + "]" : ""} -> ${stab.idempotent && keyDiff.length === 0 ? "STABLE" : "UNSTABLE"}`);

  // ── Decision Boundary Agreement (DBA) + per-clause instability detail (taxonomy input) ──
  const flips: Array<{ id: string; a: string; b: string; text: string }> = [];
  let dbaTotal = 0, dbaAgree = 0;
  const sig = (r?: PerClause) => !r ? "MISSING" : r.is_decision ? `${r.atom_type}:${r.object_canonical}` : `NON:${r.classification}`;
  for (const c of clauses) {
    const ra = p1.byClause.get(c.id), rb = p2.byClause.get(c.id);
    if (ra?.is_decision || rb?.is_decision) { dbaTotal++; if (!!ra?.is_decision === !!rb?.is_decision) dbaAgree++; }
    const ka = sig(ra), kb = sig(rb);
    if (ka !== kb) flips.push({ id: c.id, a: ka, b: kb, text: c.text.trim().replace(/\s+/g, " ").slice(0, 64) });
  }
  console.log(`\nDECISION BOUNDARY AGREEMENT (DBA): ${dbaTotal ? Math.round((dbaAgree / dbaTotal) * 100) : 100}% (${dbaAgree}/${dbaTotal} either-pass-decision clauses agreed on is_decision)`);
  console.log(`INSTABILITY DETAIL — ${flips.length} clause(s) flipped between passes (classify each into the cause taxonomy):`);
  for (const f of flips) console.log(`  ${f.id} | A=${f.a.padEnd(30)} B=${f.b.padEnd(30)} | "${f.text}"`);

  const success = A.conserved && B.conserved && stab.idempotent && keyDiff.length === 0;
  console.log(`\nPHASE-1 SUCCESS CRITERION (every strategy-bearing clause dispositioned + every decision an atom + deterministic graph): ${success ? "MET" : "NOT MET"}`);
  process.exit(0);
})();
