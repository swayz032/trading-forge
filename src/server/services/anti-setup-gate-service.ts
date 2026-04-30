/**
 * Anti-Setup Gate Service — Real-time anti-setup filtering for paper signal evaluation.
 *
 * Performs condition matching in TypeScript (mirroring Python filter_gate logic exactly)
 * to avoid subprocess overhead on the real-time signal evaluation path.
 *
 * Anti-setups are loaded from audit_log where they were persisted by the weekly miner,
 * and cached in memory with an 8-day TTL.
 *
 * Fail-open: if the gate errors at any point, the trade proceeds unblocked.
 *
 * When a trade is blocked, the caller logs to:
 *   - paper_signal_logs (signalType: "anti_setup_blocked") for auditability
 *   - shadow_signals for hypothetical P&L tracking
 *
 * The weekly effectiveness analysis job evaluates whether anti-setups help or hurt.
 */

import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ─── In-memory cache for strategy anti-setups ──────────────────
// Refreshed weekly by the anti-setup miner job.
// Key: strategyId, Value: { antiSetups, cachedAt }
const antiSetupCache = new Map<string, { antiSetups: AntiSetupRule[]; cachedAt: number }>();
const CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000; // 8 days (weekly mine + 1 day buffer)

export interface AntiSetupRule {
  condition: string;
  filter: Record<string, unknown>;
  confidence: number;
  failure_rate: number;
  sample_size?: number;
  description?: string;
}

export interface AntiSetupGateResult {
  blocked: boolean;
  matchedRule: string | null;
  matchedCondition: string | null;
  matchedFilter: Record<string, unknown> | null;
  confidence: number | null;
}

interface TradeContext {
  time?: string;
  hour?: number;
  atr?: number;
  volume?: number;
  regime?: string;
  day_of_week?: number;
  days_to_event?: number;
  streak?: number;
  streak_type?: string;
}

// ─── Condition Matching (TypeScript port of Python filter_gate) ──

const CONFIDENCE_THRESHOLD = 0.80;

function matchesCondition(context: TradeContext, condition: string, filt: Record<string, unknown>): boolean {
  switch (condition) {
    case "time_of_day": {
      let hour = context.hour;
      if (hour == null && context.time) {
        const timeStr = String(context.time);
        if (timeStr.includes("T")) {
          try {
            hour = parseInt(timeStr.split("T")[1].split(":")[0], 10);
          } catch { return false; }
        }
      }
      if (hour == null) return false;
      const hourStart = (filt.hour_start as number) ?? 0;
      const hourEnd = (filt.hour_end as number) ?? 24;
      return hour >= hourStart && hour < hourEnd;
    }

    case "volatility": {
      const atr = context.atr;
      if (atr == null) return false;
      const atrMean = (filt.atr_mean as number) ?? 0;
      if (atrMean === 0) return false;
      const loMult = filt.atr_min_multiplier as number | undefined;
      const hiMult = filt.atr_max_multiplier as number | undefined;
      if (loMult != null && atr < atrMean * loMult) return false;
      if (hiMult != null && atr > atrMean * hiMult) return false;
      return true;
    }

    case "volume": {
      const volume = context.volume;
      if (volume == null) return false;
      const volCondition = (filt.volume_condition as string) ?? "";
      if (volCondition === "below_average") {
        return volume < ((filt.volume_mean as number) ?? Infinity);
      } else if (volCondition === "very_low") {
        return volume < ((filt.volume_threshold as number) ?? Infinity);
      }
      return false;
    }

    case "day_of_week": {
      const dow = context.day_of_week;
      if (dow == null) return false;
      return dow === (filt.day as number);
    }

    case "regime": {
      const regime = context.regime;
      if (regime == null) return false;
      return String(regime) === (filt.regime as string);
    }

    case "archetype": {
      const archetype = (context as Record<string, unknown>).archetype as string | undefined;
      if (archetype == null) return false;
      return String(archetype) === (filt.archetype as string);
    }

    case "event_proximity": {
      const daysToEvent = context.days_to_event;
      if (daysToEvent == null) return false;
      return daysToEvent <= ((filt.max_days_to_event as number) ?? 0);
    }

    case "streak": {
      const streak = context.streak;
      if (streak == null) return false;
      const label = (filt.streak_label as string) ?? "";
      if (label.includes("wins")) {
        try {
          const n = parseInt(label.split("_")[1], 10);
          return streak >= n && context.streak_type === "win";
        } catch { return false; }
      } else if (label.includes("losses")) {
        try {
          const n = parseInt(label.split("_")[1], 10);
          return streak >= n && context.streak_type === "loss";
        } catch { return false; }
      }
      return false;
    }

    default:
      return false;
  }
}

