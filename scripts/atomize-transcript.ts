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
import { compileGraph } from "../src/server/lib/graph-compiler.js";
import { scoreSGF, atomPurity, GOLD } from "../src/server/lib/graph-fidelity.js";
import { compressAtoms } from "../src/server/lib/predicate-compression.js";
import { ledgerD } from "../src/server/lib/handoff-conservation.js";
import { spineDensity, densifySpine } from "../src/server/lib/spine-density.js";

const VIDEO = process.argv[2] ?? "psH--oXkD8M";
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
// Research harness default = e4b-it-qat (4.5B active, 100% GPU on 8GB, deterministic across passes + richer
// objects than e2b). Production extractor stays gemma4:e2b behind the 5-fixture parity gate. Override via env.
const MODEL = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e4b-it-qat";
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
  Do NOT describe dependencies — the compiler derives the graph edges from order + grammar. Just extract the atom.
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
  // Phase A is DONE here: atoms only, NO dependency burden. The deterministic compiler (Phase B) builds edges in main.
  const byClause = new Map<string, PerClause>();
  for (const [cid, r] of resById) byClause.set(cid, { is_decision: !!r.is_decision, atom_type: r.atom_type ?? "NONE", object_canonical: canonObject(r.object ?? ""), classification: r.classification });
  return { clauseLedger, atoms, rows, byClause };
}

