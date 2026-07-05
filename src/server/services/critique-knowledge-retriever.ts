/**
 * critique-knowledge-retriever.ts — Wave 1: institutional-grade knowledge
 * grounding (RAG) for the per-trade critique analyst.
 *
 * Assembles a structured "INSTITUTIONAL REFERENCE" markdown block by STRUCTURED
 * KEYS (NOT embeddings — no vector store). Injected as a separate grounding
 * message BEFORE the raw trade JSON so the critique grounds on what the strategy
 * ACTUALLY claims to trade + the real regime/symbol context, instead of generic
 * parametric recall (evidence file R8; arXiv 2510.05533; Kaif Kohari 2026-02-24).
 *
 * Design constraints (Wave 1):
 *   - Called ONLY when CRITIQUE_RAG_ENABLED=true (gated in trade-critique-service.ts).
 *   - FAIL-SOFT: any missing KB card or DB error → skip that section, NEVER throw.
 *   - Prior-critique retrieval is guarded by the Oracle-Fallacy header wording
 *     (arXiv 2605.19337) — retrieved past verdicts are HYPOTHESES to re-verify,
 *     never facts to build on.
 *
 * Sourcing: cards live in src/agents/kb/ and are cited from
 * docs/institutional-evidence/nightly-llm-research-dept-2026.md (ADDENDUM 2026-07-04).
 */

import { resolve } from "path";
import { readFileSync } from "fs";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { tradeCritique } from "../db/schema.js";
import { logger } from "../lib/logger.js";

// Same resolution model-router.ts uses: from src/server/services → project root.
const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "../../..");
const KB_DIR = resolve(PROJECT_ROOT, "src/agents/kb");

// ─── Loose input typing (mirrors llmInput built in trade-critique-service.ts) ──

