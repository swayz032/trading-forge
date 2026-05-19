/**
 * LLM Input Sanitizer — C3 Prompt Injection Defense (W15 Team A)
 *
 * Strips adversarial content from scout-fetched external content before it
 * reaches any LLM prompt. Defends against OWASP LLM01: Prompt Injection.
 *
 * Attack categories addressed:
 *   LLM01-A  Direct injection: imperative override phrases
 *   LLM01-B  Indirect injection: embedded HTML/script tags in web-scraped text
 *   LLM01-C  Role override: "you are now", "act as", "your new persona"
 *   LLM01-D  System prompt leakage: "print your instructions", "reveal prompt"
 *   LLM01-E  Data exfiltration: base64-encoded payloads, URL-encoded overrides
 *   LLM01-F  Delimiter attacks: fake <|im_start|>, [INST], <<SYS>> tokens
 *
 * Design constraints:
 *   - Pure TypeScript, no paid deps
 *   - All detections are logged to db as llm_injection_attempts rows
 *   - Logging is fire-and-forget (never raises, never blocks the pipeline)
 *   - Sanitized content is safe to pass to Ollama / GPT-5-mini prompts
 */

import { db } from "../db/index.js";
import { llmInjectionAttempts } from "../db/schema.js";
import { logger } from "../lib/logger.js";

// ─── Detection Patterns ───────────────────────────────────────────────────────

/**
 * Each pattern entry has a human-readable name (injection_type), the regex
 * that triggers it, and the severity to record.
 *
 * Ordering matters: highest-risk patterns first so the first match logged is
 * the most dangerous one when content triggers multiple.
 */
