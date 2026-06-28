/**
 * ZONE / CONTEXT-GATE PRIMITIVE (Fidelity Phase 3A).
 *
 * Phase 2B proved multi-leg was real but not final: iU8/O9cz stayed PARTIAL because their residual is a
 * WHERE-valid context (4h-box 25-50% optimum zone; Asia-low POI), NOT a WHEN-confirm event. Context gates
 * are a SEPARATE, orthogonal axis from confirmation legs (design: zone-context-gate-primitive.md):
 *
 *     trade_valid = all_required_context_gates_pass  AND  primary_confirmation_leg_fires
 *
 * A gate is a VALIDITY BOUNDARY, never an event. Dropping a required gate INFLATES edge (the trigger fires
 * everywhere instead of only in the zone) → fail-CLOSED: an unrepresentable (T3) REQUIRED gate quarantines.
 *
 * Pure / deterministic. v1 = 4 classes only {zone, poi, session, regime} — no vol/volume/liquidity-profile
 * gates until the data demands them.
 */

export type ContextGateType = "zone" | "poi" | "session" | "regime";
/** Representability: T1 fully computable · T2 computable with a tolerance/approx · T3 unrepresentable (fuzzy). */
export type Representability = "T1" | "T2" | "T3";
/** Phase 2D-C — level role: what the level is FOR. Prevents a TP target being mis-typed as a validity gate. */
export type LevelRole = "entry_anchor" | "gate" | "target" | "stop_anchor";
/** Phase 2D-B — session role: WHERE the POI forms vs WHERE the trade executes (distinct variables). */
export type SessionRole = "formation" | "execution";

export interface ContextGate {
  type: ContextGateType;
  name: string;
  required: boolean;
  representability: Representability;
  specificity: number;
  evidence_quote: string;
  role: LevelRole;            // 2D-C — only `gate`/`entry_anchor` participate in validity; `target`/`stop_anchor` do not
  session_role?: SessionRole; // 2D-B — set on session gates
  params: {
    bounds?: { min: number; max: number }; // zone: fraction of the anchor range [0,1]
    anchor?: string;                        // zone: what the range is measured on (e.g. 4h_candle_box)
    level?: string;                         // poi: named level (asia_low, pdh, …)
    proximity_atr?: number;                 // poi: tolerance band in ATR units
    region?: string;                        // session: NY | LONDON | ASIA
    value?: string;                         // regime: trending | ranging | …
  };
}

export type ContextContradictionType = "CONTEXT_GATE_UNREPRESENTED";
export interface ContextContradiction { type: ContextContradictionType; detail: string }

export interface ContextScanResult {
  gates: ContextGate[];
  contradictions: ContextContradiction[];
}

// ── detection ────────────────────────────────────────────────────────────────
const FUZZY_RE = /\b(smart money|repricing|inefficiency|somewhere|around the|area of interest|premium inefficiency|institutional zone)\b/i;

function gateSpecificity(f: { explicit_bounds: boolean; named_reference: boolean; timeframe_anchor: boolean; quantitative_rule: boolean }): number {
  return (f.explicit_bounds ? 5 : 0) + (f.named_reference ? 4 : 0) + (f.timeframe_anchor ? 3 : 0) + (f.quantitative_rule ? 5 : 0);
}

// `required` (hard gate) needs STRONG gating language — not loose words like "within/inside" that
// appear everywhere (those falsely mark every gate required, then any T3 over-quarantines a winner).
const REQUIRED_RE = /\b(only (?:enter|trade|take|buy|sell|in|when|during)|must (?:be|see|have|enter|trade|wait)|no trade (?:unless|without)|never (?:trade|enter)|do not (?:enter|trade))\b/i;
const TF_RE = /\b(4h|4 hour|1h|hourly|daily|15m|5m|1m|session)\b/i;

