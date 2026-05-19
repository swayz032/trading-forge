/**
 * LLM Output Validator — C3 Prompt Injection Defense (W15 Team A)
 *
 * Validates LLM-generated DSL and strategy content before it reaches the
 * database or the Python compiler. Rejects out-of-band content that indicates
 * a successful prompt injection (unexpected tool calls, file references,
 * schema violations, or system prompt leakage).
 *
 * Checks performed:
 *   1. DSL schema conformance — required fields present, enums valid
 *   2. Out-of-band content detection — no file paths, tool calls, or system
 *      artifacts embedded in generated content
 *   3. Compiler round-trip validation — DSL is parsed through the Python
 *      compiler before storage (catches compile-time injection)
 *   4. Field-level content scan — each string field in the DSL is scanned for
 *      injection patterns (attack may survive the initial sanitizer if the LLM
 *      was coerced into echoing it back in a "legitimate" field)
 */

import { runPythonModule } from "../lib/python-runner.js";
import { logger } from "../lib/logger.js";

// ─── Out-of-Band Content Patterns ────────────────────────────────────────────

/**
 * Patterns that indicate a successful injection — the LLM was manipulated
 * into including content it should never generate for a trading DSL.
 */
const OUT_OF_BAND_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // File system references — injection succeeded if the model is "reading" files
  { name: "file_path_reference", regex: /(?:^|\s)(\/etc\/|\/proc\/|C:\\Windows\\|~\/\.ssh\/)/i },
  { name: "file_path_reference", regex: /\.\.\//g },
  { name: "file_path_reference", regex: /\bopen\s*\(\s*["'][^"']{5,}["']\s*[,)]/i },

  // Unexpected tool-call artifacts — the LLM is calling tools it shouldn't
  { name: "tool_call_artifact", regex: /<tool_call>|<\/tool_call>|<tool_result>/i },
  { name: "tool_call_artifact", regex: /"type"\s*:\s*"function".*?"name"\s*:\s*"(?!compile_strategy)/i },
  { name: "tool_call_artifact", regex: /\bfunction_call\s*[:=]\s*\{/i },

  // System prompt echoing — the model repeated back its own instructions
  { name: "system_prompt_echo", regex: /you\s+are\s+(a\s+)?(?:trading\s+forge|an?\s+ai\s+assistant|a\s+large\s+language\s+model)/i },
  { name: "system_prompt_echo", regex: /my\s+(system\s+)?instructions?\s+(are|say|tell\s+me)/i },
  { name: "system_prompt_echo", regex: /as\s+per\s+my\s+(system\s+)?prompt/i },

  // Network/exec injection — model was told to "call out"
  { name: "network_injection", regex: /\bfetch\s*\(\s*["']https?:\/\//i },
  { name: "network_injection", regex: /\brequests?\.(get|post|put)\s*\(/i },
  { name: "network_injection", regex: /import\s+subprocess/i },
  { name: "network_injection", regex: /os\.(system|exec|popen)\s*\(/i },

  // Credential exfiltration patterns
  { name: "credential_exfil", regex: /(?:api_?key|secret|token|password|auth)\s*=\s*["'][A-Za-z0-9+/]{20,}/i },

  // Override instructions echoed into output
  { name: "injected_override", regex: /ignore\s+(all\s+)?(previous|prior)\s+(instructions?|rules?)/i },
  { name: "injected_override", regex: /\bDAN\b.*?(?:do\s+anything|without\s+restriction)/i },
];

// ─── DSL Field Schema ─────────────────────────────────────────────────────────

const DSL_REQUIRED_FIELDS = [
  "name", "description", "symbol", "timeframe", "direction",
  "entry_type", "entry_indicator", "entry_params", "entry_condition",
  "exit_type", "exit_params", "stop_loss_atr_multiple",
] as const;

const DSL_VALID_SYMBOLS = ["MES", "MNQ", "MCL"] as const;
const DSL_VALID_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
const DSL_VALID_DIRECTIONS = ["long", "short", "both"] as const;
const DSL_VALID_ENTRY_TYPES = [
  "breakout", "mean_reversion", "trend_follow",
  "volatility_expansion", "session_pattern", "event_driven",
] as const;
const DSL_VALID_ENTRY_INDICATORS = [
  "sma_crossover", "ema_crossover", "rsi_reversal", "bollinger_breakout",
  "atr_breakout", "vwap_reversion", "donchian_breakout", "keltner_squeeze",
  "session_open_breakout", "macd_crossover", "vwap_fade", "event_driven_fade",
  "overnight_drift",
] as const;
const DSL_VALID_EXIT_TYPES = [
  "fixed_target", "trailing_stop", "time_exit", "indicator_signal", "atr_multiple",
] as const;

// ─── Public Interface ─────────────────────────────────────────────────────────

export interface ValidateOutputResult {
  passed: boolean;
  reasons: string[];               // human-readable rejection reasons
  outOfBandDetections: string[];   // detected out-of-band content types
  schemaErrors: string[];          // DSL schema validation errors
  compileErrors?: string[];        // Python compiler errors (if compile attempted)
}

/**
 * Validate a raw LLM text response for out-of-band content.
 * Call this on the raw string before parsing JSON.
 */
export function validateRawLLMResponse(rawText: string): {
  passed: boolean;
  detections: Array<{ name: string; snippet: string }>;
} {
  const detections: Array<{ name: string; snippet: string }> = [];

  for (const pattern of OUT_OF_BAND_PATTERNS) {
    const match = pattern.regex.exec(rawText);
    if (match) {
      const start = Math.max(0, match.index - 80);
      const end = Math.min(rawText.length, match.index + match[0].length + 80);
      const snippet = rawText.slice(start, end).replace(/\n/g, " ").slice(0, 160);
      detections.push({ name: pattern.name, snippet });
    }
  }

  return { passed: detections.length === 0, detections };
}

/**
 * Validate a parsed DSL object:
 *   1. Schema field presence and enum conformance
 *   2. String field content scan for injected patterns
 *   3. Compiler round-trip validation (optional — set skipCompile for speed)
 */
export async function validateDSLOutput(
  dsl: Record<string, unknown>,
  opts: { skipCompile?: boolean; source?: string } = {},
): Promise<ValidateOutputResult> {
  const reasons: string[] = [];
  const outOfBandDetections: string[] = [];
  const schemaErrors: string[] = [];

  // ── 1. Required field presence ───────────────────────────────────────────
  for (const field of DSL_REQUIRED_FIELDS) {
    if (!(field in dsl) || dsl[field] === null || dsl[field] === undefined) {
      schemaErrors.push(`missing required field: ${field}`);
    }
  }

  // ── 2. Enum conformance ──────────────────────────────────────────────────
  const symbol = String(dsl.symbol ?? "");
  if (symbol && !DSL_VALID_SYMBOLS.includes(symbol as any)) {
    schemaErrors.push(`invalid symbol "${symbol}" — must be one of ${DSL_VALID_SYMBOLS.join(", ")}`);
  }

  const timeframe = String(dsl.timeframe ?? "");
  if (timeframe && !DSL_VALID_TIMEFRAMES.includes(timeframe as any)) {
    schemaErrors.push(`invalid timeframe "${timeframe}" — must be one of ${DSL_VALID_TIMEFRAMES.join(", ")}`);
  }

  const direction = String(dsl.direction ?? "");
  if (direction && !DSL_VALID_DIRECTIONS.includes(direction as any)) {
    schemaErrors.push(`invalid direction "${direction}" — must be one of ${DSL_VALID_DIRECTIONS.join(", ")}`);
  }

  const entryType = String(dsl.entry_type ?? "");
  if (entryType && !DSL_VALID_ENTRY_TYPES.includes(entryType as any)) {
    schemaErrors.push(`invalid entry_type "${entryType}"`);
  }

  const entryIndicator = String(dsl.entry_indicator ?? "");
  if (entryIndicator && !DSL_VALID_ENTRY_INDICATORS.includes(entryIndicator as any)) {
    schemaErrors.push(`invalid entry_indicator "${entryIndicator}"`);
  }

  const exitType = String(dsl.exit_type ?? "");
  if (exitType && !DSL_VALID_EXIT_TYPES.includes(exitType as any)) {
    schemaErrors.push(`invalid exit_type "${exitType}"`);
  }

  // Numeric range: stop_loss_atr_multiple must be 0.5-5.0
  const sl = Number(dsl.stop_loss_atr_multiple);
  if (!isNaN(sl) && (sl < 0.5 || sl > 5.0)) {
    schemaErrors.push(`stop_loss_atr_multiple ${sl} out of range [0.5, 5.0]`);
  }

  // entry_params: max 5 keys
  if (typeof dsl.entry_params === "object" && dsl.entry_params !== null) {
    const keyCount = Object.keys(dsl.entry_params).length;
    if (keyCount > 5) {
      schemaErrors.push(`entry_params has ${keyCount} keys — max allowed is 5`);
    }
  }

  // ── 3. String field content scan ─────────────────────────────────────────
  const stringFields = ["name", "description", "entry_condition", "entry_type", "exit_type"];
  for (const field of stringFields) {
    const val = String(dsl[field] ?? "");
    if (!val) continue;
    const { detections } = validateRawLLMResponse(val);
    for (const d of detections) {
      outOfBandDetections.push(`field "${field}": ${d.name}`);
    }
  }

  // ── 4. Compiler round-trip (unless skipped) ──────────────────────────────
  let compileErrors: string[] | undefined;
  const hasSchemaErrors = schemaErrors.length > 0;
  const hasOutOfBand = outOfBandDetections.length > 0;

  if (!opts.skipCompile && !hasSchemaErrors && !hasOutOfBand) {
    try {
      await runPythonModule({
        module: "src.engine.compiler.compiler",
        args: ["--action", "compile"],
        config: dsl,
        componentName: "llm-output-validator-compile",
        timeoutMs: 15_000,
      });
      // If compile succeeds, DSL is syntactically valid — no additional errors
    } catch (err: any) {
      const rawErrors: unknown = err?.errors;
      compileErrors = Array.isArray(rawErrors)
        ? rawErrors.map(String)
        : [err?.message ?? String(err)];
    }
  }

  // ── Aggregate reasons ────────────────────────────────────────────────────
  if (schemaErrors.length > 0) {
    reasons.push(...schemaErrors.map((e) => `schema: ${e}`));
  }
  if (outOfBandDetections.length > 0) {
    reasons.push(...outOfBandDetections.map((d) => `out-of-band: ${d}`));
  }
  if (compileErrors && compileErrors.length > 0) {
    reasons.push(...compileErrors.map((e) => `compile: ${e}`));
  }

  const passed = reasons.length === 0;

  if (!passed) {
    logger.warn(
      {
        source: opts.source,
        dslName: dsl.name,
        reasons: reasons.slice(0, 10),
        schemaErrorCount: schemaErrors.length,
        outOfBandCount: outOfBandDetections.length,
        compileErrorCount: compileErrors?.length ?? 0,
      },
      "llm-output-validator: DSL validation failed",
    );
  } else {
    logger.debug(
      { source: opts.source, dslName: dsl.name },
      "llm-output-validator: DSL passed validation",
    );
  }

  return { passed, reasons, outOfBandDetections, schemaErrors, compileErrors };
}