interface InjectionPattern {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  regex: RegExp;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // ── Critical: direct override instructions ───────────────────────────────
  {
    type: "override_instructions",
    severity: "critical",
    regex: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|constraints?|guidelines?)/i,
  },
  {
    type: "override_instructions",
    severity: "critical",
    regex: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|constraints?)/i,
  },
  {
    type: "override_instructions",
    severity: "critical",
    regex: /forget\s+(everything|all\s+previous|your\s+instructions?|your\s+training)/i,
  },
  {
    type: "system_prompt_override",
    severity: "critical",
    regex: /\bnew\s+(system\s+)?prompt\s*[:=]/i,
  },
  {
    type: "system_prompt_override",
    severity: "critical",
    regex: /\byour\s+(new\s+)?(instructions?|rules?|directives?|objectives?)\s+(are|is)\s*[:=]/i,
  },

  // ── Critical: role hijacking ─────────────────────────────────────────────
  {
    type: "role_override",
    severity: "critical",
    regex: /\byou\s+are\s+now\s+(a\s+|an\s+)?(new|different|another|modified|unrestricted)/i,
  },
  {
    type: "role_override",
    severity: "critical",
    regex: /act\s+as\s+(if\s+)?(you\s+are\s+)?(an?\s+)?(unrestricted|jailbroken|uncensored|unfiltered|dan\b|evil|malicious)/i,
  },
  {
    type: "role_override",
    severity: "critical",
    regex: /\bDAN\b.*?(do\s+anything\s+now|without\s+restrictions)/i,
  },
  {
    type: "role_override",
    severity: "critical",
    regex: /pretend\s+(you\s+are|to\s+be)\s+(an?\s+)?(ai|llm|assistant|model)\s+(without|that\s+has\s+no)/i,
  },

  // ── High: model token delimiter injection ────────────────────────────────
  {
    type: "delimiter_injection",
    severity: "high",
    regex: /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/i,
  },
  {
    type: "delimiter_injection",
    severity: "high",
    regex: /\[INST\]|\[\/INST\]|<<SYS>>|<<\/SYS>>/,
  },
  {
    type: "delimiter_injection",
    severity: "high",
    regex: /\[SYSTEM\]|\[USER\]|\[ASSISTANT\]|\[\/SYSTEM\]/i,
  },
  {
    type: "delimiter_injection",
    severity: "high",
    regex: /###\s*(system|instruction|human|assistant)\s*:/i,
  },

  // ── High: prompt/instruction leakage attempts ────────────────────────────
  {
    type: "prompt_leakage",
    severity: "high",
    regex: /print\s+(out\s+|your\s+)?(the\s+|all\s+)?(full\s+)?(system\s+)?prompt/i,
  },
  {
    type: "prompt_leakage",
    severity: "high",
    regex: /reveal\s+(your\s+)?(system\s+)?(prompt|instructions?|training|context)/i,
  },
  {
    type: "prompt_leakage",
    severity: "high",
    regex: /show\s+me\s+(your\s+)?(system\s+prompt|initial\s+instructions?|hidden\s+instructions?)/i,
  },
  {
    type: "prompt_leakage",
    severity: "high",
    regex: /what\s+(are\s+)?(your\s+)?(secret\s+)?(instructions?|system\s+prompt|rules?)/i,
  },
  {
    type: "prompt_leakage",
    severity: "high",
    regex: /reveal\s+(your\s+)?(hidden|secret|initial|system)\s+(instructions?|prompt|directives?)/i,
  },

  // ── High: data exfiltration via encoding ─────────────────────────────────
  {
    type: "encoded_payload",
    severity: "high",
    // Base64 blocks > 60 chars suggesting encoded commands
    regex: /[A-Za-z0-9+/]{60,}={0,2}(?=\s|$)/,
  },
  {
    type: "encoded_payload",
    severity: "high",
    // URL-encoded angle brackets suggest embedded HTML injection
    regex: /%3C(script|iframe|object|embed|link)%3E/i,
  },

  // ── High: HTML/script injection ──────────────────────────────────────────
  {
    type: "html_injection",
    severity: "high",
    regex: /<script[\s>]|<\/script>/i,
  },
  {
    type: "html_injection",
    severity: "high",
    regex: /<iframe[\s>]|<object[\s>]|<embed[\s>]/i,
  },
  {
    type: "html_injection",
    severity: "high",
    regex: /javascript\s*:/i,
  },
  {
    type: "html_injection",
    severity: "high",
    regex: /on(load|error|click|mouseover|submit|focus)\s*=/i,
  },

  // ── Medium: indirect/indirect injection via fake context ─────────────────
  {
    type: "context_fabrication",
    severity: "medium",
    regex: /\[context\s+update\]|\[important\s+override\]|\[administrator\s+note\]/i,
  },
  {
    type: "context_fabrication",
    severity: "medium",
    regex: /\bnote\s+to\s+(the\s+)?(ai|llm|assistant|model|system)\s*:/i,
  },
  {
    type: "context_fabrication",
    severity: "medium",
    regex: /\battention\s+(ai|llm|assistant|model|gpt|claude|ollama)\s*:/i,
  },

  // ── Medium: jailbreak social engineering ─────────────────────────────────
  {
    type: "jailbreak_social",
    severity: "medium",
    regex: /in\s+(this|a)\s+(hypothetical|fictional|simulation|game)\s+(scenario|context|world).*?(ignore|bypass|override)/i,
  },
  {
    type: "jailbreak_social",
    severity: "medium",
    regex: /for\s+(educational|research|fictional|hypothetical)\s+purposes?\s+(only\s+)?[:,]\s*(ignore|bypass|provide)/i,
  },

  // ── Low: suspicious markdown structural attacks ───────────────────────────
  {
    type: "markdown_injection",
    severity: "low",
    regex: /^---\s*\n.*?(system|prompt|instruction).*?\n---\s*$/ms,
  },
  {
    type: "markdown_injection",
    severity: "low",
    // Excessive repeated markdown separators (often used to trick parsers)
    regex: /(?:---\s*){4,}/,
  },
];

// ─── Sanitization Transforms ──────────────────────────────────────────────────

