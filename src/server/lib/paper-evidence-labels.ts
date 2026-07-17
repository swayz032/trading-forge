/**
 * paper-evidence-labels.ts — M2 determinism + durability (2026-07-17), Item 3.
 *
 * Claim-scoping law applied to the PAPER stage: stamps paper session results
 * with WHAT they are and are NOT qualified evidence for, so a promotion
 * decision (or an operator reading a dashboard) never silently over-trusts a
 * paper number for a dimension the paper engine cannot actually validate.
 *
 * Qualified (the internal simulator genuinely exercises these):
 *   logic, timeframes, risk_wiring, state_recovery
 * NOT qualified (the paper engine's fill model is a MODEL, not a live book):
 *   realtime_latency, bid_ask, queue, liquidity, broker_execution
 *
 * PURE ADDITIVE METADATA — this module gates NOTHING. It stamps
 * `paper_sessions.config.evidence_labels` (existing JSONB column, no
 * migration needed) plus an audit_log row at session start.
 */

export const PAPER_EVIDENCE_CERTIFIED_CLAIMS = [
  "logic",
  "timeframes",
  "risk_wiring",
  "state_recovery",
] as const;

export const PAPER_EVIDENCE_NOT_CERTIFIED_CLAIMS = [
  "realtime_latency",
  "bid_ask",
  "queue",
  "liquidity",
  "broker_execution",
] as const;

export interface PaperEvidenceClaims {
  certified: string[];
  not_certified: string[];
}

export interface PaperEvidenceLabels {
  feed_mode: "delayed" | "realtime" | "unknown";
  nominal_delay_seconds: number | null;
  claims: PaperEvidenceClaims;
}

/**
 * Reads the vendor-published nominal delay (seconds) from env. Returns null
 * (unconfigured / unknown) rather than a fabricated default — a wrong assumed
 * delay is worse than an honestly-absent one for a claim-scoping label.
 * Set `PAPER_FEED_NOMINAL_DELAY_SECONDS` to the feed vendor's actual
 * published delay when known.
 */
export function resolveNominalDelaySeconds(): number | null {
  const raw = process.env.PAPER_FEED_NOMINAL_DELAY_SECONDS;
  if (raw == null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Reads the feed-mode label from env, defaulting to "delayed" — the internal
 * paper engine runs against the Massive delayed feed (per the M2 ratify
 * packet's own framing of the promotion-evidence boundary). Override via
 * `PAPER_FEED_MODE` if a session genuinely runs against a different feed.
 */
export function resolveFeedMode(): "delayed" | "realtime" | "unknown" {
  const raw = process.env.PAPER_FEED_MODE;
  if (raw === "delayed" || raw === "realtime" || raw === "unknown") return raw;
  return "delayed";
}

/** Builds the full evidence-labels stamp for a new paper session. Pure, no I/O. */
export function buildPaperEvidenceLabels(): PaperEvidenceLabels {
  return {
    feed_mode: resolveFeedMode(),
    nominal_delay_seconds: resolveNominalDelaySeconds(),
    claims: {
      certified: [...PAPER_EVIDENCE_CERTIFIED_CLAIMS],
      not_certified: [...PAPER_EVIDENCE_NOT_CERTIFIED_CLAIMS],
    },
  };
}
