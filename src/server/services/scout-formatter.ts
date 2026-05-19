/**
 * Scout Formatter (Pass 4 Step 4)
 *
 * Pure helpers used by `agent-service.scoutIdeas()` for Tier-1 regex pre-filter
 * and premium pre-format on insert. No DB / no I/O — fully unit-testable.
 *
 * Consumers:
 *   - agent-service.scoutIdeas() — calls tier1RegexFilter() before sanitize,
 *     calls stripMarkdown() / generateOneSentenceLead() before journal insert.
 *
 * IMPORTANT: changes here affect every scouted idea written to system_journal.
 * The cleanedTitle is the PRIMARY display surface in the dashboard idea list;
 * raw_title is preserved for audit/debug only.
 */

export interface Tier1Decision {
  accept: boolean;
  reason: string;
}

/**
 * Tier-1 regex pre-filter for scout ideas. Cheap, deterministic, runs before
 * any LLM call so we never spend tokens auditing obvious garbage.
 *
 * Reject criteria (in order):
 *   1. description.length < 80                       → "description_too_short"
 *   2. title matches /^(generic|untitled|...)\b/i    → "placeholder_title"
 *   3. entry_rules matches /^see source for|^placeholder|^tbd$/i
 *                                                    → "placeholder_entry_rules"
 *   4. concept_name matches /_{4,}/                  → "auto_slug_concept_name"
 *   5. market_news_intel skips substance gate; strategy_candidate must mention
 *      at least one futures symbol, supported indicator, or strategy-mechanics
 *      term — otherwise "no_futures_or_strategy_substance"
 *
 * Returns { accept: true, reason: "passed" } when none of the above fire.
 */
const FUTURES_OR_STRATEGY_SUBSTANCE_RE =
  /\b(MES|MNQ|MCL|ES|NQ|CL|SPY|QQQ|micro futures?|e-?mini|crude oil|nasdaq|s&?p ?500|VWAP|RSI|SMA|EMA|MACD|ATR|Bollinger|Donchian|Keltner|ORB|opening range|breakout|mean[- ]reversion|momentum|trend[- ]follow|volatility expansion|backtest|hit rate|win rate|profit factor|sharpe|sortino|drawdown|stop[- ]loss|take[- ]profit|trailing stop|order block|FVG|ICT|SMC)\b/i;

export function tier1RegexFilter(idea: {
  title?: string;
  description?: string;
  entry_rules?: string;
  concept_name?: string;
  signal_type?: string;
}): Tier1Decision {
  const description = idea.description ?? "";
  if (description.length < 80) {
    return { accept: false, reason: "description_too_short" };
  }

  const title = idea.title ?? "";
  if (/^(generic|untitled|test|placeholder|todo|tbd)\b/i.test(title)) {
    return { accept: false, reason: "placeholder_title" };
  }

  if (idea.entry_rules) {
    if (/^see source for|^placeholder|^tbd$/i.test(idea.entry_rules)) {
      return { accept: false, reason: "placeholder_entry_rules" };
    }
  }

  if (idea.concept_name && /_{4,}/.test(idea.concept_name)) {
    return { accept: false, reason: "auto_slug_concept_name" };
  }

  // Mission-alignment gate: strategy_candidate ideas must mention at least one
  // futures market, supported indicator, or strategy-mechanics term. Without
  // this, scout pipelines silently fill the journal with off-topic blog URLs.
  // market_news_intel skips this gate (news context is allowed to be generic).
  // research_find skips this gate as well (research artifacts may discuss
  // methodology without naming an instrument yet).
  const signalType = idea.signal_type ?? "strategy_candidate";
  if (signalType === "strategy_candidate") {
    const haystack = `${title}\n${description}\n${idea.entry_rules ?? ""}\n${idea.concept_name ?? ""}`;
    if (!FUTURES_OR_STRATEGY_SUBSTANCE_RE.test(haystack)) {
      return { accept: false, reason: "no_futures_or_strategy_substance" };
    }
  }

  return { accept: true, reason: "passed" };
}

/**
 * Strip the 5 most-common markdown patterns we see in scout ideas. The
 * cleanedTitle is rendered verbatim in the dashboard list, so we want it
 * looking like a real headline, not a markdown source string.
 */
export function stripMarkdown(s: string): string {
  if (!s) return "";
  return s
    // ATX headings (#, ##, ### ...) at line start
    .replace(/^#{1,6}\s+/gm, "")
    // **bold**
    .replace(/\*\*(.*?)\*\*/g, "$1")
    // __bold__
    .replace(/__(.*?)__/g, "$1")
    // *italic* and _italic_
    .replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1$2$3")
    .replace(/(^|[^_])_([^_]+)_([^_]|$)/g, "$1$2$3")
    // `inline code`
    .replace(/`([^`]+)`/g, "$1")
    // [link text](url) → link text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

/**
 * Truncate a string to `n` chars at the last word boundary BEFORE `n`. Falls
 * back to a hard cut at `n` if the string has no whitespace in the first
 * `n` characters.
 */
export function smartTruncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  const slice = s.slice(0, n);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace <= 0) return slice;
  return slice.slice(0, lastSpace).trimEnd();
}

/**
 * Extract the first complete sentence (terminated by `.`, `!`, `?`) from
 * `s`. Truncated to 200 chars on a word boundary if the first sentence is
 * longer. If `s` has no sentence terminator, falls back to a 200-char
 * smart-truncate of `s`.
 *
 * Returns the empty string for empty / whitespace-only input.
 */
export function generateOneSentenceLead(s: string, max = 200): string {
  if (!s) return "";
  const cleaned = stripMarkdown(s).trim();
  if (cleaned.length === 0) return "";

  // Split on sentence terminator + whitespace; preserve the terminator
  // by matching it as a lookbehind boundary.
  const match = cleaned.match(/^(.*?[.!?])(\s|$)/);
  let lead: string;
  if (match && match[1]) {
    lead = match[1].trim();
  } else {
    // No terminator — use the whole cleaned string.
    lead = cleaned;
  }

  if (lead.length > max) {
    return smartTruncate(lead, max);
  }
  return lead;
}
