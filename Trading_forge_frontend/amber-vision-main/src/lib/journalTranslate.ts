/**
 * Journal-text simplifier — turns AI-written analyst notes, generation prompts,
 * and metric stat-speak into plain English a non-technical operator can read.
 *
 * Used by the new premium 3D bento Journal cards. No new deps, pure functions,
 * fully testable.
 */
import type { JournalEntry } from "@/types/api";

function n(v: any): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

// ── Verdict ────────────────────────────────────────────────────────────────

export type JournalVerdict =
  | "SOLID_EDGE"
  | "PROMISING"
  | "NEEDS_WORK"
  | "RISKY"
  | "REJECTED"
  | "PENDING"
  | "RESEARCH";

export function verdictFromEntry(entry: JournalEntry): JournalVerdict {
  const status = (entry.status ?? "").toLowerCase();
  if (status === "scouted") return "RESEARCH";
  if (status === "pending") return "PENDING";
  if (status === "failed" || entry.tier === "REJECTED") return "REJECTED";

  if (status === "passed") {
    if (entry.tier === "TIER_1") return "SOLID_EDGE";
    if (entry.tier === "TIER_2") return "PROMISING";
    if (entry.tier === "TIER_3") return "NEEDS_WORK";
    return "PROMISING";
  }

  // Status undefined/other — fall back to tier
  if (entry.tier === "TIER_1") return "SOLID_EDGE";
  if (entry.tier === "TIER_2") return "PROMISING";
  if (entry.tier === "REJECTED") return "REJECTED";
  return "PENDING";
}

const VERDICT_META: Record<
  JournalVerdict,
  { label: string; icon: string; tone: "profit" | "emerald" | "amber" | "loss" | "info" | "neutral" }
> = {
  SOLID_EDGE: { label: "Solid edge", icon: "✅", tone: "profit" },
  PROMISING: { label: "Promising", icon: "✨", tone: "emerald" },
  NEEDS_WORK: { label: "Needs work", icon: "🛠", tone: "amber" },
  RISKY: { label: "Risky", icon: "⚠️", tone: "amber" },
  REJECTED: { label: "Not good enough", icon: "🚫", tone: "loss" },
  PENDING: { label: "Still testing", icon: "⏳", tone: "info" },
  RESEARCH: { label: "Research find", icon: "🔍", tone: "info" },
};

export function verdictMeta(v: JournalVerdict) {
  return VERDICT_META[v];
}

// ── Title cleanup ──────────────────────────────────────────────────────────

/**
 * Pass 4 stored a server-side cleaned title at
 * `entry.strategyParams.cleaned_title` (and a 1-sentence lead at
 * `cleaned_lead`). Frontend should prefer those over re-cleaning at render
 * time so we render premium-formatted text directly from the DB.
 *
 * Backward compat: if `cleaned_title` is missing on a row (legacy / pre-Pass-4),
 * fall back to running the legacy in-render cleanup pipeline on the raw
 * title via simplifyTitle(raw).
 */
export function simplifyTitleFromEntry(entry: JournalEntry): string {
  const params = entry.strategyParams ?? {};
  const cleaned = typeof params.cleaned_title === "string" ? params.cleaned_title.trim() : "";
  if (cleaned.length > 0) return cleaned;
  const raw = (params.title ?? params.name ?? entry.generationPrompt ?? "") as string;
  return simplifyTitle(raw);
}

/**
 * Same idea for the description / lead. Prefer `cleaned_lead` if Pass 4
 * stored it, otherwise fall back to simplifyAnalystNotes() over the raw
 * description.
 */
export function simplifyLeadFromEntry(entry: JournalEntry): string {
  const params = entry.strategyParams ?? {};
  const cleaned = typeof params.cleaned_lead === "string" ? params.cleaned_lead.trim() : "";
  if (cleaned.length > 0) return cleaned;
  const raw = (params.description ?? params.summary ?? entry.analystNotes ?? "") as string | null;
  return simplifyAnalystNotes(raw ?? null);
}

