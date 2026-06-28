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

export interface ContextGate {
  type: ContextGateType;
  name: string;
  required: boolean;
  representability: Representability;
  specificity: number;
  evidence_quote: string;
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
      params: gateBounds ? { bounds: gateBounds, anchor: anchorTf ? "htf_box" : undefined } : {},
    };
    add(g);
    if (g.required && (representability === "T3" || fuzzyZone)) {
      contradictions.push({ type: "CONTEXT_GATE_UNREPRESENTED", detail: `required zone gate "${g.name}" is fuzzy/unrepresentable (T3)` });
    }
  }

  // POI — named liquidity level (T2) or fuzzy (T3).
  for (const { re, name } of POI_LEVELS) {
    if (!re.test(text)) continue;
    const fuzzy = FUZZY_RE.test(text);
    const representability: Representability = fuzzy && name === "poi" ? "T3" : "T2";
    const g: ContextGate = {
      type: "poi", name, required: REQUIRED_RE.test(text), representability,
      specificity: gateSpecificity({ explicit_bounds: false, named_reference: true, timeframe_anchor: TF_RE.test(text), quantitative_rule: false }),
      evidence_quote: quote(re), params: { level: name, proximity_atr: 1.0 },
    };
    add(g);
    if (g.required && representability === "T3") contradictions.push({ type: "CONTEXT_GATE_UNREPRESENTED", detail: `required POI gate "${name}" is unrepresentable (T3)` });
  }

  // SESSION — computable time window (T1).
  for (const { re, region } of SESSION_RE) {
    if (!re.test(text)) continue;
    add({ type: "session", name: region, required: REQUIRED_RE.test(text), representability: "T1",
      specificity: gateSpecificity({ explicit_bounds: false, named_reference: true, timeframe_anchor: true, quantitative_rule: false }),
      evidence_quote: quote(re), params: { region } });
    break; // dominant session only
  }

  // REGIME — needs the regime classifier (T2).
  for (const { re, value } of REGIME_RE) {
    if (!re.test(text)) continue;
    add({ type: "regime", name: value, required: REQUIRED_RE.test(text), representability: "T2",
      specificity: gateSpecificity({ explicit_bounds: false, named_reference: true, timeframe_anchor: false, quantitative_rule: false }),
      evidence_quote: quote(re), params: { value } });
    break;
  }

  return { gates, contradictions };
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
