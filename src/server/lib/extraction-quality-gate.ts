/**
 * Wave 26 Pass L (2026-05-27) + W3.2 (2026-06-22) — Extraction quality gate.
 *
 * Post-extraction validator that flags two known under-extraction patterns
 * the manual transcript audit surfaced:
 *
 * 1. TRADE-EXAMPLE CONTAMINATION — steps that quote specific trade prices
 *    or pip targets instead of the generalized rule. Example from video
 *    FqxEKDxemtI: "Enter to 11028. Go for plus 20. Exit the rest of the
 *    trade over here." Those are USD/JPY-specific numbers from one example,
 *    not strategy rules.
 *
 * 2. SUSPICIOUS R VALUES — speaker says "1:2 R/R" (target = 2× stop) but
 *    gemma transcribes as 1.2 instead of 2.0. The 1:N pattern is the most
 *    common phrasing in trading content and gets misread routinely.
 *
 * Pure function. No I/O. No throw. Returns a structured warning report;
 * callers decide whether to log, surface to operator, or block.
 */

export interface Step {
  step?: number;
  action?: string;
  rationale?: string | null;
}

export interface StrategyForQuality {
  name?: string | null;
  entry_sequence?: Step[];
  source_claim_avg_r?: number | null;
}

export interface QualityWarning {
  field: string;
  severity: "warn" | "high";
  message: string;
  evidence?: string;
}

export interface QualityReport {
  strategyIndex: number;
  warnings: QualityWarning[];
  underExtracted: boolean; // overall flag — true when ≥50% of steps look like trade-example quotes
}

// ============================================================================
// Trade-example detection
// ============================================================================

/** Patterns that signal a step is quoting a specific live-trade walkthrough. */
const TRADE_EXAMPLE_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  // Specific price quotes: 4+ digit number with optional decimal (e.g. "11028", "1.0960", "14905")
  { name: "specific_price_4plus_digits", rx: /\b\d{4,}(?:\.\d+)?\b/ },
  // Pip increments: "+20 pips", "+15", "plus 20"
  { name: "pip_target_plus_n", rx: /\b(?:plus|target|exit|stop)\s+\d+(?:\s+pips?)?\b/i },
  { name: "pip_target_plus_n_paren", rx: /\+\d+(?:\s+pips?)?\b/i },
  // "go long/short over here" / "exit over here" — deictic pointing at chart
  { name: "deictic_over_here", rx: /\b(?:go\s+(?:long|short)|exit|enter|stop)\s+(?:over\s+)?here\b/i },
  // "at <price>" / "at the <number>"
  { name: "at_price_quote", rx: /\bat\s+\d{2,}(?:\.\d+)?\b/i },
];

/** Patterns that prove a step IS a real rule (immunizes against false-positive). */
const GENERALIZED_RULE_MARKERS: RegExp[] = [
  /\b(wait\s+for|look\s+for|when|if|once)\b/i,
  /\b(close|breaks?|retests?|sweeps?|tags?|touches?)\b/i,
  /\b(above|below|inside|outside|beyond|through)\s+(?:the|a)\b/i,
  /\b(VWAP|EMA|ATR|RSI|MACD|FVG|OB|POC|HOD|LOD|PDH|PDL|PMH|PML|band|level|zone|gap|swing|wick|candle|range|trend|bias)\b/i,
];

function stepLooksLikeTradeExample(text: string): { isExample: boolean; matchedPattern?: string } {
  if (!text || text.length < 5) return { isExample: false };
  // First, check generalized-rule markers — if the step contains the language
  // of a rule, it's unlikely to be a trade-example even if it also has a number.
  const hasRuleLanguage = GENERALIZED_RULE_MARKERS.some((rx) => rx.test(text));
  if (hasRuleLanguage) return { isExample: false };

  for (const { name, rx } of TRADE_EXAMPLE_PATTERNS) {
    if (rx.test(text)) return { isExample: true, matchedPattern: name };
  }
  return { isExample: false };
}

// ============================================================================
// Suspicious R-ratio detection
// ============================================================================