/** Strip known injection phrases without destroying surrounding context. */
function stripImperativeOverrides(text: string): string {
  return text
    // Remove the specific override phrases while keeping surrounding text readable
    .replace(/ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|constraints?|guidelines?)[^.!?]*/gi, "[CONTENT REMOVED]")
    .replace(/disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|constraints?)[^.!?]*/gi, "[CONTENT REMOVED]")
    .replace(/forget\s+(everything|all\s+previous|your\s+instructions?|your\s+training)[^.!?]*/gi, "[CONTENT REMOVED]")
    .replace(/\bnew\s+(system\s+)?prompt\s*[:=][^\n]*/gi, "[CONTENT REMOVED]")
    .replace(/\byour\s+(new\s+)?(instructions?|rules?|directives?|objectives?)\s+(are|is)\s*[:=][^\n]*/gi, "[CONTENT REMOVED]")
    .replace(/act\s+as\s+(if\s+)?(you\s+are\s+)?(an?\s+)?(unrestricted|jailbroken|uncensored|unfiltered|dan\b|evil|malicious)[^.!?]*/gi, "[CONTENT REMOVED]")
    .replace(/\bDAN\b.*?(?:do\s+anything\s+now|without\s+restrictions)[^.!?]*/gi, "[CONTENT REMOVED]")
    .replace(/\byou\s+are\s+now\s+(a\s+|an\s+)?(new|different|another|modified|unrestricted)[^\n]*/gi, "[CONTENT REMOVED]");
}