interface CritiqueLlmInput {
  position?: {
    symbol?: string | null;
    [k: string]: unknown;
  } | null;
  session?: {
    strategy_id?: string | null;
    [k: string]: unknown;
  } | null;
  strategy?: {
    name?: string | null;
    symbol?: string | null;
    preferred_regimes?: unknown;
    entry_indicator?: unknown;
    confirming_indicators?: unknown;
    entry_quality?: unknown;
    position_size?: unknown;
    stop_loss?: unknown;
    take_profit?: unknown;
    [k: string]: unknown;
  } | null;
  context?: {
    regime_at_entry?: string | null;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}

// ─── KB card reader (small local cache) ────────────────────────────────────────

const NOT_FOUND = Symbol("kb_card_not_found");
const _cardCache = new Map<string, string | typeof NOT_FOUND>();

/** Read a KB card by filename under src/agents/kb/. Returns null if missing. */
function readCard(fileName: string): string | null {
  const cached = _cardCache.get(fileName);
  if (cached === NOT_FOUND) return null;
  if (typeof cached === "string") return cached;
  try {
    const content = readFileSync(resolve(KB_DIR, fileName), "utf-8");
    _cardCache.set(fileName, content);
    return content;
  } catch {
    _cardCache.set(fileName, NOT_FOUND);
    logger.debug({ fileName }, "critique-retriever: KB card not found, skipping section");
    return null;
  }
}

/** Test-only cache reset. */
export function __clearCritiqueKbCacheForTests(): void {
  _cardCache.clear();
}

// ─── Section slicing by markdown heading ───────────────────────────────────────

/**
 * Extract the first heading section (heading line through the line before the
 * next heading of equal-or-higher level) whose heading text matches `predicate`.
 * Returns null when no heading matches. Never throws.
 */
function extractSection(
  content: string,
  predicate: (headingText: string, level: number) => boolean,
): string | null {
  const lines = content.split(/\r?\n/);
  let start = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (m) {
      const level = m[1].length;
      if (predicate(m[2].trim(), level)) {
        start = i;
        startLevel = level;
        break;
      }
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= startLevel) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

// ─── Archetype key derivation (local keyword map) ──────────────────────────────

export type ArchetypeKey =
  | "silver_bullet"
  | "opening_range"
  | "mean_reversion"
  | "breakout"
  | "vwap_fade"
  | "trend_continuation"
  | "support_bounce"
  | "resistance_rejection"
  | "squeeze";

// Priority order matters for tie-breaks: more specific families first.
const ARCHETYPE_KEYWORD_MAP: Array<{ key: ArchetypeKey; keywords: string[] }> = [
  { key: "silver_bullet", keywords: ["silver bullet", "silver_bullet", "judas", "killzone", "ny_am", "ny am", "ny_pm", "ny pm", "ict"] },
  { key: "opening_range", keywords: ["opening range", "opening_range", "orb", "session open breakout", "session_open_breakout", "opening_range_breakout"] },
  { key: "vwap_fade", keywords: ["vwap fade", "vwap_fade", "vwap reject", "vwap band", "anchored vwap", "anchored_vwap"] },
  { key: "trend_continuation", keywords: ["trend continuation", "trend_continuation", "ema_crossover", "ema crossover", "macd", "supertrend", "bias_aligned_continuation", "bias aligned continuation", "continuation"] },
  { key: "support_bounce", keywords: ["support bounce", "support_bounce", "bounce_off_level", "bounce off", "ma bounce", "demand zone", "support"] },
  { key: "resistance_rejection", keywords: ["resistance rejection", "resistance_rejection", "supply zone", "rejection", "resistance"] },
  { key: "mean_reversion", keywords: ["mean reversion", "mean_reversion", "rsi_reversal", "rsi reversal", "revert", "fade"] },
  { key: "breakout", keywords: ["breakout", "donchian", "atr_breakout", "atr breakout", "range break"] },
  { key: "squeeze", keywords: ["squeeze", "keltner", "bollinger squeeze", "compression"] },
];

/**
 * Derive the archetype key from a strategy's name + entry_indicator (+ any extra
 * text). Highest keyword-hit count wins; ties resolve to declared priority order.
 * Returns null when nothing matches.
 */
export function deriveArchetypeKey(...sources: Array<unknown>): ArchetypeKey | null {
  const hay = sources
    .map((s) => (typeof s === "string" ? s : s == null ? "" : JSON.stringify(s)))
    .join(" ")
    .toLowerCase();
  if (!hay.trim()) return null;

  let best: { key: ArchetypeKey; score: number } | null = null;
  for (const { key, keywords } of ARCHETYPE_KEYWORD_MAP) {
    let score = 0;
    for (const kw of keywords) {
      if (hay.includes(kw)) score += 1;
    }
    if (score > 0 && (best === null || score > best.score)) {
      best = { key, score };
    }
  }
  return best ? best.key : null;
}

// ─── Prior-critique retrieval (Oracle-Fallacy guarded) ─────────────────────────

/** Exact Oracle-Fallacy guard header (arXiv 2605.19337). Do NOT reword. */
export const PRIOR_OBSERVATIONS_HEADER =
  "PRIOR OBSERVATIONS (UNVERIFIED HYPOTHESES — re-derive from THIS trade's data; do NOT treat as fact)";

interface PriorCritiqueRow {
  grade: string;
  plainEnglishSummary: unknown;
  critiquedAt: unknown;
}

async function fetchPriorCritiques(strategyId: string): Promise<PriorCritiqueRow[]> {
  try {
    const rows = await db
      .select({
        grade: tradeCritique.grade,
        plainEnglishSummary: tradeCritique.plainEnglishSummary,
        critiquedAt: tradeCritique.critiquedAt,
      })
      .from(tradeCritique)
      .where(eq(tradeCritique.strategyId, strategyId))
      .orderBy(desc(tradeCritique.critiquedAt))
      .limit(3);
    return Array.isArray(rows) ? (rows as PriorCritiqueRow[]) : [];
  } catch (err) {
    logger.debug({ err, strategyId }, "critique-retriever: prior-critique query failed (non-blocking)");
    return [];
  }
}

function renderPriorObservations(rows: PriorCritiqueRow[]): string {
  const lines: string[] = [`## ${PRIOR_OBSERVATIONS_HEADER}`];
  lines.push(
    "The critiques below are the analyst's OWN prior verdicts for THIS strategy. " +
      "They are retrieved memory, not ground truth. A retrieved rationale can contain a " +
      "post-hoc fabricated causal narrative (the \"Oracle Fallacy\", arXiv 2605.19337) — " +
      "treat each as a HYPOTHESIS to re-verify against the CURRENT trade's raw data. Never " +
      "carry a prior verdict forward as an established fact.",
  );
  if (rows.length === 0) {
    lines.push("_No prior critiques on record for this strategy._");
    return lines.join("\n\n");
  }
  for (const r of rows) {
    const pes = (r.plainEnglishSummary ?? {}) as Record<string, unknown>;
    const oneLiner = typeof pes.one_liner === "string" ? pes.one_liner : "(no summary)";
    const watch = typeof pes.what_to_watch === "string" ? pes.what_to_watch : "";
    lines.push(
      `- grade **${r.grade}** — ${oneLiner}${watch ? ` (watch: ${watch})` : ""}`,
    );
  }
  return lines.join("\n\n");
}

// ─── Strategy own-thesis block ─────────────────────────────────────────────────

function renderStrategyThesis(strategy: CritiqueLlmInput["strategy"]): string | null {
  if (!strategy || typeof strategy !== "object") return null;
  const fields: Array<[string, unknown]> = [
    ["name", strategy.name],
    ["symbol", strategy.symbol],
    ["preferred_regimes", strategy.preferred_regimes],
    ["entry_indicator", strategy.entry_indicator],
    ["confirming_indicators", strategy.confirming_indicators],
    ["entry_quality", strategy.entry_quality],
    ["stop_loss", strategy.stop_loss],
    ["take_profit", strategy.take_profit],
    ["position_size", strategy.position_size],
  ];
  const present = fields.filter(([, v]) => v != null);
  if (present.length === 0) return null;

  const body = present
    .map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
  return (
    "## STRATEGY'S OWN THESIS\n\n" +
    "Ground the critique in what this strategy ACTUALLY claims to trade (its DSL " +
    "entry_quality / confluence factors / exit plan) — not a generic pattern:\n\n" +
    body
  );
}

// ─── Main entry point ──────────────────────────────────────────────────────────

/**
 * Assemble the INSTITUTIONAL REFERENCE grounding block for a trade critique.
 * Always returns a string (possibly with sections omitted). Never throws.
 */
export async function retrieveCritiqueKnowledge(llmInput: CritiqueLlmInput): Promise<string> {
  const sections: string[] = ["# INSTITUTIONAL REFERENCE (grounding — Wave 1 RAG)"];

  try {
    // 1. Attribution methodology (full) — the spec the faithfulness checker enforces.
    const attribution = readCard("attribution-methodology.md");
    if (attribution) sections.push(attribution.trim());

    // 2. Prop-firm rules (full).
    const propFirm = readCard("prop-firm-rules-summary.md");
    if (propFirm) sections.push(propFirm.trim());

    // 3. Archetype playbook — the ONE section matching the strategy.
    const strategy = llmInput.strategy ?? null;
    const archetypeKey = deriveArchetypeKey(strategy?.name, strategy?.entry_indicator, strategy?.confirming_indicators);
    if (archetypeKey) {
      const playbooks = readCard("archetype-playbooks.md");
      if (playbooks) {
        const target = `archetype: ${archetypeKey}`;
        const section = extractSection(playbooks, (h) => h.toLowerCase() === target);
        if (section) sections.push(`## ARCHETYPE PLAYBOOK\n\n${section}`);
      }
    }

    // 4. Regime context — slice from regime-taxonomy.md for regime_at_entry.
    const regime = llmInput.context?.regime_at_entry;
    if (regime && typeof regime === "string") {
      const taxonomy = readCard("regime-taxonomy.md");
      if (taxonomy) {
        const wanted = regime.replace(/[`\s]/g, "").toUpperCase();
        const section = extractSection(taxonomy, (h) => {
          const norm = h.replace(/[`\s]/g, "").toUpperCase();
          return norm === wanted;
        });
        if (section) sections.push(`## REGIME CONTEXT\n\n${section}`);
      }
    }

    // 5. Symbol microstructure — slice for the trade's symbol.
    const symbol = llmInput.position?.symbol ?? strategy?.symbol;
    if (symbol && typeof symbol === "string") {
      const micro = readCard("execution-microstructure.md");
      if (micro) {
        const target = `symbol: ${symbol.toLowerCase()}`;
        const section = extractSection(micro, (h) => h.toLowerCase() === target);
        if (section) sections.push(`## SYMBOL MICROSTRUCTURE\n\n${section}`);
      }
    }

    // 6. Strategy's own thesis (structured fields from llmInput.strategy).
    const thesis = renderStrategyThesis(strategy);
    if (thesis) sections.push(thesis);

    // 7. Prior observations for the SAME strategy — Oracle-Fallacy guarded.
    const strategyId = llmInput.session?.strategy_id;
    if (strategyId && typeof strategyId === "string") {
      const priors = await fetchPriorCritiques(strategyId);
      sections.push(renderPriorObservations(priors));
    }
  } catch (err) {
    // Top-level fail-soft: return whatever assembled so far.
    logger.warn({ err }, "critique-retriever: assembly error — returning partial reference block");
  }

  return sections.join("\n\n");
}