/** Returns warning text if the avg_r value is in a known-misread band. */
function inspectAvgR(avgR: number | null | undefined): QualityWarning | null {
  if (avgR === null || avgR === undefined) return null;
  // The "1:2 R/R" misread → 1.2 instead of 2.0.
  // Also catches "1:3" → 1.3, "1:5" → 1.5, "1:4" → 1.4.
  // R-values between 1.0 and 1.5 EXCLUSIVE are suspicious because real R-claims
  // are usually whole or half (1.0, 1.5, 2.0, 2.5, 3.0). Values like 1.2/1.3/1.4
  // strongly suggest "1:N" was misread as "1.N".
  if (avgR > 1.0 && avgR < 1.5 && avgR !== 1.0 && avgR !== 1.5) {
    return {
      field: "source_claim_avg_r",
      severity: "high",
      message: `avg_r=${avgR} is in the suspicious 1.0–1.5 band. The speaker likely said "1:${Math.round(avgR * 10) - 10}" (target = ${Math.round(avgR * 10) - 10}× stop) which gemma misread as ${avgR}. Verify against transcript — should probably be ${Math.round(avgR * 10) - 10}.0.`,
      evidence: `1:${Math.round(avgR * 10) - 10} → ${Math.round(avgR * 10) - 10}.0`,
    };
  }
  return null;
}

// ============================================================================
// Main entry point
// ============================================================================

// ============================================================================
// W3.2 — Compilability Gate (fail-closed extraction quarantine)
// ============================================================================
//
// An extraction PASSES the compilability gate only if ALL of the following hold:
//   1. entry_indicator or archetype is non-null
//   2. entry_params is non-empty (at least one key)
//   3. direction field is present and non-empty
//   4. timeframe field is present and non-empty
//   5. ≥1 real (source-extracted) confluence factor exists
//   6. coverage_verdict.verdict !== "coverage_failed" (W3.1 signal)
//
// When any condition fails → QUARANTINE.
// Quarantined extractions are routed to needs_archetype_queue for operator
// review; they do NOT graduate, do NOT pool into shared buckets.
//
// This is a pure function — no I/O, no LLM calls. Safe to unit-test.

export interface CompilabilityInput {
  /** The LLM's entry_indicator field (may be null/empty). */
  entry_indicator?: string | null;
  /** The LLM's archetype field (may be null/empty). */
  archetype?: string | null;
  /** The LLM's entry_params field. */
  entry_params?: Record<string, unknown> | null;
  /** The LLM's direction field. */
  direction?: string | null;
  /** The LLM's timeframe field. */
  timeframe?: string | null;
  /**
   * Confluence factors extracted directly by the LLM from the source
   * (before auto_floor injection). A factor tagged "auto_floor" in
   * factor_sources is NOT a real extracted factor — it was injected to
   * meet the ≥2 minimum floor and does not count as evidence here.
   *
   * Pass this as the raw LLM-extracted list (before classifyFactorSources).
   * If unknown, pass the full list — the gate applies a conservative
   * heuristic (any non-empty list counts).
   */
  confluence_factors?: string[] | null;
  /**
   * W3.1 coverage verdict — null means the gate did not run (pass through).
   * "coverage_failed" → quarantine.
   */
  coverage_verdict?: { verdict: "pass" | "coverage_failed" } | null;
}

export interface CompilabilityResult {
  /** true = extraction passes all gates and may graduate. false = quarantine. */
  compilable: boolean;
  /**
   * Which specific conditions failed. Empty when compilable === true.
   * Each entry is a machine-readable code that becomes the quarantine reason.
   */
  missing: string[];
  /** Human-readable summary for audit/logging. */
  reason: string | null;
}

/**
 * The placeholder value gemma4:e2b emits when extraction fails to name a strategy.
 * Any concept_name matching this sentinel causes the entry to be treated as a
 * failed extraction regardless of other fields.
 */
export const PLACEHOLDER_CONCEPT_NAMES = new Set<string>([
  "extracted_strategy",
  "extracted strategy",
  "strategy",
  "unknown_strategy",
  "unknown strategy",
  "trading strategy",
  "trading_strategy",
]);

/**
 * Pure-functional compilability gate. No I/O. No throws.
 *
 * Apply this BEFORE the graduation path. If compilable === false, route the
 * extraction to needs_archetype_queue and do NOT graduate.
 */
