/**
 * SEMANTIC COMPRESSION LAYER (v1.1, 2026-06-29) — separates executable decision NODES from supporting PREDICATES
 * BEFORE graph assembly (operator/GPT mechanism decision).
 *
 * Measured root cause: over-extraction is OVER-FRAGMENTATION, not false positives (~85% of psH noise). Gemma
 * splits ONE decision ("confirmation = displacement + body-close + follow-through") into many atoms. Those
 * sub-features are PREDICATES of one node, not separate state transitions. Filtering can't fix it (you can't
 * delete a valid sub-feature); COMPRESSION can (merge/alias/preserve, conservation-law-safe).
 *
 * Algorithm (deterministic, NO LLM):
 *   1. FRAMEWORK leaks (risk/reward/stop/TP/size on non-terminal atoms) -> classified out of the graph (not deleted).
 *   2. ANCHORS = always-node types, OR refinable types with a SPECIFIC discriminating object (timeframe / named
 *      level / named pattern / indicator / session). Distinct specific objects stay distinct nodes (psH 15m-range
 *      vs 5m-break = 2 nodes — never fuzzy-merged; that would collapse real decisions / OR-branches).
 *   3. GENERICS (refinable + non-specific: "price action", "candle formation", "direction") are PREDICATES.
 *      Fold each onto the nearest SAME-RANK anchor within a transcript WINDOW (fragments are scattered, not
 *      contiguous — window absorption, not adjacency). A generic with no nearby same-rank anchor stays a node
 *      (never lose a decision). Provenance preserved on every predicate.
 */
import { canonKey, type AtomType, type DecisionAtom, type Predicate } from "./decision-atom.js";
import { rankOf } from "./graph-compiler.js";

const ALWAYS_NODE: ReadonlySet<AtomType> = new Set(["ENTER", "ENABLE_ENTRY", "INVALIDATE", "EXCEPTION", "RESET", "WAIT_SESSION", "FILTER", "WAIT_BIAS"]);
// SPECIFIC = a STRATEGY-DOMAIN object carrying an executable decision (operator/GPT: target objects must be
// domain objects, not generic surface detail). Covers SMC / indicators / levels / sessions / triggers across
// ICT, indicator-crossover, price-action and session-liquidity styles.
const SPECIFIC = /\b(\d+\s*min|\d+\s*m\b|fifteen|five|thirty|sixty|hourly|daily|weekly|session|new ?york|london|asia|asian|tokyo|killzone|midnight|sweep|liquidity|mss|bos|choch|market structure|structure break|break|breakout|broke|displacement|order ?block|fvg|fair ?value|imbalance|supply|demand|swing|fib|premium|discount|retrace|equilibrium|dealing range|range|two ?line|two ?level|level|opening|reclaim|vwap|ema|sma|cci|rsi|macd|moving average|cross|oscillat|zero line|poc|volume profile|engulf|confirm|retest|pullback|rejection|reversal|weakness|strength|bias|bullish|bearish|direction|invalidat|pd[hl]|pw[hl])\b/i;
// GENERIC_DENY = vague surface detail that must NEVER anchor even if it brushes a domain token (it was over-anchoring).
const GENERIC_DENY = /^(price action|candle formation|candle pattern|price structure|price levels?|price movement|movement|the move|setup|condition|state|waiting state|time ?frame change|thing|something|price continuously[a-z ]*)$/i;
const FRAMEWORK = /\b(risk|reward|r ?: ?r|profit|target|stop ?loss|sizing|position size|lot|pips?|take ?profit)\b/i;
const ENTRY_ACTION = /\b(enter|entry|take (the )?trade|go long|go short|buy|sell)\b/i;

const WINDOW = 4000; // chars — generics fold onto same-TYPE nodes (type-preserving => NodeRecall-safe even wide)

const isFramework = (a: DecisionAtom) => FRAMEWORK.test(a.object) || FRAMEWORK.test(a.object_canonical);
const isSpecific = (a: DecisionAtom) => SPECIFIC.test(a.object) || SPECIFIC.test(a.object_canonical);
const isGenericDeny = (a: DecisionAtom) => GENERIC_DENY.test(a.object_canonical);
// anchor = always-node type, OR a domain-specific object that is NOT vague surface detail.
const isAnchor = (a: DecisionAtom) => ALWAYS_NODE.has(a.type) || (isSpecific(a) && !isGenericDeny(a));
const isEntry = (a: DecisionAtom) => ENTRY_ACTION.test(a.object) || ENTRY_ACTION.test(a.object_canonical);
// A pure-framework leak: framework vocabulary AND not a real entry action AND not otherwise specific.
const isFrameworkLeak = (a: DecisionAtom) => isFramework(a) && !isEntry(a) && !isSpecific(a);
const startOf = (a: DecisionAtom) => a.provenance.transcript_span?.start ?? 0;

export interface CompressionResult {
  nodes: DecisionAtom[];
  frameworkLeaks: DecisionAtom[];
  rawCount: number;
  predicateCount: number;
}

function mergePredicate(node: DecisionAtom, child: DecisionAtom): void {
  node.predicates ??= [];
  const p: Predicate = { kind: child.type, object: child.object, object_canonical: child.object_canonical, provenance: child.provenance };
  if (!node.predicates.some((x) => x.object_canonical === p.object_canonical && x.kind === p.kind)) node.predicates.push(p);
}

export function compressAtoms(atoms: DecisionAtom[], _transcript: string): CompressionResult {
  const ordered = [...atoms].sort((a, b) => startOf(a) - startOf(b));
  const rawCount = ordered.length;

  // 1. framework leaks: pure stop/TP/sizing vocabulary (any type) — classified out, never deleted
  const frameworkLeaks: DecisionAtom[] = [];
  const kept: DecisionAtom[] = [];
  for (const a of ordered) (isFrameworkLeak(a) ? frameworkLeaks : kept).push(a);

  // 2. anchors -> nodes (dedup exact canonical key; same decision said twice folds as a predicate)
  const nodes: DecisionAtom[] = [];
  const byKey = new Map<string, DecisionAtom>();
  for (const a of kept) {
    if (!isAnchor(a)) continue;
    const k = canonKey(a);
    if (!byKey.has(k)) { a.predicates ??= []; byKey.set(k, a); nodes.push(a); }
    else mergePredicate(byKey.get(k)!, a);
  }

  let predicateCount = 0;
  // 3a. generics WITH a same-TYPE anchor nearby -> fold onto it (type-preserving keeps NodeRecall safe)
  const unfolded: DecisionAtom[] = [];
  for (const a of kept) {
    if (isAnchor(a)) continue;
    const aStart = startOf(a);
    let best: DecisionAtom | undefined; let bestD = WINDOW;
    for (const n of nodes) { if (n.type === a.type) { const d = Math.abs(startOf(n) - aStart); if (d < bestD) { bestD = d; best = n; } } }
    if (best) { mergePredicate(best, a); predicateCount++; } else unfolded.push(a);
  }
  // 3b. anchorless generics -> collapse same-TYPE within window into ONE node (scattered restatements of one decision)
  unfolded.sort((a, b) => startOf(a) - startOf(b));
  const repByType = new Map<AtomType, DecisionAtom>();
  for (const a of unfolded) {
    const rep = repByType.get(a.type);
    if (rep && startOf(a) - startOf(rep) <= WINDOW) { mergePredicate(rep, a); predicateCount++; }
    else { a.predicates ??= []; nodes.push(a); repByType.set(a.type, a); }
  }

  nodes.sort((a, b) => startOf(a) - startOf(b));
  return { nodes, frameworkLeaks, rawCount, predicateCount };
}
