import { db } from "../db/index.js";
import { paperPositions } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../index.js";

export interface SignalConfirmation {
  symbol: string;
  direction: "long" | "short";
  confirmingStrategies: string[];
  totalStrategies: number;
  confirmationRatio: number;
  sizeMultiplier: number;
  recommendation: string;
}

// Check if multiple strategies agree on direction for a symbol
export async function checkSignalConfirmation(symbol: string): Promise<SignalConfirmation | null> {
  // Get all open positions for this symbol across active paper sessions
  const openPositions = await db.select({
    sessionId: paperPositions.sessionId,
    side: paperPositions.side,
    symbol: paperPositions.symbol,
  })
    .from(paperPositions)
    .where(and(
      eq(paperPositions.symbol, symbol.toUpperCase()),
      isNull(paperPositions.closedAt),
    ));

  if (openPositions.length < 2) return null;

  // Count direction agreement
  const longCount = openPositions.filter(p => p.side === "long").length;
  const shortCount = openPositions.filter(p => p.side === "short").length;
  const total = openPositions.length;

  const dominantDirection = longCount >= shortCount ? "long" : "short";
  const dominantCount = Math.max(longCount, shortCount);
  const ratio = dominantCount / total;

  // Only confirm if 2+ strategies agree
  if (dominantCount < 2) return null;

  // Size multiplier: 1.0 base, +0.25 for each confirming strategy beyond 1
  const sizeMultiplier = Math.min(1.0 + (dominantCount - 1) * 0.25, 2.0);

  const confirmingSessionIds = openPositions
    .filter(p => p.side === dominantDirection)
    .map(p => p.sessionId);

  const result: SignalConfirmation = {
    symbol: symbol.toUpperCase(),
    direction: dominantDirection as "long" | "short",
    confirmingStrategies: confirmingSessionIds,
    totalStrategies: total,
    confirmationRatio: Math.round(ratio * 100) / 100,
    sizeMultiplier: Math.round(sizeMultiplier * 100) / 100,
    recommendation: ratio >= 0.75
      ? `Strong signal confirmation (${dominantCount}/${total} agree). Size boost: ${sizeMultiplier}x`
      : `Partial confirmation (${dominantCount}/${total} agree). Consider base sizing.`,
  };

  if (dominantCount >= 2) {
    logger.info(result, "Cross-strategy signal confirmation detected");
  }

  return result;
}