// 2D-C — level-role cues (detected NEAR the level mention).
const TARGET_RE = /\b(target|take profit|\btp\b|aim for|profit objective|our objective|take[- ]profit|tp at|targeting)\b/i;
const STOP_RE = /\b(stop (?:loss|below|above)?|stop[- ]loss|invalidation|invalidat)\b/i;
const ENTRY_ANCHOR_RE = /\b(buying below|selling above|point of interest|\bpoi\b|setup forms|enter (?:at|from|near)|entry (?:at|from|near)|from the|off (?:the|of))\b/i;
// 2D-B — session-formation cues (the session whose RANGE/levels seed the POI, vs where we execute).
const FORMATION_RE = /\b(range|session (?:high|low)|liquidity|forms? (?:in|during)|formed (?:in|during)|swept|sweep|point of interest|\bpoi\b)\b/i;
const EXECUTION_RE = /\b(trade during|execute|entries? during|we trade|i trade|enter during|killzone|window to trade)\b/i;

/** Classify a level's role from the words around its mention. Order: target > stop > entry_anchor > gate. */
function levelRole(near: string): LevelRole {
  if (TARGET_RE.test(near)) return "target";
  if (STOP_RE.test(near)) return "stop_anchor";
  if (ENTRY_ANCHOR_RE.test(near)) return "entry_anchor";
  return "gate";
}
/** Text window around the FIRST match of `re` (for role classification of THAT mention). */
function around(text: string, re: RegExp): string {
  const m = text.match(re);
  if (!m) return "";
  const i = m.index ?? 0;
  return text.slice(Math.max(0, i - 50), i + 60);
}

/** Parse an explicit fraction zone like "25 to 50%", "0.25-0.5", "25%-50%". */
function parseZoneBounds(text: string): { min: number; max: number } | null {
  const pct = text.match(/(\d{1,3})\s*(?:%|percent)?\s*(?:to|-|–|through)\s*(\d{1,3})\s*(?:%|percent)/i);
  if (pct) {
    const a = Number(pct[1]) / 100, b = Number(pct[2]) / 100;
    if (a >= 0 && b <= 1 && a < b) return { min: a, max: b };
  }
  const dec = text.match(/(0?\.\d+)\s*(?:to|-|–|through)\s*(0?\.\d+)/);
  if (dec) {
    const a = Number(dec[1]), b = Number(dec[2]);
    if (a >= 0 && b <= 1 && a < b) return { min: a, max: b };
  }
  return null;
}

/** Named fib quadrant → computable bounds (T1/T2). */
const QUADRANTS: Record<string, { min: number; max: number }> = {
  discount: { min: 0.0, max: 0.5 },
  premium: { min: 0.5, max: 1.0 },
  equilibrium: { min: 0.45, max: 0.55 },
  optimum: { min: 0.25, max: 0.5 }, // 4h-box "optimum" convention (iU8)
};

const POI_LEVELS: Array<{ re: RegExp; name: string }> = [
  { re: /\basian?\s+(?:session\s+)?low\b/i, name: "asia_low" },
  { re: /\basian?\s+(?:session\s+)?high\b/i, name: "asia_high" },
  { re: /\bovernight\s+low\b/i, name: "overnight_low" },
  { re: /\bovernight\s+high\b/i, name: "overnight_high" },
  { re: /\bpdh\b|previous day high|prior day high/i, name: "pdh" },
  { re: /\bpdl\b|previous day low|prior day low/i, name: "pdl" },
  { re: /\border block\b/i, name: "order_block" },
  // NOTE: no generic "point of interest"/"poi" catch-all — it's a noun that appears in passing and is
  // not an actionable level; a real POI gate must name a specific level (asia/overnight/PDH/PDL/OB).
];

const SESSION_RE: Array<{ re: RegExp; region: string }> = [
  { re: /\bnew york|\bny (?:open|session|killzone)|us session|us open\b/i, region: "NY" },
  { re: /\blondon\b/i, region: "LONDON" },
  { re: /\basian? session|tokyo\b/i, region: "ASIA" },
];

const REGIME_RE: Array<{ re: RegExp; value: string }> = [
  { re: /\btrending|in a trend|trend(?:ing)? market|displacement market\b/i, value: "trending" },
  { re: /\branging|range[- ]bound|consolidat|choppy|chop\b/i, value: "ranging" },
];

