/**
 * cross-account-hedge-gate.ts — Topstep Prohibited Conduct: cross-account hedging (single-user).
 *
 * Topstep bans holding OPPOSITE positions across your multiple accounts simultaneously
 * (account A long MES + account B short MES = "cross-account hedging"). Our existing
 * hedging rule (`hedgingSameUnderlyingBanned`) only covers WITHIN one account (MNQ+NQ).
 * This gate covers ACROSS accounts — directly relevant because multi-account is scaling
 * lever #3 (CLAUDE.md §5). Within one bot instance every account is the SAME operator's
 * (family members run separate instances), so any opposite-side position on the same
 * underlying across this firm's accounts is a single-user cross-account hedge.
 *
 * Enforced at signal-time before opening: a new entry that would be OPPOSITE to an open
 * position on the same UNDERLYING in another account is BLOCKED.
 *
 * Coordinated trading (Topstep also bans trading the same/opposite strategy "in concert"
 * with others) is handled separately by the per-family-member distinct-strategy rule
 * (account_strategy_assignments UNIQUE) — this gate is the single-user cross-account piece.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "./logger.js";

/** Map a tradable symbol to its UNDERLYING root so micro/mini of the same product collide. */
export function symbolToUnderlying(symbol: string): string {
  const s = (symbol || "").toUpperCase();
  // Equity index
  if (s === "MES" || s === "ES") return "ES";
  if (s === "MNQ" || s === "NQ") return "NQ";
  if (s === "M2K" || s === "RTY") return "RTY";
  if (s === "MYM" || s === "YM") return "YM";
  // Energy
  if (s === "MCL" || s === "CL" || s === "QM") return "CL";
  if (s === "MNG" || s === "NG" || s === "QG") return "NG";
  // Metals
  if (s === "MGC" || s === "GC") return "GC";
  if (s === "SIL" || s === "SI") return "SI";
  return s; // unknown → itself
}

export interface CrossAccountHedgeResult {
  blocked: boolean;
  conflictUnderlying?: string;
  conflictSide?: string;   // the OPEN side that conflicts
  conflictSessionId?: string;
}

/**
 * Would opening a `side` position on `symbol` create a cross-account hedge — i.e. is there
 * an OPEN OPPOSITE-side position on the SAME UNDERLYING in another account of this firm?
 *
 * FAIL-OPEN on DB error (log; better to let a trade through than silently halt all trading) —
 * the firm's own risk desk also catches hedges; this gate is defense-in-depth.
 *
 * @param firmId          the signal's firm (e.g. "topstep")
 * @param symbol          the symbol about to be traded
 * @param side            "long" | "short" — the side about to be opened
 * @param excludeSessionId the current session (don't compare against itself)
 */
export async function checkCrossAccountHedge(
  firmId: string | null | undefined,
  symbol: string,
  side: string,
  excludeSessionId: string,
): Promise<CrossAccountHedgeResult> {
  if (!firmId) return { blocked: false };
  const underlying = symbolToUnderlying(symbol);
  const opposite = side === "long" ? "short" : side === "short" ? "long" : null;
  if (!opposite) return { blocked: false };

  try {
    const rows = (await db.execute(sql`
      SELECT pp.side AS side, pp.symbol AS symbol, pp.session_id AS session_id
      FROM paper_positions pp
      JOIN paper_sessions ps ON pp.session_id = ps.id
      WHERE pp.closed_at IS NULL
        AND ps.firm_id = ${firmId}
        AND pp.session_id <> ${excludeSessionId}
    `)) as unknown as Array<{ side: string; symbol: string; session_id: string }>;

    for (const r of rows) {
      if (symbolToUnderlying(r.symbol) !== underlying) continue;
      if (r.side === opposite) {
        return {
          blocked: true,
          conflictUnderlying: underlying,
          conflictSide: r.side,
          conflictSessionId: r.session_id,
        };
      }
    }
    return { blocked: false };
  } catch (err) {
    logger.error(
      { err, firmId, symbol, side },
      "cross-account-hedge gate DB read failed — fail-open (firm risk desk is the backstop)",
    );
    return { blocked: false };
  }
}

/**
 * INTRA-account hedge (MFFU Fair Play §5 + `hedgingSameUnderlyingBanned`): hedging is entering
 * BOTH a buy and a sell on the SAME UNDERLYING at the same time WITHIN ONE account — MFFU's own
 * example is "E-Mini NQ and Micro NQ have the same underlying NQ". The cross-account gate above
 * excludes the current session; this one checks the SAME session for an OPEN opposite-side
 * position on the same underlying (e.g. one strategy long MNQ while another is short NQ in the
 * same account). Symmetric with the cross-account gate (symbolToUnderlying collision; fail-open).
 *
 * @param sessionId the current paper session (the one account being traded)
 * @param symbol    the symbol about to be traded
 * @param side      "long" | "short" — the side about to be opened
 */
export async function checkIntraAccountHedge(
  sessionId: string | null | undefined,
  symbol: string,
  side: string,
): Promise<CrossAccountHedgeResult> {
  if (!sessionId) return { blocked: false };
  const underlying = symbolToUnderlying(symbol);
  const opposite = side === "long" ? "short" : side === "short" ? "long" : null;
  if (!opposite) return { blocked: false };

  try {
    const rows = (await db.execute(sql`
      SELECT pp.side AS side, pp.symbol AS symbol, pp.session_id AS session_id
      FROM paper_positions pp
      WHERE pp.closed_at IS NULL
        AND pp.session_id = ${sessionId}
    `)) as unknown as Array<{ side: string; symbol: string; session_id: string }>;

    for (const r of rows) {
      if (symbolToUnderlying(r.symbol) !== underlying) continue;
      if (r.side === opposite) {
        return {
          blocked: true,
          conflictUnderlying: underlying,
          conflictSide: r.side,
          conflictSessionId: r.session_id,
        };
      }
    }
    return { blocked: false };
  } catch (err) {
    logger.error(
      { err, sessionId, symbol, side },
      "intra-account-hedge gate DB read failed — fail-open (firm risk desk is the backstop)",
    );
    return { blocked: false };
  }
}