/**
 * Check whether the current trade context matches any active anti-setup for the strategy.
 * Returns a result indicating whether the trade should be blocked.
 *
 * All matching is done in TypeScript to avoid subprocess overhead on the
 * real-time signal evaluation path.
 */
export async function checkAntiSetupGate(
  strategyId: string,
  tradeContext: TradeContext,
): Promise<AntiSetupGateResult> {
  const antiSetups = await getAntiSetupsForStrategy(strategyId);

  if (antiSetups.length === 0) {
    return { blocked: false, matchedRule: null, matchedCondition: null, matchedFilter: null, confidence: null };
  }

  const matched: AntiSetupRule[] = [];
  for (const anti of antiSetups) {
    if ((anti.confidence ?? 0) < CONFIDENCE_THRESHOLD) continue;
    if (matchesCondition(tradeContext, anti.condition, anti.filter)) {
      matched.push(anti);
    }
  }

  if (matched.length === 0) {
    return { blocked: false, matchedRule: null, matchedCondition: null, matchedFilter: null, confidence: null };
  }

  // Pick the strongest match (highest failure_rate)
  const strongest = matched.reduce((a, b) =>
    (b.failure_rate ?? 0) > (a.failure_rate ?? 0) ? b : a,
  );

  return {
    blocked: true,
    matchedRule: strongest.condition,
    matchedCondition: strongest.condition,
    matchedFilter: strongest.filter,
    confidence: strongest.confidence,
  };
}

/**
 * Get active anti-setups for a strategy, using cache when available.
 * Reads from audit_log where the miner persists results.
 */
async function getAntiSetupsForStrategy(strategyId: string): Promise<AntiSetupRule[]> {
  const cached = antiSetupCache.get(strategyId);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.antiSetups;
  }

  try {
    // Read the most recent mining result for this strategy from audit_log
    const [row] = await db
      .select({ result: auditLog.result })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "anti_setup.mined"),
          eq(auditLog.entityId, strategyId),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    if (!row || !row.result) {
      antiSetupCache.set(strategyId, { antiSetups: [], cachedAt: Date.now() });
      return [];
    }

    const result = row.result as Record<string, unknown>;
    const antiSetups = (result.anti_setups ?? result.filters ?? []) as AntiSetupRule[];
    antiSetupCache.set(strategyId, { antiSetups, cachedAt: Date.now() });
    logger.info(
      { strategyId, count: antiSetups.length },
      "Anti-setup gate: loaded active filters from audit_log",
    );
    return antiSetups;
  } catch (err) {
    logger.warn(
      { err, strategyId },
      "Anti-setup gate: failed to load active filters — returning empty (fail-open)",
    );
    return [];
  }
}

/**
 * Invalidate the anti-setup cache for a strategy (called after mining completes).
 */
export function invalidateAntiSetupCache(strategyId?: string): void {
  if (strategyId) {
    antiSetupCache.delete(strategyId);
  } else {
    antiSetupCache.clear();
  }
}

/**
 * Manually populate the cache for a strategy with known anti-setups.
 * Used by the miner to make newly mined rules immediately available.
 */
export function populateAntiSetupCache(strategyId: string, antiSetups: AntiSetupRule[]): void {
  antiSetupCache.set(strategyId, { antiSetups, cachedAt: Date.now() });
}