/**
 * Mine WHERE-validity context gates from the educator's steps + setup text. These come largely from the
 * PURE-CONTEXT entry_sequence steps the confirmation compiler skips ("retrace into the 25-50% zone").
 */
export function scanContextGates(corpus: string | null | undefined): ContextScanResult {
  const text = typeof corpus === "string" ? corpus : "";
  const gates: ContextGate[] = [];
  const contradictions: ContextContradiction[] = [];
  const quote = (re: RegExp): string => { const m = text.match(re); return m ? text.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 80).trim() : ""; };
  const seen = new Set<string>();
  const add = (g: ContextGate) => { const k = `${g.type}:${g.name}`; if (!seen.has(k)) { seen.add(k); gates.push(g); } };

  // ZONE — only a REAL zone: explicit bounds (T1) or a named quadrant (T2; fuzzy→T3). A bare "zone"/"fib"
  // mention with neither is NOT an actionable gate — emitting one as T3 over-quarantines winners (sv-ix).
  const bounds = parseZoneBounds(text);
  const quadHit = Object.keys(QUADRANTS).find((q) => new RegExp(`\\b${q}\\b`, "i").test(text));
  const hasZoneCue = Boolean(bounds || quadHit);
  if (hasZoneCue) {
    const anchorTf = TF_RE.test(text);
    const explicit = Boolean(bounds);
    const fuzzy = FUZZY_RE.test(text); // fuzzy context overrides a bare quadrant keyword ("premium inefficiency")
    const named = Boolean(quadHit) && !fuzzy;
    const fuzzyZone = fuzzy && !bounds;
    const representability: Representability = explicit ? "T1" : named ? "T2" : "T3";
    const gateBounds = bounds ?? (quadHit ? QUADRANTS[quadHit] : undefined);
    const g: ContextGate = {
      type: "zone", name: quadHit ? `${quadHit}_zone` : "fib_zone", required: REQUIRED_RE.test(text),
      representability, specificity: gateSpecificity({ explicit_bounds: explicit, named_reference: named, timeframe_anchor: anchorTf, quantitative_rule: explicit }),
      evidence_quote: quote(bounds ? /(\d{1,3})\s*(?:%|percent)?\s*(?:to|-|–|through)\s*(\d{1,3})/i : quadHit ? new RegExp(`\\b${quadHit}\\b`, "i") : /\bzone\b/i),
      role: "gate", // a zone is a validity boundary
      params: gateBounds ? { bounds: gateBounds, anchor: anchorTf ? "htf_box" : undefined } : {},
    };
    add(g);
    if (g.required && (representability === "T3" || fuzzyZone)) {
      contradictions.push({ type: "CONTEXT_GATE_UNREPRESENTED", detail: `required zone gate "${g.name}" is fuzzy/unrepresentable (T3)` });
    }
  }

  // POI — named liquidity level (T2). 2D-C: classify role (a TP target is NOT a validity gate).
  for (const { re, name } of POI_LEVELS) {
    if (!re.test(text)) continue;
    const role = levelRole(around(text, re));
    const isValidity = role === "gate" || role === "entry_anchor";
    const g: ContextGate = {
      type: "poi", name, required: isValidity && REQUIRED_RE.test(text), representability: "T2",
      specificity: gateSpecificity({ explicit_bounds: false, named_reference: true, timeframe_anchor: TF_RE.test(text), quantitative_rule: false }),
      evidence_quote: quote(re), role, params: { level: name, proximity_atr: 1.0 },
    };
    add(g);
  }

  // SESSION — computable time window (T1). 2D-B: emit EACH region with formation/execution role, using a
  // TIGHT local window (formation cue right after the region; execution cue right before) so one session's
  // "trade during" doesn't leak onto another's role.
  for (const { re, region } of SESSION_RE) {
    const m = text.match(re);
    if (!m) continue;
    const idx = m.index ?? 0;
    const after = text.slice(idx, idx + 40);
    const before = text.slice(Math.max(0, idx - 30), idx);
    const isFormation = FORMATION_RE.test(after) && !EXECUTION_RE.test(before) && !EXECUTION_RE.test(after.slice(0, 15));
    const session_role: SessionRole = isFormation ? "formation" : "execution";
    add({ type: "session", name: region, required: session_role === "execution" && REQUIRED_RE.test(text), representability: "T1",
      specificity: gateSpecificity({ explicit_bounds: false, named_reference: true, timeframe_anchor: true, quantitative_rule: false }),
      evidence_quote: quote(re), role: "gate", session_role, params: { region } });
  }

  // REGIME — needs the regime classifier (T2).
  for (const { re, value } of REGIME_RE) {
    if (!re.test(text)) continue;
    add({ type: "regime", name: value, required: REQUIRED_RE.test(text), representability: "T2",
      specificity: gateSpecificity({ explicit_bounds: false, named_reference: true, timeframe_anchor: false, quantitative_rule: false }),
      evidence_quote: quote(re), role: "gate", params: { value } });
    break;
  }

  return { gates, contradictions };
}