export function simplifyTitle(raw: string): string {
  if (!raw) return "Untitled strategy";

  let t = raw
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Strip Markdown headers / emphasis that arrive verbatim from scraped articles
  // ("# Backtesting Trading Strategies ## What Is...") — render as a clean
  // human title, not a raw README snippet.
  t = t.replace(/^#{1,6}\s+/gm, "");          // leading # / ## / ### at start of line
  t = t.replace(/\s+#{1,6}\s+/g, " · ");       // mid-string ## becomes a separator dot
  t = t.replace(/\*\*(.*?)\*\*/g, "$1");       // **bold** → bold
  t = t.replace(/\*(.*?)\*/g, "$1");            // *italic* → italic
  t = t.replace(/`([^`]+)`/g, "$1");            // `code` → code

  // Collapse repeated whitespace from the markdown stripping
  t = t.replace(/\s+/g, " ");

  // Strip "site name" suffixes from web-scouted titles
  t = t.replace(/\s*[-|]\s*(Reddit|YouTube|Medium|Substack|TradingView|Investopedia|BabyPips|Warrior Trading|.*\.com).*$/i, "");

  // Strip ALL CAPS / yelling
  if (t === t.toUpperCase() && t.length > 12) {
    t = t.charAt(0) + t.slice(1).toLowerCase();
  }

  // Smart truncate to 90 chars at a word boundary so cards don't render walls
  // of text. The full title still lives in the entry; we only display less.
  if (t.length > 90) {
    const cut = t.slice(0, 90);
    const lastSpace = cut.lastIndexOf(" ");
    t = (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + "…";
  }

  return t.trim();
}

// ── Metric → plain-English description ─────────────────────────────────────

export interface MetricSummary {
  shortLabel: string;
  describes: string;
}

export function describeSharpe(sharpe: number): MetricSummary | null {
  if (sharpe <= 0) return null;
  if (sharpe >= 2) return { shortLabel: "Very steady", describes: "smooth, low-stress returns" };
  if (sharpe >= 1.5) return { shortLabel: "Steady", describes: "consistent profit with mild swings" };
  if (sharpe >= 1) return { shortLabel: "Choppy", describes: "earns money but with bigger swings" };
  return { shortLabel: "Erratic", describes: "wins and losses are nearly random" };
}

export function describeWinRate(wr: number): MetricSummary | null {
  if (wr <= 0) return null;
  const pct = wr <= 1 ? wr * 100 : wr;
  if (pct >= 70) return { shortLabel: "Wins most days", describes: `wins ${Math.round(pct)}% of the time` };
  if (pct >= 60) return { shortLabel: "Wins more than loses", describes: `wins ${Math.round(pct)}% of the time` };
  if (pct >= 50) return { shortLabel: "Coin-flip", describes: `wins ${Math.round(pct)}% of the time` };
  return { shortLabel: "Loses more than wins", describes: `wins only ${Math.round(pct)}% of the time` };
}

export function describeProfitFactor(pf: number): MetricSummary | null {
  if (pf <= 0) return null;
  if (pf >= 2.5) return { shortLabel: "Big winners", describes: "wins are 2.5x bigger than losses" };
  if (pf >= 2) return { shortLabel: "Strong winners", describes: "wins are about 2x bigger than losses" };
  if (pf >= 1.5) return { shortLabel: "Solid math", describes: "winners outpace losers comfortably" };
  if (pf >= 1.1) return { shortLabel: "Thin margin", describes: "barely makes more than it loses" };
  return { shortLabel: "Losing money", describes: "losses are bigger than wins" };
}

export function describeDrawdown(maxDD: number, asPercent = false): MetricSummary | null {
  if (!maxDD) return null;
  const abs = Math.abs(maxDD);
  if (asPercent) {
    if (abs <= 5) return { shortLabel: "Smooth ride", describes: "barely a dip along the way" };
    if (abs <= 10) return { shortLabel: "Mild dips", describes: "manageable losing stretches" };
    if (abs <= 20) return { shortLabel: "Real swings", describes: "expect uncomfortable losing days" };
    return { shortLabel: "Stomach-churning", describes: "could blow a prop account" };
  }
  // Dollars
  if (abs <= 750) return { shortLabel: "Smooth ride", describes: "barely a dip along the way" };
  if (abs <= 1500) return { shortLabel: "Mild dips", describes: "manageable losing stretches" };
  if (abs <= 2500) return { shortLabel: "Real swings", describes: "expect uncomfortable losing days" };
  return { shortLabel: "Stomach-churning", describes: "could blow a prop account" };
}

// ── One-line plain-English takeaway from raw entry ─────────────────────────

export function keyTakeaway(entry: JournalEntry): string {
  const params = entry.strategyParams ?? {};
  const perf = entry.performanceGateResult ?? {};

  const status = (entry.status ?? "").toLowerCase();
  const tier = entry.tier;
  const isScouted = status === "scouted";

  if (isScouted) {
    const conf = n(params.confidence ?? params.confidence_score);
    const url = params.url ?? params.source_url ?? null;
    const where =
      url && typeof url === "string"
        ? url.includes("reddit.com") ? "from a Reddit thread"
        : url.includes("youtube") ? "from a YouTube clip"
        : url.includes("medium") ? "from a Medium post"
        : url.includes("tradingview") ? "from a TradingView idea"
        : "from a web source"
        : "from research";
    if (conf >= 0.7) return `Strong idea ${where} — worth backtesting next.`;
    if (conf >= 0.4) return `Decent idea ${where} — needs more digging.`;
    if (conf > 0) return `Weak idea ${where} — probably not worth running.`;
    return `New strategy idea ${where}.`;
  }

  if (status === "pending") {
    return "Backtest is still running — results will land here when it finishes.";
  }

  if (status === "failed" || tier === "REJECTED") {
    const reasons: string[] = [];
    const sharpe = n(perf.sharpe ?? params.sharpe);
    const winRate = n(perf.winRate ?? params.winRate);
    const pf = n(perf.profitFactor ?? params.profitFactor);
    const dd = Math.abs(n(perf.maxDrawdown ?? params.maxDrawdown));

    if (sharpe > 0 && sharpe < 1) reasons.push("returns too erratic");
    if (winRate > 0 && winRate < 0.5) reasons.push("loses more often than it wins");
    if (pf > 0 && pf < 1.5) reasons.push("losses outpace wins");
    if (dd > 2500) reasons.push("drawdown would blow a prop account");

    if (reasons.length === 0) return "Failed the gates — not safe to deploy as-is.";
    return `Failed because ${reasons.slice(0, 2).join(" and ")}.`;
  }

  if (status === "passed") {
    const sharpe = n(perf.sharpe ?? params.sharpe);
    const winRate = n(perf.winRate ?? params.winRate);
    const dd = Math.abs(n(perf.maxDrawdown ?? params.maxDrawdown));

    if (tier === "TIER_1") {
      return "Top-tier edge — passed every gate. Worth deploying on a real account.";
    }
    if (tier === "TIER_2") {
      return "Solid strategy — passed the gates with room to monitor live.";
    }
    if (tier === "TIER_3") {
      const trait =
        sharpe > 0 && sharpe < 1.5 ? "returns are choppy"
        : winRate > 0 && winRate < 0.55 ? "win rate is below average"
        : dd > 2000 ? "drawdown is on the edge"
        : "metrics are minimum-viable only";
      return `Barely passed — ${trait}. Deploy only on the best-fit prop firm.`;
    }
    return "Passed the gates — review tier before deploying.";
  }

  return "Strategy logged — open for details.";
}

// ── AI analyst-notes simplifier ────────────────────────────────────────────

/**
 * Strip jargon, ALL-CAPS, citation noise, and chain-of-thought from raw analyst
 * output. Returns a 1-2 sentence plain-English summary suitable for a card.
 */
export function simplifyAnalystNotes(raw: string | null): string {
  if (!raw) return "";

  let t = raw
    // Strip HTML
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Drop "Reasoning:", "Thoughts:", "Analysis:" preambles
    .replace(/^(Reasoning|Thoughts|Analysis|Note|Notes|Summary|Review):\s*/i, "")
    // Drop in-line citations [1] [2] (Smith 2024)
    .replace(/\[\d+\]/g, "")
    .replace(/\(\w+\s+\d{4}\)/g, "")
    // Compress whitespace
    .replace(/\s+/g, " ")
    .trim();

  // Replace common jargon with plain words
  const replacements: [RegExp, string][] = [
    [/\bsharpe ratio\b/gi, "consistency score"],
    [/\bsharpe\b/gi, "consistency score"],
    [/\bprofit factor\b/gi, "win-to-loss ratio"],
    [/\bmax drawdown\b/gi, "worst losing stretch"],
    [/\bdrawdown\b/gi, "losing stretch"],
    [/\bexpectancy\b/gi, "average dollars per trade"],
    [/\bwalk[- ]forward\b/gi, "out-of-sample test"],
    [/\boos\b/gi, "out-of-sample test"],
    [/\bprobability of ruin\b/gi, "chance of blowing the account"],
    [/\bmonte carlo\b/gi, "simulation"],
    [/\bMC simulation\b/gi, "simulation"],
    [/\boverfitting\b/gi, "memorizing past data"],
    [/\boverfit\b/gi, "memorizing past data"],
    [/\bregime shift\b/gi, "market change"],
    [/\bin[- ]sample\b/gi, "training data"],
    [/\bvar\b/gi, "bad-day loss"],
    [/\bcvar\b/gi, "worst-bad-day loss"],
    [/\bATR\b/g, "average daily range"],
    [/\bMAE\b/g, "worst point during trade"],
    [/\bMFE\b/g, "best point during trade"],
    [/\bR:R\b/g, "reward-to-risk ratio"],
    [/\brisk[- ]reward\b/gi, "reward-to-risk ratio"],
    [/\bROI\b/g, "return on money"],
    [/\bP&L\b/g, "profit/loss"],
    [/\bPnL\b/g, "profit/loss"],
    [/\bedge\b/gi, "advantage"],
    [/\balpha\b/gi, "edge over the market"],
    [/\bbeta\b/gi, "market correlation"],
  ];

  for (const [re, replacement] of replacements) {
    t = t.replace(re, replacement);
  }

  // De-yell ALL-CAPS sentences (keep the first cap)
  t = t.replace(/\b[A-Z]{4,}\b/g, (match) => match.charAt(0) + match.slice(1).toLowerCase());

  // Trim to ~240 chars at a sentence boundary
  if (t.length > 240) {
    const cut = t.slice(0, 240);
    const lastDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    t = (lastDot > 60 ? cut.slice(0, lastDot + 1) : cut + "…").trim();
  }

  // Ensure first letter is capitalized
  if (t.length > 0) t = t.charAt(0).toUpperCase() + t.slice(1);

  return t;
}

/**
 * Same simplifier applied to the AI generation prompt — strips system-prompt
 * boilerplate and keeps the user-facing intent.
 */
export function simplifyPrompt(raw: string | null): string {
  if (!raw) return "";
  let t = raw
    .replace(/<[^>]*>/g, "")
    .replace(/^(System|User|Assistant|Prompt|Instruction)s?:\s*/i, "")
    .replace(/```[\s\S]*?```/g, "") // drop code fences
    .replace(/\s+/g, " ")
    .trim();

  if (t.length > 200) {
    const cut = t.slice(0, 200);
    const lastDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    t = (lastDot > 50 ? cut.slice(0, lastDot + 1) : cut + "…").trim();
  }

  if (t.length > 0) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

// ── Prop-compliance summary ────────────────────────────────────────────────

export function summarizePropCompliance(raw: any): string {
  if (!raw || typeof raw !== "object") return "";
  const entries = Object.entries(raw);
  if (entries.length === 0) return "";

  const passed: string[] = [];
  const failed: string[] = [];
  for (const [firm, result] of entries) {
    const ok = (result as any)?.pass ?? false;
    if (ok) passed.push(firm);
    else failed.push(firm);
  }

  if (passed.length > 0 && failed.length === 0) {
    return `Cleared every prop firm checked (${passed.length}).`;
  }
  if (passed.length === 0 && failed.length > 0) {
    return `Failed every prop firm rule (${failed.length}). Not eligible to deploy.`;
  }
  if (passed.length > 0) {
    return `Cleared ${passed.length} firm${passed.length === 1 ? "" : "s"}, blocked at ${failed.length}.`;
  }
  return "";
}
