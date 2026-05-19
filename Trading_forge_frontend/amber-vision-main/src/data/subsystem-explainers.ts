/**
 * Subsystem explainers — baby-level one-liners for the Command Room
 * whiteboard, NPC tooltips, and incident overlays. Plain English first;
 * technical name as subscript.
 *
 * Source-of-truth for the subsystem catalog is `Trading Forge System Map v2.md`
 * + `CLAUDE.md`. Update here when a subsystem ships or its purpose changes.
 */

export type LifecycleStage =
  | "generation"
  | "validation"
  | "paper"
  | "promotion"
  | "canary"
  | "live"
  | "decline"
  | "safety";

export interface SubsystemExplainer {
  /** Canonical subsystem id (A4, B14, C11, etc.). */
  id: string;
  /** Short human name shown on the whiteboard tile. */
  name: string;
  /** One-sentence plain-English explanation. No jargon. */
  oneLiner: string;
  /** Where this fits in the pipeline. */
  stage: LifecycleStage;
}

export const SUBSYSTEMS: SubsystemExplainer[] = [
  // ── Generation ────────────────────────────────────────────────────────
  {
    id: "scout",
    name: "Strategy Scout",
    oneLiner: "Reads the internet (Reddit, papers, X) and writes new trading ideas every night.",
    stage: "generation",
  },
  {
    id: "C9",
    name: "DSL Diversity",
    oneLiner: "Rejects new strategies that look almost identical to ones we already tested.",
    stage: "generation",
  },
  {
    id: "C3",
    name: "Prompt-Injection Shield",
    oneLiner: "Stops attackers from sneaking malicious instructions through the AI scout.",
    stage: "generation",
  },

  // ── Validation ────────────────────────────────────────────────────────
  {
    id: "backtest",
    name: "Backtest Engine",
    oneLiner: "Replays a strategy against years of real market data to see what it would have made.",
    stage: "validation",
  },
  {
    id: "walk-forward",
    name: "Walk-Forward",
    oneLiner: "Splits the data into chunks and tests each chunk on data the strategy never saw.",
    stage: "validation",
  },
  {
    id: "A4",
    name: "Frankenstein Gate",
    oneLiner: "Shuffles trade order to detect strategies that just got lucky on one path.",
    stage: "validation",
  },
  {
    id: "A13",
    name: "Information Ratio",
    oneLiner: "Measures real edge vs just riding the S&P drift.",
    stage: "validation",
  },
  {
    id: "A14",
    name: "Synthetic Black Swan",
    oneLiner: "Tests strategies against fake market crashes that haven't happened yet.",
    stage: "validation",
  },
  {
    id: "monte-carlo",
    name: "Monte Carlo",
    oneLiner: "Simulates 1,000 alternate market histories to see how often the strategy survives.",
    stage: "validation",
  },

  // ── Paper ─────────────────────────────────────────────────────────────
  {
    id: "paper-engine",
    name: "Paper Engine",
    oneLiner: "Trades the strategy with fake money in real-time markets for 30+ days.",
    stage: "paper",
  },
  {
    id: "B11",
    name: "News Blackout",
    oneLiner: "Sits out for 30 minutes around FOMC, CPI, and NFP unless you opt in.",
    stage: "paper",
  },
  {
    id: "C11",
    name: "Macro Regime Overlay",
    oneLiner: "Blocks new entries when the macro state (crisis, inflation) doesn't fit the strategy.",
    stage: "paper",
  },

  // ── Promotion ─────────────────────────────────────────────────────────
  {
    id: "A7",
    name: "Signal Correlation",
    oneLiner: "Blocks promoting a strategy if its trade signals are too similar to a deployed one.",
    stage: "promotion",
  },
  {
    id: "B5",
    name: "Multi-Firm Eligibility",
    oneLiner: "Checks each of 8 prop firms to see which ones a strategy is allowed to trade at.",
    stage: "promotion",
  },
  {
    id: "B10",
    name: "Min Regime Performance",
    oneLiner: "Confirms the strategy holds up across different market regimes, not just one.",
    stage: "promotion",
  },
  {
    id: "B14",
    name: "Prop-Firm Survival",
    oneLiner: "Predicts which prop firm won't ban or freeze your account once you're profitable.",
    stage: "promotion",
  },

  // ── Canary ────────────────────────────────────────────────────────────
  {
    id: "B8",
    name: "PILOT Canary",
    oneLiner: "Live-trades the strategy with 1 contract for 5 sessions before going full-size.",
    stage: "canary",
  },

  // ── Live ──────────────────────────────────────────────────────────────
  {
    id: "deployed",
    name: "Deployed Strategy",
    oneLiner: "Real money. Watched every 4 hours for performance decline.",
    stage: "live",
  },
  {
    id: "B12",
    name: "Closed Feedback Loop",
    oneLiner: "Feeds live trade outcomes back into the strategy memory so the system learns.",
    stage: "live",
  },

  // ── Decline ───────────────────────────────────────────────────────────
  {
    id: "decay",
    name: "Decay Detector",
    oneLiner: "Spots a strategy losing its edge from a falling 30-day Sharpe ratio.",
    stage: "decline",
  },
  {
    id: "B4",
    name: "Auto-Regen",
    oneLiner: "When a strategy declines, automatically generates replacements to test.",
    stage: "decline",
  },

  // ── Safety (always-on) ────────────────────────────────────────────────
  {
    id: "C1",
    name: "CME Outage Watch",
    oneLiner: "Detects when the CME exchange goes down and blocks new entries until it's back.",
    stage: "safety",
  },
  {
    id: "C2",
    name: "Prop Firm Health",
    oneLiner: "Polls all 8 firms every 15 minutes. If a firm suspends you, blocks new entries there.",
    stage: "safety",
  },
  {
    id: "C4",
    name: "Network Failover",
    oneLiner: "Watches your internet. Falls back to your phone hotspot if the home line drops.",
    stage: "safety",
  },
  {
    id: "C7",
    name: "Validation Cadence",
    oneLiner: "Counts days since your last live backtest. Goes red if you've been building too long without testing.",
    stage: "safety",
  },
  {
    id: "C8",
    name: "Windows Update Guard",
    oneLiner: "Pauses Trading Forge before Windows tries to reboot your machine mid-trade.",
    stage: "safety",
  },
];

export const STAGE_ORDER: LifecycleStage[] = [
  "generation",
  "validation",
  "paper",
  "promotion",
  "canary",
  "live",
  "decline",
  "safety",
];

export const STAGE_LABELS: Record<LifecycleStage, string> = {
  generation: "1. Generation",
  validation: "2. Validation",
  paper: "3. Paper Trading",
  promotion: "4. Promotion",
  canary: "5. Canary (PILOT)",
  live: "6. Live",
  decline: "7. Decline & Retire",
  safety: "Always-On Safety",
};

export const STAGE_TAGLINES: Record<LifecycleStage, string> = {
  generation: "Where new ideas come from",
  validation: "Prove it works before any real money is at risk",
  paper: "Practice with fake money for 30+ days",
  promotion: "Confirm the strategy is unique and firm-eligible",
  canary: "1 contract, 5 sessions, fail fast or graduate",
  live: "Real money on the line",
  decline: "Spot the edge fading and replace before it bleeds",
  safety: "Subsystems that never sleep — they protect every stage above",
};

export function subsystemsByStage(stage: LifecycleStage): SubsystemExplainer[] {
  return SUBSYSTEMS.filter((s) => s.stage === stage);
}