/** Strip HTML/script injection markers. */
function stripHtmlInjection(text: string): string {
  return text
    // Remove script and dangerous HTML tags entirely
    .replace(/<script[\s\S]*?<\/script>/gi, "[SCRIPT REMOVED]")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "[IFRAME REMOVED]")
    .replace(/<(object|embed|link|meta)[^>]*>/gi, "[TAG REMOVED]")
    // Remove event handlers on any remaining tags
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, "")
    // Remove javascript: protocol
    .replace(/javascript\s*:[^\s"'<>]*/gi, "[JS REMOVED]")
    // Decode and strip URL-encoded angle brackets used to bypass HTML filters
    .replace(/%3C(script|iframe|object|embed|link)%3E/gi, "[ENCODED TAG REMOVED]");
}

/** Strip model delimiter injection tokens. */
function stripDelimiterTokens(text: string): string {
  return text
    .replace(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/gi, "[TOKEN REMOVED]")
    .replace(/\[INST\]|\[\/INST\]/g, "[TOKEN REMOVED]")
    .replace(/<<SYS>>|<<\/SYS>>/g, "[TOKEN REMOVED]")
    .replace(/\[SYSTEM\]|\[USER\]|\[ASSISTANT\]|\[\/SYSTEM\]/gi, "[TOKEN REMOVED]")
    .replace(/###\s*(system|instruction|human|assistant)\s*:/gi, "[TOKEN REMOVED]:");
}

/** Strip fabricated context headers. */
function stripContextFabrication(text: string): string {
  return text
    .replace(/\[context\s+update\]/gi, "[REMOVED]")
    .replace(/\[important\s+override\]/gi, "[REMOVED]")
    .replace(/\[administrator\s+note\]/gi, "[REMOVED]")
    .replace(/\bnote\s+to\s+(the\s+)?(ai|llm|assistant|model|system)\s*:[^\n]*/gi, "[REMOVED]")
    .replace(/\battention\s+(ai|llm|assistant|model|gpt|claude|ollama)\s*:[^\n]*/gi, "[REMOVED]");
}

// ─── Public Interface ─────────────────────────────────────────────────────────

export interface SanitizeOptions {
  source: string;         // e.g. "reddit", "brave", "tavily", "youtube"
  sourceUrl?: string;     // original URL of the content
  maxLength?: number;     // truncate content to this length (default: 8000)
}

export interface SanitizeResult {
  sanitized: string;
  detections: Array<{
    type: string;
    severity: "critical" | "high" | "medium" | "low";
    snippet: string;      // first 200 chars around the match
  }>;
  wasModified: boolean;
  blocked: boolean;       // true if content contained critical/high severity
}

/**
 * Sanitize external content before passing to an LLM prompt.
 *
 * Strips known injection patterns, logs attempts to the DB (fire-and-forget),
 * and returns both the sanitized text and a list of detections.
 *
 * The `blocked` flag in the result signals that the content contained
 * critical or high severity patterns. Callers SHOULD skip LLM processing
 * for blocked content (the sanitized text still exists as a fallback for
 * journaling, but it should not become an LLM prompt).
 */
export async function sanitizeExternalContent(
  rawContent: string,
  opts: SanitizeOptions,
): Promise<SanitizeResult> {
  const maxLen = opts.maxLength ?? 8_000;
  // Truncate before analysis to limit regex backtracking on enormous payloads
  const truncated = rawContent.slice(0, maxLen);

  // ── Detection pass ───────────────────────────────────────────────────────
  const detections: SanitizeResult["detections"] = [];
  let highestSeverity: "critical" | "high" | "medium" | "low" | null = null;

  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.regex.exec(truncated);
    if (match) {
      // Collect snippet context (100 chars before + 100 chars after match)
      const start = Math.max(0, match.index - 100);
      const end = Math.min(truncated.length, match.index + match[0].length + 100);
      const snippet = truncated.slice(start, end).replace(/\n/g, " ").slice(0, 200);

      detections.push({ type: pattern.type, severity: pattern.severity, snippet });

      // Track highest severity seen
      const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
      if (
        highestSeverity === null ||
        severityRank[pattern.severity] > severityRank[highestSeverity]
      ) {
        highestSeverity = pattern.severity;
      }
    }
  }

  // ── Sanitization pass ────────────────────────────────────────────────────
  let sanitized = truncated;
  if (detections.length > 0) {
    sanitized = stripImperativeOverrides(sanitized);
    sanitized = stripHtmlInjection(sanitized);
    sanitized = stripDelimiterTokens(sanitized);
    sanitized = stripContextFabrication(sanitized);
  }

  const wasModified = sanitized !== truncated;
  const blocked = highestSeverity === "critical" || highestSeverity === "high";

  // ── Structured log ───────────────────────────────────────────────────────
  if (detections.length > 0) {
    logger.warn(
      {
        source: opts.source,
        sourceUrl: opts.sourceUrl,
        detectionCount: detections.length,
        highestSeverity,
        blocked,
        types: [...new Set(detections.map((d) => d.type))],
      },
      "llm-input-sanitizer: injection detected",
    );
  }

  // ── Persist to DB (fire-and-forget) ─────────────────────────────────────
  if (detections.length > 0) {
    const firstDetection = detections[0];
    db.insert(llmInjectionAttempts)
      .values({
        source: opts.source,
        sourceUrl: opts.sourceUrl ?? null,
        contentSnippet: firstDetection.snippet,
        injectionType: detections.map((d) => d.type).join(","),
        severity: highestSeverity ?? "low",
        blocked,
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "llm-input-sanitizer: failed to persist injection attempt (non-blocking)");
      });
  }

  return { sanitized, detections, wasModified, blocked };
}

/**
 * Batch-sanitize an array of content strings (e.g., search result snippets).
 * Returns sanitized versions and aggregate detection stats.
 */
export async function sanitizeBatch(
  items: Array<{ content: string; sourceUrl?: string }>,
  opts: Omit<SanitizeOptions, "sourceUrl">,
): Promise<{
  items: Array<{ sanitized: string; blocked: boolean; detectionCount: number }>;
  totalDetections: number;
  totalBlocked: number;
}> {
  const results = await Promise.all(
    items.map((item) =>
      sanitizeExternalContent(item.content, { ...opts, sourceUrl: item.sourceUrl }),
    ),
  );

  return {
    items: results.map((r) => ({
      sanitized: r.sanitized,
      blocked: r.blocked,
      detectionCount: r.detections.length,
    })),
    totalDetections: results.reduce((sum, r) => sum + r.detections.length, 0),
    totalBlocked: results.filter((r) => r.blocked).length,
  };
}