export interface GateEvalResult {
  allowed: boolean;            // WHERE half of trade_valid — do all required entry gates pass?
  failed: ContextGate[];       // required gates that evaluated false
  unevaluable: ContextGate[];  // required gates with no market-state input (fail-closed → blocks)
}

/**
 * Signal-time WHERE gate (Phase 3A→engine): evaluate the REQUIRED entry-validity gates against market
 * state and decide whether the trigger is allowed to fire. This is the WHERE half of
 *   trade_valid = required_context_gates_pass AND primary_confirmation_leg_fires.
 *
 * Only ENTRY-validity gates participate: target/stop levels never gate entry, and a FORMATION session
 * (where the POI formed) is NOT an entry-time session check (the 2D-B payoff — O9cz checks LONDON
 * execution, not ASIA formation). Fail-CLOSED: a required gate with no market-state input BLOCKS
 * (a missing zone/POI check over-fires if we let it through).
 */
export function evaluateContextGates(gates: ContextGate[], state: GateMarketState): GateEvalResult {
  const entryGates = gates.filter(
    (g) => g.required && g.role !== "target" && g.role !== "stop_anchor" && !(g.type === "session" && g.session_role === "formation"),
  );
  const failed: ContextGate[] = [];
  const unevaluable: ContextGate[] = [];
  for (const g of entryGates) {
    const r = evaluateContextGate(g, state);
    if (r === null) unevaluable.push(g); // no data for a REQUIRED gate → fail-closed
    else if (r === false) failed.push(g);
  }
  return { allowed: failed.length === 0 && unevaluable.length === 0, failed, unevaluable };
}

/** Market state the WHERE-evaluator reads at signal time (engine-provided). */
export interface GateMarketState {
  range_position?: number;                 // zone: price as a fraction [0,1] of the anchor range
  level_distance_atr?: Record<string, number>; // poi: |price − level| / ATR, keyed by level name
  session_region?: string;                 // session: current region
  regime?: string;                         // regime: current institutional regime
}

/**
 * Evaluate ONE context gate against market state (T1/T2 only — T3 never reaches here; it quarantines).
 * Returns null when the state lacks the input (caller decides fail-open/closed per `required`).
 */
export function evaluateContextGate(gate: ContextGate, state: GateMarketState): boolean | null {
  switch (gate.type) {
    case "zone": {
      if (state.range_position == null || !gate.params.bounds) return null;
      return state.range_position >= gate.params.bounds.min && state.range_position <= gate.params.bounds.max;
    }
    case "poi": {
      const d = state.level_distance_atr?.[gate.params.level ?? gate.name];
      if (d == null) return null;
      return d <= (gate.params.proximity_atr ?? 1.0);
    }
    case "session":
      if (state.session_region == null) return null;
      return state.session_region === gate.params.region;
    case "regime":
      if (state.regime == null) return null;
      return state.regime === gate.params.value;
  }
}