const FRAMEWORK_OBJ = /\b(risk|reward|stop|target|profit|size|sizing|position|lot|pips?)\b/i;

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

  // Phase B — the DETERMINISTIC GRAPH COMPILER builds the edges (it owns the graph; gemma does not).
  const compiled = compileGraph(p1.atoms, transcript);
  const compiled2 = compileGraph(p2.atoms, transcript);
  const A = ledgerA(p1.clauseLedger), B = ledgerB(p1.clauseLedger, compiled.atoms);
  const graph: DecisionGraph = { atoms: compiled.atoms }; const C = ledgerC(graph);  // on the COMPILED graph
  const hall = structuralHallucinations(compiled.atoms, transcript);
  const connected = compiled.reachable.size;
  const isolated = compiled.atoms.filter((a) => !compiled.reachable.has(a.id));
  const isoFramework = isolated.filter((a) => FRAMEWORK_OBJ.test(a.object) || a.type === "EXIT_HINT").length;
  const stab = checkIdempotence([{ atoms: compiled.atoms }, { atoms: compiled2.atoms }]);
  const keysA = new Set(compiled.atoms.map(canonKey)), keysB = new Set(compiled2.atoms.map(canonKey));
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
  const edgeRoles: Record<string, number> = {};
  for (const e of compiled.edges) edgeRoles[e.role] = (edgeRoles[e.role] ?? 0) + 1;
  console.log(`\nDETERMINISTIC GRAPH COMPILER (Phase B) — edges DERIVED from order + grammar, not extracted`);
  console.log(`  edges: ${compiled.edges.length} (${Object.entries(edgeRoles).map(([k, v]) => `${k}=${v}`).join(" | ") || "none"}) | AND-groups ${compiled.andGroups.length} | OR-branches ${compiled.orBranches.length}`);
  console.log(`  connectivity: CONNECTED(reach ENTER) ${connected}/${compiled.atoms.length} | isolated ${isolated.length} (framework ${isoFramework}, other ${isolated.length - isoFramework})`);
  // ── SEMANTIC COMPRESSION — lift supporting PREDICATES out of the graph; recompile on decision NODES only ──
  const clones = p1.atoms.map((a) => ({ ...a, depends_on: [] as string[] }));
  const comp = compressAtoms(clones, transcript);
  const compiledC = compileGraph(comp.nodes, transcript);
  const totalPreds = comp.nodes.reduce((s, n) => s + (n.predicates?.length ?? 0), 0);
  console.log(`\nSEMANTIC COMPRESSION (decision NODES vs PREDICATES) — raw ${comp.rawCount} -> nodes ${comp.nodes.length} (+${totalPreds} predicates folded, ${comp.frameworkLeaks.length} framework leaks classified out)`);
  console.log(`  NODES: ${comp.nodes.map((n) => `${canonKey(n)}${n.predicates?.length ? "[+" + n.predicates.length + "]" : ""}`).join(" | ")}`);
  console.log(`  connectivity: CONNECTED(reach ENTER) ${compiledC.reachable.size}/${compiledC.atoms.length}`);
  const gold = GOLD[VIDEO];
  if (gold) {
    const base = scoreSGF(compiled, gold), comped = scoreSGF(compiledC, gold);
    console.log(`\nSGF vs gold (${gold.nodes.length} nodes, ${gold.edges.length} edges) — BASELINE -> COMPRESSED:`);
    console.log(`  AtomPurity:  ${(atomPurity(compiled.atoms.length, gold) * 100).toFixed(0)}% -> ${(atomPurity(compiledC.atoms.length, gold) * 100).toFixed(0)}%`);
    console.log(`  NodeRecall:  ${(base.NR * 100).toFixed(0)}% -> ${(comped.NR * 100).toFixed(0)}%`);
    console.log(`  EdgeRecall:  ${(base.ER * 100).toFixed(0)}% -> ${(comped.ER * 100).toFixed(0)}%`);
    console.log(`  Reachable:   ${base.RG ? "YES" : "NO"} -> ${comped.RG ? "YES" : "NO"}    TopologyFid: ${(base.TF * 100).toFixed(0)}% -> ${(comped.TF * 100).toFixed(0)}%`);
    console.log(`  SGF:         ${(base.SGF * 100).toFixed(0)}% -> ${(comped.SGF * 100).toFixed(0)}%`);
    const erUp = comped.ER > base.ER + 0.05, nrHeld = comped.NR >= base.NR - 0.01;
    console.log(`  VERDICT: ${erUp && nrHeld ? "COMPRESSION VALIDATED — ER up + NR held" : !nrHeld ? "FAILED — NodeRecall dropped (over-merge)" : "INCONCLUSIVE — ER not materially up"}`);
  } else console.log(`  (no gold for ${VIDEO})`);

  // ── SPINE DENSITY + canonical densification (2026-06-30 verdict: densifySpine IS the compiler step
  //    feeding the hand-off — n=8 all lifted to 100% reachable with Ledger D CONSERVED) ──
  const sdBase = spineDensity(compiledC);
  const densified = densifySpine(compiledC);
  const sdRef = spineDensity(densified);
  console.log(`\nSPINE DENSITY — BASELINE -> DENSIFIED (canonical; orphan-confluence attach):`);
  console.log(`  reachable:    ${(sdBase.reachable_pct * 100).toFixed(0)}% -> ${(sdRef.reachable_pct * 100).toFixed(0)}%   confluence-in-chain: ${(sdBase.confluence_in_chain_pct * 100).toFixed(0)}% -> ${(sdRef.confluence_in_chain_pct * 100).toFixed(0)}%`);
  console.log(`  orphans:      ${sdBase.orphan_count} -> ${sdRef.orphan_count}   avg-depth: ${sdBase.avg_depth} -> ${sdRef.avg_depth}`);

  // ── Ledger D — graph→engine HANDOFF conservation on the DENSIFIED graph (the Databento hand-off gate) ──
  const dD = ledgerD(densified);

  // ── --emit-spec: persist the EngineStrategySpec artifact (hashed) for live engine execution + Ledger G ──
  if (process.argv.includes("--emit-spec")) {
    const { createHash } = await import("crypto");
    const { writeFileSync } = await import("fs");
    const specJson = JSON.stringify(dD.spec);
    const artifact = {
      video: VIDEO,
      spec_hash: createHash("sha256").update(specJson).digest("hex"),
      graph_canonical_hash: canonicalHash(graph),
      ledger_d: dD.ok ? "CONSERVED" : "VIOLATED",
      transcript_chars: transcript.length,
      spec: dD.spec,
    };
    const outPath = join("tmp/generalization", `${VIDEO}.spec.json`);
    writeFileSync(outPath, JSON.stringify(artifact, null, 1));
    console.log(`\nSPEC ARTIFACT: ${outPath} (spec_hash=${artifact.spec_hash.slice(0, 16)}…, ledger_d=${artifact.ledger_d})`);
  }
  console.log(`\nLEDGER D — graph→engine HANDOFF conservation (DENSIFIED source-owned → Databento spec):`);
  console.log(`  ${dD.invariants.map((i) => `${i.ok ? "✓" : "✗"} ${i.name}${i.ok ? "" : "[" + i.offenders.slice(0, 4).join(",") + "]"}`).join("  ")}`);
  console.log(`  engine spec: ${dD.spec.entry_conditions.length} entry conds (${dD.spec.and_groups.length} AND-groups, ${dD.spec.or_branches.length} OR-branches), ${dD.spec.invalidations.length} invalidation, dir=${dD.spec.direction}, trigger=${dD.spec.entry_trigger_id ? "set" : "NONE"} -> HANDOFF ${dD.ok ? "CONSERVED" : "VIOLATED"}`);

  console.log(`\nCANONICAL GRAPH: ${canonicalHash(graph)} (${new Set(compiled.atoms.map(canonKey)).size} distinct atoms)`);
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
