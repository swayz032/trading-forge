/**
 * Wave 26 Pass L (2026-05-27) — Extraction quality gate.
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