export function checkCompilabilityGate(
  input: CompilabilityInput,
  concept_name?: string | null,
): CompilabilityResult {
  const missing: string[] = [];

  // Gate 0: placeholder concept_name → treat as failed extraction
  if (concept_name && PLACEHOLDER_CONCEPT_NAMES.has(concept_name.trim().toLowerCase())) {
    missing.push("placeholder_concept_name");
  }

  // Gate 1: entry_indicator or archetype must be non-null / non-empty
  const hasEntryIndicator =
    typeof input.entry_indicator === "string" && input.entry_indicator.trim().length > 0;
  const hasArchetype =
    typeof input.archetype === "string" && input.archetype.trim().length > 0;
  if (!hasEntryIndicator && !hasArchetype) {
    missing.push("missing_entry_indicator_or_archetype");
  }

  // Gate 2: entry_params non-empty — REQUIRED ONLY when there is no entry_indicator/archetype.
  // FIX 7 (5-URL audit 2026-06-22): a named entry_indicator/archetype carries the entry logic;
  // the archetype handler + framework-overlay supply parameters. Requiring entry_params here
  // quarantined good archetype extractions (e.g. z3Qn volume_profile cleared coverage but failed
  // ONLY on empty params). entry_params is a fallback signal when no indicator/archetype exists.
  const params = input.entry_params;
  const hasParams =
    params !== null &&
    params !== undefined &&
    typeof params === "object" &&
    Object.keys(params).length > 0;
  if (!hasParams && !hasEntryIndicator && !hasArchetype) {
    missing.push("empty_entry_params");
  }

  // Gate 3: direction must be present and non-empty
  const hasDirection =
    typeof input.direction === "string" && input.direction.trim().length > 0;
  if (!hasDirection) {
    missing.push("missing_direction");
  }

  // Gate 4: timeframe must be present and non-empty
  const hasTimeframe =
    typeof input.timeframe === "string" && input.timeframe.trim().length > 0;
  if (!hasTimeframe) {
    missing.push("missing_timeframe");
  }

  // Gate 5: ≥1 real (source-extracted) confluence factor
  const factors = input.confluence_factors;
  const hasFactors =
    Array.isArray(factors) && factors.filter((f) => typeof f === "string" && f.trim().length > 0).length >= 1;
  if (!hasFactors) {
    missing.push("no_real_confluence_factors");
  }

  // Gate 6: coverage verdict must not be "coverage_failed"
  if (input.coverage_verdict?.verdict === "coverage_failed") {
    missing.push("coverage_failed");
  }

  const compilable = missing.length === 0;
  const reason = compilable
    ? null
    : `Extraction failed compilability gate: [${missing.join(", ")}]`;

  return { compilable, missing, reason };
}

// ============================================================================
// Main entry point (original)
// ============================================================================

export function checkExtractionQuality(strategies: StrategyForQuality[]): QualityReport[] {
  if (!Array.isArray(strategies)) return [];

  return strategies.map((s, idx) => {
    const warnings: QualityWarning[] = [];

    // 1. Trade-example contamination scan
    const steps = s.entry_sequence ?? [];
    let exampleCount = 0;
    for (const st of steps) {
      const text = `${st.action ?? ""} ${st.rationale ?? ""}`.trim();
      const result = stepLooksLikeTradeExample(text);
      if (result.isExample) {
        exampleCount++;
        warnings.push({
          field: `entry_sequence[${st.step ?? "?"}]`,
          severity: "warn",
          message: `Step looks like a trade-example quote (pattern=${result.matchedPattern}), not a generalized rule.`,
          evidence: text.slice(0, 200),
        });
      }
    }
    const underExtracted = steps.length > 0 && exampleCount / steps.length >= 0.5;
    if (underExtracted) {
      warnings.push({
        field: "entry_sequence",
        severity: "high",
        message: `${exampleCount} of ${steps.length} steps look like trade-example quotes. Strategy likely under-extracted — re-run extraction or operator review needed.`,
      });
    }

    // 2. Suspicious R-ratio
    const rWarn = inspectAvgR(s.source_claim_avg_r ?? null);
    if (rWarn) warnings.push(rWarn);

    return { strategyIndex: idx, warnings, underExtracted };
  });
}
