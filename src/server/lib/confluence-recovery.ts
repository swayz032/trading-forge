/**
 * Confluence Recovery (2026-06-23) — representational fix, NOT a gate change.
 *
 * The local model frequently files confirmations under `entry_sequence` (procedural channel)
 * instead of `confluence_factors` (evaluation channel). The dual-score diagnostic proved this is
 * representational: structurally-rich strategies (SY2 0→5, gdd 0→3, ktkqq 0→6, 75DJ 0→3) carry
 * 3-6 DISTINCT confluence categories in their step text while reporting 0 explicit confluences;
 * already-passing strategies (rf_/Fqx/iU8/z3Qn) are unchanged; the genuinely-thin N7uP stays at 1.
 *
 * This pass AUGMENTS (never replaces) the explicit confluences by scanning steps for DISTINCT
 * confluence CATEGORIES (families — so "50% fib" + "61.8% fib" + "golden pocket" = ONE fib_zone,
 * not three) and emitting them as provenance-tagged confluences `{name, source, evidence_step}`.
 * The gate is untouched: it still requires real confluences — we just read them from the field
 * the model actually used. Explicit confluences keep source="explicit"; recovered ones are
 * source="step_inferred" with the evidence step index, so explicit-vs-inferred stays auditable
 * and provides future retraining data.
 */

export interface RecoveredConfluence {
  name: string; // canonical 11-factor name (the evaluation vocabulary)
  category: string; // recovery family (fib_zone, liquidity, ...) for audit
  source: "explicit" | "step_inferred";
  evidence_step?: number; // 1-based step index the confluence was recovered from
}

// Small, STABLE recovery vocabulary (operator-specified). Each family is ONE unit regardless of
// how many steps cite it — category-dedup prevents verbose strategies from inflating their score.
const CATEGORY_PATTERNS: Array<{ category: string; canonical: string; rx: RegExp }> = [
  { category: "fib_zone",        canonical: "vp_level_proximity",       rx: /\bfib|fibonacci|optimum zone|golden pocket|0\.?25\b|0\.?50\b|0\.?75\b|0\.?618|\b25%|\b50%|\b75%|\b61\.8|retrace/i },
  { category: "liquidity",       canonical: "liquidity_target_clear",   rx: /liquidit|sweep|stop run|stop hunt|\braid\b|inducement/i },
  { category: "prior_level",     canonical: "liquidity_target_clear",   rx: /prior (day|daily|session|week)|\bpdh\b|\bpdl\b|\bpwh\b|\bpwl\b|naked poc|untouched|previous (day|session).{0,12}(high|low)/i },
  { category: "structure",       canonical: "market_structure_aligned", rx: /\bbos\b|choch|\bmss\b|break of structure|market structure|structural|trend(line| line)|higher (high|low)|lower (high|low)/i },
  { category: "order_block",     canonical: "market_structure_aligned", rx: /order block|\bob\b|supply zone|demand zone|supply and demand|\bfvg\b|fair value gap|imbalance/i },
  { category: "rejection",       canonical: "market_structure_aligned", rx: /rejection|reject|\bwick\b|pin bar|\btail\b|engulf/i },
  { category: "vwap",            canonical: "vwap_alignment",           rx: /vwap/i },
  { category: "premium_discount",canonical: "vwap_alignment",           rx: /premium|discount|equilibrium|dealing range|fair value|\b50% of (the )?range/i },
  { category: "vp_node",         canonical: "vp_level_proximity",       rx: /point of control|\bpoc\b|volume profile|\bhvn\b|\blvn\b|value area|\bvah\b|\bval\b/i },
  { category: "volume",          canonical: "delta_or_volume_signature",rx: /volume|delta|footprint|bookmap|depth of market|cumulative delta/i },
  { category: "moving_average",  canonical: "market_structure_aligned", rx: /moving average|\bema\b|\bsma\b|\b\d{1,3} ?(ema|sma|ma)\b|200 ?(day|period)|20 ?(day|period)/i },
  { category: "bollinger",       canonical: "vp_level_proximity",       rx: /bollinger|standard deviation band|\b[23] ?(std|sigma|standard deviation)/i },
  { category: "regime",          canonical: "regime_match",             rx: /killzone|kill zone|\bsession\b|new york|london|asian|\bregime\b|trending|consolidat/i },
];

export interface IdeaLike {
  entry_sequence?: Array<{ step?: number; action?: string; rationale?: string }> | unknown;
  confluences?: Array<Record<string, unknown>> | unknown;
  confluence_factors?: unknown;
  [k: string]: unknown;
}

/**
 * Augment `idea` in place with step-recovered confluences. Returns the recovery report for audit.
 * Idempotent: re-running adds nothing new (categories already present are skipped).
 */
export function recoverConfluences(idea: IdeaLike): {
  recovered: RecoveredConfluence[];
  explicit_count: number;
  effective_count: number;
} {
  const steps = Array.isArray(idea.entry_sequence) ? idea.entry_sequence : [];
  const explicitConfl = Array.isArray(idea.confluences) ? idea.confluences : [];
  const explicitFactors = Array.isArray(idea.confluence_factors)
    ? (idea.confluence_factors as unknown[]).filter((f) => typeof f === "string" && f.trim().length > 0).map(String)
    : [];

  // Categories already present (explicit) — never double-count a family.
  const present = new Set<string>();
  const canonicalPresent = new Set<string>(explicitFactors.map((f) => f.toLowerCase()));
  for (const c of explicitConfl) {
    const txt = String((c && typeof c === "object" ? (c as Record<string, unknown>).name : c) ?? "").toLowerCase();
    for (const { category, rx } of CATEGORY_PATTERNS) if (rx.test(txt)) present.add(category);
  }

  const recovered: RecoveredConfluence[] = [];
  // Track first matched category set to avoid re-matching the same family across multiple steps.
  const seenCategories = new Set<string>(present);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as { step?: number; action?: string; rationale?: string };
    const text = `${s?.action ?? ""} ${s?.rationale ?? ""}`;
    for (const { category, canonical, rx } of CATEGORY_PATTERNS) {
      if (seenCategories.has(category)) continue;
      if (rx.test(text)) {
        seenCategories.add(category);
        recovered.push({
          name: canonical,
          category,
          source: "step_inferred",
          evidence_step: typeof s?.step === "number" ? s.step : i + 1,
        });
      }
    }
  }

  // Augment idea: confluences objects (coverage gate FIX-13 counts these) + confluence_factors
  // strings (compilability Gate 5 counts these). Explicit factors preserved + canonical recovered
  // factors appended (deduped against what's already there).
  const newConflObjects = recovered.map((r) => ({
    name: r.category,
    description: `recovered from entry_sequence step ${r.evidence_step}`,
    source: r.source,
    evidence_step: r.evidence_step,
    canonical_factor: r.name,
  }));
  // Tag existing explicit confluences with provenance if untagged.
  const taggedExplicit = explicitConfl.map((c) =>
    c && typeof c === "object" && !(c as Record<string, unknown>).source
      ? { ...(c as Record<string, unknown>), source: "explicit" }
      : c,
  );
  idea.confluences = [...taggedExplicit, ...newConflObjects];

  const mergedFactors = [...explicitFactors];
  for (const r of recovered) {
    if (!canonicalPresent.has(r.name.toLowerCase())) {
      canonicalPresent.add(r.name.toLowerCase());
      mergedFactors.push(r.name);
    }
  }
  idea.confluence_factors = mergedFactors;

  return {
    recovered,
    explicit_count: explicitConfl.length,
    effective_count: (idea.confluences as unknown[]).length,
  };
}
