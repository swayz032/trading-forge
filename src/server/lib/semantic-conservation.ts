/**
 * SEMANTIC CONSERVATION — Checkpoint 2 (the headline metric).
 *
 * Operator rule: every instructional unit must have EXACTLY ONE disposition — never "vanished".
 *   EXECUTED            — represented in the IR (became a node)
 *   NORMALIZED          — same meaning as an executed node, different wording (synonym/umbrella fold)
 *   IGNORED_WITH_REASON — deliberately not executable (promotion / psychology / instrument / tool / …)
 *   (silent_loss)       — none of the above → HARD FAIL (the thing CP2 exists to make impossible)
 *
 * This makes silent loss structurally detectable. It will outlast blind grading because it answers a
 * different question: not "is the strategy faithful?" but "did we ACCOUNT FOR everything the educator said?".
 * Pure / deterministic. Input = the transcript-derived instruction inventory (`_coverage_speaker_items`).
 */

export type IgnoreReason =
  | "promotion" | "psychology" | "anecdote" | "instrument" | "tool"
  | "output_stat" | "education" | "metadata" | "risk_overlay_owned" | "selection_filter";

export type Disposition =
  | { kind: "EXECUTED" }
  | { kind: "NORMALIZED"; of: string }
  | { kind: "IGNORED_WITH_REASON"; reason: IgnoreReason };

export interface SpeakerItem { name: string; verbatim_quote?: string; emphasis_level?: string }
export interface ConservedItem { item: SpeakerItem; disposition: Disposition | null } // null = silent loss

export interface ConservationResult {
  total: number;
  executed: number;
  normalized: number;
  ignored: number;
  silent_loss: SpeakerItem[];
  coverage_pct: number; // (total - silent_loss) / total — fraction ACCOUNTED FOR (not fraction executed)
  items: ConservedItem[];
}

// ── ignore-reason matchers (from the role-taxonomy unclassifiable buckets) ──────
const IGNORE_MATCHERS: Array<{ reason: IgnoreReason; re: RegExp }> = [
  { reason: "promotion", re: /\b(discount code|promo|sign ?up|join (?:my|the)|course|mentorship|link in (?:the )?(?:bio|description)|free (?:webinar|class)|prop ?firm (?:ad|deal)|funded program)\b/i },
  { reason: "psychology", re: /\b(mindset|discipline|patience|emotion|fear|greed|accept (?:the )?risk|conviction|psychology|don'?t (?:be )?(?:greedy|emotional)|trust the process|stay calm)\b/i },
  { reason: "output_stat", re: /\b(win[- ]?rate|risk[- ]?(?:to[- ]?)?reward|r:?r\b|profit factor|expectancy|average (?:r|win|loss)|hit rate)\b/i },
  { reason: "instrument", re: /\b(s&p|nasdaq|dow|russell|\bes\b|\bnq\b|\bcl\b|\bmes\b|\bmnq\b|\bmcl\b|eur\/?usd|gbp|bitcoin|btc|gold|crude|ticker|symbol)\b/i },
  { reason: "tool", re: /\b(bookmap|ninja ?trader|trading ?view|thinkorswim|tradovate|sierra ?chart|meta ?trader|mt4|mt5|\btool\b|indicator (?:setup|install)|add (?:the )?(?:vwap|ema|macd|bollinger|fib)|platform|charting software|watchlist)\b/i },
  // indicator ANATOMY (sub-components of a stated indicator) — framework owns the indicator; the parts are not separate mechanics
  { reason: "education", re: /\b(margin|leverage|notional|tick size|contract (?:spec|size|value)|expiry|settlement|what is a future|how futures work|point value|rollover|profit and loss|signal line|histogram|zero line|middle line|upper (?:and lower )?band|lower band|the band)\b/i },
  // metadata incl. SPELLED-OUT timeframes ("five minute opening range", "hourly chart", "one minute charts")
  { reason: "metadata", re: /\b((?:one|two|three|five|ten|fifteen|thirty|sixty|\d+)[- ]?(?:hour|hourly|hr|minute|min|day|week)|hourly chart|on the \d+m?)\b/i },
  { reason: "risk_overlay_owned", re: /\b(position siz|risk per trade|max (?:contracts|risk|trades)|lot size|how many contracts)\b|\b\d+\s?%/i },
  { reason: "selection_filter", re: /\b(only trade|don'?t trade|avoid (?:trading|the)|stay away|no[- ]trade|skip (?:the|this)|leading (?:gainers|movers)|most volatile|focus on)\b/i },
];

export function classifyIgnoreReason(text: string): IgnoreReason | null {
  const t = text || "";
  for (const m of IGNORE_MATCHERS) if (m.re.test(t)) return m.reason;
  return null;
}

/** Normalize a concept name for synonym/umbrella matching (mirrors the comparator's dedup intent). */
function normKey(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(strategy|setup|zone|zones|level|levels|trading|the|a|an|of|s)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

/**
 * Assign every speaker_item exactly one disposition.
 * @param coveredNames  names the existing comparator matched into the representation (covered ∪ shallow)
 *                      → these are EXECUTED.
 * Items NOT covered: NORMALIZED if a synonym of a covered item; else IGNORED_WITH_REASON if classifiable;
 * else silent_loss (HARD FAIL via conserveOrThrow).
 */
export function checkSemanticConservation(speakerItems: SpeakerItem[], coveredNames: string[]): ConservationResult {
  const coveredKeys = new Set(coveredNames.map(normKey));
  const covered = new Set(coveredNames.map((n) => n.toLowerCase()));
  const items: ConservedItem[] = [];
  let executed = 0, normalized = 0, ignored = 0;
  const silent_loss: SpeakerItem[] = [];

  for (const it of speakerItems) {
    const nameLc = (it.name || "").toLowerCase();
    const k = normKey(it.name);
    // 1) EXECUTED — the item itself is directly represented (exact name match)
    if (covered.has(nameLc)) { items.push({ item: it, disposition: { kind: "EXECUTED" } }); executed++; continue; }
    // 2) NORMALIZED — reworded synonym/umbrella of something executed (normKey match). Checked BEFORE ignore so
    //    a real mechanic we DID capture is never mis-bucketed as noise.
    const syn = k ? [...coveredKeys].find((ck) => ck.length > 2 && (ck === k || ck.includes(k) || k.includes(ck))) : undefined;
    if (syn) { items.push({ item: it, disposition: { kind: "NORMALIZED", of: syn } }); normalized++; continue; }
    // 3) IGNORED_WITH_REASON — deliberately non-executable (promo/psych/instrument/tool/…)
    const reason = classifyIgnoreReason(`${it.name} ${it.verbatim_quote ?? ""}`);
    if (reason) { items.push({ item: it, disposition: { kind: "IGNORED_WITH_REASON", reason } }); ignored++; continue; }
    // 4) VANISHED → silent loss → hard fail
    items.push({ item: it, disposition: null }); silent_loss.push(it);
  }

  const total = speakerItems.length;
  return { total, executed, normalized, ignored, silent_loss, items, coverage_pct: total ? (total - silent_loss.length) / total : 1 };
}

/** CP2 contract: fail HARD on silent loss. Returns the result if conserved, throws otherwise. */
export function conserveOrThrow(result: ConservationResult): ConservationResult {
  if (result.silent_loss.length > 0) {
    const names = result.silent_loss.map((s) => s.name).join(", ");
    throw new Error(`semantic_conservation_violation: ${result.silent_loss.length} instructional unit(s) VANISHED (no disposition): ${names}`);
  }
  return result;
}
